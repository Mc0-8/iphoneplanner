import { icon } from '../icons.js';
import { esc, h, openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import { state, sortTasks } from '../store.js';
import { taskRow } from '../task-ui.js';
import { dayItems, itemRow, positionNowLine, enableListDrag } from '../block-ui.js';
import { todayKey, longToday, formatMinutes, fromMin, toMin, nowMin, addDays as addDaysKey, shortDate } from '../dates.js';
import { windowFor } from '../scheduler.js';
import { openSettings } from './settings.js';
import { runningBar } from './focus.js';
import { habitsToday } from './habits.js';

let showDone = false;
let timer;

export const addLabel = 'Add task';
export const addDefaults = () => ({ deadline: todayKey() });

export function render(el) {
  const today = todayKey();
  const items = dayItems(today);
  const blocks = items.filter((i) => i.type === 'block').map((i) => i.block);
  const planned = blocks.reduce((s, b) => s + b.duration, 0);
  const done = blocks.filter((b) => b.status === 'done').reduce((s, b) => s + b.duration, 0);

  const meta = planned
    ? `${longToday()} · <span class="num">${formatMinutes(planned)}</span> planned${done ? `, <span class="num">${formatMinutes(done)}</span> done` : ''}`
    : longToday();

  el.innerHTML = `
    <header class="header">
      <div>
        <h1>Today</h1>
        <p class="meta">${meta}</p>
      </div>
      <div class="header-actions">
        <button class="icon-button" data-spare aria-label="I have some time">${icon('lightning', 24)}</button>
        <button class="icon-button" data-settings aria-label="Settings">${icon('gear', 24)}</button>
      </div>
    </header>`;
  el.querySelector('[data-settings]').addEventListener('click', openSettings);
  el.querySelector('[data-spare]').addEventListener('click', () => import('./spare.js').then((m) => m.openSpareTime()));

  const running = runningBar();
  if (running) el.append(running);

  // End-of-day check-in
  const openBlocks = blocks.filter((b) => b.status === 'planned' && b.start <= nowMin());
  if (openBlocks.length && nowMin() >= toMin(state.settings.checkinFrom) && state.settings.lastCheckin !== today) {
    const bar = h(`<button class="checkin">${icon('check', 18)}<span><strong>Check in</strong> Mark what you got done today</span>${icon('caretRight', 16)}</button>`);
    bar.addEventListener('click', openCheckin);
    el.append(bar);
  }

  // Timed list with the "now" line
  if (items.length) {
    const wrap = h('<div class="timeline"><ul class="rows tlist"></ul><div class="now-line" aria-hidden="true"><span class="now-label num"></span></div></div>');
    const ul = wrap.querySelector('ul');
    items.forEach((it) => ul.append(itemRow(it, { live: true })));
    el.append(wrap);
    enableListDrag(ul, today);
    const line = wrap.querySelector('.now-line');
    requestAnimationFrame(() => positionNowLine(ul, line));
    clearInterval(timer);
    timer = setInterval(() => { if (document.body.contains(ul)) positionNowLine(ul, line); else clearInterval(timer); }, 30000);
  } else {
    const off = !windowFor(state.settings, state.daysOff, today);
    el.append(h(`<p class="empty">${off ? 'Day off. Nothing is planned today.' : 'Nothing planned today.'}</p>`));
  }

  // Due today or overdue, but not on today's list
  const onToday = new Set(blocks.filter((b) => b.kind === 'task').map((b) => b.taskId));
  const loose = sortTasks(state.tasks.filter((t) => !t.completed && t.type !== 'exam' && t.deadline && t.deadline <= today && !onToday.has(t.id)));
  if (loose.length) {
    const s = h(`
      <section class="section" style="margin-top:24px">
        <div class="section-head quiet"><h2>Due, but no time left today</h2><span class="count num">${loose.length}</span></div>
        <ul class="rows"></ul>
      </section>`);
    loose.forEach((t) => s.querySelector('ul').append(taskRow(t)));
    el.append(s);
  }

  // Habits for today
  const habits = habitsToday();
  if (habits) el.append(habits);

  // Exams coming up within a week
  const soon = state.tasks.filter((t) => t.type === 'exam' && !t.completed && t.deadline >= today && t.deadline <= addDaysKey(today, 7));
  if (soon.length) {
    el.append(h(`<p class="fineprint">${soon.map((e) => `${esc(e.title)}: ${esc(dayWord(e.deadline))}`).join(' · ')}</p>`));
  }

  // Tasks ticked off today (from the Tasks tab)
  const doneToday = state.tasks
    .filter((t) => t.completed && t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString())
    .sort((a, b) => b.completedAt - a.completedAt);
  if (doneToday.length) {
    const s = h(`
      <section class="section" style="margin-top:24px">
        <button class="section-head toggle quiet" aria-expanded="${showDone}">
          <h2>Finished today <span class="count num">${doneToday.length}</span></h2>${icon('caretRight', 16)}
        </button>
        <ul class="rows"></ul>
      </section>`);
    if (showDone) doneToday.forEach((t) => s.querySelector('ul').append(taskRow(t)));
    s.querySelector('button').addEventListener('click', () => { showDone = !showDone; render(el); });
    el.append(s);
  }
}

const dayWord = (k) => { const s = shortDate(k); return s === 'Today' || s === 'Tomorrow' ? s.toLowerCase() : s; };

function openCheckin() {
  const today = todayKey();
  // Only blocks that have started: later ones can still happen tonight.
  const blocks = state.blocks.filter((b) => b.date === today && b.status !== 'missed' && b.start <= nowMin()).sort((a, b) => a.start - b.start);
  const answers = Object.fromEntries(blocks.map((b) => [b.id, b.status === 'done' ? 'done' : 'missed']));

  openSheet({
    title: 'Check in',
    action: 'Save',
    onAction: async (close) => {
      await store.checkIn(answers);
      close();
      const missed = Object.values(answers).filter((v) => v === 'missed').length;
      toast(missed ? `Saved. ${missed} missed block${missed === 1 ? ' was' : 's were'} spread over the coming days.` : 'Saved. Nice work today.');
    },
    build(body) {
      body.innerHTML = `<p class="fineprint" style="margin-top:0">Anything not done is planned again on another day.</p><ul class="rows"></ul>`;
      const ul = body.querySelector('ul');
      for (const b of blocks) {
        const name = b.kind === 'study' ? (store.subjectById(b.subjectId)?.name || 'Study') : (state.tasks.find((t) => t.id === b.taskId)?.title || 'Task');
        const row = h(`
          <li class="checkin-row">
            <div><span class="title">${esc(name)}</span><span class="sub num">${fromMin(b.start)} · ${formatMinutes(b.duration)}</span></div>
            <div class="segmented">
              <button type="button" data-v="done" aria-pressed="${answers[b.id] === 'done'}">Done</button>
              <button type="button" data-v="missed" aria-pressed="${answers[b.id] === 'missed'}">Not done</button>
            </div>
          </li>`);
        row.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
          answers[b.id] = btn.dataset.v;
          row.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === btn));
        }));
        ul.append(row);
      }
    },
  });
}
