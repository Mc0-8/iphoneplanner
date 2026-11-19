// App state: loaded from IndexedDB once, kept in memory, written through on every change.
// After every change the scheduler re-plans the coming weeks (see scheduler.js).

import * as db from './db.js';
import { todayKey, addDays, weekday, daysBetween, nowMin } from './dates.js';
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
  finishDayBefore: true,
  badge: false,
  calendarAlert: 10,
  backupEvery: 7, // days between backup reminders, 0 = off
  lastBackup: null, // date key of the last backup
  backupStart: null, // date key the reminder clock starts from when there's never been a backup
  backupSnoozedUntil: null,
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
  state.tasks = data.tasks.map((t) => ({ steps: [], priority: 'medium', type: 'task', dateMode: 'due', ...t, inbox: !t.listId && !t.deadline && !t.notBefore }));
  state.lists = data.lists.sort((a, b) => a.order - b.order);
  state.subjects = data.subjects.sort((a, b) => a.order - b.order);
  state.commitments = data.commitments;
  state.daysOff = data.daysOff;
  state.blocks = data.blocks;
  for (const k of ['notes', 'topics', 'habits', 'grades', 'timeLogs']) state[k] = data[k] || [];
  state.habits = state.habits.map((x) => ({ done: [], weekdays: [], ...x }));
  state.commitments = state.commitments.map((c) => ({ weekdays: [], date: null, ...c }));
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
  if (!state.settings.backupStart) {
    state.settings.backupStart = todayKey();
    await db.put('settings', state.settings);
  }
  await commit();
}

/** Re-plan and notify the screens. Called after every change. */
export async function commit(opts = {}) {
  housekeeping();
  const result = plan(state, new Date(), opts);
  state.blocks = result.blocks;
  state.plan = { overflow: result.overflow, weeks: result.weeks };
  emit();
  await db.replaceStore('blocks', state.blocks);
}

export const replan = () => commit();

/** A subject on pause gets no new study sessions until its pause ends (pausedUntil = the day it's back). */
export const isPaused = (s, day = todayKey()) => !!s.paused && (!s.pausedUntil || s.pausedUntil > day);

/** Pause (or resume, with until = false) every subject that has weekly hours. */
export async function pauseAll(until) {
  for (const s of state.subjects) {
    if (until === false) { s.paused = false; s.pausedUntil = null; }
    else if (s.hoursPerWeek) { s.paused = true; s.pausedUntil = until || null; }
    await db.put('subjects', s);
  }
  await commit();
}

/** Small automatic tidy-ups that depend on the date. */
function housekeeping() {
  const today = todayKey();
  for (const s of state.subjects) {
    if (s.paused && s.pausedUntil && s.pausedUntil <= today) { s.paused = false; s.pausedUntil = null; db.put('subjects', s); }
  }
  for (const t of state.tasks) {
    // An exam is over once its day has passed.
    if (t.type === 'exam' && !t.completed && t.deadline && t.deadline < today) {
      t.completed = true; t.completedAt = Date.now(); t.autoCompleted = true;
      db.put('tasks', t);
    }
    // A repeating "on the day" task (gym, practice) whose day passed moves on to its next day.
    if (t.dateMode === 'on' && !t.completed && t.repeat && t.repeat !== 'none' && t.deadline && t.deadline < today) {
      t.deadline = nextOccurrence(t.repeat, t.deadline);
      db.put('tasks', t);
    }
  }
}

/* ---------- Tasks ---------- */

/** A task sits in the inbox until it has a list or a deadline. */
const inInbox = (t) => !t.listId && !t.deadline && !t.notBefore;

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
  if (task.type === 'exam' || !task.deadline) task.dateMode = 'due';
  if (task.dateMode === 'on') { task.notBefore = null; task.notBeforeTime = null; } else task.atTime = null;
  task.steps = (task.steps || []).filter((x) => x.text && x.text.trim());
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
    const deadline = nextOccurrence(task.repeat, task.deadline);
    const next = { ...structuredClone(task), id: uid(), completed: false, completedAt: null, nextId: null, createdAt: Date.now(), deadline };
    next.steps = (next.steps || []).map((x) => ({ ...x, done: false }));
    // Keep "not before" the same distance before the deadline.
    if (task.notBefore && task.deadline) next.notBefore = addDays(task.notBefore, daysBetween(task.deadline, deadline));
    else next.notBefore = null;
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

/** Tick a step inside a task. No re-plan needed. */
export async function toggleStep(taskId, stepId) {
  const task = state.tasks.find((t) => t.id === taskId);
  const step = task?.steps?.find((x) => x.id === stepId);
  if (!step) return;
  step.done = !step.done;
  await db.put('tasks', task);
  emit();
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

/**
 * Change a block's length (drag its bottom edge). Task blocks change the task's total time by the
 * same amount; study blocks just take more or less of the week's target. Either way it's pinned.
 */
export async function resizeBlock(id, duration) {
  const b = state.blocks.find((x) => x.id === id);
  if (!b || b.kind === 'review') return;
  duration = Math.max(15, Math.min(1440 - b.start, Math.round(duration / 5) * 5));
  const delta = duration - b.duration;
  if (!delta) return;
  if (b.kind === 'task') {
    const t = state.tasks.find((x) => x.id === b.taskId);
    if (t) { t.duration = Math.max(5, t.duration + delta); await db.put('tasks', t); }
  }
  Object.assign(b, { duration, pinned: true });
  await commit();
}

/**
 * "I have some time": put a task or subject at now for `minutes`, pinned. Reuses a block still to come
 * (so the plan shrinks elsewhere) or adds one. Returns the block id, for the focus timer.
 */
export async function startNow({ kind, taskId = null, subjectId = null }, minutes) {
  const today = todayKey();
  const now = Math.floor(nowMin() / 5) * 5;
  minutes = Math.max(5, Math.min(minutes, 1440 - now));
  const same = (b) => b.kind === kind && b.status === 'planned' && (kind === 'task' ? b.taskId === taskId : b.subjectId === subjectId);
  const later = state.blocks.filter((b) => same(b) && (b.date > today || b.start >= now))
    .sort((a, c) => a.date.localeCompare(c.date) || a.start - c.start)[0];
  let b = later;
  if (b) Object.assign(b, { date: today, start: now, duration: minutes, pinned: true });
  else {
    b = { id: uid(), date: today, start: now, duration: minutes, kind, taskId, subjectId, topicIds: null, pinned: true, status: 'planned' };
    state.blocks.push(b);
  }
  await commit();
  return b.id;
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
  await commit({ fresh: { from: monday < today ? today : monday, to: sunday } });
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

/** Flashcards from "Q: …" / "A: …" lines (see notes-format.js). */
export { flashcards } from './notes-format.js';

export const topicsDue = (day = todayKey()) => state.topics.filter((t) => t.nextReview && t.nextReview <= day);

/* ---------- Habits ---------- */

export async function saveHabit(h) {
  h.name = h.name.trim();
  const i = state.habits.findIndex((x) => x.id === h.id);
  if (i >= 0) state.habits[i] = h; else state.habits.push(h);
  await db.put('habits', h);
  await commit(); // a habit with a set time changes what's free
}
export async function deleteHabit(id) {
  const h = state.habits.find((x) => x.id === id);
  state.habits = state.habits.filter((x) => x.id !== id);
  await db.remove('habits', id);
  await commit();
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

export const BACKUP_FORMAT = 3;

/** An error whose message is safe to show to the user as it is. */
export class BackupError extends Error {}

const BACKUP_LABELS = [['tasks', 'task'], ['notes', 'note'], ['subjects', 'subject'], ['topics', 'topic'], ['habits', 'habit'], ['lists', 'list'], ['grades', 'grade']];

/**
 * Check that a parsed file really is a usable Planner backup before anything is wiped.
 * Throws BackupError with a readable message, or returns { data, counts, summary, exportedAt }
 * where data holds one clean array per store.
 */
export function validateBackup(json) {
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (!isObj(json) || json.app !== 'planner' || !isObj(json.data)) throw new BackupError('This file is not a Planner backup.');
  if (json.format !== undefined && (typeof json.format !== 'number' || json.format > BACKUP_FORMAT)) {
    throw new BackupError('This backup was made by a newer version of Planner. Update the app (Settings → Check for updates), then try again.');
  }
  const data = {};
  for (const name of db.STORES) {
    const items = json.data[name];
    if (items === undefined || items === null) { data[name] = []; continue; }
    if (!Array.isArray(items)) throw new BackupError(`This backup is damaged (${name} is not a list).`);
    const ids = new Set();
    for (const item of items) {
      const okId = isObj(item) && ((typeof item.id === 'string' && item.id !== '') || Number.isFinite(item.id));
      if (!okId) throw new BackupError(`This backup is damaged (an item in ${name} has no id).`);
      if (ids.has(item.id)) throw new BackupError(`This backup is damaged (${name} has the same item twice).`);
      ids.add(item.id);
    }
    data[name] = items;
  }
  const appSettings = data.settings.find((x) => x.id === 'app');
  if (appSettings && appSettings.availability !== undefined) {
    const a = appSettings.availability;
    if (!Array.isArray(a) || a.length !== 7 || !a.every((d) => isObj(d) && typeof d.start === 'string' && typeof d.end === 'string')) {
      throw new BackupError('This backup is damaged (available hours are unreadable).');
    }
  }
  if (data.tasks.some((t) => typeof t.title !== 'string')) throw new BackupError('This backup is damaged (a task has no title).');
  const content = db.STORES.filter((n) => n !== 'settings' && n !== 'blocks').reduce((sum, n) => sum + data[n].length, 0);
  if (!content) throw new BackupError('This backup is empty, so restoring it would only delete your data.');

  const counts = Object.fromEntries(db.STORES.map((n) => [n, data[n].length]));
  const summary = BACKUP_LABELS.filter(([n]) => counts[n]).map(([n, one]) => `${counts[n]} ${one}${counts[n] === 1 ? '' : 's'}`).join(', ');
  const at = typeof json.exportedAt === 'string' ? new Date(json.exportedAt) : null;
  return { data, counts, summary, exportedAt: at && !isNaN(at) ? at : null };
}

/** Replace all data with a backup. The file is checked first; if loading fails afterwards, the old data is put back. */
export async function importData(json) {
  const { data } = validateBackup(json);
  const before = exportData().data;
  await db.replaceAll(data);
  try {
    await load();
  } catch (err) {
    await db.replaceAll(before);
    await load();
    throw new BackupError('That backup could not be loaded, so your data was left as it was.');
  }
}

/** Remember that a backup was made, so the reminder starts counting again. */
export async function markBackedUp() {
  await updateSettings({ lastBackup: todayKey(), backupSnoozedUntil: null });
}

export async function snoozeBackup(days = 3) {
  await updateSettings({ backupSnoozedUntil: addDays(todayKey(), days) });
}

/** Days since the last backup (or since reminders started, if never), or null if never and no start date. */
export function daysSinceBackup(settings = state.settings, today = todayKey()) {
  const from = settings.lastBackup || settings.backupStart;
  return from ? daysBetween(from, today) : null;
}

/** Whether to show the "Back up" reminder: it's switched on, enough days have passed, there's something worth keeping, and it isn't snoozed. */
export function backupDue(s = state, today = todayKey()) {
  const settings = s.settings;
  if (!settings.backupEvery) return false;
  if (settings.backupSnoozedUntil && settings.backupSnoozedUntil > today) return false;
  const hasData = s.tasks.length + s.notes.length + s.subjects.length + s.topics.length + s.habits.length + s.grades.length > 0;
  if (!hasData) return false;
  const days = daysSinceBackup(settings, today);
  return days !== null && days >= settings.backupEvery;
}
