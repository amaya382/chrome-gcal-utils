// Google Calendar has its own theme setting, so prefers-color-scheme alone cannot tell which theme the page shows.
(() => {
  const { isDarkColor } = globalThis.GCalUtilsCore;
  const ATTR = 'data-gcu-theme';
  const scheme = matchMedia('(prefers-color-scheme: dark)');

  // Computed colors may come back in any CSS color syntax, so a canvas resolves them to RGBA bytes.
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const resolved = new Map();
  function rgbaOf(color) {
    if (resolved.has(color)) return resolved.get(color);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'transparent';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const rgba = [...ctx.getImageData(0, 0, 1, 1).data];
    resolved.set(color, rgba);
    return rgba;
  }

  function isDark() {
    const start = document.querySelector('[role="main"]') || document.body || document.documentElement;
    for (let node = start; node; node = node.parentElement) {
      const dark = isDarkColor(rgbaOf(getComputedStyle(node).backgroundColor));
      if (dark !== null) return dark;
    }
    const text = isDarkColor(rgbaOf(getComputedStyle(start).color));
    if (text !== null) return !text;
    return scheme.matches;
  }

  let frame = 0;
  function update() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const theme = isDark() ? 'dark' : 'light';
      if (document.documentElement.getAttribute(ATTR) !== theme) document.documentElement.setAttribute(ATTR, theme);
    });
  }

  // Theme switches arrive as class changes, stylesheet swaps, or re-rendered views; checks are batched per frame.
  new MutationObserver(update).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  scheme.addEventListener('change', update);
  update();
})();
