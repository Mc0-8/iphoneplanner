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
  return daysOff.some((d) => (d.date && d.date === key) || (d.from && d.to && key >= d.from && key <= d.to) ||
    (d.weekday !== null && d.weekday !== undefined && d.weekday === wd));
}

/** Available window for a day as [start, end] minutes, or null. */
export function windowFor(settings, daysOff, key) {
  if (isDayOff(daysOff, key)) return null;
  const a = settings.availability[weekday(key)];
  if (!a || !a.on) return null;
  const s = toMin(a.start), e = a.end === '00:00' ? 1440 : toMin(a.end); // until 00:00 = until midnight
  return e > s ? [s, e] : null;
}

/**
 * Fixed times on a day: weekly or one-off commitments, plus habits that have a set time.
 * Habits come back with kind 'habit'; commitments with kind 'commitment'.
 */
export function commitmentsOn(commitments, key, habits = []) {
  const wd = weekday(key);
  const fixed = commitments
    .filter((c) => (c.date ? c.date === key : c.weekdays.includes(wd)))
    .map((c) => ({ ...c, kind: 'commitment', s: toMin(c.start), e: toMin(c.end) }));
  const timed = habits
    .filter((h) => h.time && h.weekdays.includes(wd))
    .map((h) => ({ ...h, kind: 'habit', start: h.time, s: toMin(h.time), e: toMin(h.time) + (h.duration || 30) }));
  return [...fixed, ...timed].sort((a, b) => a.s - b.s);
}

/**
 * Plan the coming weeks.
 *
 * The plan is "sticky": a block that is already planned stays where it is as long as that spot is
 * still valid (within its allowed days, free hours and daily limit, and not clashing with anything
 * more urgent). Only new work, and blocks that have to move, are placed again — on the least busy
 * day that fits. `opts.fresh = {from, to}` ignores existing spots in that date range (Re-spread).
 *
 * @param data {tasks, subjects, commitments, daysOff, habits, topics, blocks, settings}
 * @returns {blocks, overflow, weeks, atRisk}
 */
export function plan(data, now = new Date(), opts = {}) {
  const { tasks, subjects, commitments, daysOff, settings } = data;
  const topics = data.topics || [];
  const habits = data.habits || [];
  const today = todayKey();
  const nowM = currentMin(now);
  const end = horizonEnd(today);
  const cap = settings.dailyCap;
  const gap = settings.breakMinutes;
  const cutoff = toMin(settings.hardCutoff);
  const finishEarly = settings.finishDayBefore !== false;

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  // "On the day" tasks with a set time sit exactly there, like an appointment.
  const fixedTask = new Map();
  for (const t of tasks) {
    if (t.completed || t.inbox || t.type === 'exam' || t.dateMode !== 'on' || !t.atTime || !t.deadline) continue;
    if (t.deadline < today || t.deadline > end) continue;
    fixedTask.set(t.id, t);
  }

  // 1. Sort existing blocks: kept as they are (history, pinned, already started) or "previous" spots.
  const kept = [];
  const previous = [];
  const fixedIds = new Map();
  for (const b of data.blocks) {
    if (b.kind === 'task' && fixedTask.has(b.taskId) && b.status === 'planned' && !b.pinned) {
      if (!fixedIds.has(b.taskId)) fixedIds.set(b.taskId, b.id); // reuse its id
      continue;
    }
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
    previous.push(b);
  }
  for (const t of fixedTask.values()) {
    // Already done, or moved by hand (a pinned block still to come): leave it be.
    const done = kept.some((b) => b.kind === 'task' && b.taskId === t.id && (b.status === 'done' || (b.pinned && b.status === 'planned')));
    if (done) continue;
    kept.push({ id: fixedIds.get(t.id) || uid(), date: t.deadline, start: toMin(t.atTime), duration: t.duration, kind: 'task',
      taskId: t.id, subjectId: null, topicIds: null, pinned: false, status: 'planned', fixed: true });
  }
  const fresh = opts.fresh;
  const inFresh = (b) => fresh && b.date >= fresh.from && b.date <= fresh.to;
  const candidates = new Map(); // key → previous blocks that may keep their spot
  const idPool = new Map();     // key → previous blocks whose ids can be reused
  for (const b of [...previous].sort((a, c) => a.date.localeCompare(c.date) || a.start - c.start)) {
    const k = poolKey(b);
    if (!idPool.has(k)) idPool.set(k, []);
    idPool.get(k).push(b);
    if (inFresh(b)) continue;
    if (!candidates.has(k)) candidates.set(k, []);
    candidates.get(k).push(b);
  }

  // 2. Days: free window, hard-busy times, load, and the soft "reserved" spots of previous blocks.
  const days = [];
  for (let k = today; k <= end; k = addDays(k, 1)) days.push(k);
  const dayInfo = new Map();
  for (const k of days) {
    const win = windowFor(settings, daysOff, k);
    const busy = commitmentsOn(commitments, k, habits).map((c) => [c.s, c.e]);
    let load = 0;
    for (const b of kept) {
      if (b.date !== k || b.status === 'missed') continue;
      busy.push([b.start, b.start + b.duration]);
      load += b.duration;
    }
    let win2 = win;
    if (win && k === today) win2 = [Math.max(win[0], ceilTo(nowM, ROUND)), win[1]];
    if (win2 && win2[1] - win2[0] < MIN_PIECE) win2 = null;
    dayInfo.set(k, { win: win2, busy, load, keys: new Set(), reserved: new Set() });
  }
  for (const b of kept) dayInfo.get(b.date)?.keys.add(keyOf(b));

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
  // Pieces must fit in a day: never longer than the daily limit or the longest free window.
  const longestWindow = Math.max(0, ...days.map((k) => { const w = windowFor(settings, daysOff, k); return w ? w[1] - w[0] : 0; }));
  const maxPiece = Math.max(MIN_PIECE, Math.min(cap, longestWindow || cap));
  for (const t of tasks) {
    if (t.completed || t.type === 'exam' || t.inbox || fixedTask.has(t.id)) continue;
    const onDay = t.dateMode === 'on' && t.deadline;
    if (onDay && (t.deadline < today || t.deadline > end)) continue; // that day has passed (or is too far off)
    const used = kept.filter((b) => b.kind === 'task' && b.taskId === t.id && b.status !== 'missed')
      .reduce((s, b) => s + b.duration, 0);
    let remaining = t.duration - used;
    if (remaining < MIN_PIECE / 3) continue;
    remaining = Math.max(remaining, MIN_PIECE);
    const overdue = !onDay && t.deadline && t.deadline < today;
    // Overdue work is planned as soon as possible on any day, not only today.
    const latest = t.deadline && !overdue ? (t.deadline > end ? end : t.deadline) : end;
    const earliest = onDay ? t.deadline : t.notBefore && t.notBefore > today ? t.notBefore : today;
    if (earliest > end) continue; // starts after the planning window
    const pieces = t.duration > Math.min(SPLIT_ABOVE, maxPiece) ? splitMinutes(remaining, Math.min(CHUNK, maxPiece), maxPiece) : [remaining];
    pieces.forEach((min) => items.push({
      kind: 'task', taskId: t.id, key: 'task:' + t.id, duration: min, asap: overdue,
      first: earliest, last: latest < earliest ? earliest : latest,
      notBefore: t.notBefore || null, notBeforeMin: t.notBeforeTime ? toMin(t.notBeforeTime) : 0,
      group: t.deadline ? 1 : 3,
      sortDate: t.deadline || '9999', prio: { high: 0, medium: 1, low: 2 }[t.priority] ?? 1,
      title: t.title, deadline: t.deadline, onDay: !!onDay,
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
      // Paused: nothing until the pause ends (or at all, if it has no end date).
      if (s.paused && (!s.pausedUntil || s.pausedUntil > wkEnd)) continue;
      const startDay = s.paused && s.pausedUntil > first ? s.pausedUntil : first;
      const boosted = exams.some((e) => e.subjectId === s.id && e.deadline >= wk && addDays(e.deadline, -14) <= wkEnd);
      const target = Math.round((s.hoursPerWeek * 60 * (boosted ? 1.5 : 1)) / 15) * 15;
      const used = kept.filter((b) => b.kind === 'study' && b.subjectId === s.id && b.status !== 'missed' && b.date >= wk && b.date <= wkEnd)
        .reduce((sum, b) => sum + b.duration, 0);
      let remaining = target - used;
      // Part of a week (it's already mid-week, or a pause ends mid-week): only a fair share for the days
      // that are left, plus anything actually missed, so a whole week isn't crammed into a few days.
      if (startDay > wk) {
        let total = 0, left = 0;
        for (let k = wk; k <= wkEnd; k = addDays(k, 1)) {
          if (!windowFor(settings, daysOff, k)) continue;
          total++;
          if (k >= startDay) left++;
        }
        const missed = wk === mondayOf(today) ? data.blocks.filter((b) => b.kind === 'study' && b.subjectId === s.id && b.date >= wk && b.date < today && b.status !== 'done')
          .reduce((sum, b) => sum + b.duration, 0) : 0;
        const fromToday = kept.filter((b) => b.kind === 'study' && b.subjectId === s.id && b.status !== 'missed' && b.date >= today && b.date <= wkEnd)
          .reduce((sum, b) => sum + b.duration, 0);
        const share = total ? Math.round(((target * left) / total + missed) / 15) * 15 : 0;
        remaining = Math.min(remaining, share - fromToday);
      }
      if (remaining < MIN_PIECE) continue;
      const pieces = splitMinutes(remaining, Math.min(settings.sessionLength, maxPiece), maxPiece);
      pieces.forEach((min, i) => studyItems.push({
        kind: 'study', subjectId: s.id, key: 'sub:' + s.id, duration: min,
        first: startDay, last: wkEnd > end ? end : wkEnd,
        group: boosted ? 0 : 2, round: i, order: s.order ?? 0, hard: !!s.hard,
        title: s.name, week: wk,
      }));
    }
  }
  // Round-robin across subjects so sessions interleave.
  studyItems.sort((a, b) => a.week.localeCompare(b.week) || a.round - b.round || a.order - b.order);
  items.push(...studyItems);

  // Order: reviews, exam-boosted study, deadline tasks, regular study, tasks without deadline.
  items.sort((a, b) => a.group - b.group ||
    (a.kind === b.kind && a.kind !== 'study' ? (a.sortDate.localeCompare(b.sortDate) || a.prio - b.prio) : 0));
  // (Array.prototype.sort is stable, so study keeps its round-robin order.)

  // 4. Place each item: keep its previous spot if still valid, otherwise the least busy day that fits.
  const clashes = (info, start, dur) => info.busy.some(([s, e]) => start < e + gap && s - gap < start + dur);
  // First match every item to its own previous spot (same kind, same length, allowed day, still free of
  // fixed times). Only matched spots are reserved; old spots nothing claims are simply let go.
  const fitsWindow = (item, b) => {
    const info = dayInfo.get(b.date);
    if (!info?.win || b.date < item.first || b.date > item.last) return false;
    const after = item.notBefore && b.date === item.notBefore ? item.notBeforeMin : 0;
    return b.start >= Math.max(info.win[0], after) && b.start + item.duration <= info.win[1] && !clashes(info, b.start, item.duration);
  };
  for (const item of items) {
    const list = candidates.get(poolKey(item)) || [];
    const i = list.findIndex((b) => b.duration === item.duration && fitsWindow(item, b));
    if (i >= 0) {
      item.prev = list.splice(i, 1)[0];
      dayInfo.get(item.prev.date).reserved.add(item.prev);
      continue;
    }
  }

  const validAt = (item, k, start) => {
    const info = dayInfo.get(k);
    if (!info?.win || k < item.first || k > item.last) return false;
    const after = item.notBefore && k === item.notBefore ? item.notBeforeMin : 0;
    return start >= Math.max(info.win[0], after) && start + item.duration <= info.win[1] &&
      info.load + item.duration <= cap && !clashes(info, start, item.duration);
  };
  const reservedLoad = (info) => { let n = 0; for (const b of info.reserved) n += b.duration; return n; };
  const reservedKeys = (info) => { const s2 = new Set(); for (const b of info.reserved) s2.add(keyOf(b)); return s2; };

  // Priority of an existing block (lower = more important), matching the item groups above.
  const boostedOn = (subjectId, date) => exams.some((e) => e.subjectId === subjectId && e.deadline >= mondayOf(date) && addDays(e.deadline, -14) <= addDays(mondayOf(date), 6));
  const rankOf = (b) => (b.kind === 'review' ? -1 : b.kind === 'task' ? (taskById.get(b.taskId)?.deadline ? 1 : 3) : boostedOn(b.subjectId, b.date) ? 0 : 2);

  const bestNew = (item, lastDay) => {
    let best = null;
    for (const k of days) {
      if (k < item.first || k > lastDay) continue;
      const info = dayInfo.get(k);
      if (!info.win || info.load + item.duration > cap) continue;
      const after = item.notBefore && k === item.notBefore ? item.notBeforeMin : 0;
      // Prefer a slot that leaves existing plans alone; displace one only if nothing else fits.
      const soft = { win: info.win, busy: [...info.busy, ...[...info.reserved].map((b) => [b.start, b.start + b.duration])] };
      let start = findSlot(soft, item.duration, gap, after);
      let displaced = false;
      if (start === null) {
        // Only push aside planned work that is less important than this item.
        const firm = { win: info.win, busy: [...info.busy, ...[...info.reserved].filter((b) => rankOf(b) < item.group).map((b) => [b.start, b.start + b.duration])] };
        start = findSlot(firm, item.duration, gap, after);
        displaced = true;
      }
      if (start === null) continue;
      const rl = reservedLoad(info);
      const rk = reservedKeys(info);
      let score = info.load + rl;
      if (displaced) score += 60;
      if (info.load + rl + item.duration > cap) score += 500;               // would push planned work off this day
      if (info.keys.has(item.key) || rk.has(item.key)) score += 10000;     // same subject/task twice in a day
      const prevDay = dayInfo.get(addDays(k, -1)), nextDay = dayInfo.get(addDays(k, 1));
      if (prevDay?.keys.has(item.key)) score += 90;                         // back-to-back days
      if (nextDay?.keys.has(item.key)) score += 90;
      if (item.hard && start + item.duration > cutoff) score += 45;         // hard subjects early
      if (item.asap) score += daysBetweenKeys(k, today) * 1000;            // overdue: earliest day wins
      if (!best || score < best.score) best = { k, start, score };
    }
    return best;
  };

  const placed = [];
  const overflow = [];
  const keepPrev = (item, allowDueDay, due) => {
    const b = item.prev;
    if (!b || (!allowDueDay && b.date === due)) return null;
    // Its own reservation shouldn't block it.
    dayInfo.get(b.date).reserved.delete(b);
    if (validAt(item, b.date, b.start)) return { k: b.date, start: b.start, prev: b };
    dayInfo.get(b.date).reserved.add(b);
    return null;
  };

  function place(item, chosen) {
    const info = dayInfo.get(chosen.k);
    const block = {
      id: chosen.prev ? chosen.prev.id : null, date: chosen.k, start: chosen.start, duration: item.duration,
      kind: item.kind, taskId: item.taskId || null, subjectId: item.subjectId || null,
      topicIds: item.topicIds || null,
      pinned: false, status: 'planned',
    };
    if (chosen.prev) {
      dayInfo.get(chosen.prev.date)?.reserved.delete(chosen.prev);
      const pool = idPool.get(poolKey(item));
      const at = pool ? pool.indexOf(chosen.prev) : -1;
      if (at >= 0) pool.splice(at, 1);
    }
    placed.push(block);
    info.busy.push([block.start, block.start + block.duration]);
    info.load += block.duration;
    info.keys.add(item.key);
  }

  for (const item of items) {
    // "Finish the day before": a task due on a later day avoids its due day when it can.
    const due = item.kind === 'task' && !item.onDay && finishEarly && item.deadline && item.deadline > item.first ? item.deadline : null;
    // Reviews belong on their due day; the next two days are only a fallback.
    if (item.kind === 'review' && item.prev && item.prev.date !== item.first) {
      const onDay = (dayInfo.get(item.prev.date).reserved.delete(item.prev), bestNew(item, item.first));
      dayInfo.get(item.prev.date).reserved.add(item.prev);
      if (onDay) { dayInfo.get(item.prev.date).reserved.delete(item.prev); item.prevDropped = item.prev; item.prev = null; }
    }
    let chosen = keepPrev(item, !due, due);
    if (!chosen && item.prev) dayInfo.get(item.prev.date).reserved.delete(item.prev); // its old spot is let go
    if (!chosen && item.kind === 'review') chosen = bestNew(item, item.first);
    if (!chosen) chosen = bestNew(item, due ? addDays(due, -1) : item.last);
    if (!chosen && due && item.prev) { dayInfo.get(item.prev.date).reserved.add(item.prev); chosen = keepPrev(item, true, due); if (!chosen) dayInfo.get(item.prev.date).reserved.delete(item.prev); }
    if (!chosen && due) chosen = bestNew(item, item.last);
    if (!chosen) { overflow.push(item); continue; }

    place(item, chosen);
  }

  // New spots reuse ids of previous blocks of the same kind (nearest date first), so open screens keep working.
  for (const b of placed) {
    if (b.id) continue;
    const pool = idPool.get(poolKey(b)) || [];
    let bi = -1, bd = Infinity;
    pool.forEach((p, i) => { const d = Math.abs(daysBetweenKeys(p.date, b.date)); if (d < bd) { bd = d; bi = i; } });
    b.id = bi >= 0 ? pool.splice(bi, 1)[0].id : uid();
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
      const open = freeMinutes(info.win, commitmentsOn(commitments, k, habits).map((c) => [c.s, c.e]));
      free += Math.min(cap, open);
    }
    for (const b of all) if (b.date >= wk && b.date <= wkEnd && b.date >= today && b.status !== 'missed') planned += b.duration;
    const ref = (o) => (o.asap ? today : o.last);
    const over = overflow.filter((o) => ref(o) >= wk && ref(o) <= wkEnd);
    weeks.push({ monday: wk, free, planned, overflowMinutes: over.reduce((s, o) => s + o.duration, 0), overflow: over });
  }

  return { blocks: all, overflow, weeks, atRisk: atRisk(overflow, end) };
}

/**
 * Tasks that don't fit in the free time before their deadline ("overbooked"), most urgent first.
 * Overdue tasks and deadlines past the planning window are left out: those aren't a fit problem yet.
 * @returns [{ taskId, title, deadline, minutes }] minutes = how much doesn't fit
 */
export function atRisk(overflow, end) {
  const by = new Map();
  for (const o of overflow) {
    if (o.kind !== 'task' || o.asap || !o.deadline || o.deadline > end) continue;
    const r = by.get(o.taskId) || { taskId: o.taskId, title: o.title, deadline: o.deadline, minutes: 0 };
    r.minutes += o.duration;
    by.set(o.taskId, r);
  }
  return [...by.values()].sort((a, b) => a.deadline.localeCompare(b.deadline) || b.minutes - a.minutes);
}

const daysBetweenKeys = (a, b) => Math.round((Date.UTC(...a.split('-').map((n, i) => (i === 1 ? n - 1 : +n))) - Date.UTC(...b.split('-').map((n, i) => (i === 1 ? n - 1 : +n)))) / 86400000);

/** Same key for an old block and the new item that replaces it. */
function poolKey(x) {
  if (x.kind === 'review') return 'review:' + [...(x.topicIds || [])].sort().join(',');
  return x.kind === 'task' ? 'task:' + x.taskId : 'sub:' + x.subjectId;
}

function keyOf(b) {
  return b.kind === 'task' ? 'task:' + b.taskId : b.kind === 'study' ? 'sub:' + b.subjectId : b.kind + ':' + b.id;
}

/** Split minutes into pieces of `size`; a small remainder joins the last piece if that stays within `max`. */
export function splitMinutes(total, size, max = Infinity) {
  const pieces = [];
  let left = total;
  while (left > 0) {
    if (left <= size) { pieces.push(left); break; }
    pieces.push(size);
    left -= size;
  }
  if (pieces.length > 1 && pieces[pieces.length - 1] < MIN_PIECE + 5 && pieces[pieces.length - 2] + pieces[pieces.length - 1] <= max) {
    const tail = pieces.pop();
    pieces[pieces.length - 1] += tail;
  }
  return pieces;
}

/** Earliest start in the day's window that fits `dur` with a break around other blocks. */
function findSlot(info, dur, gap, after = 0) {
  const ws = Math.max(info.win[0], after), we = info.win[1];
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
  const busy = commitmentsOn(data.commitments, key, data.habits || []).map((c) => [c.s, c.e]);
  for (const b of data.blocks) {
    if (b.date === key && b.id !== excludeId && b.status !== 'missed') busy.push([b.start, b.start + b.duration]);
  }
  return findSlot({ win: [ws, win[1]], busy }, dur, data.settings.breakMinutes);
}
