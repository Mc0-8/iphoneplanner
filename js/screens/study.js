import { icon } from '../icons.js';
import { esc, h, openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import { state, SUBJECT_COLOURS } from '../store.js';
import { todayKey, addDays, mondayOf, formatMinutes } from '../dates.js';

export const addLabel = 'Add subject';
export const onAdd = () => openSubjectEditor(null);

/** This week's target for a subject, including the exam boost (+50% in the 2 weeks before). */
export function weekTarget(subject, monday = mondayOf(todayKey())) {
  const sunday = addDays(monday, 6);
  const boosted = state.tasks.some((t) => t.type === 'exam' && !t.completed && t.subjectId === subject.id &&
    t.deadline >= monday && addDays(t.deadline, -14) <= sunday);
  return { minutes: Math.round((subject.hoursPerWeek * 60 * (boosted ? 1.5 : 1)) / 15) * 15, boosted };
}

function streak() {
  const days = new Set(state.blocks.filter((b) => b.kind === 'study' && b.status === 'done').map((b) => b.date));
  let k = todayKey();
  if (!days.has(k)) k = addDays(k, -1);
  let n = 0;
  while (days.has(k)) { n++; k = addDays(k, -1); }
  return n;
}

export function render(el) {
  const monday = mondayOf(todayKey());
  const sunday = addDays(monday, 6);
  const rows = state.subjects.map((s) => {
    const inWeek = state.blocks.filter((b) => b.kind === 'study' && b.subjectId === s.id && b.date >= monday && b.date <= sunday);
    const done = inWeek.filter((b) => b.status === 'done').reduce((n, b) => n + b.duration, 0);
    const planned = inWeek.filter((b) => b.status === 'planned').reduce((n, b) => n + b.duration, 0);
    return { s, done, planned, ...weekTarget(s, monday) };
  });
  const left = rows.reduce((n, r) => n + Math.max(0, r.minutes - r.done), 0);
  const st = streak();

  el.innerHTML = `
    <header class="header">
      <div>
        <h1>Study</h1>
        <p class="meta">${state.subjects.length ? `<span class="num">${formatMinutes(left)}</span> of study left this week` : 'Weekly study hours per subject'}</p>
      </div>
    </header>`;

  if (!state.subjects.length) {
    el.append(h('<p class="empty">Add your subjects and how many hours a week each one needs. The planner spreads the sessions over your week, so no day gets crowded.</p>'));
    return;
  }

  const week = h(`
    <section class="section">
      <div class="section-head"><h2>This week</h2><span class="count">${st ? `${st}-day streak` : ''}</span></div>
      <ul class="rows"></ul>
    </section>`);
  for (const r of rows) {
    const pctDone = r.minutes ? Math.min(100, (r.done / r.minutes) * 100) : 0;
    const pctPlan = r.minutes ? Math.min(100 - pctDone, (r.planned / r.minutes) * 100) : 0;
    week.querySelector('ul').append(h(`
      <li class="progress-row">
        <div class="progress-top">
          <span><span class="dot" style="background:${r.s.colour}"></span>${esc(r.s.name)}${r.boosted ? ' <span class="badge">Exam soon</span>' : ''}</span>
          <span class="num muted">${formatMinutes(r.done)} of ${formatMinutes(r.minutes)}</span>
        </div>
        <div class="bar" role="img" aria-label="${formatMinutes(r.done)} done, ${formatMinutes(r.planned)} planned">
          <span style="width:${pctDone}%;background:${r.s.colour}"></span><span style="width:${pctPlan}%;background:${r.s.colour};opacity:.3"></span>
        </div>
      </li>`));
  }
  el.append(week);

  const list = h(`
    <section class="section">
      <div class="section-head"><h2>Subjects</h2><span class="count num">${state.subjects.length}</span></div>
      <ul class="rows"></ul>
    </section>`);
  for (const s of state.subjects) {
    const row = h(`
      <li class="row"><div class="row-inner">
        <button class="row-body" type="button">
          <span class="title"><span class="dot" style="background:${s.colour}"></span>${esc(s.name)}</span>
          <span class="sub"><span class="num">${formatMinutes(Math.round(s.hoursPerWeek * 60))} a week</span>${s.hard ? '<span>Hard: planned early</span>' : ''}</span>
        </button>
        <span class="chev">${icon('caretRight', 16)}</span>
      </div></li>`);
    row.querySelector('.row-body').addEventListener('click', () => openSubjectEditor(s));
    list.querySelector('ul').append(row);
  }
  el.append(list);
}

export function openSubjectEditor(existing) {
  const isNew = !existing;
  const subject = isNew ? store.newSubject() : structuredClone(existing);

  openSheet({
    title: isNew ? 'New subject' : 'Edit subject',
    action: 'Save',
    onAction: async (close) => {
      if (!subject.name.trim()) return;
      await store.saveSubject(subject);
      close();
    },
    build(body, close, saveBtn) {
      body.innerHTML = `
        <input class="title-input" placeholder="Subject name" value="${esc(subject.name)}" aria-label="Subject name" enterkeyhint="done">
        <div class="field">
          <span class="label">Hours per week</span>
          <div class="stepper">
            <button type="button" class="chip" data-step="-0.5" aria-label="Less">−</button>
            <output class="num" data-hours></output>
            <button type="button" class="chip" data-step="0.5" aria-label="More">+</button>
          </div>
        </div>
        <div class="field">
          <span class="label">Colour</span>
          <div class="swatches">${SUBJECT_COLOURS.map((c) => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${subject.colour === c}"></button>`).join('')}</div>
        </div>
        <label class="field field-row">
          <span>Hard subject<span class="hint">Planned before ${esc(state.settings.hardCutoff)} when possible</span></span>
          <input type="checkbox" class="switch" ${subject.hard ? 'checked' : ''} data-hard>
        </label>
        ${isNew ? '' : `<div class="delete-row"><button type="button" class="text-button danger with-icon" data-delete>${icon('trash', 18)} Delete subject</button></div>`}`;

      const name = body.querySelector('.title-input');
      const sync = () => { saveBtn.disabled = !name.value.trim(); };
      name.addEventListener('input', () => { subject.name = name.value; sync(); });
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
      sync();
      if (isNew) setTimeout(() => name.focus(), 60);

      const out = body.querySelector('[data-hours]');
      const show = () => { out.textContent = formatMinutes(Math.round(subject.hoursPerWeek * 60)); };
      show();
      body.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
        subject.hoursPerWeek = Math.min(20, Math.max(0, subject.hoursPerWeek + Number(b.dataset.step)));
        show();
      }));
      body.querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
        subject.colour = b.dataset.c;
        body.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', x === b));
      }));
      body.querySelector('[data-hard]').addEventListener('change', (e) => { subject.hard = e.target.checked; });
      body.querySelector('[data-delete]')?.addEventListener('click', async () => {
        close();
        const removed = await store.deleteSubject(subject.id);
        toast(`Deleted ${removed.name}`, { undo: () => store.saveSubject(removed) });
      });
    },
  });
}
