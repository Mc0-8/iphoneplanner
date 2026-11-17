// App state: loaded from IndexedDB once, kept in memory, written through on every change.
// After every change the scheduler re-plans the coming weeks (see scheduler.js).

import * as db from './db.js';
import { todayKey, addDays, weekday } from './dates.js';
import { plan, freeSlot, windowFor } from './scheduler.js';

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
  pomodoro: false,
};

export const REVIEW_STEPS = [1, 3, 7, 14, 30]; // days until the next review

export const state = {
  tasks: [], lists: [], subjects: [], commitments: [], daysOff: [], blocks: [],
  notes: [], topics: [], habits: [], grades: [], timeLogs: [],
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
  for (const k of ['notes', 'topics', 'habits', 'grades', 'timeLogs']) state[k] = data[k] || [];
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

/** Next date for a repeating task, after `from` and not before today. */
export function nextOccurrence(repeat, from) {
  const step = (k) => {
    if (repeat === 'daily') return addDays(k, 1);
    if (repeat === 'weekly') return addDays(k, 7);
    if (repeat === 'weekdays') { let n = addDays(k, 1); while (weekday(n) === 0 || weekday(n) === 6) n = addDays(n, 1); return n; }
    return null;
  };
  let n = step(from || todayKey());
  while (n && n < todayKey()) n = step(n);
  return n;
}

/** Set a task's completed state; a repeating task gets its next copy when finished. */
async function markTask(task, completed) {
  if (task.completed === completed) return;
  task.completed = completed;
  task.completedAt = completed ? Date.now() : null;
  if (completed && task.repeat && task.repeat !== 'none' && !task.nextId) {
    const next = { ...structuredClone(task), id: uid(), completed: false, completedAt: null, nextId: null, createdAt: Date.now(),
      deadline: nextOccurrence(task.repeat, task.deadline) };
    task.nextId = next.id;
    state.tasks.push(next);
    await db.put('tasks', next);
  }
  if (!completed && task.nextId) {
    const next = state.tasks.find((t) => t.id === task.nextId);
    if (next && !next.completed) {
      state.tasks = state.tasks.filter((t) => t.id !== next.id);
      await db.remove('tasks', next.id);
    }
    task.nextId = null;
  }
  await db.put('tasks', task);
}

export async function setCompleted(id, completed) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  await markTask(task, completed);
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
      await markTask(task, doneMin >= task.duration - 5);
    }
  }
  await commit();
}

/** Move a block by hand: it gets pinned there, so the planner works around it. */
export async function moveBlock(id, date, start) {
  const b = state.blocks.find((x) => x.id === id);
  if (!b) return;
  Object.assign(b, { date, start: Math.max(0, Math.min(1440 - b.duration, Math.round(start / 5) * 5)), pinned: true, status: 'planned' });
  await commit();
}

/** Move to another day: first free time at or after the same time, else the first free time that day. */
export async function moveBlockToDay(id, date) {
  const b = state.blocks.find((x) => x.id === id);
  if (!b) return null;
  const start = freeSlot(state, date, b.duration, id, b.start) ?? freeSlot(state, date, b.duration, id)
    ?? (windowFor(state.settings, state.daysOff, date) || [b.start])[0];
  await moveBlock(id, date, start);
  return start;
}

export async function setPinned(id, pinned) {
  const b = state.blocks.find((x) => x.id === id);
  if (!b) return;
  b.pinned = pinned;
  await commit();
}

/** Unpin everything still to come in a week, so the planner can spread it again. */
export async function respreadWeek(monday, sunday) {
  const today = todayKey();
  for (const b of state.blocks) {
    if (b.status === 'planned' && b.date >= monday && b.date <= sunday && b.date >= today) b.pinned = false;
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
    if (doneMin >= task.duration - 5) await markTask(task, true);
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

/* ---------- Notes, topics and reviews ---------- */

const norm = (s) => s.trim().toLowerCase();

/** Find or create the topic for a subject + name. New topics are first reviewed tomorrow. */
async function topicFor(subjectId, name, date) {
  if (!name.trim()) return null;
  let t = state.topics.find((x) => x.subjectId === subjectId && norm(x.name) === norm(name));
  if (!t) {
    t = { id: uid(), subjectId, name: name.trim(), step: 0, nextReview: addDays(date, REVIEW_STEPS[0]), lastRating: null, lastReviewed: null, hardCount: 0, createdAt: Date.now() };
    state.topics.push(t);
    await db.put('topics', t);
  }
  return t;
}

export async function saveNote(note) {
  note.text = note.text.trim();
  const oldTopic = state.notes.find((n) => n.id === note.id)?.topicId;
  const topic = await topicFor(note.subjectId, note.topicName || '', note.date);
  note.topicId = topic ? topic.id : null;
  const i = state.notes.findIndex((n) => n.id === note.id);
  if (i >= 0) state.notes[i] = note; else state.notes.push(note);
  await db.put('notes', note);
  if (oldTopic && oldTopic !== note.topicId) await dropEmptyTopic(oldTopic);
  await commit();
}

export async function deleteNote(id) {
  const note = state.notes.find((n) => n.id === id);
  state.notes = state.notes.filter((n) => n.id !== id);
  await db.remove('notes', id);
  if (note?.topicId) await dropEmptyTopic(note.topicId);
  await commit();
  return note;
}

async function dropEmptyTopic(topicId) {
  if (state.notes.some((n) => n.topicId === topicId)) return;
  state.topics = state.topics.filter((t) => t.id !== topicId);
  await db.remove('topics', topicId);
}

export async function deleteTopic(id) {
  const notes = state.notes.filter((n) => n.topicId === id);
  for (const n of notes) { state.notes = state.notes.filter((x) => x.id !== n.id); await db.remove('notes', n.id); }
  state.topics = state.topics.filter((t) => t.id !== id);
  await db.remove('topics', id);
  await commit();
}

/** Easy / OK / Hard. OK → next step, Hard → back to 1 day, Easy → skip a step. */
export async function rateTopic(id, rating) {
  const t = state.topics.find((x) => x.id === id);
  if (!t) return;
  const today = todayKey();
  t.step = rating === 'hard' ? 0 : Math.min(REVIEW_STEPS.length - 1, t.step + (rating === 'easy' ? 2 : 1));
  t.nextReview = addDays(today, REVIEW_STEPS[t.step]);
  t.lastRating = rating;
  t.lastReviewed = today;
  if (rating === 'hard') t.hardCount = (t.hardCount || 0) + 1;
  await db.put('topics', t);
  // A review block today is done once all its topics are reviewed.
  for (const b of state.blocks) {
    if (b.kind === 'review' && b.date === today && b.status === 'planned' && b.topicIds?.includes(id) &&
        b.topicIds.every((tid) => { const x = state.topics.find((y) => y.id === tid); return !x || x.lastReviewed === today; })) {
      b.status = 'done';
    }
  }
  await commit();
}

/** Skip a review block: its topics move to tomorrow. */
export async function skipReview(blockId) {
  const b = state.blocks.find((x) => x.id === blockId);
  if (!b) return;
  const tomorrow = addDays(todayKey(), 1);
  for (const id of b.topicIds || []) {
    const t = state.topics.find((x) => x.id === id);
    if (t && t.nextReview < tomorrow) { t.nextReview = tomorrow; await db.put('topics', t); }
  }
  b.status = 'missed';
  await commit();
}

/** Flashcards from "Q: …" / "A: …" lines. */
export function flashcards(text) {
  const cards = [];
  let q = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([QA])\s*[:.)]\s*(.*)$/i);
    if (!m) { if (q && cards.at(-1)?.q === q && line.trim()) cards.at(-1).a += ' ' + line.trim(); continue; }
    if (m[1].toUpperCase() === 'Q') q = m[2].trim();
    else if (q) { cards.push({ q, a: m[2].trim() }); }
  }
  return cards;
}

export const topicsDue = (day = todayKey()) => state.topics.filter((t) => t.nextReview && t.nextReview <= day);

/* ---------- Habits ---------- */

export async function saveHabit(h) {
  h.name = h.name.trim();
  const i = state.habits.findIndex((x) => x.id === h.id);
  if (i >= 0) state.habits[i] = h; else state.habits.push(h);
  await db.put('habits', h);
  emit();
}
export async function deleteHabit(id) {
  const h = state.habits.find((x) => x.id === id);
  state.habits = state.habits.filter((x) => x.id !== id);
  await db.remove('habits', id);
  emit();
  return h;
}
export async function toggleHabit(id, day = todayKey()) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  h.done = h.done.includes(day) ? h.done.filter((d) => d !== day) : [...h.done, day];
  await db.put('habits', h);
  emit();
}

/* ---------- Grades ---------- */

export async function addGrade(g) {
  const grade = { id: uid(), date: todayKey(), ...g };
  state.grades.push(grade);
  await db.put('grades', grade);
  emit();
}
export async function deleteGrade(id) {
  state.grades = state.grades.filter((g) => g.id !== id);
  await db.remove('grades', id);
  emit();
}

/* ---------- Time logs (focus timer) ---------- */

export async function logTime(block, minutes) {
  if (minutes < 1) return;
  const log = { id: uid(), blockId: block.id, date: todayKey(), minutes: Math.round(minutes), planned: block.duration,
    kind: block.kind, subjectId: block.subjectId || null, taskId: block.taskId || null };
  state.timeLogs.push(log);
  await db.put('timeLogs', log);
}

/** How long tasks really take compared to the estimate (1.2 = 20% longer). Null until there's enough data. */
export function estimateRatio() {
  const logs = state.timeLogs.filter((l) => l.kind === 'task');
  if (logs.length < 3) return null;
  const planned = logs.reduce((s, l) => s + l.planned, 0);
  return planned ? logs.reduce((s, l) => s + l.minutes, 0) / planned : null;
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
    format: 3,
    exportedAt: new Date().toISOString(),
    data: {
      tasks: state.tasks, lists: state.lists, subjects: state.subjects,
      commitments: state.commitments, daysOff: state.daysOff, blocks: state.blocks,
      notes: state.notes, topics: state.topics, habits: state.habits, grades: state.grades, timeLogs: state.timeLogs,
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
