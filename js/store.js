// App state: loaded from IndexedDB once, kept in memory, written through on every change.

import * as db from './db.js';
import { todayKey } from './dates.js';

const DEFAULT_SETTINGS = { id: 'app', theme: 'auto', defaultDuration: 30 };

export const state = { tasks: [], lists: [], settings: { ...DEFAULT_SETTINGS } };

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function load() {
  const [tasks, lists, settings] = await Promise.all([db.getAll('tasks'), db.getAll('lists'), db.getAll('settings')]);
  state.tasks = tasks;
  state.lists = lists.sort((a, b) => a.order - b.order);
  state.settings = { ...DEFAULT_SETTINGS, ...(settings.find((s) => s.id === 'app') || {}) };

  // First run: two starter lists.
  if (!lists.length && !tasks.length && !settings.length) {
    await addList('School');
    await addList('Personal');
    await db.put('settings', state.settings);
  }
}

/* ---------- Tasks ---------- */

/** A task sits in the inbox until it has a list or a deadline. */
const inInbox = (t) => !t.listId && !t.deadline;

export function newTask(fields = {}) {
  return {
    id: uid(),
    title: '',
    notes: '',
    listId: null,
    type: 'task',
    subjectId: null,
    priority: 'medium',
    duration: state.settings.defaultDuration,
    deadline: null,
    steps: [],
    inbox: true,
    completed: false,
    completedAt: null,
    createdAt: Date.now(),
    ...fields,
  };
}

export async function saveTask(task) {
  task.title = task.title.trim();
  if (task.type === 'exam' && !task.deadline) task.deadline = todayKey();
  task.inbox = inInbox(task);
  const i = state.tasks.findIndex((t) => t.id === task.id);
  if (i >= 0) state.tasks[i] = task; else state.tasks.push(task);
  emit();
  await db.put('tasks', task);
}

export async function setCompleted(id, completed) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = completed;
  task.completedAt = completed ? Date.now() : null;
  emit();
  await db.put('tasks', task);
}

export async function deleteTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  state.tasks = state.tasks.filter((t) => t.id !== id);
  emit();
  await db.remove('tasks', id);
  return task;
}

/** Sort: earliest deadline first (none last), then priority, then oldest first. */
const PRIO = { high: 0, medium: 1, low: 2 };
export function sortTasks(list) {
  return [...list].sort((a, b) =>
    (a.deadline || '9999').localeCompare(b.deadline || '9999') ||
    PRIO[a.priority] - PRIO[b.priority] ||
    a.createdAt - b.createdAt);
}

/* ---------- Lists ---------- */

export async function addList(name) {
  const list = { id: uid(), name: name.trim(), order: state.lists.length ? Math.max(...state.lists.map((l) => l.order)) + 1 : 0 };
  state.lists.push(list);
  emit();
  await db.put('lists', list);
  return list;
}

export async function renameList(id, name) {
  const list = state.lists.find((l) => l.id === id);
  if (!list || !name.trim()) return;
  list.name = name.trim();
  emit();
  await db.put('lists', list);
}

/** Deleting a list keeps its tasks; they lose the list (and may go back to the inbox). */
export async function deleteList(id) {
  state.lists = state.lists.filter((l) => l.id !== id);
  const affected = state.tasks.filter((t) => t.listId === id);
  for (const t of affected) { t.listId = null; t.inbox = inInbox(t); }
  emit();
  await db.remove('lists', id);
  await Promise.all(affected.map((t) => db.put('tasks', t)));
}

export const listName = (id) => state.lists.find((l) => l.id === id)?.name;

/* ---------- Settings ---------- */

export async function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  emit();
  await db.put('settings', state.settings);
}

/* ---------- Backup ---------- */

export function exportData() {
  return {
    app: 'planner',
    format: 1,
    exportedAt: new Date().toISOString(),
    data: { tasks: state.tasks, lists: state.lists, settings: [state.settings] },
  };
}

export async function importData(json) {
  if (!json || json.app !== 'planner' || !json.data) throw new Error('This file is not a Planner backup.');
  const data = {
    tasks: Array.isArray(json.data.tasks) ? json.data.tasks : [],
    lists: Array.isArray(json.data.lists) ? json.data.lists : [],
    settings: Array.isArray(json.data.settings) ? json.data.settings : [],
  };
  await db.replaceAll(data);
  await load();
  emit();
}
