// Habits: small recurring things (exercise, reading) ticked off on the days they're due.

import { icon } from '../icons.js';
import { esc, h, openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { todayKey, addDays, weekday, fromKey } from '../dates.js';
import { WEEK } from './schedule.js';

const dueOn = (habit, key) => habit.weekdays.includes(weekday(key));

function streak(habit) {
  let k = todayKey(), n = 0, guard = 0;
  if (!habit.done.includes(k)) k = addDays(k, -1);
  while (guard++ < 400) {
    if (dueOn(habit, k)) { if (!habit.done.includes(k)) break; n++; }
    k = addDays(k, -1);
  }
  return n;
}

function checkRow(habit) {
  const today = todayKey();
  const done = habit.done.includes(today);
  const row = h(`
    <li class="row habit${done ? ' done' : ''}"><div class="row-inner">
      <button class="check" type="button" aria-label="${done ? 'Not done' : 'Done'}"><span>${icon('check', 14)}</span></button>
      <button class="row-body" type="button">
        <span class="title">${esc(habit.name)}</span>
        <span class="sub">${streakText(habit)}</span>
      </button>
      <span class="week-dots" aria-hidden="true">${lastSeven(habit)}</span>
    </div></li>`);
  row.querySelector('.check').addEventListener('click', () => store.toggleHabit(habit.id));
  row.querySelector('.row-body').addEventListener('click', () => openHabitEditor(habit));
  return row;
}

const streakText = (habit) => { const n = streak(habit); return `<span class="num">${n ? `${n} in a row` : 'No streak yet'}</span>`; };

function lastSeven(habit) {
  return Array.from({ length: 7 }, (_, i) => {
    const k = addDays(todayKey(), i - 6);
    const cls = !dueOn(habit, k) ? 'off' : habit.done.includes(k) ? 'on' : '';
    return `<i class="${cls}" title="${fromKey(k).toLocaleDateString('en-GB', { weekday: 'short' })}"></i>`;
  }).join('');
}

/** Section for Today: only habits due today. */
export function habitsToday() {
  const today = todayKey();
  const list = state.habits.filter((x) => dueOn(x, today));
  if (!list.length) return null;
  const done = list.filter((x) => x.done.includes(today)).length;
  const s = h(`
    <section class="section" style="margin-top:24px">
      <div class="section-head quiet"><h2>Habits</h2><span class="count num">${done} of ${list.length}</span></div>
      <ul class="rows"></ul>
    </section>`);
  list.forEach((x) => s.querySelector('ul').append(checkRow(x)));
  return s;
}

/** Section for Study: all habits. */
export function habitsSection() {
  const s = h(`
    <section class="section">
      <div class="section-head"><h2>Habits</h2><button class="link-button" data-add style="min-height:36px">${icon('plus', 16)}&nbsp;Add</button></div>
      <ul class="rows"></ul>
    </section>`);
  s.querySelector('[data-add]').addEventListener('click', () => openHabitEditor(null));
  const ul = s.querySelector('ul');
  if (!state.habits.length) ul.append(h('<li><p class="empty">Small things you want to do regularly, like exercise or reading.</p></li>'));
  state.habits.forEach((x) => ul.append(checkRow(x)));
  return s;
}

export function openHabitEditor(existing) {
  const habit = existing ? structuredClone(existing) : { id: store.uid(), name: '', weekdays: [1, 2, 3, 4, 5, 6, 0], done: [], createdAt: Date.now() };
  openSheet({
    title: existing ? 'Edit habit' : 'New habit',
    action: 'Save',
    extra: existing ? { icon: 'trash', label: 'Delete habit', onClick: async (close) => {
      close();
      const removed = await store.deleteHabit(habit.id);
      toast('Habit deleted', { undo: () => store.saveHabit(removed) });
    } } : null,
    onAction: async (close) => {
      if (!habit.name.trim() || !habit.weekdays.length) return;
      await store.saveHabit(habit);
      close();
    },
    build(body, close, saveBtn) {
      body.innerHTML = `
        <input class="title-input" placeholder="e.g. Read 20 pages" value="${esc(habit.name)}" aria-label="Habit">
        <div class="field">
          <span class="label">Days</span>
          <div class="chips">${WEEK.map(([wd, n]) => `<button type="button" class="chip" data-wd="${wd}" aria-pressed="${habit.weekdays.includes(wd)}">${n.slice(0, 3)}</button>`).join('')}</div>
        </div>`;
      const name = body.querySelector('.title-input');
      const sync = () => { saveBtn.disabled = !habit.name.trim() || !habit.weekdays.length; };
      name.addEventListener('input', () => { habit.name = name.value; sync(); });
      body.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => {
        const wd = Number(b.dataset.wd);
        habit.weekdays = habit.weekdays.includes(wd) ? habit.weekdays.filter((x) => x !== wd) : [...habit.weekdays, wd];
        b.setAttribute('aria-pressed', habit.weekdays.includes(wd));
        sync();
      }));
      sync();
      if (!existing) setTimeout(() => name.focus(), 60);
    },
  });
}
