// Rows for the timed day list (Today and the Week tab's day agenda).

import { icon } from './icons.js';
import { esc, h, toast, openSheet } from './ui.js';
import { longPress, ghost, autoScroller } from './drag.js';
import * as store from './store.js';
import { state } from './store.js';
import { fromMin, formatMinutes, nowMin, todayKey, addDays, shortDate } from './dates.js';
import { commitmentsOn, windowFor, horizonEnd } from './scheduler.js';
import { openTaskEditor } from './task-ui.js';
import { openSubjectEditor } from './screens/study.js';

/** Everything on a day, in time order: blocks and fixed commitments. */
export function dayItems(key) {
  const blocks = state.blocks
    .filter((b) => b.date === key && !(b.status === 'missed' && key >= todayKey()))
    .map((b) => ({ type: 'block', start: b.start, end: b.start + b.duration, block: b }));
  const fixed = commitmentsOn(state.commitments, key, state.habits)
    .map((c) => ({ type: c.kind === 'habit' ? 'habit' : 'fixed', start: c.s, end: c.e, commitment: c, day: key }));
  return [...blocks, ...fixed].sort((a, b) => a.start - b.start || (a.type === 'fixed' ? -1 : 1));
}

/** "Essay · part 2 of 6" style details for a block. */
export function describe(b) {
  if (b.kind === 'review') {
    const topics = (b.topicIds || []).map((id) => state.topics.find((t) => t.id === id)).filter(Boolean);
    const s = topics[0] && store.subjectById(topics[0].subjectId);
    return { title: `Review: ${topics.map((t) => t.name).join(', ') || 'topics'}`, dot: s?.colour, kindLabel: 'Review',
      onOpen: () => import('./screens/review.js').then((m) => m.openReview(topics.map((t) => t.id), b.id)) };
  }
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
  if (item.type === 'habit') {
    const hb = item.commitment;
    const done = hb.done.includes(item.day);
    const row = h(`
      <li class="trow habit-row${done ? ' done' : ''}${past && !done ? ' past' : ''}" data-start="${item.start}" data-end="${item.end}">
        <div class="ttime num">${fromMin(item.start)}<span>${fromMin(item.end)}</span></div>
        <button class="check" type="button" aria-label="${done ? 'Mark as not done' : 'Mark as done'}"><span>${icon('check', 14)}</span></button>
        <button class="tbody" type="button">
          <span class="title">${esc(hb.name)}</span>
          <span class="sub"><span>Habit</span><span class="num">${formatMinutes(item.end - item.start)}</span></span>
        </button>
      </li>`);
    row.querySelector('.check').addEventListener('click', () => store.toggleHabit(hb.id, item.day));
    row.querySelector('.tbody').addEventListener('click', () => import('./screens/habits.js').then((m) => m.openHabitEditor(state.habits.find((x) => x.id === hb.id))));
    return row;
  }
  if (item.type === 'fixed') {
    const c = item.commitment;
    const row = h(`
      <li class="trow fixed${past ? ' past' : ''}" data-start="${item.start}" data-end="${item.end}">
        <div class="ttime num">${fromMin(item.start)}<span>${fromMin(item.end)}</span></div>
        <button class="tbody" type="button">
          <span class="title">${esc(c.name)}</span>
          <span class="sub">${c.date ? 'One-off' : 'Fixed'} · ${formatMinutes(item.end - item.start)}</span>
        </button>
      </li>`);
    row.querySelector('.tbody').addEventListener('click', () => import('./screens/schedule.js').then((m) => m.editCommitment(state.commitments.find((x) => x.id === c.id), () => {})));
    return row;
  }

  const b = item.block;
  const d = describe(b);
  const done = b.status === 'done';
  const missed = b.status === 'missed';
  const row = h(`
    <li class="trow${done ? ' done' : ''}${past && !done ? ' past' : ''}${missed ? ' missed' : ''}" data-id="${b.id}" data-start="${item.start}" data-end="${item.end}">
      <div class="ttime num">${fromMin(item.start)}<span>${fromMin(item.end)}</span></div>
      <button class="check" type="button" aria-label="${done ? 'Mark as not done' : 'Mark as done'}"><span>${icon('check', 14)}</span></button>
      <button class="tbody" type="button">
        <span class="title">${esc(d.title)}</span>
        <span class="sub">
          ${d.dot ? `<span class="dot" style="background:${d.dot}"></span>` : ''}
          <span class="num">${formatMinutes(b.duration)}</span>
          ${d.kindLabel ? `<span>${esc(d.kindLabel)}</span>` : ''}
          ${missed ? '<span>Missed</span>' : ''}
          ${b.pinned && !done ? `<span class="pinned">${icon('pin', 13)}Pinned</span>` : ''}
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
  row.querySelector('.tbody').addEventListener('click', () => {
    // Today's planned study and task blocks open focus mode; everything else opens its editor.
    if (b.status === 'planned' && b.date === todayKey() && b.kind !== 'review') {
      import('./screens/focus.js').then((m) => m.openFocus(b.id));
    } else d.onOpen?.();
  });
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

/* ---------- Long-press menu ---------- */

export function openBlockMenu(block) {
  const d = describe(block);
  const isTask = block.kind === 'task';
  const tomorrow = addDays(block.date < todayKey() ? todayKey() : block.date, 1);
  const nextLabel = block.date <= todayKey() ? 'Move to tomorrow' : `Move to ${shortDate(tomorrow)}`;
  const actions = [
    { id: 'focus', icon: 'clock', label: 'Start focus timer', show: block.status === 'planned' && block.date === todayKey() && block.kind !== 'review' },
    { id: 'edit', icon: 'pencil', label: block.kind === 'review' ? 'Start review' : isTask ? 'Edit task' : 'Edit subject', show: !!d.onOpen },
    { id: 'pin', icon: block.pinned ? 'unpin' : 'pin', label: block.pinned ? 'Unpin (let the planner move it)' : 'Pin to this time', show: block.status === 'planned' },
    { id: 'tomorrow', icon: 'arrowRight', label: nextLabel, show: block.status === 'planned' && tomorrow <= horizonEnd() },
    { id: 'delete', icon: isTask ? 'trash' : 'skip', label: isTask ? 'Delete task' : block.kind === 'review' ? 'Skip this review' : 'Skip this session', show: block.status === 'planned' || isTask, danger: true },
  ].filter((a) => a.show);

  openSheet({
    title: d.title,
    build(body, close) {
      body.innerHTML = `<p class="fineprint" style="margin-top:0">${esc(shortDate(block.date))} · ${fromMin(block.start)}–${fromMin(block.start + block.duration)} · ${formatMinutes(block.duration)}</p>
        <div class="menu">${actions.map((a) => `<button type="button" class="menu-item${a.danger ? ' danger' : ''}" data-a="${a.id}">${icon(a.icon, 20)}<span>${esc(a.label)}</span></button>`).join('')}</div>
        <p class="fineprint">Tip: hold and drag a block to move it.</p>`;
      body.querySelectorAll('[data-a]').forEach((btn) => btn.addEventListener('click', async () => {
        close();
        const a = btn.dataset.a;
        if (a === 'edit') d.onOpen();
        if (a === 'focus') import('./screens/focus.js').then((m) => m.openFocus(block.id));
        if (a === 'pin') await store.setPinned(block.id, !block.pinned);
        if (a === 'tomorrow') {
          const start = await store.moveBlockToDay(block.id, tomorrow);
          toast(`Moved to ${shortDate(tomorrow).replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase())}, ${fromMin(start)}`);
        }
        if (a === 'delete' && isTask) {
          const removed = await store.deleteTask(block.taskId);
          if (removed) toast('Task deleted', { undo: () => store.saveTask(removed) });
        }
        if (a === 'delete' && block.kind === 'review') {
          await store.skipReview(block.id);
          toast('Review moved to tomorrow');
        }
        if (a === 'delete' && block.kind === 'study') {
          await store.setBlockStatus(block.id, 'missed');
          toast('Skipped. The time is planned on another day.', { undo: () => store.setBlockStatus(block.id, 'planned') });
        }
      }));
    },
  });
}

/* ---------- Drag to reorder (and drop on a day in the Week strip) ---------- */

const ceil5 = (m) => Math.ceil(m / 5) * 5;

export function enableListDrag(ul, dayKey) {
  for (const row of ul.querySelectorAll('.trow[data-id]')) {
    const block = state.blocks.find((b) => b.id === row.dataset.id);
    if (!block) continue;
    if (block.status !== 'planned') {
      longPress(row, { onMenu: () => openBlockMenu(block) });
      continue;
    }
    let g, line, target = null, dayEl = null;
    const scroll = autoScroller(window);

    longPress(row, {
      onMenu: () => openBlockMenu(block),
      onDragStart(x, y) {
        g = ghost(row, x, y);
        row.classList.add('drag-src');
        line = h('<div class="drop-line" hidden></div>');
        ul.append(line);
      },
      onDragMove(x, y) {
        g.move(x, y);
        scroll.update(y);
        const hit = document.elementFromPoint(x, y);
        const day = hit?.closest('[data-day]');
        if (dayEl && dayEl !== day) dayEl.classList.remove('drop-target');
        dayEl = day && day.dataset.day >= todayKey() ? day : null;
        if (dayEl) {
          dayEl.classList.add('drop-target');
          line.hidden = true;
          target = { day: dayEl.dataset.day };
          return;
        }
        const rows = [...ul.querySelectorAll('.trow')].filter((r) => r !== row);
        let idx = rows.findIndex((r) => y < r.getBoundingClientRect().top + r.offsetHeight / 2);
        if (idx < 0) idx = rows.length;
        line.hidden = false;
        line.style.top = `${idx < rows.length ? rows[idx].offsetTop : (rows.at(-1)?.offsetTop ?? 0) + (rows.at(-1)?.offsetHeight ?? 0)}px`;
        target = { index: idx, rows };
      },
      async onDrop() {
        cleanup();
        if (!target) return;
        if (target.day) {
          if (target.day === block.date) return;
          const start = await store.moveBlockToDay(block.id, target.day);
          toast(`Moved to ${shortDate(target.day).replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase())}, ${fromMin(start)}`);
          return;
        }
        const { index, rows } = target;
        const prev = rows[index - 1], next = rows[index];
        const gap = state.settings.breakMinutes;
        const win = windowFor(state.settings, state.daysOff, dayKey) || [8 * 60, 21 * 60];
        let earliest = win[0];
        if (dayKey === todayKey()) earliest = Math.max(earliest, ceil5(nowMin()));
        let start;
        if (prev) start = Math.max(earliest, ceil5(Number(prev.dataset.end) + gap));
        else if (next) start = Math.max(earliest, Math.floor((Number(next.dataset.start) - block.duration - gap) / 5) * 5);
        else start = earliest;
        if (start === block.start) return;
        await store.moveBlock(block.id, dayKey, start);
        toast(`Moved to ${fromMin(start)} and pinned`);
      },
      onCancel: cleanup,
    });

    function cleanup() {
      scroll.stop();
      g?.remove();
      line?.remove();
      row.classList.remove('drag-src');
      dayEl?.classList.remove('drop-target');
    }
  }
}
