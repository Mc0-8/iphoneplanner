import { icon } from '../icons.js';
import { esc, h } from '../ui.js';
import { state, sortTasks } from '../store.js';
import { taskRow } from '../task-ui.js';
import { todayKey, longToday, formatMinutes } from '../dates.js';
import { openSettings } from './settings.js';

let showDone = false;

export const addLabel = 'Add task';
export const addDefaults = () => ({ deadline: todayKey() });

export function render(el) {
  const today = todayKey();
  const open = state.tasks.filter((t) => !t.completed);
  const overdue = sortTasks(open.filter((t) => t.deadline && t.deadline < today));
  const dueToday = sortTasks(open.filter((t) => t.deadline === today));
  const doneToday = state.tasks
    .filter((t) => t.completed && t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString())
    .sort((a, b) => b.completedAt - a.completedAt);

  const planned = [...overdue, ...dueToday].filter((t) => t.type !== 'exam').reduce((sum, t) => sum + t.duration, 0);
  const meta = planned ? `${longToday()} · <span class="num">${formatMinutes(planned)}</span> planned` : longToday();

  el.innerHTML = `
    <header class="header">
      <div>
        <h1>Today</h1>
        <p class="meta">${meta}</p>
      </div>
      <div class="header-actions">
        <button class="icon-button" data-settings aria-label="Settings">${icon('gear', 24)}</button>
      </div>
    </header>`;

  el.querySelector('[data-settings]').addEventListener('click', openSettings);

  if (overdue.length) el.append(section('Overdue', overdue));
  if (dueToday.length) el.append(section('Due today', dueToday));
  if (!overdue.length && !dueToday.length) {
    el.append(h(`<p class="empty">${doneToday.length ? 'All done for today.' : 'Nothing due today.'}</p>`));
  }

  if (doneToday.length) {
    const s = h(`
      <section class="section">
        <button class="section-head toggle quiet" aria-expanded="${showDone}">
          <h2>Done today <span class="count num">${doneToday.length}</span></h2>${icon('caretRight', 16)}
        </button>
        <ul class="rows"></ul>
      </section>`);
    const ul = s.querySelector('ul');
    if (showDone) doneToday.forEach((t) => ul.append(taskRow(t)));
    s.querySelector('button').addEventListener('click', () => { showDone = !showDone; render(el); });
    el.append(s);
  }
}

function section(title, tasks) {
  const s = h(`
    <section class="section">
      <div class="section-head"><h2>${esc(title)}</h2><span class="count num">${tasks.length}</span></div>
      <ul class="rows"></ul>
    </section>`);
  const ul = s.querySelector('ul');
  tasks.forEach((t) => ul.append(taskRow(t, { hideToday: true })));
  return s;
}
