// The scheduler: spreads tasks and study sessions evenly over the coming weeks.
// Pure function — takes the app data, returns the new list of blocks plus anything that didn't fit.
// Rules follow the plan's "Auto-scheduling" and "Study planner" sections.

import { todayKey, addDays, mondayOf, weekday, toMin, nowMin as currentMin } from './dates.js';

export const WEEKS_AHEAD = 4;           // this week + 4 more
const SPLIT_ABOVE = 90;                 // tasks longer than this are split…
const CHUNK = 60;                       // …into chunks of up to 60 min
const MIN_PIECE = 15;
const ROUND = 5;                        // start times snap to 5 minutes

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const ceilTo = (n, step) => Math.ceil(n / step) * step;

/** Last day the scheduler plans: Sunday of the 4th week after this one. */
export function horizonEnd(today = todayKey()) {
  return addDays(mondayOf(today), 7 * (WEEKS_AHEAD + 1) - 1);
}

export function isDayOff(daysOff, key) {
  const wd = weekday(key);
  return daysOff.some((d) => (d.date && d.date === key) || (d.weekday !== null && d.weekday !== undefined && d.weekday === wd));
}

/** Available window for a day as [start, end] minutes, or null. */
export function windowFor(settings, daysOff, key) {
  if (isDayOff(daysOff, key)) return null;
  const a = settings.availability[weekday(key)];
  if (!a || !a.on) return null;
  const s = toMin(a.start), e = toMin(a.end);
  return e > s ? [s, e] : null;
}

export function commitmentsOn(commitments, key) {
  const wd = weekday(key);
  return commitments
    .filter((c) => c.weekdays.includes(wd))
    .map((c) => ({ ...c, s: toMin(c.start), e: toMin(c.end) }))
    .sort((a, b) => a.s - b.s);
}

/**
 * @param data {tasks, subjects, commitments, daysOff, blocks, settings}
 * @returns {blocks, overflow, weeks}
 */
export function plan(data, now = new Date()) {
  const { tasks, subjects, commitments, daysOff, settings } = data;
  const topics = data.topics || [];
  const today = todayKey();
  const nowM = currentMin(now);
  const end = horizonEnd(today);
  const cap = settings.dailyCap;
  const gap = settings.breakMinutes;
  const cutoff = toMin(settings.hardCutoff);

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  // 1. Decide which existing blocks stay.
  const kept = [];
  const idPool = new Map();
  for (const b of data.blocks) {
    if (b.kind === 'task') {
      const t = taskById.get(b.taskId);
      if (!t) continue;                                   // task deleted
      if (t.completed && b.status === 'planned') continue; // finished early
    }
    if (b.kind === 'study' && !subjectById.has(b.subjectId) && b.status !== 'done') continue;
    if (b.kind === 'review' && b.status === 'planned' && !b.topicIds?.some((id) => topics.some((t) => t.id === id))) continue;

    if (b.status !== 'planned') { kept.push(b); continue; }          // done / missed history
    if (b.date < today) { kept.push({ ...b, status: 'missed' }); continue; } // never checked off
    if (b.pinned) { kept.push(b); continue; }
    if (b.date === today && b.start < nowM) { kept.push(b); continue; } // already started: frozen
    // everything else is re-planned; remember its id so the new block can keep it
    const k = poolKey(b);
    if (!idPool.has(k)) idPool.set(k, []);
    idPool.get(k).push(b);
  }
  for (const list of idPool.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);

  // 2. Days, free time and load.
  const days = [];
  for (let k = today; k <= end; k = addDays(k, 1)) days.push(k);
  const dayInfo = new Map();
  for (const k of days) {
    const win = windowFor(settings, daysOff, k);
    const busy = commitmentsOn(commitments, k).map((c) => [c.s, c.e]);
    let load = 0;
    for (const b of kept) {
      if (b.date !== k || b.status === 'missed') continue;
      busy.push([b.start, b.start + b.duration]);
      load += b.duration;
    }
    let win2 = win;
    if (win && k === today) win2 = [Math.max(win[0], ceilTo(nowM, ROUND)), win[1]];
    if (win2 && win2[1] - win2[0] < MIN_PIECE) win2 = null;
    dayInfo.set(k, { win: win2, busy, load, keys: new Set() });
  }
  for (const b of kept) {
    const info = dayInfo.get(b.date);
    if (info) info.keys.add(keyOf(b));
  }

  // 3. Work items.
  const items = [];

  // Reviews: 15 minutes per group of up to 3 topics, on the day each topic is due
  const REVIEW_MIN = 15, PER_BLOCK = 3;
  const covered = new Set(kept.filter((b) => b.kind === 'review' && b.status === 'planned').flatMap((b) => b.topicIds || []));
  const reviewDays = new Map();
  for (const t of topics) {
    if (!t.nextReview || covered.has(t.id)) continue;
    const day = t.nextReview < today ? today : t.nextReview;
    if (day > end) continue;
    if (!reviewDays.has(day)) reviewDays.set(day, []);
    reviewDays.get(day).push(t);
  }
  for (const [day, list] of reviewDays) {
    for (let i = 0; i < list.length; i += PER_BLOCK) {
      const ids = list.slice(i, i + PER_BLOCK).map((t) => t.id);
      items.push({
        kind: 'review', topicIds: ids, key: `review:${day}:${i}`, duration: REVIEW_MIN,
        first: day, last: addDays(day, 2) > end ? end : addDays(day, 2), group: -1,
        title: 'Review', sortDate: day, prio: 0,
      });
    }
  }

  // Tasks (not in the inbox, not exams)
  for (const t of tasks) {
    if (t.completed || t.type === 'exam' || t.inbox) continue;
    const used = kept.filter((b) => b.kind === 'task' && b.taskId === t.id && b.status !== 'missed')
      .reduce((s, b) => s + b.duration, 0);
    let remaining = t.duration - used;
    if (remaining < MIN_PIECE / 3) continue;
    remaining = Math.max(remaining, MIN_PIECE);
    const latest = t.deadline ? (t.deadline < today ? today : (t.deadline > end ? end : t.deadline)) : end;
    const pieces = t.duration > SPLIT_ABOVE ? splitMinutes(remaining, CHUNK) : [remaining];
    pieces.forEach((min) => items.push({
      kind: 'task', taskId: t.id, key: 'task:' + t.id, duration: min,
      first: today, last: latest,
      group: t.deadline ? 1 : 3,
      sortDate: t.deadline || '9999', prio: { high: 0, medium: 1, low: 2 }[t.priority] ?? 1,
      title: t.title, deadline: t.deadline,
    }));
  }

  // Study sessions, per week
  const exams = tasks.filter((t) => t.type === 'exam' && !t.completed && t.subjectId && t.deadline);
  const studyItems = [];
  for (let wk = mondayOf(today); wk <= end; wk = addDays(wk, 7)) {
    const wkEnd = addDays(wk, 6);
    const first = wk < today ? today : wk;
    for (const s of subjects) {
      if (!s.hoursPerWeek) continue;
      const boosted = exams.some((e) => e.subjectId === s.id && e.deadline >= wk && addDays(e.deadline, -14) <= wkEnd);
      const target = Math.round((s.hoursPerWeek * 60 * (boosted ? 1.5 : 1)) / 15) * 15;
      const used = kept.filter((b) => b.kind === 'study' && b.subjectId === s.id && b.status !== 'missed' && b.date >= wk && b.date <= wkEnd)
        .reduce((sum, b) => sum + b.duration, 0);
      const remaining = target - used;
      if (remaining < MIN_PIECE) continue;
      const pieces = splitMinutes(remaining, settings.sessionLength);
      pieces.forEach((min, i) => studyItems.push({
        kind: 'study', subjectId: s.id, key: 'sub:' + s.id, duration: min,
        first, last: wkEnd > end ? end : wkEnd,
        group: boosted ? 0 : 2, round: i, order: s.order ?? 0, hard: !!s.hard,
        title: s.name, week: wk,
      }));
    }
  }
  // Round-robin across subjects so sessions interleave.
  studyItems.sort((a, b) => a.week.localeCompare(b.week) || a.round - b.round || a.order - b.order);
  items.push(...studyItems);

  // Order: exam-boosted study, deadline tasks, regular study, tasks without deadline.
  items.sort((a, b) => a.group - b.group ||
    (a.kind === b.kind && a.kind !== 'study' ? (a.sortDate.localeCompare(b.sortDate) || a.prio - b.prio) : 0));
  // (Array.prototype.sort is stable, so study keeps its round-robin order.)

  // 4. Place each item on the least busy day that still fits.
  const placed = [];
  const overflow = [];
  for (const item of items) {
    let best = null;
    for (const k of days) {
      if (k < item.first || k > item.last) continue;
      const info = dayInfo.get(k);
      if (!info.win || info.load + item.duration > cap) continue;
      const start = findSlot(info, item.duration, gap);
      if (start === null) continue;
      let score = info.load;
      if (info.keys.has(item.key)) score += 10000;                       // same subject/task twice in a day
      if (dayInfo.get(addDays(k, -1))?.keys.has(item.key)) score += 90;  // back-to-back days
      if (dayInfo.get(addDays(k, 1))?.keys.has(item.key)) score += 90;
      if (item.hard && start + item.duration > cutoff) score += 45;      // hard subjects early
      if (!best || score < best.score) best = { k, start, score };
    }
    if (!best) { overflow.push(item); continue; }
    const info = dayInfo.get(best.k);
    const reuse = idPool.get(poolKey(item))?.shift();
    const block = {
      id: reuse ? reuse.id : uid(), date: best.k, start: best.start, duration: item.duration,
      kind: item.kind, taskId: item.taskId || null, subjectId: item.subjectId || null,
      topicIds: item.topicIds || null,
      pinned: false, status: 'planned',
    };
    placed.push(block);
    info.busy.push([block.start, block.start + block.duration]);
    info.load += block.duration;
    info.keys.add(item.key);
  }

  // 5. Week summaries for the capacity check.
  const all = [...kept, ...placed];
  const weeks = [];
  for (let wk = mondayOf(today); wk <= end; wk = addDays(wk, 7)) {
    const wkEnd = addDays(wk, 6);
    let free = 0, planned = 0;
    for (let k = wk < today ? today : wk; k <= wkEnd; k = addDays(k, 1)) {
      const info = dayInfo.get(k);
      if (!info?.win) continue;
      const open = freeMinutes(info.win, commitmentsOn(commitments, k).map((c) => [c.s, c.e]));
      free += Math.min(cap, open);
    }
    for (const b of all) if (b.date >= wk && b.date <= wkEnd && b.date >= today && b.status !== 'missed') planned += b.duration;
    const over = overflow.filter((o) => o.last >= wk && o.last <= wkEnd);
    weeks.push({ monday: wk, free, planned, overflowMinutes: over.reduce((s, o) => s + o.duration, 0), overflow: over });
  }

  return { blocks: all, overflow, weeks };
}

/** Same key for an old block and the new item that replaces it. */
function poolKey(x) {
  if (x.kind === 'review') return 'review:' + [...(x.topicIds || [])].sort().join(',');
  return x.kind === 'task' ? 'task:' + x.taskId : 'sub:' + x.subjectId;
}

function keyOf(b) {
  return b.kind === 'task' ? 'task:' + b.taskId : b.kind === 'study' ? 'sub:' + b.subjectId : b.kind + ':' + b.id;
}

/** Split minutes into pieces of `size`; a small remainder joins the last piece. */
export function splitMinutes(total, size) {
  const pieces = [];
  let left = total;
  while (left > 0) {
    if (left <= size) { pieces.push(left); break; }
    pieces.push(size);
    left -= size;
  }
  if (pieces.length > 1 && pieces[pieces.length - 1] < MIN_PIECE + 5) {
    const tail = pieces.pop();
    pieces[pieces.length - 1] += tail;
  }
  return pieces;
}

/** Earliest start in the day's window that fits `dur` with a break around other blocks. */
function findSlot(info, dur, gap) {
  const [ws, we] = info.win;
  const busy = info.busy
    .map(([s, e]) => [s - gap, e + gap])
    .sort((a, b) => a[0] - b[0]);
  let t = ceilTo(ws, ROUND);
  for (const [s, e] of busy) {
    if (e <= t) continue;
    if (s >= t + dur) break;
    t = Math.max(t, ceilTo(e, ROUND));
  }
  return t + dur <= we ? t : null;
}

function freeMinutes([ws, we], busy) {
  let free = we - ws;
  for (const [s, e] of busy) free -= Math.max(0, Math.min(e, we) - Math.max(s, ws));
  return Math.max(0, free);
}

/** Earliest free start on a day (at or after `after`) for `dur` minutes, ignoring block `excludeId`. */
export function freeSlot(data, key, dur, excludeId = null, after = 0) {
  const win = windowFor(data.settings, data.daysOff, key) || [8 * 60, 21 * 60];
  let ws = Math.max(win[0], after);
  if (key === todayKey()) ws = Math.max(ws, ceilTo(currentMin(), ROUND));
  if (ws + dur > win[1]) return null;
  const busy = commitmentsOn(data.commitments, key).map((c) => [c.s, c.e]);
  for (const b of data.blocks) {
    if (b.date === key && b.id !== excludeId && b.status !== 'missed') busy.push([b.start, b.start + b.duration]);
  }
  return findSlot({ win: [ws, win[1]], busy }, dur, data.settings.breakMinutes);
}
