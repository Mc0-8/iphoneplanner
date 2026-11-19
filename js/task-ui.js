// Task rows and the add/edit sheet, shared by Today and Tasks.

import { icon } from './icons.js';
import { esc, h, openSheet, toast, enableSwipe } from './ui.js';
import * as store from './store.js';
import { state } from './store.js';
import { todayKey, addDays, shortDate, formatMinutes, daysBetween } from './dates.js';
import { parseQuickAdd, titleKeeping } from './parse.js';
import { linkedTaskIds, plainText, splitCards } from './notes-format.js';

const DURATIONS = [15, 30, 45, 60, 90, 120];
const lower = (w) => w.replace(/^(Today|Tomorrow|Yesterday)$/, (x) => x.toLowerCase());

/** "Fri 18:00", "today", "tomorrow 07:30" for an "on the day" task. */
export function onDayLabel(task) {
  const d = shortDate(task.deadline);
  return `${/^(Today|Tomorrow)$/.test(d) ? d : 'On ' + d}${task.atTime ? ' ' + task.atTime : ''}`;
}

/** "Tasks usually take you 25% longer than you plan" — from the focus timer's logs. */
function estimateHint() {
  const r = store.estimateRatio();
  if (!r || Math.abs(r - 1) < 0.1) return '';
  const pct = Math.round(Math.abs(r - 1) * 100);
  return `<p class="fineprint" style="margin:8px 0 0">From your timer: tasks usually take you ${pct}% ${r > 1 ? 'longer' : 'less time'} than you plan.</p>`;
}

/* ---------- Overbooked ---------- */

/** Sheet listing the tasks that don't fit before their deadline, with ways to fix it. */
export function openOverbooked() {
  openSheet({
    title: 'Not enough time',
    build(body) {
      const draw = () => {
        const list = state.plan.atRisk || [];
        if (!list.length) { body.innerHTML = '<p class="empty">Everything fits now.</p>'; return; }
        body.innerHTML = `
          <p style="margin-top:0">There isn't enough free time before ${list.length === 1 ? 'this deadline' : 'these deadlines'}. You can:</p>
          <ul class="summary-list">
            <li>Move the deadline or shorten the task (tap it below)</li>
            <li>Add free hours or raise your daily limit in Settings</li>
            <li>Remove busy times or days off you don't need</li>
          </ul>
          <ul class="rows"></ul>`;
        const ul = body.querySelector('.rows');
        for (const r of list) {
          const t = state.tasks.find((x) => x.id === r.taskId);
          if (t) ul.append(taskRow(t));
        }
      };
      draw();
      const unsub = store.subscribe(() => { if (document.body.contains(body)) draw(); else unsub(); });
    },
  });
}

/* ---------- Row ---------- */

export function taskRow(task, { showList = true, hideToday = false } = {}) {
  const today = todayKey();
  const bits = [];
  if (task.type === 'exam') {
    bits.push(`<span class="tag exam">${icon('exam', 14)}Exam · ${esc(shortDate(task.deadline))}</span>`);
  } else if (task.dateMode === 'on' && task.deadline) {
    const missed = !task.completed && task.deadline < today;
    if (missed) bits.push(`<span class="late">Missed · ${esc(shortDate(task.deadline))}</span>`);
    else if (!(hideToday && task.deadline === today && !task.atTime)) bits.push(`<span class="num">${esc(onDayLabel(task))}</span>`);
  } else if (task.deadline && !(hideToday && task.deadline === today)) {
    const late = !task.completed && task.deadline < today;
    bits.push(late
      ? `<span class="late">Overdue · ${esc(shortDate(task.deadline))}</span>`
      : `<span>Due ${esc(lower(shortDate(task.deadline)))}</span>`);
  }
  const short = !task.completed && store.shortfall(task.id);
  if (short) bits.push(`<span class="tight">Won't fit · ${formatMinutes(short.minutes)} short</span>`);
  if (task.type !== 'exam') bits.push(`<span class="num">${formatMinutes(task.duration)}</span>`);
  if (task.steps?.length) bits.push(`<span class="num">${task.steps.filter((x) => x.done).length}/${task.steps.length} steps</span>`);
  if (task.notBefore && task.notBefore >= today && !task.completed && task.dateMode !== 'on') bits.push(`<span>From ${esc(lower(shortDate(task.notBefore)))}${task.notBeforeTime ? ` ${task.notBeforeTime}` : ''}</span>`);
  if (task.repeat && task.repeat !== 'none') bits.push(`<span>${{ daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly' }[task.repeat]}</span>`);
  const list = showList && store.listName(task.listId);
  if (list) bits.push(`<span>${esc(list)}</span>`);

  const colour = task.type === 'exam' && store.subjectById(task.subjectId)?.colour;
  const row = h(`
    <li class="row${colour ? ' tinted' : ''}${task.completed ? ' done' : ''}"${colour ? ` style="--sc:${colour}"` : ''} data-id="${task.id}">
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

/** Notes that link to this task (see notes-format.js), shown in the task sheet. */
function linkedNotesHTML(taskId) {
  const notes = state.notes.filter((n) => linkedTaskIds(n.text).includes(taskId)).sort((a, b) => b.createdAt - a.createdAt);
  if (!notes.length) return '';
  return `
    <div class="field linked-notes">
      <span class="label">Linked notes</span>
      <ul class="rows">${notes.map((n) => {
        const topic = state.topics.find((t) => t.id === n.topicId);
        const first = plainText(splitCards(n.text).body || n.text).split('\n').find((l) => l.trim()) || '';
        return `<li class="row"><div class="row-inner"><button class="row-body" type="button" data-note="${n.id}">
          <span class="title note-text">${esc(first)}</span>
          <span class="sub"><span>${esc(topic?.name || 'No topic')}</span><span>${esc(shortDate(n.date))}</span></span>
        </button></div></li>`;
      }).join('')}</ul>
    </div>`;
}

export function openTaskEditor(existing, defaults = {}) {
  const isNew = !existing;
  const task = isNew ? store.newTask(defaults) : structuredClone(existing);
  task.dateMode = task.dateMode || 'due';
  task.steps = task.steps || [];
  const hasExtras = !isNew && (task.type === 'exam' || task.priority !== 'medium' || task.listId || task.notes || task.notBefore || task.steps.length || (task.repeat && task.repeat !== 'none'));
  // Quick add: words like "fri 2h #school" in a new task's title fill in the fields.
  const QUICK = ['deadline', 'dateMode', 'atTime', 'duration', 'repeat', 'listId', 'priority'];
  const base = Object.fromEntries(QUICK.map((k) => [k, task[k] ?? null]));
  const manual = new Set();   // fields the person set by hand: typing no longer changes them
  let quickOn = isNew, parsed = null;

  openSheet({
    title: isNew ? (task.type === 'exam' ? 'New exam' : 'New task') : 'Edit task',
    action: 'Save',
    extra: isNew ? null : { icon: 'trash', label: 'Delete task', onClick: (close) => { close(); removeTask(existing); } },
    onAction: save,
    build(body, close, saveBtn) {
      body.innerHTML = `
        <textarea class="title-input" rows="1" placeholder="${isNew ? 'What needs doing? e.g. essay fri 2h' : 'What needs doing?'}" enterkeyhint="done" aria-label="Title">${esc(task.title)}</textarea>
        <p class="understood" data-understood hidden><span></span> <button type="button" class="text-button" data-keep>Keep as typed</button></p>

        <div class="field" data-field="duration">
          <span class="label">Time needed</span>
          <div class="chips" data-durations></div>
          ${estimateHint()}
        </div>

        <div class="field">
          <span class="label" data-date-label></span>
          <div class="segmented date-mode" data-seg="dateMode" ${task.type === 'exam' ? 'hidden' : ''}>
            <button type="button" data-v="due">Due by</button>
            <button type="button" data-v="on">On the day</button>
          </div>
          <div class="chips" style="margin-bottom:8px">
            <button type="button" class="chip" data-quick="0">Today</button>
            <button type="button" class="chip" data-quick="1">Tomorrow</button>
            <button type="button" class="chip" data-quick="7">In a week</button>
          </div>
          <div class="date-wrap">
            <input class="input num" type="date" value="${task.deadline || ''}" aria-label="Date" data-date>
            <input class="input num" type="time" step="300" value="${task.atTime || ''}" data-at-time aria-label="Time (optional)" style="flex:0 0 120px">
            <button type="button" class="text-button date-clear" data-clear>Clear</button>
          </div>
          <p class="fineprint" data-mode-hint style="margin:8px 0 0"></p>
        </div>

        <button type="button" class="more-toggle" aria-expanded="${hasExtras}">${icon('caretRight', 16)} More options</button>
        <div class="more" ${hasExtras ? '' : 'hidden'}>
          <div class="field" data-field="steps" ${task.type === 'exam' ? 'hidden' : ''}>
            <span class="label">Steps<span class="hint">Smaller bits to tick off as you go</span></span>
            <ul class="steps" data-steps></ul>
            <input class="input" data-step-add placeholder="Add a step" enterkeyhint="done" aria-label="Add a step">
          </div>
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
            <p class="fineprint warn-text" data-nb-warn hidden>This is after the deadline, so the task can only be planned late.</p>
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
        ${linkedNotesHTML(task.id)}

        ${isNew ? '' : `<div class="delete-row"><button type="button" class="text-button danger with-icon" data-delete>${icon('trash', 18)} Delete task</button></div>`}
      `;

      const title = body.querySelector('.title-input');
      const grow = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
      const sync = () => { saveBtn.disabled = !title.value.trim(); };
      title.addEventListener('input', () => { task.title = title.value.replace(/\n/g, ' '); grow(); quick(); sync(); });
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (title.value.trim()) save(close); } });
      requestAnimationFrame(grow);
      if (isNew) setTimeout(() => title.focus(), 60);

      // Duration
      const durWrap = body.querySelector('[data-durations]');
      const drawDurations = () => {
        const list = DURATIONS.includes(task.duration) ? DURATIONS : [...DURATIONS, task.duration].sort((a, b) => a - b);
        durWrap.innerHTML = list.map((m) => `<button type="button" class="chip" data-min="${m}" aria-pressed="${task.duration === m}">${formatMinutes(m)}</button>`).join('');
      };
      durWrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-min]');
        if (!b) return;
        task.duration = Number(b.dataset.min); manual.add('duration'); drawDurations();
      });

      // Date: "Due by" (homework: done before the day) or "On the day" (gym, practice: exactly that day)
      const dateInput = body.querySelector('[data-date]');
      const timeInput = body.querySelector('[data-at-time]');
      const setDate = (key, byHand = true) => { task.deadline = key || null; if (!key) task.atTime = null; if (byHand) manual.add('deadline'); drawDate(); };
      const drawDate = () => {
        const on = task.dateMode === 'on' && task.type !== 'exam';
        dateInput.value = task.deadline || '';
        timeInput.value = task.atTime || '';
        timeInput.hidden = !on;
        body.querySelector('[data-date-label]').textContent = task.type === 'exam' ? 'Exam date' : on ? 'Day' : 'Deadline';
        body.querySelectorAll('[data-seg="dateMode"] button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === task.dateMode));
        body.querySelectorAll('[data-quick]').forEach((b) =>
          b.setAttribute('aria-pressed', !!task.deadline && daysBetween(todayKey(), task.deadline) === Number(b.dataset.quick)));
        const hint = body.querySelector('[data-mode-hint]');
        hint.hidden = task.type === 'exam' || !task.deadline;
        hint.textContent = on
          ? (task.atTime ? 'Fixed at this time, like an appointment.' : 'Planned on exactly this day, never earlier. Add a time to fix it there.')
          : state.settings.finishDayBefore ? 'Planned before it\'s due: the day before, if there\'s room.' : 'Planned on or before this day.';
        const nb = body.querySelector('[data-field="notbefore"]');
        if (nb) nb.hidden = task.type === 'exam' || on;
      };
      body.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => setDate(addDays(todayKey(), Number(b.dataset.quick)))));
      dateInput.addEventListener('change', () => setDate(dateInput.value));
      timeInput.addEventListener('change', () => {
        task.atTime = timeInput.value || null; manual.add('atTime');
        if (task.atTime && !task.deadline) setDate(todayKey());
        drawDate();
      });
      body.querySelector('[data-clear]').addEventListener('click', () => setDate(null));

      // Steps
      const stepsUl = body.querySelector('[data-steps]');
      const drawSteps = () => {
        stepsUl.innerHTML = task.steps.map((st) => `
          <li class="step${st.done ? ' done' : ''}" data-step="${st.id}">
            <button type="button" class="check small" aria-label="${st.done ? 'Mark step as not done' : 'Mark step as done'}"><span>${icon('check', 12)}</span></button>
            <input class="step-text" value="${esc(st.text)}" aria-label="Step">
            <button type="button" class="icon-button" data-rm aria-label="Remove step">${icon('x', 16)}</button>
          </li>`).join('');
      };
      stepsUl.addEventListener('click', (e) => {
        const li = e.target.closest('[data-step]');
        if (!li) return;
        const st = task.steps.find((x) => x.id === li.dataset.step);
        if (e.target.closest('.check')) { st.done = !st.done; drawSteps(); }
        if (e.target.closest('[data-rm]')) { task.steps = task.steps.filter((x) => x !== st); drawSteps(); }
      });
      stepsUl.addEventListener('input', (e) => {
        const li = e.target.closest('[data-step]');
        if (li) task.steps.find((x) => x.id === li.dataset.step).text = e.target.value;
      });
      const stepAdd = body.querySelector('[data-step-add]');
      const addStep = () => {
        const text = stepAdd.value.trim();
        if (!text) return;
        task.steps.push({ id: store.uid(), text, done: false });
        stepAdd.value = '';
        drawSteps();
      };
      stepAdd.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } });
      stepAdd.addEventListener('blur', addStep);

      // Quick add
      const understood = body.querySelector('[data-understood]');
      const quick = () => {
        if (!quickOn) return;
        parsed = parseQuickAdd(title.value, state.lists);
        for (const k of QUICK) {
          if (manual.has(k)) continue;
          task[k] = k in parsed.fields ? parsed.fields[k] : base[k];
        }
        if (!task.dateMode) task.dateMode = 'due';
        if (task.dateMode !== 'on') task.atTime = null;
        if (task.repeat && task.repeat !== 'none' && !task.deadline) task.deadline = todayKey();
        const f = parsed.fields, parts = [];
        if (f.deadline && !manual.has('deadline')) parts.push(task.dateMode === 'on' ? onDayLabel(task).replace(/^On /, 'on ').replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase()) : `due ${lower(shortDate(task.deadline))}`);
        else if (f.atTime && !manual.has('atTime')) parts.push(`at ${f.atTime}`);
        if (f.duration && !manual.has('duration')) parts.push(formatMinutes(f.duration));
        if (f.repeat && !manual.has('repeat')) parts.push({ daily: 'repeats daily', weekly: 'repeats weekly', weekdays: 'repeats on weekdays' }[f.repeat]);
        if (f.listId && !manual.has('listId')) parts.push(parsed.labels[0]);
        if (f.priority && !manual.has('priority')) parts.push(`${f.priority} priority`);
        understood.hidden = !parts.length;
        understood.querySelector('span').textContent = parts.length ? `Understood: ${parts.join(' · ')}` : '';
        refresh();
      };
      body.querySelector('[data-keep]').addEventListener('click', () => {
        quickOn = false; parsed = null;
        for (const k of QUICK) if (!manual.has(k)) task[k] = base[k];
        understood.hidden = true;
        refresh(); sync(); title.focus();
      });
      const refresh = () => {
        drawDurations(); drawDate();
        for (const k of ['priority', 'repeat']) body.querySelectorAll(`[data-seg="${k}"] button`).forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === (task[k] || (k === 'repeat' ? 'none' : 'medium'))));
        const ls = body.querySelector('#list-select'); if (ls) ls.value = task.listId || '';
      };

      // More options
      const moreBtn = body.querySelector('.more-toggle');
      const more = body.querySelector('.more');
      moreBtn.addEventListener('click', () => {
        const open = more.hidden;
        more.hidden = !open;
        moreBtn.setAttribute('aria-expanded', open);
      });
      body.querySelectorAll('[data-seg]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const k = seg.dataset.seg;
        task[k] = b.dataset.v;
        manual.add(k);
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
        if (k === 'type') {
          body.querySelector('[data-field="duration"]').hidden = task.type === 'exam';
          body.querySelector('[data-field="subject"]').hidden = task.type !== 'exam' || !state.subjects.length;
          body.querySelector('[data-field="repeat"]').hidden = task.type === 'exam';
          body.querySelector('[data-field="steps"]').hidden = task.type === 'exam';
          body.querySelector('[data-seg="dateMode"]').hidden = task.type === 'exam';
        }
        if (k === 'dateMode') { manual.add('atTime'); if (task.dateMode !== 'on') task.atTime = null; }
        if (k === 'repeat' && task.repeat !== 'none' && !task.deadline) setDate(todayKey());
        drawDate();
      })));
      body.querySelector('[data-field="duration"]').hidden = task.type === 'exam';
      drawDurations(); drawDate(); drawSteps(); sync();
      const nbDate = body.querySelector('[data-nb-date]'), nbTime = body.querySelector('[data-nb-time]');
      const nbWarn = () => { body.querySelector('[data-nb-warn]').hidden = !(task.notBefore && task.deadline && task.notBefore > task.deadline); };
      nbWarn();
      body.addEventListener('change', nbWarn);
      body.addEventListener('click', () => setTimeout(nbWarn));
      nbDate.addEventListener('change', () => { task.notBefore = nbDate.value || null; if (!task.notBefore) { task.notBeforeTime = null; nbTime.value = ''; } });
      nbTime.addEventListener('change', () => {
        if (nbTime.value && !nbDate.value) { nbDate.value = todayKey(); task.notBefore = todayKey(); }
        task.notBeforeTime = nbTime.value || null;
      });
      body.querySelector('[data-nb-clear]').addEventListener('click', () => { task.notBefore = null; task.notBeforeTime = null; nbDate.value = ''; nbTime.value = ''; });
      body.querySelector('#subject-select').addEventListener('change', (e) => { task.subjectId = e.target.value || null; });
      body.querySelector('#list-select').addEventListener('change', (e) => { task.listId = e.target.value || null; manual.add('listId'); });
      body.querySelector('#notes').addEventListener('input', (e) => { task.notes = e.target.value; });
      body.querySelectorAll('[data-note]').forEach((b) => b.addEventListener('click', () => {
        const n = state.notes.find((x) => x.id === b.dataset.note);
        if (n) import('./screens/notes.js').then((m) => m.openNoteEditor(n));
      }));

      // Delete
      body.querySelector('[data-delete]')?.addEventListener('click', async () => {
        close();
        const removed = await store.deleteTask(task.id);
        toast('Task deleted', { undo: () => store.saveTask(removed) });
      });
    },
  });

  async function save(close) {
    if (quickOn && parsed) {
      const t = titleKeeping(parsed, [...manual]);
      if (t.trim()) task.title = t;
    }
    if (!task.title.trim()) return;
    task.steps = task.steps.filter((x) => x.text.trim());
    close();
    await store.saveTask(task);
    // A task without a list or date isn't planned: say where it went instead of letting it vanish.
    if (isNew && task.inbox) {
      toast('Added to the Inbox. Give it a list or date to plan it.', { action: () => import('./screens/tasks.js').then((m) => m.showInbox()), actionLabel: 'Show' });
    } else if (!task.completed) {
      const short = store.shortfall(task.id);
      if (short) toast(`Heads up: ${formatMinutes(short.minutes)} of this doesn't fit before ${lower(shortDate(short.deadline))}.`, { action: () => openOverbooked(), actionLabel: 'Options' });
    }
  }
}
