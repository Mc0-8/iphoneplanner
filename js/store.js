// App state: loaded from IndexedDB once, kept in memory, written through on every change.
// After every change the scheduler re-plans the coming weeks (see scheduler.js).

import * as db from './db.js';
import { todayKey } from './dates.js';
import { plan } from './scheduler.js';

export const SUBJECT_COLOURS = ['#6B8F71', '#4F6D8F', '#C29A3B', '#8A5A7A', '#3F8A8A', '#7A7368'];

const weekdayHours = { on: true, start: '16:00', end: '21:00' };
const weekendHours = { on: true, start: '10:00', end: '17:00' };

const DEFAULT_SETTINGS = {
  id: 'app',
  theme: 'auto',
  defaultDuration: 30,
  // index = weekday, 0 = Sunday
  availability: [weekendHours, weekdayHours, weekdayHours, weekdayHours, weekdayHours, weekdayHours, weekendHours],
  dailyCap: 240,
  sessionLength: 60,
  breakMinutes: 10,
  hardCutoff: '18:00',
  checkinFrom: '20:00',
};

export const state = {
  tasks: [], lists: [], subjects: [], commitments: [], daysOff: [], blocks: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  plan: { overflow: [], weeks: [] },
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function load() {
  const all = await Promise.all(db.STORES.map((s) => db.getAll(s)));
  const data = Object.fromEntries(db.STORES.map((s, i) => [s, all[i]]));
  state.tasks = data.tasks;
  state.lists = data.lists.sort((a, b) => a.order - b.order);
  state.subjects = data.subjects.sort((a, b) => a.order - b.order);
  state.commitments = data.commitments;
  state.daysOff = data.daysOff;
  state.blocks = data.blocks;
  state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(data.settings.find((s) => s.id === 'app') || {}) };

  // First run: two starter lists.
  if (!data.lists.length && !data.tasks.length && !data.settings.length) {
    for (const name of ['School', 'Personal']) {
      const list = { id: uid(), name, order: state.lists.length };
      state.lists.push(list);
      await db.put('lists', list);
    }
    await db.put('settings', state.settings);
  }
  await commit();
}

/** Re-plan and notify the screens. Called after every change. */
export async function commit() {
  const result = plan(state);
  state.blocks = result.blocks;
  state.plan = { overflow: result.overflow, weeks: result.weeks };
  emit();
  await db.replaceStore('blocks', state.blocks);
}

export const replan = commit;

/* ---------- Tasks ---------- */

/** A task sits in the inbox until it has a list or a deadline. */
const inInbox = (t) => !t.listId && !t.deadline;

export function newTask(fields = {}) {
  return {
    id: uid(), title: '', notes: '', listId: null, type: 'task', subjectId: null,
    priority: 'medium', duration: state.settings.defaultDuration, deadline: null, steps: [],
    inbox: true, completed: false, completedAt: null, createdAt: Date.now(),
    ...fields,
  };
}

export async function saveTask(task) {
  task.title = task.title.trim();
  if (task.type === 'exam' && !task.deadline) task.deadline = todayKey();
  if (task.type !== 'exam') task.subjectId = null;
  task.inbox = inInbox(task);
  const i = state.tasks.findIndex((t) => t.id === task.id);
  if (i >= 0) state.tasks[i] = task; else state.tasks.push(task);
  await db.put('tasks', task);
  await commit();
}

export async function setCompleted(id, completed) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = completed;
  task.completedAt = completed ? Date.now() : null;
  await db.put('tasks', task);
  await commit();
}

export async function deleteTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  state.tasks = state.tasks.filter((t) => t.id !== id);
  await db.remove('tasks', id);
  await commit();
  return task;
}

const PRIO = { high: 0, medium: 1, low: 2 };
/** Earliest deadline first (none last), then priority, then oldest first. */
export function sortTasks(list) {
  return [...list].sort((a, b) =>
    (a.deadline || '9999').localeCompare(b.deadline || '9999') ||
    PRIO[a.priority] - PRIO[b.priority] ||
    a.createdAt - b.createdAt);
}

/* ---------- Blocks ---------- */

/** Tick a block off (or undo). A task is completed when all its time is done. */
export async function setBlockStatus(id, status) {
  const block = state.blocks.find((b) => b.id === id);
  if (!block) return;
  block.status = status;
  if (block.kind === 'task') {
    const task = state.tasks.find((t) => t.id === block.taskId);
    if (task) {
      const doneMin = state.blocks.filter((b) => b.taskId === task.id && b.status === 'done').reduce((s, b) => s + b.duration, 0);
      const finished = doneMin >= task.duration - 5;
      if (finished !== task.completed) {
        task.completed = finished;
        task.completedAt = finished ? Date.now() : null;
        await db.put('tasks', task);
      }
    }
  }
  await commit();
}

/** End-of-day check-in: {blockId: 'done' | 'missed'}. */
export async function checkIn(statuses) {
  for (const [id, status] of Object.entries(statuses)) {
    const b = state.blocks.find((x) => x.id === id);
    if (b) b.status = status;
  }
  for (const task of state.tasks) {
    const blocks = state.blocks.filter((b) => b.taskId === task.id);
    if (!blocks.length || task.completed) continue;
    const doneMin = blocks.filter((b) => b.status === 'done').reduce((s, b) => s + b.duration, 0);
    if (doneMin >= task.duration - 5) { task.completed = true; task.completedAt = Date.now(); await db.put('tasks', task); }
  }
  await updateSettings({ lastCheckin: todayKey() });
}

/* ---------- Lists ---------- */

export async function addList(name) {
  const list = { id: uid(), name: name.trim(), order: state.lists.length ? Math.max(...state.lists.map((l) => l.order)) + 1 : 0 };
  state.lists.push(list);
  await db.put('lists', list);
  await commit();
  return list;
}

export async function renameList(id, name) {
  const list = state.lists.find((l) => l.id === id);
  if (!list || !name.trim()) return;
  list.name = name.trim();
  await db.put('lists', list);
  emit();
}

/** Deleting a list keeps its tasks; they lose the list (and may go back to the inbox). */
export async function deleteList(id) {
  state.lists = state.lists.filter((l) => l.id !== id);
  const affected = state.tasks.filter((t) => t.listId === id);
  for (const t of affected) { t.listId = null; t.inbox = inInbox(t); }
  await db.remove('lists', id);
  await Promise.all(affected.map((t) => db.put('tasks', t)));
  await commit();
}

export const listName = (id) => state.lists.find((l) => l.id === id)?.name;

/* ---------- Subjects ---------- */

export function newSubject() {
  const used = new Set(state.subjects.map((s) => s.colour));
  const colour = SUBJECT_COLOURS.find((c) => !used.has(c)) || SUBJECT_COLOURS[state.subjects.length % SUBJECT_COLOURS.length];
  return { id: uid(), name: '', colour, hoursPerWeek: 2, hard: false, order: state.subjects.length ? Math.max(...state.subjects.map((s) => s.order)) + 1 : 0 };
}

export async function saveSubject(subject) {
  subject.name = subject.name.trim();
  const i = state.subjects.findIndex((s) => s.id === subject.id);
  if (i >= 0) state.subjects[i] = subject; else state.subjects.push(subject);
  await db.put('subjects', subject);
  await commit();
}

export async function deleteSubject(id) {
  const subject = state.subjects.find((s) => s.id === id);
  state.subjects = state.subjects.filter((s) => s.id !== id);
  await db.remove('subjects', id);
  await commit();
  return subject;
}

export const subjectById = (id) => state.subjects.find((s) => s.id === id);

/* ---------- Commitments & days off ---------- */

export async function saveCommitment(c) {
  c.name = c.name.trim();
  const i = state.commitments.findIndex((x) => x.id === c.id);
  if (i >= 0) state.commitments[i] = c; else state.commitments.push(c);
  await db.put('commitments', c);
  await commit();
}
export async function deleteCommitment(id) {
  state.commitments = state.commitments.filter((c) => c.id !== id);
  await db.remove('commitments', id);
  await commit();
}

export async function addDayOff(d) {
  const item = { id: uid(), date: null, weekday: null, label: '', ...d };
  state.daysOff.push(item);
  await db.put('daysOff', item);
  await commit();
}
export async function deleteDayOff(id) {
  state.daysOff = state.daysOff.filter((d) => d.id !== id);
  await db.remove('daysOff', id);
  await commit();
}

/* ---------- Settings ---------- */

export async function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.put('settings', state.settings);
  await commit();
}

/* ---------- Backup ---------- */

export function exportData() {
  return {
    app: 'planner',
    format: 2,
    exportedAt: new Date().toISOString(),
    data: {
      tasks: state.tasks, lists: state.lists, subjects: state.subjects,
      commitments: state.commitments, daysOff: state.daysOff, blocks: state.blocks,
      settings: [state.settings],
    },
  };
}

export async function importData(json) {
  if (!json || json.app !== 'planner' || !json.data) throw new Error('This file is not a Planner backup.');
  const data = {};
  for (const s of db.STORES) data[s] = Array.isArray(json.data[s]) ? json.data[s] : [];
  await db.replaceAll(data);
  await load();
}
