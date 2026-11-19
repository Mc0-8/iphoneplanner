// Settings sheets for the scheduler: available hours, fixed commitments, days off.

import { icon } from '../icons.js';
import { esc, h, openSheet } from '../ui.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { shortDate, todayKey } from '../dates.js';

// Display order Monday → Sunday; values are JS weekdays (0 = Sunday).
export const WEEK = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];

export function openAvailability() {
  openSheet({
    title: 'Available hours',
    build(body) {
      body.innerHTML = `
        <p class="fineprint" style="margin-top:0">When you're free to study and do tasks. The planner only uses these times.</p>
        <div class="avail"></div>`;
      const wrap = body.querySelector('.avail');
      for (const [wd, name] of WEEK) {
        const a = state.settings.availability[wd];
        const row = h(`
          <div class="avail-row">
            <label class="avail-day"><input type="checkbox" class="switch" ${a.on ? 'checked' : ''}> ${name}</label>
            <div class="avail-times" ${a.on ? '' : 'hidden'}>
              <input class="input num" type="time" value="${a.start}" aria-label="${name} from" step="300">
              <span>–</span>
              <input class="input num" type="time" value="${a.end}" aria-label="${name} until" step="300">
            </div>
          </div>`);
        const [on] = row.querySelectorAll('input[type=checkbox]');
        const [from, until] = row.querySelectorAll('input[type=time]');
        const warn = h('<p class="fineprint warn-text" hidden>The end time must be after the start, or this day counts as unavailable.</p>');
        row.append(warn);
        const save = () => {
          const availability = structuredClone(state.settings.availability);
          availability[wd] = { on: on.checked, start: from.value || '16:00', end: until.value || '21:00' };
          row.querySelector('.avail-times').hidden = !on.checked;
          warn.hidden = !(on.checked && availability[wd].end <= availability[wd].start);
          store.updateSettings({ availability });
        };
        warn.hidden = !(a.on && a.end <= a.start);
        [on, from, until].forEach((i) => i.addEventListener('change', save));
        wrap.append(row);
      }
    },
  });
}

export function openCommitments() {
  openSheet({
    title: 'Fixed commitments',
    build(body) {
      const draw = () => {
        body.innerHTML = `
          <p class="fineprint" style="margin-top:0">Times you're busy, like school, sport or a work shift. Set them for every week or for one day. Nothing is planned during them.</p>
          <ul class="rows"></ul>
          <button class="text-button primary with-icon" data-add style="margin-top:8px">${icon('plus', 18)} Add commitment</button>`;
        const ul = body.querySelector('ul');
        if (!state.commitments.length) ul.append(h('<li><p class="empty">None yet.</p></li>'));
        const list = state.commitments.filter((c) => !c.date || c.date >= todayKey())
          .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.start.localeCompare(b.start));
        for (const c of list) {
          const days = c.date ? shortDate(c.date) : WEEK.filter(([wd]) => c.weekdays.includes(wd)).map(([, n]) => n.slice(0, 3)).join(', ');
          const row = h(`
            <li class="row"><div class="row-inner">
              <button class="row-body" type="button">
                <span class="title">${esc(c.name)}</span>
                <span class="sub num">${esc(days)} · ${c.start}–${c.end}</span>
              </button>
              <span class="chev">${icon('caretRight', 16)}</span>
            </div></li>`);
          row.querySelector('.row-body').addEventListener('click', () => editCommitment(c, draw));
          ul.append(row);
        }
        body.querySelector('[data-add]').addEventListener('click', () => editCommitment(null, draw));
      };
      draw();
    },
  });
}

export function editCommitment(existing, onDone = () => {}) {
  const c = existing ? structuredClone(existing) : { id: store.uid(), name: '', weekdays: [1, 2, 3, 4, 5], date: null, start: '08:30', end: '15:30' };
  const valid = () => c.name.trim() && c.end > c.start && (c.date || c.weekdays.length);
  openSheet({
    title: existing ? 'Edit commitment' : 'New commitment',
    action: 'Save',
    onAction: async (close) => {
      if (!valid()) return;
      await store.saveCommitment(c);
      close();
      onDone();
    },
    build(body, close, saveBtn) {
      body.innerHTML = `
        <input class="title-input" placeholder="e.g. School, Football" value="${esc(c.name)}" aria-label="Name">
        <div class="field">
          <span class="label">When</span>
          <div class="segmented" data-seg="when" style="margin-bottom:12px">
            <button type="button" data-v="weekly" aria-pressed="${!c.date}">Every week</button>
            <button type="button" data-v="once" aria-pressed="${!!c.date}">One day</button>
          </div>
          <div class="chips" data-weekly ${c.date ? 'hidden' : ''}>${WEEK.map(([wd, n]) => `<button type="button" class="chip" data-wd="${wd}" aria-pressed="${c.weekdays.includes(wd)}">${n.slice(0, 3)}</button>`).join('')}</div>
          <input class="input num" type="date" min="${todayKey()}" value="${c.date || todayKey()}" data-once ${c.date ? '' : 'hidden'} aria-label="Date">
        </div>
        <div class="field">
          <span class="label">Time</span>
          <div class="date-wrap">
            <input class="input num" type="time" value="${c.start}" data-start aria-label="From" step="300">
            <span>–</span>
            <input class="input num" type="time" value="${c.end}" data-end aria-label="Until" step="300">
          </div>
        </div>
        ${existing ? `<div class="delete-row"><button type="button" class="text-button danger with-icon" data-delete>${icon('trash', 18)} Delete commitment</button></div>` : ''}`;
      const name = body.querySelector('.title-input');
      const msg = h('<p class="fineprint warn-text" hidden></p>');
      body.querySelector('[data-end]').closest('.field').append(msg);
      const sync = () => {
        saveBtn.disabled = !valid();
        const overnight = c.start && c.end && c.end <= c.start;
        msg.hidden = !overnight;
        msg.textContent = overnight ? 'The end time must be after the start. For something past midnight, add two: one until 23:55 and one from 00:00 the next day.' : '';
      };
      const onceIn = body.querySelector('[data-once]');
      body.querySelectorAll('[data-seg="when"] button').forEach((b) => b.addEventListener('click', () => {
        const once = b.dataset.v === 'once';
        c.date = once ? (onceIn.value || todayKey()) : null;
        body.querySelectorAll('[data-seg="when"] button').forEach((x) => x.setAttribute('aria-pressed', x === b));
        body.querySelector('[data-weekly]').hidden = once;
        onceIn.hidden = !once;
        sync();
      }));
      onceIn.addEventListener('change', () => { if (c.date !== null) c.date = onceIn.value || todayKey(); sync(); });
      name.addEventListener('input', () => { c.name = name.value; sync(); });
      body.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => {
        const wd = Number(b.dataset.wd);
        c.weekdays = c.weekdays.includes(wd) ? c.weekdays.filter((x) => x !== wd) : [...c.weekdays, wd];
        b.setAttribute('aria-pressed', c.weekdays.includes(wd));
        sync();
      }));
      body.querySelector('[data-start]').addEventListener('change', (e) => { c.start = e.target.value; sync(); });
      body.querySelector('[data-end]').addEventListener('change', (e) => { c.end = e.target.value; sync(); });
      body.querySelector('[data-delete]')?.addEventListener('click', async () => {
        await store.deleteCommitment(c.id);
        close();
        onDone();
      });
      sync();
      if (!existing) setTimeout(() => name.focus(), 60);
    },
  });
}

export function openDaysOff() {
  openSheet({
    title: 'Days off',
    build(body) {
      const draw = () => {
        const weekly = new Set(state.daysOff.filter((d) => d.weekday !== null && d.weekday !== undefined).map((d) => d.weekday));
        const dates = state.daysOff.filter((d) => d.date && d.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date));
        body.innerHTML = `
          <div class="field" style="padding-top:0">
            <span class="label">Every week</span>
            <div class="chips">${WEEK.map(([wd, n]) => `<button type="button" class="chip" data-wd="${wd}" aria-pressed="${weekly.has(wd)}">${n.slice(0, 3)}</button>`).join('')}</div>
          </div>
          <div class="field">
            <span class="label">Specific dates (holidays, sick days)</span>
            <form class="date-wrap" data-form>
              <input class="input num" type="date" min="${todayKey()}" required aria-label="Date">
              <button class="text-button primary" type="submit">Add</button>
            </form>
            <ul class="rows" style="margin-top:8px"></ul>
          </div>`;
        body.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', async () => {
          const wd = Number(b.dataset.wd);
          const existing = state.daysOff.find((d) => d.weekday === wd);
          if (existing) await store.deleteDayOff(existing.id); else await store.addDayOff({ weekday: wd });
          draw();
        }));
        const ul = body.querySelector('ul');
        for (const d of dates) {
          const row = h(`<li class="list-edit"><span style="flex:1">${esc(shortDate(d.date))} <span class="muted num">${d.date}</span></span><button class="icon-button" aria-label="Remove">${icon('trash', 20)}</button></li>`);
          row.querySelector('button').addEventListener('click', async () => { await store.deleteDayOff(d.id); draw(); });
          ul.append(row);
        }
        body.querySelector('[data-form]').addEventListener('submit', async (e) => {
          e.preventDefault();
          const v = e.target.querySelector('input').value;
          if (!v || state.daysOff.some((d) => d.date === v)) return;
          await store.addDayOff({ date: v });
          draw();
        });
      };
      draw();
    },
  });
}
