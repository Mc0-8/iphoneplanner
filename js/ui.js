// Shared UI pieces: escaping, bottom sheets, toast, swipe-to-complete.

import { icon } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ---------- Bottom sheet ---------- */

let openSheetCount = 0;

/**
 * Opens a bottom sheet. `build(body, close)` fills the body.
 * Returns a close function.
 */
export function openSheet({ title, action, onAction, full = false, build, onClose, extra }) {
  const layer = document.getElementById('sheet-layer');
  const scrim = h('<div class="scrim"></div>');
  const sheet = h(`
    <section class="sheet${full ? ' full' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-bar">
        <h2>${esc(title)}</h2>
        <div>
          ${extra ? `<button class="icon-button" data-extra aria-label="${esc(extra.label)}">${icon(extra.icon, 22)}</button>` : ''}
          ${action ? `<button class="text-button primary" data-act>${esc(action)}</button>` : ''}
          <button class="icon-button" data-close aria-label="Close">${icon('x')}</button>
        </div>
      </div>
      <div class="sheet-body"></div>
    </section>`);
  scrim.style.zIndex = 40 + openSheetCount * 2;
  sheet.style.zIndex = 41 + openSheetCount * 2;
  layer.append(scrim, sheet);
  openSheetCount++;
  document.body.style.overflow = 'hidden';
  document.body.classList.add('sheet-open');

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    sheet.classList.remove('open');
    scrim.classList.remove('open');
    setTimeout(() => { sheet.remove(); scrim.remove(); }, 260);
    openSheetCount--;
    if (!openSheetCount) { document.body.style.overflow = ''; document.body.classList.remove('sheet-open'); }
    onClose?.();
  }

  scrim.addEventListener('click', close);
  sheet.querySelector('[data-close]').addEventListener('click', close);
  sheet.querySelector('[data-extra]')?.addEventListener('click', () => extra.onClick(close));
  const actBtn = sheet.querySelector('[data-act]');
  if (actBtn) actBtn.addEventListener('click', () => onAction?.(close));

  build(sheet.querySelector('.sheet-body'), close, actBtn);
  requestAnimationFrame(() => requestAnimationFrame(() => { sheet.classList.add('open'); scrim.classList.add('open'); }));
  return close;
}

/* ---------- Confirm (in-app, instead of the browser's dialog) ---------- */

export function confirmSheet({ title, message, confirm = 'Confirm' }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      onClose: () => { if (!answered) resolve(false); },
      build(body, close) {
        body.innerHTML = `
          <p style="margin:0 0 24px">${esc(message)}</p>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button type="button" class="text-button" data-no>Cancel</button>
            <button type="button" class="text-button primary" data-yes>${esc(confirm)}</button>
          </div>`;
        body.querySelector('[data-no]').addEventListener('click', close);
        body.querySelector('[data-yes]').addEventListener('click', () => { answered = true; resolve(true); close(); });
      },
    });
  });
}

/* ---------- Toast with optional undo ---------- */

let toastTimer;
export function toast(message, { undo, action, actionLabel = 'Undo', sticky = false } = {}) {
  undo = undo || action;
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.innerHTML = `<span>${esc(message)}</span>${undo ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  el.hidden = false;
  if (undo) {
    el.querySelector('button').addEventListener('click', () => { el.hidden = true; undo(); }, { once: true });
  }
  if (!sticky) toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 5000 : 2600);
}

/* ---------- Swipe right to complete, swipe left to delete ---------- */

export function enableSwipe(row, onComplete, onDelete) {
  const inner = row.querySelector('.row-inner');
  let startX = 0, startY = 0, dx = 0, tracking = false, decided = false;
  const THRESHOLD = 96;

  inner.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; dx = 0;
    tracking = true; decided = false;
  }, { passive: true });

  inner.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    const mx = t.clientX - startX, my = t.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = true;
      if (Math.abs(my) > Math.abs(mx) || (mx > 0 && !onComplete) || (mx < 0 && !onDelete)) { tracking = false; return; }
      inner.classList.add('dragging');
    }
    dx = onComplete ? mx : Math.min(0, mx);
    if (!onDelete) dx = Math.max(0, dx);
    row.classList.toggle('swipe-left', dx < 0);
    inner.style.transform = `translateX(${dx}px)`;
  }, { passive: true });

  const end = () => {
    if (!tracking) return;
    tracking = false;
    inner.classList.remove('dragging');
    if (dx > THRESHOLD && onComplete) {
      inner.style.transform = 'translateX(100%)';
      setTimeout(onComplete, 160);
    } else if (dx < -THRESHOLD && onDelete) {
      inner.style.transform = 'translateX(-100%)';
      setTimeout(onDelete, 160);
    } else {
      inner.style.transform = '';
    }
  };
  inner.addEventListener('touchend', end);
  inner.addEventListener('touchcancel', end);
}
