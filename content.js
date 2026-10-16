(() => {
  const {
    decodeEventId,
    compilePatterns,
    parseCalendarList,
    pickRepresentative,
    groupDuplicates,
    layoutLanes,
    packRows,
    foldRanges,
    foldY,
  } = globalThis.GCalUtilsCore;

  const DEFAULTS = {
    merge: true,
    hide: true,
    solo: true,
    patterns: '',
    priority: '',
    fold: true,
    earlyEnd: 8,
    lateStart: 20,
  };
  const FOLD_STATE_KEY = 'foldOpen';
  const STRIPE_WIDTH = 4;
  const BAND_HEIGHT = 20;
  // Chip tops sit a pixel above the hour line, so boundaries are compared with this slack.
  const EDGE_SLACK = 2;
  const UNSUPPORTED_VIEW = /\/r\/(month|year|agenda|schedule)(\/|$)/;

  let settings = { ...DEFAULTS };
  let patterns = [];
  let priority = [];
  // The chip picked from a merged popover stays the representative while its detail dialog is open.
  let pin = null;
  // Google may take a moment to open the dialog, so a pin that never saw one is dropped only after this delay.
  const PIN_TIMEOUT = 2000;
  let foldOpen = {};
  // Google scrolls the grid in unfolded coordinates, so the first fold of a grid converts its scroll position once.
  const foldedScrollers = new WeakSet();
  let keepInView = null;

  // Every DOM change goes through this log so a run can be fully reverted before the next scan.
  const changes = [];
  const injected = [];
  const popContent = new WeakMap();
  let applied = null;

  function setStyle(el, prop, value) {
    const old = el.style.getPropertyValue(prop);
    const oldPriority = el.style.getPropertyPriority(prop);
    el.style.setProperty(prop, value);
    // Store the serialized form, which may differ from `value`, so undo can tell our value from Google's.
    changes.push({ el, prop, old, oldPriority, value: el.style.getPropertyValue(prop) });
  }

  function setAttr(el, name, value) {
    changes.push({ el, attr: name, old: el.getAttribute(name), value });
    el.setAttribute(name, value);
  }

  function inject(node, parent, before = null) {
    parent.insertBefore(node, before);
    injected.push(node);
  }

  function undo() {
    while (injected.length) injected.pop().remove();
    while (changes.length) {
      const c = changes.pop();
      if (c.prop) {
        // Skip values Google has re-rendered since we wrote them.
        if (c.el.style.getPropertyValue(c.prop) !== c.value) continue;
        c.el.style.removeProperty(c.prop);
        if (c.old) c.el.style.setProperty(c.prop, c.old, c.oldPriority);
      } else {
        if (c.el.getAttribute(c.attr) !== c.value) continue;
        if (c.old === null) c.el.removeAttribute(c.attr);
        else c.el.setAttribute(c.attr, c.old);
      }
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function isPx(v) {
    return /^-?[\d.]+px$/.test(v);
  }

  function percentOf(v) {
    const m = /^(?:calc\()?\s*(-?[\d.]+)%/.exec(v);
    return m ? parseFloat(m[1]) : null;
  }

  function titleNode(root) {
    for (const hidden of root.querySelectorAll('[aria-hidden="true"]')) {
      const walker = document.createTreeWalker(hidden, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (t.textContent.trim() && !t.parentElement.closest('[class^="gcu-"]')) return t;
      }
    }
    return null;
  }

  function colorOf(root) {
    const candidates = [root, root.querySelector('[role="button"]')].filter(Boolean);
    for (const c of candidates) {
      const color = c.style.backgroundColor || c.style.borderColor;
      if (color) return color;
    }
    for (const c of candidates) {
      const color = getComputedStyle(c).backgroundColor;
      if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
    }
    return '#888';
  }

  function isAccepted(eventEl) {
    return !!(eventEl.style.backgroundColor || eventEl.querySelector('[role="button"]')?.style.backgroundColor);
  }

  // Google states the RSVP only in the screen-reader text; the chip's colors cannot tell "needs RSVP" from "declined".
  const DECLINED = /\bdeclined\b|辞退|不参加/i;
  const UNDECIDED = /needs rsvp|\btentative\b|\bmaybe\b|未定|未回答|出欠|返信/i;

  function screenReaderText(eventEl) {
    let text = '';
    const walker = document.createTreeWalker(eventEl, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.parentElement.closest('[aria-hidden="true"], [class^="gcu-"]')) text += ` ${t.textContent}`;
    }
    return text;
  }

  function statusOf(eventEl) {
    const text = screenReaderText(eventEl);
    if (DECLINED.test(text)) return 'declined';
    if (UNDECIDED.test(text)) return 'tentative';
    return isAccepted(eventEl) ? 'accepted' : 'tentative';
  }

  function chipOf(eventEl) {
    // Walk up to the element Google positions; a few levels cover both the button and its wrapper.
    for (let node = eventEl, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
      if (node.hasAttribute('data-stacked-layout-chip-container')) {
        const s = node.style;
        if (percentOf(s.left) == null || percentOf(s.width) == null || !/em$/.test(s.top)) return null;
        return { kind: 'allday', box: node, scope: node.closest('[role="row"]') || node.parentElement };
      }
      if (isPx(node.style.top) && isPx(node.style.height)) {
        return { kind: 'timed', box: node, scope: node.closest('[role="gridcell"]') || node.parentElement };
      }
    }
    return null;
  }

  function collectChips(main) {
    const chips = [];
    const seen = new Set();
    for (const eventEl of main.querySelectorAll('[data-eventid]')) {
      if (eventEl.parentElement.closest('[data-eventid]')) continue;
      const decoded = decodeEventId(eventEl.getAttribute('data-eventid'));
      if (!decoded) continue;
      const chip = chipOf(eventEl);
      if (!chip || seen.has(chip.box)) continue;
      seen.add(chip.box);
      const s = chip.box.style;
      const rect = chip.box.getBoundingClientRect();
      chips.push({
        ...chip,
        ...decoded,
        eid: eventEl.getAttribute('data-eventid'),
        eventEl,
        title: titleNode(eventEl)?.textContent.trim() || '',
        color: colorOf(eventEl),
        status: statusOf(eventEl),
        pos: chip.kind === 'timed' ? `${s.top}|${s.height}` : `${s.left}|${s.width}|${s.top}`,
        anchorX: chip.kind === 'timed' ? rect.left + rect.width / 2 : rect.left + 4,
        hidden: false,
      });
    }
    return chips;
  }

  function headerAt(x) {
    for (const header of document.querySelectorAll('[role="main"] [role="columnheader"]')) {
      const r = header.getBoundingClientRect();
      if (r.width && x >= r.left && x < r.right) return header;
    }
    return null;
  }

  function hide(chips) {
    const byHeader = new Map();
    for (const chip of chips) {
      if (!patterns.some((p) => p.test(chip.title))) continue;
      chip.hidden = true;
      setStyle(chip.box, 'display', 'none');
      const header = headerAt(chip.anchorX);
      if (!header) continue;
      if (!byHeader.has(header)) byHeader.set(header, []);
      byHeader.get(header).push(chip);
    }
    for (const [header, hiddenChips] of byHeader) {
      if (getComputedStyle(header).position === 'static') setStyle(header, 'position', 'relative');
      const badge = el('span', 'gcu-hidden-badge', `⊘${hiddenChips.length}`);
      badge.setAttribute('data-gcu-pop', '');
      popContent.set(badge, {
        heading: 'Hidden by GCal Utils',
        items: hiddenChips.map((c) => ({ color: c.color, status: c.status, label: c.title })),
      });
      inject(badge, header);
    }
  }

  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

  function ownEmail() {
    for (const node of document.querySelectorAll('header [aria-label*="@"], [role="banner"] [aria-label*="@"]')) {
      const m = EMAIL.exec(node.getAttribute('aria-label'));
      if (m) return m[0].toLowerCase();
    }
    return null;
  }

  function merge(chips) {
    const visible = chips.filter((c) => !c.hidden);
    const groups = groupDuplicates(visible.map((c) => ({ ...c, scope: scopeKey(c.scope) })));
    const own = ownEmail();
    const order = own ? [own, ...priority.filter((id) => id !== own)] : priority;
    for (const group of groups) {
      if (group.length < 2) continue;
      const members = group.map((i) => visible[i]);
      const { keep, preferred } = pickRepresentative(members, order, pin?.eid);
      for (const c of members) {
        if (c === keep) continue;
        c.hidden = true;
        setStyle(c.box, 'display', 'none');
        setAttr(c.box, 'aria-hidden', 'true');
      }
      const byCalendar = new Map();
      for (const m of [keep, ...members]) if (!byCalendar.has(m.calendarId)) byCalendar.set(m.calendarId, m);
      keep.members = [...byCalendar.values()];
      decorate(keep, keep.members, preferred);
    }
  }

  const scopeIds = new WeakMap();
  let nextScopeId = 0;
  function scopeKey(node) {
    if (!scopeIds.has(node)) scopeIds.set(node, nextScopeId++);
    return scopeIds.get(node);
  }

  // Stripes are painted as a background instead of child nodes: Google re-renders chip children and drops its own title next to foreign nodes.
  // Without a priority calendar no member's color is more relevant, so the whole chip is split evenly instead.
  function decorate(keep, calendars, preferred) {
    const surface = surfaceOf(keep);
    if (!preferred) {
      const share = 100 / calendars.length;
      const stops = calendars.map((c, i) => `${c.color} ${i * share}% ${(i + 1) * share}%`);
      setStyle(surface, 'background-image', `linear-gradient(to right, ${stops.join(', ')})`);
      setStyle(surface, 'outline', '1.5px dashed #5f6368');
      setStyle(surface, 'outline-offset', '-1.5px');
      return;
    }
    const basePadding = parseFloat(getComputedStyle(surface).paddingLeft) || 0;
    const width = STRIPE_WIDTH * calendars.length;
    const stops = calendars.map((c, i) => `${c.color} ${i * STRIPE_WIDTH}px ${(i + 1) * STRIPE_WIDTH}px`);
    setStyle(surface, 'padding-left', `${basePadding + width}px`);
    setStyle(surface, 'background-image', `linear-gradient(to right, ${stops.join(', ')})`);
    setStyle(surface, 'background-size', `${width}px 100%`);
    setStyle(surface, 'background-repeat', 'no-repeat');
  }

  function surfaceOf(chip) {
    const { eventEl } = chip;
    return eventEl.matches('[role="button"]') ? eventEl : eventEl.querySelector('[role="button"]') || eventEl;
  }

  function attachPopovers(chips) {
    for (const chip of chips) {
      if (chip.hidden) continue;
      const members = chip.members || [chip];
      setAttr(chip.box, 'data-gcu-pop', '');
      popContent.set(chip.box, {
        heading: chip.title || members.find((m) => m.title)?.title || '',
        interactive: members.length > 1,
        items: members.map((m) => ({
          color: m.color,
          status: m.status,
          label: m.calendarId,
          eid: m.eid,
          current: m === chip,
        })),
      });
    }
  }

  function relayout(chips) {
    const scopes = new Map();
    for (const chip of chips) {
      if (!scopes.has(chip.scope)) scopes.set(chip.scope, []);
      scopes.get(chip.scope).push(chip);
    }
    for (const scopeChips of scopes.values()) {
      if (!scopeChips.some((c) => c.hidden)) continue;
      const visible = scopeChips.filter((c) => !c.hidden);
      if (scopeChips[0].kind === 'timed') relayoutTimed(visible);
      else relayoutAllDay(scopeChips, visible);
    }
  }

  function relayoutTimed(visible) {
    const items = visible.map((c) => {
      const top = parseFloat(c.box.style.top);
      return { top, bottom: top + parseFloat(c.box.style.height) };
    });
    layoutLanes(items).forEach(({ left, width }, i) => {
      setStyle(visible[i].box, 'left', `calc(${left}% + 0px)`);
      setStyle(visible[i].box, 'width', `calc(${width}% - 2px)`);
    });
  }

  function relayoutAllDay(all, visible) {
    const tops = [...new Set(all.map((c) => parseFloat(c.box.style.top)))].sort((a, b) => a - b);
    const base = tops[0];
    const pitch = tops.slice(1).reduce((min, t, i) => Math.min(min, t - tops[i]), Infinity);
    const rowOf = (c) => (Number.isFinite(pitch) ? Math.round((parseFloat(c.box.style.top) - base) / pitch) : 0);
    const oldRows = Math.max(...all.map(rowOf)) + 1;

    const spans = visible.map((c) => {
      const left = percentOf(c.box.style.left);
      return { start: left, end: left + percentOf(c.box.style.width), row: rowOf(c) };
    });
    const rows = packRows(spans);
    rows.forEach((row, i) => {
      if (row !== spans[i].row) setStyle(visible[i].box, 'top', `${base + row * pitch}em`);
    });

    const newRows = rows.length ? Math.max(...rows) + 1 : 0;
    if (!Number.isFinite(pitch) || newRows >= oldRows) return;
    const shrinkPx = (oldRows - newRows) * pitch * parseFloat(getComputedStyle(all[0].box).fontSize);
    const area = allDayArea(all[0].box);
    if (area && Number.isFinite(shrinkPx)) setStyle(area, 'height', `calc(${area.style.height} - ${shrinkPx}px)`);
  }

  function allDayArea(box) {
    const stop = box.closest('[role="row"]');
    if (!stop) return null;
    for (let node = box.parentElement; node && node !== stop.parentElement; node = node.parentElement) {
      if (/(px|em)$/.test(node.style.height)) return node;
    }
    return null;
  }

  function hourLabel(hour) {
    return `${String(hour).padStart(2, '0')}:00`;
  }

  function scrollerOf(node) {
    for (let n = node.parentElement; n && n !== document.body; n = n.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n;
    }
    return null;
  }

  // Google renders the hour labels and the hour lines as two lists of 24 equally tall rows.
  function hourLists(main, hourHeight) {
    const lists = [];
    for (const node of main.querySelectorAll('*')) {
      if (node.childElementCount < 24) continue;
      const rows = [...node.children].filter((c) => Math.abs(c.offsetHeight - hourHeight) < 1);
      if (rows.length === 24) lists.push(rows);
    }
    return lists;
  }

  function prepareFold(main, chips) {
    const cells = [...main.querySelectorAll('[role="gridcell"][data-datekey]')];
    if (!cells.length) return null;
    const hourHeight =
      parseFloat(getComputedStyle(cells[0]).getPropertyValue('--cal-timed-grid-cell-height')) || cells[0].offsetHeight / 24;
    if (!(hourHeight > 0)) return null;
    const lists = hourLists(main, hourHeight);
    if (!lists.length) return null;

    const ranges = foldRanges(settings.earlyEnd, settings.lateStart).map((r) => ({
      ...r,
      top: r.start * hourHeight,
      bottom: r.end * hourHeight,
      open: !!foldOpen[r.name],
      folded: new Map(),
    }));
    const closed = ranges.filter((r) => !r.open);
    for (const chip of chips) {
      if (chip.hidden || chip.kind !== 'timed') continue;
      const top = parseFloat(chip.box.style.top);
      const bottom = top + parseFloat(chip.box.style.height);
      const range = closed.find((r) => top >= r.top - EDGE_SLACK && bottom <= r.bottom + EDGE_SLACK);
      if (!range) continue;
      chip.hidden = true;
      setStyle(chip.box, 'display', 'none');
      if (!range.folded.has(chip.scope)) range.folded.set(chip.scope, []);
      range.folded.get(chip.scope).push(chip);
    }
    return { cells, hourHeight, lists, ranges, closed };
  }

  function applyFold({ cells, hourHeight, lists, ranges, closed }, chips) {
    const map = (y) => foldY(y, closed, BAND_HEIGHT);

    for (const rows of lists) {
      for (const r of closed) {
        setStyle(rows[r.start], 'height', `${BAND_HEIGHT}px`);
        for (let h = r.start + 1; h < r.end; h++) setStyle(rows[h], 'display', 'none');
      }
      const fullHeight = 24 * hourHeight;
      for (let node = rows[0].parentElement; node && node !== document.body; node = node.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) break;
        if (Math.abs(node.offsetHeight - fullHeight) <= 3) setStyle(node, 'height', 'auto');
      }
    }

    for (const chip of chips) {
      if (chip.hidden || chip.kind !== 'timed') continue;
      let top = parseFloat(chip.box.style.top);
      let bottom = top + parseFloat(chip.box.style.height);
      const clip = [];
      for (const r of closed) {
        if (top >= r.top - EDGE_SLACK && top < r.bottom - EDGE_SLACK && bottom > r.bottom) {
          top = r.bottom;
          clip.push('top');
        }
        if (top < r.top && bottom > r.top + EDGE_SLACK && bottom <= r.bottom + EDGE_SLACK) {
          bottom = r.top;
          clip.push('bottom');
        }
      }
      setStyle(chip.box, 'top', `${map(top)}px`);
      setStyle(chip.box, 'height', `${Math.max(0, map(bottom) - map(top))}px`);
      if (clip.length) setAttr(chip.box, 'data-gcu-clip', clip.join(' '));
    }

    for (const cell of cells) {
      for (const marker of cell.children) {
        if (marker.hasAttribute('data-eventid') || !isPx(marker.style.top)) continue;
        const y = parseFloat(marker.style.top);
        if (closed.some((r) => y > r.top && y < r.bottom)) setStyle(marker, 'display', 'none');
        else setStyle(marker, 'top', `${map(y)}px`);
      }
    }

    const row = cells[0].parentElement;
    if (closed.length) {
      setAttr(row, 'data-gcu-fold', JSON.stringify({ ranges: closed.map(({ top, bottom }) => ({ top, bottom })), band: BAND_HEIGHT }));
    }
    const left = cells[0].offsetLeft;
    const last = cells[cells.length - 1];
    const width = last.offsetLeft + last.offsetWidth - left;
    const controls = new Map();
    for (const r of ranges) {
      const label = `${hourLabel(r.start)}–${hourLabel(r.end)}`;
      const control = r.open ? foldPill(r, label) : foldBand(r, label, cells, left);
      control.style.top = `${map(r.top)}px`;
      control.style.left = `${left}px`;
      if (!r.open) control.style.width = `${width}px`;
      inject(control, row);
      controls.set(r.name, control);
    }

    const scroller = scrollerOf(cells[0]);
    if (!scroller) return;
    if (keepInView && controls.has(keepInView.name)) {
      scroller.scrollTop += controls.get(keepInView.name).getBoundingClientRect().top - keepInView.top;
    } else if (!foldedScrollers.has(scroller)) {
      scroller.scrollTop = map(scroller.scrollTop);
    }
    foldedScrollers.add(scroller);
    keepInView = null;
  }

  function foldBand(range, label, cells, left) {
    const band = el('div', 'gcu-fold-band');
    band.style.height = `${BAND_HEIGHT}px`;
    band.title = `${label} folded — click to expand`;
    band.appendChild(el('span', 'gcu-fold-label', `▸ ${label}`));
    for (const cell of cells) {
      const folded = range.folded.get(cell) || [];
      if (!folded.length) continue;
      const slot = el('span', 'gcu-fold-slot');
      slot.style.left = `${cell.offsetLeft - left}px`;
      slot.style.width = `${cell.offsetWidth}px`;
      const count = el('span', 'gcu-fold-count', `+${folded.length}`);
      count.setAttribute('data-gcu-pop', '');
      popContent.set(count, {
        heading: label,
        items: folded.map((c) => ({ color: c.color, status: c.status, label: c.title })),
      });
      slot.appendChild(count);
      band.appendChild(slot);
    }
    return withToggle(band, range);
  }

  function foldPill(range, label) {
    const pill = el('button', 'gcu-fold-pill', `▾ ${label}`);
    pill.type = 'button';
    pill.title = `Fold ${label}`;
    return withToggle(pill, range);
  }

  function withToggle(node, range) {
    // Keep presses away from Google's grid, which would start creating an event.
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick']) {
      node.addEventListener(type, (e) => e.stopPropagation());
    }
    node.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      keepInView = { name: range.name, top: node.getBoundingClientRect().top };
      foldOpen = { ...foldOpen, [range.name]: !range.open };
      chrome.storage.local.set({ [FOLD_STATE_KEY]: foldOpen });
      invalidate();
    });
    return node;
  }

  function isSupportedView() {
    if (UNSUPPORTED_VIEW.test(location.pathname)) return false;
    return !document.querySelector('[data-viewkey="MONTH"], [data-viewkey="YEAR"], [data-viewkey="AGENDA"]');
  }

  // Popover: one fixed element reused for every hover target so chip/header overflow never clips it.
  const popover = el('div', 'gcu-popover');
  let popAnchor = null;

  function showPopover(anchor) {
    const content = popContent.get(anchor);
    if (!content) return hidePopover();
    popAnchor = anchor;
    popover.classList.toggle('gcu-interactive', !!content.interactive);
    popover.replaceChildren(el('div', 'gcu-popover-heading', content.heading));
    for (const item of content.items) {
      const row = el(content.interactive ? 'button' : 'div', `gcu-popover-item gcu-${item.status}`);
      const dot = el('span', `gcu-popover-dot gcu-${item.status}`);
      dot.style.setProperty('--gcu-color', item.color);
      row.append(dot, el('span', 'gcu-popover-label', item.label));
      if (content.interactive) {
        row.type = 'button';
        row.classList.toggle('gcu-current', item.current);
        row.addEventListener('click', () => openMember(item.eid));
      }
      popover.appendChild(row);
    }
    if (!popover.isConnected) document.body.appendChild(popover);
    const r = anchor.getBoundingClientRect();
    popover.style.display = 'block';
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const below = r.bottom + 4 + height <= window.innerHeight;
    popover.style.left = `${left}px`;
    popover.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - height - 4)}px`;
  }

  function hidePopover() {
    popAnchor = null;
    popover.style.display = 'none';
  }

  // The slack covers the gap between a chip and its popover so the pointer can travel into it.
  const POPOVER_SLACK = 8;

  function isOverPopover(x, y) {
    if (!popAnchor || !popover.classList.contains('gcu-interactive')) return false;
    const r = popover.getBoundingClientRect();
    const s = POPOVER_SLACK;
    return x >= r.left - s && x < r.right + s && y >= r.top - s && y < r.bottom + s;
  }

  // Hit-test injected badges by geometry as well, since Google's header layers can sit above them.
  function anchorAt(x, y) {
    if (isOverPopover(x, y)) return popAnchor;
    const hit = document.elementFromPoint(x, y)?.closest('[data-gcu-pop]');
    if (hit) return hit;
    return (
      injected.find((node) => {
        if (!node.hasAttribute('data-gcu-pop')) return false;
        const r = node.getBoundingClientRect();
        return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
      }) || null
    );
  }

  let pointer = null;
  function updatePopover() {
    const anchor = pointer ? anchorAt(pointer.x, pointer.y) : null;
    if (anchor === popAnchor) return;
    anchor ? showPopover(anchor) : hidePopover();
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      updatePopover();
    },
    { capture: true, passive: true },
  );
  document.documentElement.addEventListener('mouseleave', () => {
    pointer = null;
    updatePopover();
  });

  // Showing the member as the representative first gives Google a visible chip to open its detail dialog from.
  function openMember(eid) {
    hidePopover();
    pin = { eid, since: Date.now(), sawDialog: false };
    applied = null;
    run();
    const target = [...document.querySelectorAll('[role="main"] [data-eventid]')].find(
      (e) => e.getAttribute('data-eventid') === eid,
    );
    if (!target) return;
    const surface = surfaceOf({ eventEl: target });
    const r = surface.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    for (const type of ['mousedown', 'mouseup', 'click']) surface.dispatchEvent(new MouseEvent(type, init));
  }

  function eventBoxes(main) {
    return [...main.querySelectorAll('[data-eventid]')].map((e) => {
      const box = chipOf(e)?.box;
      return `${e.getAttribute('data-eventid')}|${box ? box.style.cssText : ''}`;
    });
  }

  // Re-applying on every mutation would rewrite the DOM Google just rendered and invite another round of re-renders.
  function isIntact(main) {
    if (!applied || applied.main !== main || applied.path !== location.pathname) return false;
    if (injected.some((node) => !node.isConnected)) return false;
    if (!changes.every((c) => (c.prop ? c.el.style.getPropertyValue(c.prop) : c.el.getAttribute(c.attr)) === c.value)) {
      return false;
    }
    const events = main.querySelectorAll('[data-eventid]');
    if (events.length !== applied.events.length || [...events].some((e, i) => e !== applied.events[i])) return false;
    const boxes = eventBoxes(main);
    return boxes.every((b, i) => b === applied.boxes[i]);
  }

  function run() {
    if (pin) {
      if (document.querySelector('[role="dialog"]')) pin.sawDialog = true;
      else if (pin.sawDialog || Date.now() - pin.since > PIN_TIMEOUT) {
        pin = null;
        applied = null;
      }
    }
    const main = document.querySelector('[role="main"]');
    const active = main && isSupportedView() && (settings.hide || settings.merge || settings.fold);
    if (active ? isIntact(main) : !applied && !changes.length && !injected.length) return;
    observer.disconnect();
    undo();
    applied = null;
    try {
      if (active) {
        const chips = collectChips(main);
        if (settings.hide && patterns.length) hide(chips);
        if (settings.merge) merge(chips);
        const fold = settings.fold ? prepareFold(main, chips) : null;
        relayout(chips);
        if (fold) applyFold(fold, chips);
        if (settings.merge) attachPopovers(chips);
        applied = {
          main,
          path: location.pathname,
          events: [...main.querySelectorAll('[data-eventid]')],
          boxes: eventBoxes(main),
        };
      }
    } finally {
      popAnchor = null;
      updatePopover();
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'data-eventid', 'aria-hidden'],
      });
    }
  }

  // Run in the next frame, before paint, so Google's re-render is never shown without our changes.
  let frame = 0;
  function schedule() {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        run();
      });
    }
  }

  function invalidate() {
    applied = null;
    schedule();
  }

  const isOwn = (node) => node.nodeType === 1 && (node.className?.toString().startsWith('gcu-') || node === popover);
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => {
      if (isOwn(m.target)) return false;
      if (m.type !== 'childList') return true;
      // Our own nodes are only removed by us while disconnected, so a removal seen here means Google dropped one.
      return m.removedNodes.length > 0 || [...m.addedNodes].some((n) => !isOwn(n));
    });
    if (relevant) schedule();
  });

  function applySettings(next) {
    settings = { ...DEFAULTS, ...next };
    patterns = compilePatterns(settings.patterns).patterns;
    priority = parseCalendarList(settings.priority);
    invalidate();
  }

  chrome.storage.sync.get(DEFAULTS, applySettings);
  chrome.storage.local.get(FOLD_STATE_KEY, (local) => {
    foldOpen = local[FOLD_STATE_KEY] || {};
    invalidate();
  });
  chrome.storage.onChanged.addListener((changed, area) => {
    if (area === 'sync') chrome.storage.sync.get(DEFAULTS, applySettings);
    if (area === 'local' && changed[FOLD_STATE_KEY]) {
      foldOpen = changed[FOLD_STATE_KEY].newValue || {};
      invalidate();
    }
  });
  window.addEventListener('resize', invalidate);
  window.addEventListener('popstate', invalidate);
})();
