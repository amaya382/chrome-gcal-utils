(() => {
  const { decodeEventId, compilePatterns, groupDuplicates, layoutLanes, packRows } = globalThis.GCalUtilsCore;

  const DEFAULTS = { merge: true, hide: true, solo: true, patterns: '' };
  const STRIPE_WIDTH = 4;
  const UNSUPPORTED_VIEW = /\/r\/(month|year|agenda|schedule)(\/|$)/;

  let settings = { ...DEFAULTS };
  let patterns = [];

  // Every DOM change goes through this log so a run can be fully reverted before the next scan.
  const changes = [];
  const injected = [];
  const popContent = new WeakMap();

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
      const text = titleNode(eventEl);
      const s = chip.box.style;
      const rect = chip.box.getBoundingClientRect();
      chips.push({
        ...chip,
        ...decoded,
        eventEl,
        textNode: text,
        title: text ? text.textContent.trim() : '',
        color: colorOf(eventEl),
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
        items: hiddenChips.map((c) => ({ color: c.color, label: c.title })),
      });
      inject(badge, header);
    }
  }

  function merge(chips) {
    const visible = chips.filter((c) => !c.hidden);
    const groups = groupDuplicates(visible.map((c) => ({ ...c, scope: scopeKey(c.scope) })));
    for (const group of groups) {
      if (group.length < 2) continue;
      const members = group.map((i) => visible[i]);
      const keep = members.find((c) => isAccepted(c.eventEl)) || members[0];
      for (const c of members) {
        if (c === keep) continue;
        c.hidden = true;
        setStyle(c.box, 'display', 'none');
        setAttr(c.box, 'aria-hidden', 'true');
      }
      decorate(keep, members);
    }
  }

  function isAccepted(eventEl) {
    return !!(eventEl.style.backgroundColor || eventEl.querySelector('[role="button"]')?.style.backgroundColor);
  }

  const scopeIds = new WeakMap();
  let nextScopeId = 0;
  function scopeKey(node) {
    if (!scopeIds.has(node)) scopeIds.set(node, nextScopeId++);
    return scopeIds.get(node);
  }

  function decorate(keep, members) {
    const surface = keep.eventEl.matches('[role="button"]') ? keep.eventEl : keep.eventEl.querySelector('[role="button"]') || keep.eventEl;
    if (getComputedStyle(surface).position === 'static') setStyle(surface, 'position', 'relative');
    const basePadding = parseFloat(getComputedStyle(surface).paddingLeft) || 0;
    setStyle(surface, 'padding-left', `${basePadding + STRIPE_WIDTH * members.length}px`);

    const stripes = el('span', 'gcu-stripes');
    for (const m of members) {
      const stripe = el('span', 'gcu-stripe');
      stripe.style.background = m.color;
      stripes.appendChild(stripe);
    }
    inject(stripes, surface, surface.firstChild);

    if (keep.textNode) {
      inject(el('span', 'gcu-badge', `×${members.length}`), keep.textNode.parentElement, keep.textNode);
    }

    setAttr(keep.box, 'data-gcu-pop', '');
    popContent.set(keep.box, {
      heading: keep.title,
      items: members.map((m) => ({ color: m.color, label: m.calendarId })),
    });
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
    popover.replaceChildren(el('div', 'gcu-popover-heading', content.heading));
    for (const item of content.items) {
      const row = el('div', 'gcu-popover-item');
      const dot = el('span', 'gcu-popover-dot');
      dot.style.background = item.color;
      row.append(dot, el('span', '', item.label));
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

  document.addEventListener('mouseover', (e) => {
    const anchor = e.target.closest?.('[data-gcu-pop]');
    if (anchor !== popAnchor) anchor ? showPopover(anchor) : hidePopover();
  });

  function run() {
    observer.disconnect();
    undo();
    try {
      const main = document.querySelector('[role="main"]');
      if (main && isSupportedView() && (settings.hide || settings.merge)) {
        const chips = collectChips(main);
        if (settings.hide && patterns.length) hide(chips);
        if (settings.merge) merge(chips);
        relayout(chips);
      }
    } finally {
      if (popAnchor) popAnchor.isConnected && popContent.has(popAnchor) ? showPopover(popAnchor) : hidePopover();
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'data-eventid', 'aria-hidden'],
      });
    }
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  }

  const isOwn = (node) => node.nodeType === 1 && (node.className?.toString().startsWith('gcu-') || node === popover);
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => {
      if (isOwn(m.target)) return false;
      if (m.type !== 'childList') return true;
      return [...m.addedNodes, ...m.removedNodes].some((n) => !isOwn(n));
    });
    if (relevant) schedule();
  });

  function applySettings(next) {
    settings = { ...DEFAULTS, ...next };
    patterns = compilePatterns(settings.patterns).patterns;
    schedule();
  }

  chrome.storage.sync.get(DEFAULTS, applySettings);
  chrome.storage.onChanged.addListener((_, area) => {
    if (area === 'sync') chrome.storage.sync.get(DEFAULTS, applySettings);
  });
  window.addEventListener('resize', schedule);
  window.addEventListener('popstate', schedule);
})();
