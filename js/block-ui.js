// Rows for the timed day list (Today and the Week tab's day agenda).

import { icon } from './icons.js';
import { esc, h, toast } from './ui.js';
import * as store from './store.js';
import { state } from './store.js';
import { fromMin, formatMinutes, nowMin, todayKey } from './dates.js';
import { commitmentsOn } from './scheduler.js';
import { openTaskEditor } from './task-ui.js';
import { openSubjectEditor } from './screens/study.js';

/** Everything on a day, in time order: blocks and fixed commitments. */
export function dayItems(key) {
  const blocks = state.blocks
    .filter((b) => b.date === key && !(b.status === 'missed' && key >= todayKey()))
    .map((b) => ({ type: 'block', start: b.start, end: b.start + b.duration, block: b }));
  const fixed = commitmentsOn(state.commitments, key)
    .map((c) => ({ type: 'fixed', start: c.s, end: c.e, commitment: c }));
  return [...blocks, ...fixed].sort((a, b) => a.start - b.start || (a.type === 'fixed' ? -1 : 1));
}

/** "Essay · part 2 of 6" style details for a block. */
function describe(b) {
  if (b.kind === 'study') {
    const s = store.subjectById(b.subjectId);
    return { title: s ? s.name : 'Study', dot: s?.colour, kindLabel: 'Study', onOpen: s ? () => openSubjectEditor(s) : null };
  }
  const t = state.tasks.find((x) => x.id === b.taskId);
  if (!t) return { title: 'Task', kindLabel: '' };
  const parts = state.blocks.filter((x) => x.taskId === t.id && x.status !== 'missed')
    .sort((a, c) => a.date.localeCompare(c.date) || a.start - c.start);
  const label = parts.length > 1 ? `Part ${parts.indexOf(b) + 1} of ${parts.length}` : store.listName(t.listId) || '';
  return { title: t.title, kindLabel: label, deadline: t.deadline, onOpen: () => openTaskEditor(t) };
}

export function itemRow(item, { live = false } = {}) {
  const now = nowMin();
  const past = live && item.end <= now;
  if (item.type === 'fixed') {
    const c = item.commitment;
    return h(`
      <li class="trow fixed${past ? ' past' : ''}" data-start="${item.start}" data-end="${item.end}">
        <div class="ttime num">${fromMin(item.start)}<span>${fromMin(item.end)}</span></div>
        <div class="tbody">
          <span class="title">${esc(c.name)}</span>
          <span class="sub">Fixed · ${formatMinutes(item.end - item.start)}</span>
        </div>
      </li>`);
  }

  const b = item.block;
  const d = describe(b);
  const done = b.status === 'done';
  const missed = b.status === 'missed';
  const row = h(`
    <li class="trow${done ? ' done' : ''}${past && !done ? ' past' : ''}${missed ? ' missed' : ''}" data-start="${item.start}" data-end="${item.end}">
      <div class="ttime num">${fromMin(item.start)}<span>${fromMin(item.end)}</span></div>
      <button class="check" type="button" aria-label="${done ? 'Mark as not done' : 'Mark as done'}"><span>${icon('check', 14)}</span></button>
      <button class="tbody" type="button">
        <span class="title">${esc(d.title)}</span>
        <span class="sub">
          ${d.dot ? `<span class="dot" style="background:${d.dot}"></span>` : ''}
          <span class="num">${formatMinutes(b.duration)}</span>
          ${d.kindLabel ? `<span>${esc(d.kindLabel)}</span>` : ''}
          ${missed ? '<span>Missed</span>' : ''}
        </span>
      </button>
    </li>`);
  row.querySelector('.check').addEventListener('click', () => {
    if (done) { store.setBlockStatus(b.id, 'planned'); return; }
    row.classList.add('done');
    setTimeout(() => {
      store.setBlockStatus(b.id, 'done');
      toast(`Done: ${d.title}`, { undo: () => store.setBlockStatus(b.id, 'planned') });
    }, 250);
  });
  if (d.onOpen) row.querySelector('.tbody').addEventListener('click', d.onOpen);
  return row;
}

/** Place the "now" line inside the list: through the current item, or between items. */
export function positionNowLine(list, line) {
  const now = nowMin();
  const rows = [...list.querySelectorAll('.trow')];
  line.querySelector('.now-label').textContent = fromMin(now);
  if (!rows.length) { line.hidden = true; return; }
  line.hidden = false;
  let top;
  const current = rows.find((r) => Number(r.dataset.start) <= now && now < Number(r.dataset.end));
  if (current) {
    const s = Number(current.dataset.start), e = Number(current.dataset.end);
    top = current.offsetTop + ((now - s) / (e - s)) * current.offsetHeight;
  } else {
    const next = rows.find((r) => Number(r.dataset.start) > now);
    top = next ? next.offsetTop : rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight;
  }
  line.style.top = `${Math.round(top)}px`;
  rows.forEach((r) => r.classList.toggle('past', Number(r.dataset.end) <= now && !r.classList.contains('done')));
}
