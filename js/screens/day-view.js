// Zoomed day: opens from a day in the Week tab. Shows the day on an hour grid with
// everything that's on it, plus stats, a subject breakdown and what's due.
// Hold and drag a block to change its time, or drop it on a day in the strip to move it there.

import { icon } from '../icons.js';
import { esc, h, toast } from '../ui.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { describe, openBlockMenu } from '../block-ui.js';
import { longPress, autoScroller } from '../drag.js';
import { todayKey, addDays, mondayOf, fromKey, dayTitle, fromMin, formatMinutes, nowMin, shortDate } from '../dates.js';
import { windowFor, commitmentsOn, horizonEnd } from '../scheduler.js';

const PX = 1.15; // pixels per minute
const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

let layer = null;

export function openDayView(key, originEl) {
  closeDayView(true);
  layer = h(`<section class="zoom" role="dialog" aria-modal="true" aria-label="Day"></section>`);
  document.body.append(layer);
  document.body.classList.add('zoom-open');

  if (originEl) {
    const r = originEl.getBoundingClientRect();
    layer.style.transformOrigin = `${r.left + r.width / 2}px ${r.top + r.height / 2}px`;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => layer?.classList.add('open')));

  let current = key;
  const draw = (scrollToFocus = false) => render(layer, current, (k) => { current = k; draw(true); }, scrollToFocus);
  draw(true);
  const unsub = store.subscribe(() => { if (layer && !document.body.querySelector('.drag-src, .dragging-z')) draw(false); });
  layer._unsub = unsub;
  layer._onKey = (e) => { if (e.key === 'Escape') closeDayView(); };
  document.addEventListener('keydown', layer._onKey);
}

export function closeDayView(instant = false) {
  if (!layer) return;
  const el = layer;
  layer = null;
  el._unsub?.();
  document.removeEventListener('keydown', el._onKey);
  document.body.classList.remove('zoom-open');
  if (instant) { el.remove(); return; }
  el.classList.remove('open');
  setTimeout(() => el.remove(), 240);
}

function render(root, key, go, scrollToFocus) {
  const today = todayKey();
  const first = today, last = horizonEnd(today);
  const prevScroll = root.querySelector('.zoom-body')?.scrollTop;
  const blocks = state.blocks.filter((b) => b.date === key && !(b.status === 'missed' && key >= today));
  const fixed = commitmentsOn(state.commitments, key, state.habits);
  const win = windowFor(state.settings, state.daysOff, key);
  const live = blocks.filter((b) => b.status !== 'missed');
  const planned = live.reduce((s, b) => s + b.duration, 0);
  const done = live.filter((b) => b.status === 'done').reduce((s, b) => s + b.duration, 0);
  const cap = state.settings.dailyCap;
  const freeInWindow = win ? Math.max(0, (win[1] - win[0]) - overlap(win, fixed.map((c) => [c.s, c.e])) - planned) : 0;
  const free = Math.max(0, Math.min(freeInWindow, cap - planned));

  // Subject / task breakdown
  const parts = new Map();
  for (const b of live) {
    const d = describe(b);
    const k = b.kind === 'study' ? 's:' + b.subjectId : 'tasks';
    const p = parts.get(k) || { name: b.kind === 'study' ? d.title : 'Tasks', colour: d.dot || null, min: 0 };
    p.min += b.duration;
    parts.set(k, p);
  }
  const due = state.tasks.filter((t) => !t.completed && t.deadline === key && t.dateMode !== 'on');

  // Grid range
  const starts = [...blocks.map((b) => b.start), ...fixed.map((c) => c.s), win ? win[0] : 16 * 60];
  const ends = [...blocks.map((b) => b.start + b.duration), ...fixed.map((c) => c.e), win ? win[1] : 21 * 60];
  const g0 = Math.max(0, Math.floor(Math.min(...starts) / 60) * 60 - 60);
  const g1 = Math.min(1440, Math.ceil(Math.max(...ends) / 60) * 60);
  const y = (m) => (m - g0) * PX;

  const monday = mondayOf(key);
  root.innerHTML = `
    <header class="zoom-bar">
      <button class="icon-button" data-close aria-label="Close">${icon('x', 22)}</button>
      <h2>${esc(dayTitle(key))}</h2>
      <div class="zoom-nav">
        <button class="icon-button" data-go="-1" aria-label="Previous day" ${key <= first ? 'disabled' : ''}>${icon('caretLeft', 20)}</button>
        <button class="icon-button" data-go="1" aria-label="Next day" ${key >= last ? 'disabled' : ''}>${icon('caretRight', 20)}</button>
      </div>
    </header>
    <div class="zoom-strip">
      ${Array.from({ length: 7 }, (_, i) => {
        const k = addDays(monday, i);
        const load = state.blocks.filter((b) => b.date === k && b.status !== 'missed').reduce((s, b) => s + b.duration, 0);
        const out = k < first || k > last;
        return `<button class="zchip${k === key ? ' on' : ''}${k === today ? ' today' : ''}" data-day="${k}" ${out ? 'disabled' : ''}>
          <span>${LETTERS[i]}</span><strong class="num">${fromKey(k).getDate()}</strong><i style="width:${Math.min(100, (load / cap) * 100)}%"></i></button>`;
      }).join('')}
    </div>
    <div class="zoom-body">
      <div class="zstats">
        <div><strong class="num">${formatMinutes(planned)}</strong><span>planned</span></div>
        <div><strong class="num">${formatMinutes(done)}</strong><span>done</span></div>
        <div><strong class="num">${win ? formatMinutes(free) : '–'}</strong><span>${win ? 'still free' : 'day off'}</span></div>
      </div>
      <p class="zcap">${win
        ? `Free ${fromMin(win[0])}–${fromMin(win[1])} · daily limit ${formatMinutes(cap)}${planned > cap ? ' <span class="warn">(over)</span>' : ''}`
        : 'Day off. Nothing new is planned today.'}</p>
      <button type="button" class="link-button zbusy" data-busy>${icon('clock', 14)} ${key === today ? 'Busy until…' : 'Mark busy time…'}</button>
      ${parts.size ? `<div class="zparts">${[...parts.values()].sort((a, b) => b.min - a.min).map((p) =>
        `<span class="zpart">${p.colour ? `<span class="dot" style="background:${p.colour}"></span>` : ''}${esc(p.name)} <span class="num muted">${formatMinutes(p.min)}</span></span>`).join('')}</div>` : ''}
      ${due.length ? `<div class="zdue"><h3>Due ${key === today ? 'today' : 'this day'}</h3>${due.map((t) =>
        `<p>${t.type === 'exam' ? icon('exam', 16) : icon('flag', 16)}<span>${esc(t.title)}${t.type === 'exam' ? ' <span class="muted">exam</span>' : ''}</span></p>`).join('')}</div>` : ''}

      <div class="zgrid" style="height:${y(g1) + 8}px">
        ${Array.from({ length: (g1 - g0) / 60 + 1 }, (_, i) => {
          const m = g0 + i * 60;
          return `<div class="zhour" style="top:${y(m)}px"><span class="num">${fromMin(m % 1440)}</span></div>`;
        }).join('')}
        ${win ? `<div class="zwin" style="top:${y(win[0])}px;height:${(win[1] - win[0]) * PX}px"></div>` : ''}
        ${fixed.map((c) => `<div class="zfixed${c.kind === 'habit' ? ' zhabit' : ''}" style="top:${y(c.s)}px;height:${(c.e - c.s) * PX}px"><span>${esc(c.name)}${c.kind === 'habit' ? ' · habit' : ''}</span><span class="num">${fromMin(c.s)}–${fromMin(c.e)}</span></div>`).join('')}
        <div class="zblocks"></div>
        ${key === today ? `<div class="now-line" style="top:${y(nowMin())}px"><span class="now-label num">${fromMin(nowMin())}</span></div>` : ''}
      </div>
      <p class="fineprint">Hold a block to move it: drag up or down to change the time, or onto a day above to move it there. Drag a block's bottom edge to make it longer or shorter.</p>
    </div>`;

  const body = root.querySelector('.zoom-body');
  const blocksEl = root.querySelector('.zblocks');
  for (const b of blocks.sort((a, c) => a.start - c.start)) blocksEl.append(blockEl(b, y, key, root));

  root.querySelector('[data-close]').addEventListener('click', () => closeDayView());
  root.querySelector('[data-busy]').addEventListener('click', () => {
    // A one-off busy time on this day: from now (today) or the start of free time, for an hour.
    const from = key === today ? Math.ceil(nowMin() / 5) * 5 : win ? win[0] : 16 * 60;
    const start = Math.min(from, 1440 - 65);
    import('./schedule.js').then((m) => m.editCommitment(null, () => toast('Busy time added. The plan moved around it.'),
      { name: 'Busy', date: key, weekdays: [], start: fromMin(start), end: fromMin(Math.min(1435, start + 60)) }));
  });
  root.querySelectorAll('[data-go]').forEach((btn) => btn.addEventListener('click', () => go(addDays(key, Number(btn.dataset.go)))));
  root.querySelectorAll('.zchip').forEach((c) => c.addEventListener('click', () => go(c.dataset.day)));

  // Swipe sideways on the stats area to change day
  let sx = null;
  const top = root.querySelector('.zstats');
  top.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  top.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    const next = addDays(key, dx < 0 ? 1 : -1);
    if (Math.abs(dx) > 60 && next >= first && next <= last) go(next);
  });

  if (scrollToFocus) {
    body.scrollTop = 0;
  } else if (prevScroll !== undefined) {
    body.scrollTop = prevScroll;
  }
}

function blockEl(b, y, key, root) {
  const d = describe(b);
  const short = b.duration < 30;
  const el = h(`
    <button type="button" class="zblock${d.dot ? ' study' : ''}${b.status === 'done' ? ' done' : ''}${b.status === 'missed' ? ' missed' : ''}${short ? ' short' : ''}"
      style="top:${y(b.start)}px;height:${Math.max(18, b.duration * PX - 2)}px;${d.dot ? `--c:${d.dot}` : ''}">
      <span class="zt">${esc(d.title)}${b.pinned ? ` ${icon('pin', 12)}` : ''}</span>
      ${short ? '' : `<span class="zs num" data-time>${fromMin(b.start)}–${fromMin(b.start + b.duration)}${d.kindLabel ? ` · ${esc(d.kindLabel)}` : ''}</span>`}
      ${b.status === 'planned' && b.kind !== 'review' ? '<span class="zresize" aria-hidden="true"></span>' : ''}
    </button>`);
  el.addEventListener('click', () => openBlockMenu(b));
  if (b.status !== 'planned') return el;
  if (b.kind !== 'review') enableResize(el, b, y, root);

  const body = root.querySelector('.zoom-body');
  const scroll = autoScroller(body);
  let startY = 0, startScroll = 0, newStart = b.start, dayEl = null, label;

  longPress(el, {
    onMenu: () => openBlockMenu(b),
    onDragStart(x, yy) {
      startY = yy; startScroll = body.scrollTop;
      el.classList.add('dragging-z');
      label = h(`<span class="zlabel num">${fromMin(b.start)}</span>`);
      el.append(label);
    },
    onDragMove(x, yy) {
      scroll.update(yy);
      const hit = document.elementFromPoint(x, yy);
      const chip = hit?.closest('.zchip:not([disabled])');
      if (dayEl && dayEl !== chip) dayEl.classList.remove('drop-target');
      dayEl = chip && chip.dataset.day !== key ? chip : null;
      if (dayEl) { dayEl.classList.add('drop-target'); el.classList.add('to-day'); return; }
      el.classList.remove('to-day');
      const deltaMin = (yy - startY + (body.scrollTop - startScroll)) / PX;
      newStart = Math.max(0, Math.min(1440 - b.duration, Math.round((b.start + deltaMin) / 5) * 5));
      el.style.top = `${y(newStart)}px`;
      label.textContent = `${fromMin(newStart)}–${fromMin(newStart + b.duration)}`;
    },
    async onDrop() {
      scroll.stop();
      el.classList.remove('dragging-z', 'to-day');
      label?.remove();
      if (dayEl) {
        const target = dayEl.dataset.day;
        dayEl.classList.remove('drop-target');
        const start = await store.moveBlockToDay(b.id, target);
        toast(`Moved to ${shortDate(target)}, ${fromMin(start)}`);
        return;
      }
      if (newStart !== b.start) {
        await store.moveBlock(b.id, key, newStart);
        toast(`Moved to ${fromMin(newStart)} and pinned`);
      } else {
        el.style.top = `${y(b.start)}px`;
      }
    },
    onCancel() {
      scroll.stop();
      el.classList.remove('dragging-z', 'to-day');
      label?.remove();
      dayEl?.classList.remove('drop-target');
      el.style.top = `${y(b.start)}px`;
    },
  });
  return el;
}

/** Drag the bottom edge of a block to change its length (5-minute steps, at least 15 minutes). */
function enableResize(el, b, y, root) {
  const handle = el.querySelector('.zresize');
  const body = root.querySelector('.zoom-body');
  let y0 = null, s0 = 0, dur = b.duration, label = null, moved = false;
  const start = (cy) => { y0 = cy; s0 = body.scrollTop; dur = b.duration; moved = false; };
  const move = (cy) => {
    if (y0 === null) return;
    const delta = (cy - y0 + (body.scrollTop - s0)) / PX;
    if (!moved && Math.abs(cy - y0) < 4) return;
    if (!moved) { moved = true; el.classList.add('resizing'); label = h('<span class="zlabel num"></span>'); el.append(label); }
    dur = Math.max(15, Math.min(1440 - b.start, Math.round((b.duration + delta) / 5) * 5));
    el.style.height = `${Math.max(18, dur * PX - 2)}px`;
    label.textContent = `${fromMin(b.start)}–${fromMin(b.start + dur)} · ${formatMinutes(dur)}`;
  };
  const end = async () => {
    if (y0 === null) return;
    y0 = null;
    el.classList.remove('resizing');
    label?.remove();
    if (!moved || dur === b.duration) { el.style.height = `${Math.max(18, b.duration * PX - 2)}px`; return; }
    await store.resizeBlock(b.id, dur);
    toast(b.kind === 'task' ? `Now ${formatMinutes(dur)}. The task's total time changed to match.` : `Now ${formatMinutes(dur)} and pinned`);
  };
  // Touch: starts straight away on the handle (no hold), and doesn't scroll or open the menu.
  handle.addEventListener('touchstart', (e) => { e.stopPropagation(); start(e.touches[0].clientY); }, { passive: true });
  handle.addEventListener('touchmove', (e) => { e.stopPropagation(); e.preventDefault(); move(e.touches[0].clientY); }, { passive: false });
  handle.addEventListener('touchend', (e) => { e.stopPropagation(); end(); });
  handle.addEventListener('touchcancel', (e) => { e.stopPropagation(); end(); });
  // Mouse, for testing on a computer
  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation(); e.preventDefault(); start(e.clientY);
    const mm = (ev) => move(ev.clientY);
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); end(); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  });
  handle.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
}

function overlap([ws, we], ranges) {
  return ranges.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, we) - Math.max(a, ws)), 0);
}
