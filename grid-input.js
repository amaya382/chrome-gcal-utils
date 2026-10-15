// Runs in the page's world so Google's own handlers see pointer positions in unfolded grid coordinates.
(() => {
  const { unfoldY } = globalThis.GCalUtilsCore;
  const TYPES = ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu'];
  const AXES = ['clientY', 'pageY', 'screenY', 'y', 'offsetY'];

  function translate(e) {
    const grid = document.querySelector('[data-gcu-fold]');
    if (!grid || e.target.closest?.('[class^="gcu-"]')) return;
    const rect = grid.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX >= rect.right || e.clientY < rect.top || e.clientY >= rect.bottom) return;
    let fold;
    try {
      fold = JSON.parse(grid.getAttribute('data-gcu-fold'));
    } catch {
      return;
    }
    const y = e.clientY - rect.top;
    const delta = unfoldY(y, fold.ranges, fold.band) - y;
    if (!delta) return;
    for (const axis of AXES) {
      const value = e[axis];
      Object.defineProperty(e, axis, { value: value + delta, configurable: true });
    }
  }

  for (const type of TYPES) window.addEventListener(type, translate, true);
})();
