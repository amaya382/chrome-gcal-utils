(() => {
  const STATE_KEY = 'soloState';
  const CLICK_INTERVAL_MS = 50;

  let enabled = true;
  // { target: calendar key, saved: keys that were visible before solo started }
  let state = null;
  let busy = false;

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

  async function setVisible(rows, isVisible) {
    for (const { checkbox, key } of rows) {
      if (checkbox.checked === isVisible(key)) continue;
      checkbox.click();
      await sleep(CLICK_INTERVAL_MS);
    }
  }

  async function toggle(key) {
    if (busy) return;
    busy = true;
    try {
      const rows = calendarRows();
      if (state?.target === key) {
        const saved = new Set(state.saved);
        state = null;
        await chrome.storage.local.remove(STATE_KEY);
        await setVisible(rows, (k) => saved.has(k));
      } else {
        const saved = state ? state.saved : rows.filter((r) => r.checkbox.checked).map((r) => r.key);
        state = { target: key, saved };
        await chrome.storage.local.set({ [STATE_KEY]: state });
        await setVisible(rows, (k) => k === key);
      }
    } finally {
      busy = false;
      render();
    }
  }

  function placeButton(row, button) {
    const rowRect = row.getBoundingClientRect();
    let right = rowRect.right;
    for (const other of row.querySelectorAll('button, [role="button"]')) {
      if (other === button || button.contains(other)) continue;
      const r = other.getBoundingClientRect();
      if (r.width && r.left > rowRect.left + rowRect.width / 2) right = Math.min(right, r.left);
    }
    button.style.right = `${rowRect.right - right + 2}px`;
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
    if (button && !row.contains(e.relatedTarget)) placeButton(row, button);
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
