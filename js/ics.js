// Calendar export: a one-time copy of planned blocks as an .ics file, with an alert before each.
// Deadlines and exams in the same range go in as all-day events with a reminder some days before, at 9:00.
// It does not stay in sync. Each block keeps its UID, so calendar apps that honour UIDs update rather than duplicate.

import { esc, openSheet, toast } from './ui.js';
import * as store from './store.js';
import { state } from './store.js';
import { fromKey, formatMinutes, todayKey, addDays } from './dates.js';
import { describe } from './block-ui.js';

const ALERTS = [[0, 'None'], [5, '5 min'], [10, '10 min'], [30, '30 min']];
// Days before a deadline; -1 is no reminder, 0 is the morning of the day.
const DEADLINE_ALERTS = [[-1, 'None'], [0, 'That day'], [1, '1 day'], [2, '2 days'], [7, '1 week']];
const REMIND_AT = 9; // o'clock

const pad = (n) => String(n).padStart(2, '0');
function stamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`;
}
function at(key, min) {
  const d = fromKey(key);
  d.setHours(0, min, 0, 0);
  return d;
}
const text = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Lines longer than 75 bytes are folded, as the format requires. */
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const dateOnly = (key) => key.replace(/-/g, '');

/** Open tasks and exams due from `from` to `to` (and not before today). "On the day" tasks are already blocks. */
export function deadlinesIn(tasks, from, to) {
  const start = from > todayKey() ? from : todayKey();
  return tasks.filter((t) => !t.completed && !t.inbox && t.deadline && t.deadline >= start && t.deadline <= to && t.dateMode !== 'on')
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
}

/** TRIGGER for a reminder `days` before an all-day event, at REMIND_AT o'clock. */
export const deadlineTrigger = (days) => (days === 0 ? `TRIGGER:PT${REMIND_AT}H` : `TRIGGER:-PT${days * 24 - REMIND_AT}H`);

export function toIcs(blocks, alertMin, deadlines = [], deadlineDays = -1) {
  const now = stamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planner//iphoneplanner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const b of blocks) {
    const d = describe(b);
    const title = b.kind === 'study' ? `Study: ${d.title}` : d.title;
    lines.push('BEGIN:VEVENT', `UID:${b.id}@iphoneplanner`, `DTSTAMP:${now}`,
      `DTSTART:${stamp(at(b.date, b.start))}`, `DTEND:${stamp(at(b.date, b.start + b.duration))}`,
      `SUMMARY:${text(title)}`, `DESCRIPTION:${text(`${formatMinutes(b.duration)}, planned by Planner. A one-time copy: later changes in the app don't show up here.`)}`);
    if (alertMin) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(title)}`, `TRIGGER:-PT${alertMin}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  for (const t of deadlines) {
    const title = t.type === 'exam' ? `Exam: ${t.title}` : `Due: ${t.title}`;
    lines.push('BEGIN:VEVENT', `UID:deadline-${t.id}@iphoneplanner`, `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dateOnly(t.deadline)}`, `DTEND;VALUE=DATE:${dateOnly(addDays(t.deadline, 1))}`,
      `SUMMARY:${text(title)}`, 'TRANSP:TRANSPARENT',
      `DESCRIPTION:${text('Deadline from Planner. A one-time copy: later changes in the app don\'t show up here.')}`);
    if (deadlineDays >= 0) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(title)}`, deadlineTrigger(deadlineDays), 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

async function deliver(filename, ics, how) {
  const file = new File([ics], filename, { type: 'text/calendar' });
  if (how === 'share' && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

/**
 * Sheet that exports `blocks` (only planned ones, today or later), plus the deadlines in `range`.
 * @param label e.g. "this week" or the block's title
 * @param range { from, to } date keys whose deadlines are included; leave out for blocks only
 */
export function openCalendarExport(blocks, label, filename = 'planner.ics', range = null) {
  const list = blocks.filter((b) => b.status === 'planned');
  const dues = range ? deadlinesIn(state.tasks, range.from, range.to) : [];
  if (!list.length && !dues.length) { toast('Nothing planned to add'); return; }
  let alertMin = state.settings.calendarAlert ?? 10;
  let dueDays = state.settings.deadlineAlert ?? 1;
  const what = [list.length && (list.length === 1 && !range ? esc(label) : `${list.length} planned block${list.length === 1 ? "" : "s"}`),
    dues.length && `${dues.length} deadline${dues.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
  const canShare = (() => { try { return !!navigator.canShare?.({ files: [new File(['x'], 'x.ics', { type: 'text/calendar' })] }); } catch { return false; } })();

  openSheet({
    title: 'Add to Calendar',
    build(body, close) {
      body.innerHTML = `
        <p style="margin-top:0">${what}${range ? ` from ${esc(label)}` : ''} as calendar events.</p>
        ${list.length ? `<div class="field">
          <span class="label">Alert before each block</span>
          <div class="segmented fill" data-alert>${ALERTS.map(([m, l]) => `<button type="button" data-v="${m}" aria-pressed="${m === alertMin}">${l}</button>`).join('')}</div>
        </div>` : ''}
        ${dues.length ? `<div class="field">
          <span class="label">Remind me before deadlines<span class="hint">At ${REMIND_AT}:00</span></span>
          <div class="segmented fill" data-due>${DEADLINE_ALERTS.map(([d, l]) => `<button type="button" data-v="${d}" aria-pressed="${d === dueDays}">${l}</button>`).join('')}</div>
        </div>` : ''}
        <div class="menu">
          ${canShare ? '<button type="button" class="menu-item" data-how="share"><span>Share to Calendar or Files…</span></button>' : ''}
          <button type="button" class="menu-item" data-how="download"><span>Download .ics file</span></button>
        </div>
        <p class="fineprint">On iPhone: open the file and tap <strong>Add All</strong>. This is a one-time copy: when the plan changes, your calendar doesn't.</p>`;
      body.querySelectorAll('[data-alert] button').forEach((b) => b.addEventListener('click', () => {
        alertMin = Number(b.dataset.v);
        body.querySelectorAll('[data-alert] button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      }));
      body.querySelectorAll('[data-due] button').forEach((b) => b.addEventListener('click', () => {
        dueDays = Number(b.dataset.v);
        body.querySelectorAll('[data-due] button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      }));
      body.querySelectorAll('[data-how]').forEach((b) => b.addEventListener('click', async () => {
        if (alertMin !== state.settings.calendarAlert || dueDays !== state.settings.deadlineAlert) store.updateSettings({ calendarAlert: alertMin, deadlineAlert: dueDays });
        const ok = await deliver(filename, toIcs(list, alertMin, dues, dueDays), b.dataset.how);
        if (ok) { close(); toast(b.dataset.how === 'share' ? 'Calendar file ready' : 'Calendar file downloaded'); }
      }));
    },
  });
}
