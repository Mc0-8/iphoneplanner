import { icon } from '../icons.js';
import { esc, h, openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import { state, SUBJECT_COLOURS } from '../store.js';
import { todayKey, addDays, mondayOf, formatMinutes, shortDate } from '../dates.js';
import { habitsSection } from './habits.js';
import { statsSection, gradesField } from './stats.js';

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
  const left = rows.filter((r) => !store.isPaused(r.s)).reduce((n, r) => n + Math.max(0, r.minutes - r.done), 0);
  const paused = state.subjects.filter((s) => store.isPaused(s));
  const st = streak();

  el.innerHTML = `
    <header class="header">
      <div>
        <h1>Study</h1>
        <p class="meta">${state.subjects.length ? `<span class="num">${formatMinutes(left)}</span> of study left this week` : 'Weekly study hours per subject'}</p>
      </div>
      ${state.subjects.length ? `<div class="header-actions"><button class="text-button with-icon" data-pause>${icon('pause', 18)} ${paused.length ? 'Paused' : 'Pause'}</button></div>` : ''}
    </header>`;
  el.querySelector('[data-pause]')?.addEventListener('click', openPauseAll);

  if (!state.subjects.length) {
    el.append(h('<p class="empty">Add your subjects and how many hours a week each one needs. The planner spreads the sessions over your week, so no day gets crowded.</p>'));
    el.append(habitsSection());
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
      <li class="progress-row tinted" style="--sc:${r.s.colour}">
        <div class="progress-top">
          <span><span class="dot" style="background:${r.s.colour}"></span>${esc(r.s.name)}${r.boosted ? ' <span class="badge">Exam soon</span>' : ''}${store.isPaused(r.s) ? ' <span class="badge muted-badge">Paused</span>' : ''}</span>
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
      <li class="row tinted" style="--sc:${s.colour}"><div class="row-inner">
        <button class="row-body" type="button">
          <span class="title"><span class="dot" style="background:${s.colour}"></span>${esc(s.name)}</span>
          <span class="sub"><span class="num">${formatMinutes(Math.round(s.hoursPerWeek * 60))} a week</span>${s.hard ? '<span>Hard: planned early</span>' : ''}${store.isPaused(s) ? `<span class="late">${pauseText(s)}</span>` : ''}</span>
        </button>
        <span class="chev">${icon('caretRight', 16)}</span>
      </div></li>`);
    row.querySelector('.row-body').addEventListener('click', () => openSubjectEditor(s));
    list.querySelector('ul').append(row);
  }
  el.append(list);
  el.append(habitsSection());
  el.append(statsSection());
}

const pauseText = (s) => (s.pausedUntil ? `Paused, back ${shortDate(s.pausedUntil).replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase())}` : 'Paused');

/** Pause all study for a while: holidays, a week off, exam week. */
function openPauseAll() {
  const any = state.subjects.some((s) => store.isPaused(s));
  let until = addDays(todayKey(), 7);
  openSheet({
    title: 'Pause study',
    build(body, close) {
      body.innerHTML = `
        <p style="margin-top:0">No new study sessions are planned while study is paused. Tasks and reviews carry on.</p>
        <div class="field">
          <span class="label">Back on</span>
          <div class="chips" style="margin-bottom:8px">
            <button type="button" class="chip" data-d="7" aria-pressed="true">In 1 week</button>
            <button type="button" class="chip" data-d="14">In 2 weeks</button>
            <button type="button" class="chip" data-d="0">When I turn it back on</button>
          </div>
          <input class="input num" type="date" min="${addDays(todayKey(), 1)}" value="${until}" data-until aria-label="Back on">
        </div>
        <div class="menu">
          <button type="button" class="menu-item" data-go>${icon('pause', 20)}<span>Pause all subjects</span></button>
          ${any ? `<button type="button" class="menu-item" data-resume>${icon('arrowRight', 20)}<span>Resume all now</span></button>` : ''}
        </div>`;
      const input = body.querySelector('[data-until]');
      body.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
        const d = Number(b.dataset.d);
        until = d ? addDays(todayKey(), d) : null;
        input.value = until || '';
        input.hidden = !d;
        body.querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      }));
      input.addEventListener('change', () => { until = input.value || null; body.querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', false)); });
      body.querySelector('[data-go]').addEventListener('click', async () => {
        close();
        await store.pauseAll(until);
        toast(until ? `Study paused, back ${shortDate(until).replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase())}` : 'Study paused until you turn it back on', { undo: () => store.pauseAll(false) });
      });
      body.querySelector('[data-resume]')?.addEventListener('click', async () => { close(); await store.pauseAll(false); toast('Study is back on'); });
    },
  });
}

export function openSubjectEditor(existing) {
  const isNew = !existing;
  const subject = isNew ? store.newSubject() : structuredClone(existing);

  openSheet({
    title: isNew ? 'New subject' : 'Edit subject',
    full: !isNew,
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
        <label class="field field-row">
          <span>Pause this subject<span class="hint">No sessions planned until the date below, or until you turn this off</span></span>
          <input type="checkbox" class="switch" ${store.isPaused(subject) ? 'checked' : ''} data-paused>
        </label>
        <div class="field" data-pause-until ${store.isPaused(subject) ? '' : 'hidden'} style="padding-top:0">
          <div class="date-wrap">
            <span class="muted" style="flex:none">Back on</span>
            <input class="input num" type="date" min="${addDays(todayKey(), 1)}" value="${subject.pausedUntil || ''}" aria-label="Back on (optional)">
          </div>
        </div>
        <div data-grades></div>
        ${isNew ? '' : `<div class="delete-row"><button type="button" class="text-button danger with-icon" data-delete>${icon('trash', 18)} Delete subject</button></div>`}`;
      if (!isNew) body.querySelector('[data-grades]').append(gradesField(subject.id));

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
      body.querySelector('[data-paused]').addEventListener('change', (e) => {
        subject.paused = e.target.checked;
        if (!subject.paused) subject.pausedUntil = null;
        body.querySelector('[data-pause-until]').hidden = !subject.paused;
      });
      body.querySelector('[data-pause-until] input').addEventListener('change', (e) => { subject.pausedUntil = e.target.value || null; });
      body.querySelector('[data-delete]')?.addEventListener('click', async () => {
        close();
        const removed = await store.deleteSubject(subject.id);
        toast(`Deleted ${removed.name}`, { undo: () => store.saveSubject(removed) });
      });
    },
  });
}
