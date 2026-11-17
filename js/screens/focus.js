// Focus mode: a full-screen view of one block with a timer.
// The timer survives closing the app: it's stored as timestamps, not as a ticking counter.
// With Pomodoro on, the timer runs 25 minutes of work, then a 5-minute break, and repeats.

import { icon } from '../icons.js';
import { esc, h, toast } from '../ui.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { describe } from '../block-ui.js';
import { fromMin, formatMinutes, nowMin, todayKey } from '../dates.js';

const KEY = 'planner-focus';
const WORK = 25, BREAK = 5;

export function getFocus() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function setFocus(f) {
  try { f ? localStorage.setItem(KEY, JSON.stringify(f)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}

/** Total minutes the timer has run (including Pomodoro breaks). */
function elapsedMin(f) {
  return (f.elapsedMs + (f.runningSince ? Date.now() - f.runningSince : 0)) / 60000;
}
/** Minutes of actual work: Pomodoro breaks don't count. */
function workMin(f) {
  const e = elapsedMin(f);
  if (!f.pomodoro) return e;
  const cycle = WORK + BREAK;
  return Math.floor(e / cycle) * WORK + Math.min(e % cycle, WORK);
}

let layer = null, timer = null;

export function openFocus(blockId) {
  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return;
  let f = getFocus();
  if (f && f.blockId !== blockId) {
    // Another block was running: log its time first.
    const old = state.blocks.find((b) => b.id === f.blockId);
    if (old) store.logTime(old, workMin(f));
    f = null;
  }
  if (!f) {
    f = { blockId, elapsedMs: 0, runningSince: null, pomodoro: !!state.settings.pomodoro };
    setFocus(f);
  }
  show();
}

function show() {
  close(true);
  layer = h('<section class="focus" role="dialog" aria-modal="true" aria-label="Focus"></section>');
  document.body.append(layer);
  document.body.classList.add('zoom-open');
  requestAnimationFrame(() => requestAnimationFrame(() => layer?.classList.add('open')));
  draw();
  timer = setInterval(tick, 1000);
}

function close(instant = false) {
  clearInterval(timer);
  if (!layer) return;
  const el = layer;
  layer = null;
  document.body.classList.remove('zoom-open');
  if (instant) { el.remove(); return; }
  el.classList.remove('open');
  setTimeout(() => el.remove(), 220);
  window.dispatchEvent(new Event('focuschange'));
}

const mmss = (min) => {
  const s = Math.max(0, Math.round(min * 60));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function phase(f, block) {
  const e = elapsedMin(f);
  if (!f.pomodoro) {
    const left = block.duration - e;
    return { label: left >= 0 ? 'left' : 'over', time: mmss(Math.abs(left)), progress: Math.min(1, e / block.duration), onBreak: false };
  }
  const cycle = WORK + BREAK, pos = e % cycle;
  const onBreak = pos >= WORK;
  return {
    label: onBreak ? 'break' : `focus · round ${Math.floor(e / cycle) + 1}`,
    time: mmss(onBreak ? cycle - pos : WORK - pos),
    progress: Math.min(1, workMin(f) / block.duration),
    onBreak,
  };
}

function draw() {
  const f = getFocus();
  const block = f && state.blocks.find((b) => b.id === f.blockId);
  if (!block) { close(); return; }
  const d = describe(block);
  const p = phase(f, block);
  const running = !!f.runningSince;

  layer.classList.toggle('on-break', p.onBreak);
  layer.innerHTML = `
    <header class="zoom-bar">
      <button class="icon-button" data-min aria-label="Minimise">${icon('caretDown', 22)}</button>
      <span></span>
      <button class="text-button" data-pomo aria-pressed="${f.pomodoro}">Pomodoro ${f.pomodoro ? 'on' : 'off'}</button>
    </header>
    <div class="focus-body">
      <p class="focus-kind">${d.dot ? `<span class="dot" style="background:${d.dot}"></span>` : ''}${esc(block.kind === 'study' ? 'Study session' : d.kindLabel || 'Task')}</p>
      <h2 class="focus-title">${esc(d.title)}</h2>
      <p class="muted num">${fromMin(block.start)}–${fromMin(block.start + block.duration)} · ${formatMinutes(block.duration)} planned</p>
      <div class="focus-timer num" data-time>${p.time}</div>
      <p class="focus-label" data-label>${esc(p.label)}</p>
      <div class="bar focus-bar"><span data-bar style="width:${p.progress * 100}%;background:${d.dot || 'var(--accent)'}"></span></div>
      <p class="muted num" data-worked>${formatMinutes(Math.floor(workMin(f)))} worked</p>
    </div>
    <div class="focus-actions">
      <button class="focus-main" data-toggle>${running ? 'Pause' : elapsedMin(f) > 0 ? 'Resume' : 'Start'}</button>
      <div class="focus-row">
        <button class="text-button" data-stop>Stop, not done</button>
        <button class="text-button primary with-icon" data-done>${icon('check', 18)} Done</button>
      </div>
    </div>`;

  layer.querySelector('[data-min]').addEventListener('click', () => close());
  layer.querySelector('[data-pomo]').addEventListener('click', () => {
    const g = getFocus();
    g.pomodoro = !g.pomodoro;
    setFocus(g);
    store.updateSettings({ pomodoro: g.pomodoro });
    draw();
  });
  layer.querySelector('[data-toggle]').addEventListener('click', async () => {
    const g = getFocus();
    if (g.runningSince) { g.elapsedMs += Date.now() - g.runningSince; g.runningSince = null; }
    else {
      g.runningSince = Date.now();
      // Starting early or late: move the block to now and pin it, so the plan matches what you're doing.
      const now = Math.floor(nowMin() / 5) * 5;
      if (!g.elapsedMs && Math.abs(block.start - now) >= 10) await store.moveBlock(block.id, todayKey(), now);
      else if (!block.pinned) await store.setPinned(block.id, true);
    }
    setFocus(g);
    draw();
  });
  layer.querySelector('[data-stop]').addEventListener('click', async () => {
    const g = getFocus();
    const worked = workMin(g);
    setFocus(null);
    await store.logTime(block, worked);
    close();
    toast(worked >= 1 ? `Logged ${formatMinutes(Math.round(worked))}. The block stays planned.` : 'Timer stopped');
  });
  layer.querySelector('[data-done]').addEventListener('click', async () => {
    const g = getFocus();
    const worked = workMin(g);
    setFocus(null);
    await store.logTime(block, worked);
    await store.setBlockStatus(block.id, 'done');
    close();
    toast(worked >= 1 ? `Done: ${d.title}, ${formatMinutes(Math.round(worked))}` : `Done: ${d.title}`);
  });
}

function tick() {
  const f = getFocus();
  if (!layer || !f) return;
  const block = state.blocks.find((b) => b.id === f.blockId);
  if (!block) return;
  const p = phase(f, block);
  const wasBreak = layer.classList.contains('on-break');
  if (p.onBreak !== wasBreak) { draw(); try { navigator.vibrate?.([80, 60, 80]); } catch { /* */ } return; }
  layer.querySelector('[data-time]').textContent = p.time;
  layer.querySelector('[data-label]').textContent = p.label;
  layer.querySelector('[data-bar]').style.width = `${p.progress * 100}%`;
  layer.querySelector('[data-worked]').textContent = `${formatMinutes(Math.floor(workMin(f)))} worked`;
}

/** A bar for the Today screen while a timer is running in the background. */
export function runningBar() {
  const f = getFocus();
  const block = f && state.blocks.find((b) => b.id === f.blockId);
  if (!block || block.status !== 'planned') { if (f && !block) setFocus(null); return null; }
  const d = describe(block);
  const bar = h(`<button class="checkin focus-running">${icon('clock', 18)}<span><strong>${f.runningSince ? 'Focusing' : 'Paused'}</strong>${esc(d.title)}</span>${icon('caretRight', 16)}</button>`);
  bar.addEventListener('click', () => show());
  return bar;
}
