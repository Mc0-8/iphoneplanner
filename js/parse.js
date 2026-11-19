// Quick add: understands things typed in a task's title, such as
//   "essay fri 2h #school !"      → due Friday, 2 hours, list School, high priority
//   "gym on sat 10:00 1h"         → on Saturday at 10:00 for an hour
//   "vocab 15m daily"             → 15 minutes, repeats daily
// Recognised words are removed from the title. Nothing here guesses beyond these rules.

import { todayKey, addDays, weekday, toKey, mondayOf } from './dates.js';

const DAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };

/** Next date (today included) that falls on weekday `wd`. */
function nextWeekday(wd, from = todayKey()) {
  let k = from;
  for (let i = 0; i < 7; i++) { if (weekday(k) === wd) return k; k = addDays(k, 1); }
  return from;
}

/** A day + month without a year: this year, or next year if that date has passed. */
function dayMonth(d, m) {
  const now = new Date();
  let dt = new Date(now.getFullYear(), m, d);
  if (dt.getMonth() !== m) return null;
  if (toKey(dt) < todayKey()) dt = new Date(now.getFullYear() + 1, m, d);
  return toKey(dt);
}

function parseTime(tok, next) {
  const m = tok.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/i);
  if (!m) return null;
  const hasMinutes = m[2] !== undefined;
  const ap = m[3] || (/^(am|pm)$/i.test(next || '') ? next : null);
  if (!hasMinutes && !ap) return null; // a plain number isn't a time
  let h = Number(m[1]);
  const min = hasMinutes ? Number(m[2]) : 0;
  if (ap && /pm/i.test(ap) && h < 12) h += 12;
  if (ap && /am/i.test(ap) && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * @param text the title as typed
 * @param lists [{id, name}] to match #list
 * @returns {title, fields, labels, segs} — only the fields that were recognised are set.
 *   segs keeps every word in order with the field it set (key null = part of the title), so a
 *   field set by hand can keep its words in the title: titleKeeping(parsed, keys).
 */
export function parseQuickAdd(text, lists = []) {
  const words = text.split(/\s+/).filter(Boolean);
  const segs = [];
  const f = {};
  const labels = [];
  let mode = null;
  let lead = [];   // "due", "by", "on", "at": joined to the date or time that follows

  const KEY = { deadline: 'deadline', atTime: 'atTime', duration: 'duration', repeat: 'repeat', listId: 'listId', priority: 'priority' };
  const keep = { push: (w) => { if (lead.length) { segs.push({ words: lead, key: null }); lead = []; } segs.push({ words: [w], key: null }); } };
  let i0 = 0;
  const took = (key) => { segs.push({ words: [...lead, ...words.slice(i0, i + 1)], key }); lead = []; };
  let i = 0;
  for (; i < words.length; i++) {
    i0 = i;
    const raw = words[i];
    const w = raw.toLowerCase().replace(/[,;]$/, '');
    const next = (words[i + 1] || '').toLowerCase();

    // "by" / "due" / "on" only count when followed by a date word
    if ((w === 'by' || w === 'due' || w === 'on') && looksLikeDate(next, words[i + 2])) { mode = w === 'on' ? 'on' : 'due'; lead.push(raw); continue; }
    if (w === 'at' && parseTime(next, words[i + 2])) { lead.push(raw); continue; }

    // dates
    if (w === 'today' || w === 'tod') { f.deadline = todayKey(); took(KEY.deadline); continue; }
    if (['tomorrow', 'tmrw', 'tmr'].includes(w)) { f.deadline = addDays(todayKey(), 1); took(KEY.deadline); continue; }
    if (w === 'next' && next === 'week') { f.deadline = addDays(todayKey(), 7); i++; took(KEY.deadline); continue; }
    if (w === 'next' && DAYS[next] !== undefined) { f.deadline = nextWeekday(DAYS[next], addDays(mondayOf(todayKey()), 7)); i++; took(KEY.deadline); continue; }
    if (w === 'in' && /^\d+$/.test(next) && /^(days?|weeks?)$/.test((words[i + 2] || '').toLowerCase())) {
      const n = Number(next) * (/week/.test(words[i + 2].toLowerCase()) ? 7 : 1);
      f.deadline = addDays(todayKey(), n); i += 2; took(KEY.deadline); continue;
    }
    if (DAYS[w] !== undefined) { f.deadline = nextWeekday(DAYS[w]); took(KEY.deadline); continue; }
    let m = w.match(/^(\d{1,2})[/-](\d{1,2})$/); // 3/12 = 3 December (day first)
    if (m) { const k = dayMonth(Number(m[1]), Number(m[2]) - 1); if (k) { f.deadline = k; took(KEY.deadline); continue; } }
    if (/^\d{1,2}$/.test(w) && MONTHS[next.slice(0, 3)] !== undefined && MONTHS[next] !== undefined) {
      const k = dayMonth(Number(w), MONTHS[next]); if (k) { f.deadline = k; i++; took(KEY.deadline); continue; }
    }
    if (MONTHS[w] !== undefined && /^\d{1,2}$/.test(next)) {
      const k = dayMonth(Number(next), MONTHS[w]); if (k) { f.deadline = k; i++; took(KEY.deadline); continue; }
    }

    // times
    const t = parseTime(w, words[i + 1]);
    if (t) { f.atTime = t; if (/^(am|pm)$/i.test(next)) i++; took(KEY.atTime); continue; }

    // durations: 2h, 1.5h, 1h30, 45m, 45min, "2 hours", "30 min"
    m = w.match(/^(\d+(?:[.,]\d+)?)(h|hr|hrs|hour|hours)$/);
    if (m) { f.duration = Math.round(parseFloat(m[1].replace(',', '.')) * 60); took(KEY.duration); continue; }
    m = w.match(/^(\d+)h(\d{1,2})m?$/);
    if (m) { f.duration = Number(m[1]) * 60 + Number(m[2]); took(KEY.duration); continue; }
    m = w.match(/^(\d+)(m|min|mins|minutes)$/);
    if (m) { f.duration = Number(m[1]); took(KEY.duration); continue; }
    if (/^\d+(?:[.,]\d+)?$/.test(w) && /^(h|hr|hrs|hour|hours)$/.test(next)) { f.duration = Math.round(parseFloat(w.replace(',', '.')) * 60); i++; took(KEY.duration); continue; }
    if (/^\d+$/.test(w) && /^(m|min|mins|minutes)$/.test(next)) { f.duration = Number(w); i++; took(KEY.duration); continue; }

    // repeat
    if (w === 'daily' || (w === 'every' && next === 'day')) { f.repeat = 'daily'; if (w === 'every') i++; took(KEY.repeat); continue; }
    if (w === 'weekly' || (w === 'every' && next === 'week')) { f.repeat = 'weekly'; if (w === 'every') i++; took(KEY.repeat); continue; }
    if (w === 'weekdays') { f.repeat = 'weekdays'; took(KEY.repeat); continue; }

    // #list and !priority
    if (w.startsWith('#') && w.length > 1) {
      const name = w.slice(1);
      const list = lists.find((l) => l.name.toLowerCase() === name) || lists.find((l) => l.name.toLowerCase().startsWith(name));
      if (list) { f.listId = list.id; labels.push(list.name); took(KEY.listId); continue; }
    }
    if (/^!+$/.test(w) || w === '!high') { f.priority = 'high'; took(KEY.priority); continue; }
    if (w === '!low') { f.priority = 'low'; took(KEY.priority); continue; }

    keep.push(raw);
  }

  if (lead.length) segs.push({ words: lead, key: null });
  if (f.atTime && !mode) mode = 'on';     // a time of day means "on that day at that time"
  if (f.atTime && !f.deadline) f.deadline = todayKey();
  if (mode && f.deadline) f.dateMode = mode;
  if (f.dateMode === 'due') { delete f.atTime; for (const sg of segs) if (sg.key === 'atTime') sg.key = null; }
  const parsed = { fields: f, labels, segs };
  parsed.title = titleKeeping(parsed, []);
  return parsed;
}

/** The title with recognised words removed, except those for `keys` (fields set by hand instead). */
export function titleKeeping(parsed, keys) {
  return parsed.segs.filter((sg) => !sg.key || keys.includes(sg.key)).flatMap((sg) => sg.words).join(' ');
}

function looksLikeDate(w, after) {
  if (!w) return false;
  return ['today', 'tod', 'tomorrow', 'tmrw', 'tmr', 'next', 'in'].includes(w) || DAYS[w] !== undefined ||
    /^\d{1,2}[/-]\d{1,2}$/.test(w) || MONTHS[w] !== undefined || (/^\d{1,2}$/.test(w) && MONTHS[(after || '').toLowerCase()] !== undefined);
}
