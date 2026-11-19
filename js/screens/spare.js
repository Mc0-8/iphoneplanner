// "I have some time": pick how long you've got, get a few things that fit, start one straight away.

import { esc, openSheet } from '../ui.js';
import * as store from '../store.js';
import { state, sortTasks } from '../store.js';
import { todayKey, mondayOf, addDays, formatMinutes, shortDate } from '../dates.js';
import { weekTarget } from './study.js';

const LENGTHS = [15, 30, 45, 60, 90];

/** Ranked suggestions that fit in `min` minutes. */
export function suggestions(min) {
  const today = todayKey();
  const out = [];

  // Reviews due: quick, and they slip otherwise.
  const due = store.topicsDue(today);
  if (due.length) {
    const ids = due.slice(0, Math.max(1, Math.floor(min / 5))).map((t) => t.id);
    out.push({ kind: 'review', topicIds: ids, title: ids.length === 1 ? `Review: ${due[0].name}` : `Review ${ids.length} topics`, why: 'Due today', min: Math.min(min, 15) });
  }

  // Tasks: overdue, then soonest deadline, then priority. Inbox tasks last.
  const doneMin = (t) => state.blocks.filter((b) => b.taskId === t.id && b.status === 'done').reduce((s, b) => s + b.duration, 0);
  const tasks = sortTasks(state.tasks.filter((t) => !t.completed && t.type !== 'exam' &&
    !(t.dateMode === 'on' && t.deadline && t.deadline !== today) && !(t.notBefore && t.notBefore > today)));
  const rank = (t) => (t.inbox ? 3 : t.deadline && t.deadline < today ? 0 : t.deadline ? 1 : 2);
  tasks.sort((a, b) => rank(a) - rank(b));
  for (const t of tasks) {
    const left = Math.max(5, t.duration - doneMin(t));
    const why = t.dateMode === 'on' ? 'Today' : t.deadline && t.deadline < today ? 'Overdue' : t.deadline ? `Due ${shortDate(t.deadline).replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase())}` : t.inbox ? 'In your inbox' : store.listName(t.listId) || '';
    out.push({ kind: 'task', taskId: t.id, title: t.title, why, min: Math.min(min, left), whole: left <= min });
  }

  // Subjects behind on this week's hours.
  const wk = mondayOf(today);
  for (const s of state.subjects) {
    if (!s.hoursPerWeek || (s.paused && (!s.pausedUntil || s.pausedUntil > today))) continue;
    const doneWk = state.blocks.filter((b) => b.kind === 'study' && b.subjectId === s.id && b.status === 'done' && b.date >= wk && b.date <= addDays(wk, 6))
      .reduce((sum, b) => sum + b.duration, 0);
    const behind = weekTarget(s, wk).minutes - doneWk;
    if (behind >= 15) out.push({ kind: 'study', subjectId: s.id, title: s.name, colour: s.colour, why: `${formatMinutes(behind)} to go this week`, min: Math.min(min, behind), behind });
  }

  // Overdue and due-today tasks first, then reviews, then the rest; study sorted by how far behind.
  const score = (x) => x.kind === 'review' ? 1 : x.kind === 'task' ? (x.why === 'Overdue' || x.why === 'Today' || x.why === 'Due today' ? 0 : 2 + (x.why.startsWith('In your') ? 2 : 0)) : 3 - Math.min(0.9, x.behind / 600);
  return out.sort((a, b) => score(a) - score(b)).slice(0, 6);
}

export function openSpareTime() {
  let min = 30;
  openSheet({
    title: 'I have some time',
    build(body, close) {
      body.innerHTML = `
        <div class="field">
          <span class="label">How long?</span>
          <div class="chips" data-len>${LENGTHS.map((m) => `<button type="button" class="chip" data-m="${m}" aria-pressed="${m === min}">${formatMinutes(m)}</button>`).join('')}</div>
        </div>
        <div class="menu" data-list></div>
        <p class="fineprint">Picking one puts it at now and starts the focus timer. The rest of the plan adjusts.</p>`;
      const list = body.querySelector('[data-list]');
      const draw = () => {
        const items = suggestions(min);
        list.innerHTML = items.length ? items.map((x, i) => `
          <button type="button" class="menu-item spare-item" data-i="${i}">
            ${x.colour ? `<span class="dot" style="background:${x.colour}"></span>` : ''}
            <span class="spare-text"><span>${esc(x.title)}</span><span class="fineprint">${esc(x.why)}${x.kind === 'task' && !x.whole ? ` · ${formatMinutes(x.min)} of it` : ''}</span></span>
            <span class="num muted">${formatMinutes(x.min)}</span>
          </button>`).join('') : '<p class="empty">Nothing waiting. Enjoy the break.</p>';
        list.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
          const x = items[Number(b.dataset.i)];
          close();
          if (x.kind === 'review') { import('./review.js').then((m) => m.openReview(x.topicIds)); return; }
          const id = await store.startNow(x, x.min);
          import('./focus.js').then((m) => m.openFocus(id));
        }));
      };
      body.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
        min = Number(b.dataset.m);
        body.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-pressed', x === b));
        draw();
      }));
      draw();
    },
  });
}
