(() => {
  const STATE_KEY = 'soloState';
  const POLL_MS = 50;
  const SETTLE_TIMEOUT_MS = 1500;
  const MAX_CLICKS_PER_CALENDAR = 3;

  let enabled = true;
  // { target: calendar key, saved: keys that were visible before solo started }
  let state = null;
  let busy = false;
  let lastOffset = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function calendarRows() {
    const rows = [];
    for (const checkbox of document.querySelectorAll('input[type="checkbox"]')) {
      if (checkbox.closest('[role="main"], [role="dialog"], .gcu-solo')) continue;
      const row = checkbox.closest('li, [role="listitem"]');
      if (!row) continue;
      const key = (checkbox.getAttribute('aria-label') || row.textContent || '').trim();
      if (key) rows.push({ row, checkbox, key });
    }
    return rows;
  }

  async function waitFor(condition) {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    while (!condition() && Date.now() < deadline) await sleep(POLL_MS);
  }

  // Google re-renders the list after each toggle, so rows are looked up again instead of reusing stale checkboxes.
  async function setVisible(isVisible) {
    const clicks = new Map();
    for (;;) {
      const pending = calendarRows().find(
        ({ checkbox, key }) => checkbox.checked !== isVisible(key) && (clicks.get(key) || 0) < MAX_CLICKS_PER_CALENDAR,
      );
      if (!pending) return;
      clicks.set(pending.key, (clicks.get(pending.key) || 0) + 1);
      pending.checkbox.click();
      await waitFor(() => calendarRows().find((r) => r.key === pending.key)?.checkbox.checked === isVisible(pending.key));
    }
  }

  async function toggle(key) {
    if (busy) return;
    busy = true;
    try {
      if (state?.target === key) {
        const saved = new Set(state.saved);
        state = null;
        await chrome.storage.local.remove(STATE_KEY);
        await setVisible((k) => saved.has(k));
      } else {
        const saved = state ? state.saved : calendarRows().filter((r) => r.checkbox.checked).map((r) => r.key);
        state = { target: key, saved };
        await chrome.storage.local.set({ [STATE_KEY]: state });
        await setVisible((k) => k === key);
      }
    } finally {
      busy = false;
      render();
    }
  }

  // Google shows the row's own buttons only while its inner area is hovered, so the offset is kept from the last time they were measurable.
  function placeButton(row, button) {
    const rowRect = row.getBoundingClientRect();
    let right = Infinity;
    for (const other of row.querySelectorAll('button, [role="button"]')) {
      if (other === button || button.contains(other)) continue;
      const r = other.getBoundingClientRect();
      if (r.width && r.left > rowRect.left + rowRect.width / 2) right = Math.min(right, r.left);
    }
    if (Number.isFinite(right)) lastOffset = rowRect.right - right + 2;
    button.style.right = `${lastOffset ?? 2}px`;
    button.classList.toggle('gcu-solo-unplaced', lastOffset == null);
  }

  function render() {
    observer.disconnect();
    for (const { row, key } of calendarRows()) {
      let button = row.querySelector('.gcu-solo');
      if (!enabled) {
        button?.remove();
        row.classList.remove('gcu-solo-row');
        continue;
      }
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'gcu-solo';
        // Google's row handlers react to press events too, which would toggle the row's own checkbox.
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
          button.addEventListener(type, (e) => e.stopPropagation());
        }
        button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle(button.dataset.key);
        });
        row.classList.add('gcu-solo-row');
        row.appendChild(button);
      }
      const active = state?.target === key;
      button.dataset.key = key;
      button.classList.toggle('gcu-solo-active', active);
      button.title = active ? 'Exit solo mode' : `Show only "${key}"`;
      button.setAttribute('aria-label', button.title);
      if (active) placeButton(row, button);
    }
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('mouseover', (e) => {
    const row = e.target.closest?.('.gcu-solo-row');
    const button = row?.querySelector('.gcu-solo');
    if (button) placeButton(row, button);
  });

  let timer = null;
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) =>
      [...m.addedNodes].some((n) => n.nodeType === 1 && !n.classList.contains('gcu-solo') && !n.classList.contains('gcu-popover')),
    );
    if (!relevant) return;
    clearTimeout(timer);
    timer = setTimeout(render, 200);
  });

  Promise.all([chrome.storage.sync.get({ solo: true }), chrome.storage.local.get(STATE_KEY)]).then(([sync, local]) => {
    enabled = sync.solo;
    state = local[STATE_KEY] || null;
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.solo) {
      enabled = changes.solo.newValue !== false;
      render();
    }
  });
})();
