// Task rows and the add/edit sheet, shared by Today and Tasks.

import { icon } from './icons.js';
import { esc, h, openSheet, toast, enableSwipe } from './ui.js';
import * as store from './store.js';
import { state } from './store.js';
import { todayKey, addDays, shortDate, formatMinutes, daysBetween } from './dates.js';

const DURATIONS = [15, 30, 45, 60, 90, 120];

/** "Tasks usually take you 25% longer than you plan" — from the focus timer's logs. */
function estimateHint() {
  const r = store.estimateRatio();
  if (!r || Math.abs(r - 1) < 0.1) return '';
  const pct = Math.round(Math.abs(r - 1) * 100);
  return `<p class="fineprint" style="margin:8px 0 0">From your timer: tasks usually take you ${pct}% ${r > 1 ? 'longer' : 'less time'} than you plan.</p>`;
}

/* ---------- Row ---------- */

export function taskRow(task, { showList = true, hideToday = false } = {}) {
  const today = todayKey();
  const bits = [];
  if (task.type === 'exam') {
    bits.push(`<span class="tag exam">${icon('exam', 14)}Exam · ${esc(shortDate(task.deadline))}</span>`);
  } else if (task.deadline && !(hideToday && task.deadline === today)) {
    const late = !task.completed && task.deadline < today;
    bits.push(late
      ? `<span class="late">Overdue · ${esc(shortDate(task.deadline))}</span>`
      : `<span>Due ${esc(shortDate(task.deadline).replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase()))}</span>`);
  }
  if (task.type !== 'exam') bits.push(`<span class="num">${formatMinutes(task.duration)}</span>`);
  if (task.notBefore && task.notBefore >= today && !task.completed) bits.push(`<span>From ${esc(shortDate(task.notBefore).replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase()))}${task.notBeforeTime ? ` ${task.notBeforeTime}` : ''}</span>`);
  if (task.repeat && task.repeat !== 'none') bits.push(`<span>${{ daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly' }[task.repeat]}</span>`);
  const list = showList && store.listName(task.listId);
  if (list) bits.push(`<span>${esc(list)}</span>`);

  const row = h(`
    <li class="row${task.completed ? ' done' : ''}" data-id="${task.id}">
      <div class="row-swipe-bg" aria-hidden="true">${icon('check', 18)} Done</div>
      <div class="row-swipe-del" aria-hidden="true">Delete ${icon('trash', 18)}</div>
      <div class="row-inner">
        <button class="check" type="button" aria-label="${task.completed ? 'Mark as not done' : 'Mark as done'}"><span>${icon('check', 14)}</span></button>
        <button class="row-body" type="button">
          <span class="title">${esc(task.title)}</span>
          ${bits.length ? `<span class="sub">${bits.join('')}</span>` : ''}
        </button>
        ${task.priority === 'high' && !task.completed ? `<span class="prio" title="High priority">${icon('flag', 16)}</span>` : ''}
      </div>
    </li>`);

  row.querySelector('.check').addEventListener('click', () => toggleDone(task, row));
  row.querySelector('.row-body').addEventListener('click', () => openTaskEditor(task));
  enableSwipe(row, task.completed ? null : () => complete(task), () => removeTask(task));
  return row;
}

export async function removeTask(task) {
  const removed = await store.deleteTask(task.id);
  if (removed) toast(`Deleted: ${removed.title}`, { undo: () => store.saveTask(removed) });
}

function toggleDone(task, row) {
  if (task.completed) { store.setCompleted(task.id, false); return; }
  row.classList.add('done');
  setTimeout(() => complete(task), 280);
}

function complete(task) {
  store.setCompleted(task.id, true);
  toast(`Done: ${task.title}`, { undo: () => store.setCompleted(task.id, false) });
}

/* ---------- Add / edit sheet ---------- */

export function openTaskEditor(existing, defaults = {}) {
  const isNew = !existing;
  const task = isNew ? store.newTask(defaults) : structuredClone(existing);
  const hasExtras = !isNew && (task.type === 'exam' || task.priority !== 'medium' || task.listId || task.notes || task.notBefore);

  openSheet({
    title: isNew ? (task.type === 'exam' ? 'New exam' : 'New task') : 'Edit task',
    action: 'Save',
    extra: isNew ? null : { icon: 'trash', label: 'Delete task', onClick: (close) => { close(); removeTask(existing); } },
    onAction: save,
    build(body, close, saveBtn) {
      body.innerHTML = `
        <textarea class="title-input" rows="1" placeholder="What needs doing?" enterkeyhint="done" aria-label="Title">${esc(task.title)}</textarea>

        <div class="field" data-field="duration">
          <span class="label">Time needed</span>
          <div class="chips">${DURATIONS.map((m) => `<button type="button" class="chip" data-min="${m}" aria-pressed="${task.duration === m}">${formatMinutes(m)}</button>`).join('')}</div>
          ${estimateHint()}
        </div>

        <div class="field">
          <span class="label" data-date-label>${task.type === 'exam' ? 'Exam date' : 'Deadline'}</span>
          <div class="chips" style="margin-bottom:8px">
            <button type="button" class="chip" data-quick="0">Today</button>
            <button type="button" class="chip" data-quick="1">Tomorrow</button>
            <button type="button" class="chip" data-quick="7">In a week</button>
          </div>
          <div class="date-wrap">
            <input class="input num" type="date" value="${task.deadline || ''}" aria-label="Date">
            <button type="button" class="text-button date-clear" data-clear>Clear</button>
          </div>
        </div>

        <button type="button" class="more-toggle" aria-expanded="${hasExtras}">${icon('caretRight', 16)} More options</button>
        <div class="more" ${hasExtras ? '' : 'hidden'}>
          <div class="field">
            <span class="label">Type</span>
            <div class="segmented" data-seg="type">
              <button type="button" data-v="task" aria-pressed="${task.type === 'task'}">Task</button>
              <button type="button" data-v="exam" aria-pressed="${task.type === 'exam'}">Exam</button>
            </div>
          </div>
          <div class="field" data-field="subject" ${task.type === 'exam' && state.subjects.length ? '' : 'hidden'}>
            <label class="label" for="subject-select">Subject<span class="hint">Gets 50% more study time in the 2 weeks before the exam</span></label>
            <select id="subject-select" class="select">
              <option value="">No subject</option>
              ${state.subjects.map((s) => `<option value="${s.id}" ${task.subjectId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <span class="label">Priority</span>
            <div class="segmented" data-seg="priority">
              ${['low', 'medium', 'high'].map((p) => `<button type="button" data-v="${p}" aria-pressed="${task.priority === p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}
            </div>
          </div>
          <div class="field" data-field="notbefore" ${task.type === 'exam' ? 'hidden' : ''}>
            <span class="label">Not before<span class="hint">e.g. you're at work until then, or can't start until a day</span></span>
            <div class="date-wrap">
              <input class="input num" type="date" value="${task.notBefore || ''}" data-nb-date aria-label="Not before date">
              <input class="input num" type="time" step="300" value="${task.notBeforeTime || ''}" data-nb-time aria-label="Not before time" style="flex:0 0 112px">
              <button type="button" class="text-button date-clear" data-nb-clear>Clear</button>
            </div>
          </div>
          <div class="field" data-field="repeat" ${task.type === 'exam' ? 'hidden' : ''}>
            <span class="label">Repeat<span class="hint">When you finish it, the next one is added automatically</span></span>
            <div class="segmented" data-seg="repeat">
              ${[['none', 'Never'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly']].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${(task.repeat || 'none') === v}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="field">
            <label class="label" for="list-select">List</label>
            <select id="list-select" class="select">
              <option value="">No list</option>
              ${state.lists.map((l) => `<option value="${l.id}" ${task.listId === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="label" for="notes">Notes</label>
            <textarea id="notes" class="textarea">${esc(task.notes)}</textarea>
          </div>
        </div>

        ${isNew ? '' : `<div class="delete-row"><button type="button" class="text-button danger with-icon" data-delete>${icon('trash', 18)} Delete task</button></div>`}
      `;

      const title = body.querySelector('.title-input');
      const grow = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
      const sync = () => { saveBtn.disabled = !title.value.trim(); };
      title.addEventListener('input', () => { task.title = title.value.replace(/\n/g, ' '); grow(); sync(); });
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (title.value.trim()) save(close); } });
      sync(); requestAnimationFrame(grow);
      if (isNew) setTimeout(() => title.focus(), 60);

      // Duration
      body.querySelectorAll('[data-min]').forEach((b) => b.addEventListener('click', () => {
        task.duration = Number(b.dataset.min);
        body.querySelectorAll('[data-min]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      }));

      // Deadline
      const dateInput = body.querySelector('input[type=date]');
      const setDate = (key) => { task.deadline = key || null; dateInput.value = key || ''; markQuick(); };
      const markQuick = () => body.querySelectorAll('[data-quick]').forEach((b) =>
        b.setAttribute('aria-pressed', !!task.deadline && daysBetween(todayKey(), task.deadline) === Number(b.dataset.quick)));
      body.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => setDate(addDays(todayKey(), Number(b.dataset.quick)))));
      dateInput.addEventListener('change', () => setDate(dateInput.value));
      body.querySelector('[data-clear]').addEventListener('click', () => setDate(null));
      markQuick();

      // More options
      const moreBtn = body.querySelector('.more-toggle');
      const more = body.querySelector('.more');
      moreBtn.addEventListener('click', () => {
        const open = more.hidden;
        more.hidden = !open;
        moreBtn.setAttribute('aria-expanded', open);
      });
      body.querySelectorAll('[data-seg]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        task[seg.dataset.seg] = b.dataset.v;
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
        if (seg.dataset.seg === 'type') {
          body.querySelector('[data-date-label]').textContent = task.type === 'exam' ? 'Exam date' : 'Deadline';
          body.querySelector('[data-field="duration"]').hidden = task.type === 'exam';
          body.querySelector('[data-field="subject"]').hidden = task.type !== 'exam' || !state.subjects.length;
          body.querySelector('[data-field="repeat"]').hidden = task.type === 'exam';
          body.querySelector('[data-field="notbefore"]').hidden = task.type === 'exam';
        }
        if (seg.dataset.seg === 'repeat' && task.repeat !== 'none' && !task.deadline) setDate(todayKey());
      })));
      body.querySelector('[data-field="duration"]').hidden = task.type === 'exam';
      const nbDate = body.querySelector('[data-nb-date]'), nbTime = body.querySelector('[data-nb-time]');
      nbDate.addEventListener('change', () => { task.notBefore = nbDate.value || null; if (!task.notBefore) { task.notBeforeTime = null; nbTime.value = ''; } });
      nbTime.addEventListener('change', () => {
        if (nbTime.value && !nbDate.value) { nbDate.value = todayKey(); task.notBefore = todayKey(); }
        task.notBeforeTime = nbTime.value || null;
      });
      body.querySelector('[data-nb-clear]').addEventListener('click', () => { task.notBefore = null; task.notBeforeTime = null; nbDate.value = ''; nbTime.value = ''; });
      body.querySelector('#subject-select').addEventListener('change', (e) => { task.subjectId = e.target.value || null; });
      body.querySelector('#list-select').addEventListener('change', (e) => { task.listId = e.target.value || null; });
      body.querySelector('#notes').addEventListener('input', (e) => { task.notes = e.target.value; });

      // Delete
      body.querySelector('[data-delete]')?.addEventListener('click', async () => {
        close();
        const removed = await store.deleteTask(task.id);
        toast('Task deleted', { undo: () => store.saveTask(removed) });
      });
    },
  });

  function save(close) {
    if (!task.title.trim()) return;
    store.saveTask(task);
    close();
  }
}
