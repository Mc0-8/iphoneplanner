// Long-press handling: hold ~0.4 s, then either release (opens a menu) or move (drag).
// Works with touch (iPhone) and mouse (testing on a computer).

const LONG_PRESS = 400;
let dragging = false;
let suppressClick = false;

// While dragging, stop the page from scrolling under the finger.
document.addEventListener('touchmove', (e) => { if (dragging) e.preventDefault(); }, { passive: false });
// The click that follows a long press must not also open the item.
document.addEventListener('click', (e) => {
  if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; }
}, true);

/**
 * @param el element to watch
 * @param handlers {onMenu, onDragStart(x,y), onDragMove(x,y), onDrop(x,y), onCancel}
 */
export function longPress(el, { onMenu, onDragStart, onDragMove, onDrop, onCancel }) {
  let timer = null, sx = 0, sy = 0, armed = false, moving = false;

  const begin = (x, y) => {
    sx = x; sy = y; armed = false; moving = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      armed = true;
      dragging = true;
      el.classList.add('lifted');
      try { navigator.vibrate?.(8); } catch { /* not supported */ }
    }, LONG_PRESS);
  };

  const move = (x, y, e) => {
    if (!armed) {
      if (Math.hypot(x - sx, y - sy) > 8) clearTimeout(timer); // it's a scroll or swipe
      return;
    }
    if (e?.cancelable) e.preventDefault();
    if (!moving && Math.hypot(x - sx, y - sy) > 6 && onDragStart) { moving = true; onDragStart(x, y); }
    if (moving) onDragMove?.(x, y);
  };

  const finish = (x, y, cancelled = false) => {
    clearTimeout(timer);
    if (!armed) return;
    armed = false;
    dragging = false;
    el.classList.remove('lifted');
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 450);
    if (moving) (cancelled ? onCancel?.() : onDrop?.(x, y));
    else if (!cancelled) onMenu?.();
    moving = false;
  };

  // Touch
  el.addEventListener('touchstart', (e) => { if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  el.addEventListener('touchmove', (e) => move(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
  el.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; finish(t.clientX, t.clientY); });
  el.addEventListener('touchcancel', () => finish(0, 0, true));

  // Mouse
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.sourceCapabilities?.firesTouchEvents) return;
    begin(e.clientX, e.clientY);
    const mm = (ev) => move(ev.clientX, ev.clientY, ev);
    const mu = (ev) => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); finish(ev.clientX, ev.clientY); };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
  });

  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** A floating copy of `el` that follows the finger. */
export function ghost(el, x, y) {
  const r = el.getBoundingClientRect();
  const g = el.cloneNode(true);
  g.classList.add('drag-ghost');
  g.classList.remove('lifted');
  Object.assign(g.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: 0 });
  document.body.append(g);
  const ox = x - r.left, oy = y - r.top;
  return {
    move(nx, ny) { g.style.left = `${nx - ox}px`; g.style.top = `${ny - oy}px`; },
    remove() { g.remove(); },
  };
}

/** Scroll `scroller` (an element or window) while the finger is near its top or bottom edge. */
export function autoScroller(scroller = window) {
  let raf = null, speed = 0;
  const tick = () => {
    if (!speed) { raf = null; return; }
    if (scroller === window) window.scrollBy(0, speed); else scroller.scrollTop += speed;
    raf = requestAnimationFrame(tick);
  };
  return {
    update(y) {
      const top = scroller === window ? 0 : scroller.getBoundingClientRect().top;
      const bottom = scroller === window ? innerHeight : scroller.getBoundingClientRect().bottom;
      const edge = 70;
      speed = y < top + edge ? -Math.ceil((top + edge - y) / 8) : y > bottom - edge - 60 ? Math.ceil((y - (bottom - edge - 60)) / 8) : 0;
      if (speed && !raf) raf = requestAnimationFrame(tick);
    },
    stop() { speed = 0; },
  };
}
