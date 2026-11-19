import { icon } from '../icons.js';
import { esc, h, toast } from '../ui.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { dayItems, itemRow, enableListDrag } from '../block-ui.js';
import { openDayView } from './day-view.js';
import { todayKey, addDays, mondayOf, weekRange, dayTitle, formatMinutes, fromKey } from '../dates.js';
import { windowFor, horizonEnd } from '../scheduler.js';

let selected = null;
let page = 0;

export const addLabel = 'Add task';
export const addDefaults = () => (selected && selected >= todayKey() ? { deadline: selected } : {});

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function render(el) {
  const today = todayKey();
  if (!selected || selected < today) selected = today;
  const first = mondayOf(today);
  const last = horizonEnd(today);
  const cap = state.settings.dailyCap;

  el.innerHTML = `
    <header class="header">
      <div>
        <h1>Week</h1>
        <p class="meta" data-range></p>
      </div>
      <div class="header-actions">
        <button class="text-button" data-replan>Re-spread</button>
      </div>
    </header>
    <div data-summary></div>
    <div class="pager" tabindex="-1"></div>
    <div class="pager-dots" aria-hidden="true"></div>
    <section class="section agenda"></section>`;

  el.querySelector('[data-replan]').addEventListener('click', async () => {
    const wk = addDays(first, page * 7);
    const pinned = state.blocks.filter((b) => b.pinned && b.status === 'planned' && b.date >= wk && b.date <= addDays(wk, 6) && b.date >= today).length;
    const sig = () => state.blocks.filter((b) => b.date >= wk && b.date <= addDays(wk, 6) && b.status === 'planned')
      .map((b) => `${b.id}${b.date}${b.start}`).sort().join('|');
    const before = sig();
    await store.respreadWeek(wk, addDays(wk, 6));
    if (sig() === before) toast('Already spread as evenly as your free time allows');
    else toast(pinned ? `Re-spread ${weekRange(wk)}. ${pinned} pinned block${pinned === 1 ? '' : 's'} unpinned.` : `Re-spread ${weekRange(wk)}`);
  });

  const summary = weekSummary(today);
  if (summary) el.querySelector('[data-summary]').append(summary);

  const pager = el.querySelector('.pager');
  const dots = el.querySelector('.pager-dots');
  const weeks = [];
  for (let wk = first; wk <= last; wk = addDays(wk, 7)) weeks.push(wk);

  weeks.forEach((wk, i) => {
    const summary = state.plan.weeks.find((w) => w.monday === wk);
    const pg = h(`<div class="week-page" data-i="${i}"><div class="week-cap"></div><div class="days"></div></div>`);
    pg.querySelector('.week-cap').innerHTML = capacityLine(summary);
    const daysEl = pg.querySelector('.days');
    for (let d = 0; d < 7; d++) {
      const key = addDays(wk, d);
      daysEl.append(dayCell(key, today, cap));
    }
    pager.append(pg);
    dots.append(h(`<span class="${i === page ? 'on' : ''}"></span>`));
  });

  const range = el.querySelector('[data-range]');
  const setPage = (i) => {
    page = i;
    range.textContent = `${weekRange(weeks[i])}${i === 0 ? ' · this week' : ''}`;
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
  };
  setPage(page);
  requestAnimationFrame(() => { pager.scrollLeft = page * pager.clientWidth; });
  pager.addEventListener('scroll', () => {
    const i = Math.round(pager.scrollLeft / pager.clientWidth);
    if (i !== page && weeks[i]) setPage(i);
  }, { passive: true });

  pager.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-day]');
    if (!cell) return;
    selected = cell.dataset.day;
    pager.querySelectorAll('[data-day]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.day === selected));
    drawAgenda(el.querySelector('.agenda'));
    if (selected >= today) openDayView(selected, cell);
  });

  drawAgenda(el.querySelector('.agenda'));
}

function capacityLine(w) {
  if (!w) return '';
  if (w.overflowMinutes) {
    const names = [...new Set(w.overflow.map((o) => o.title))];
    const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
    const study = w.overflow.some((o) => o.kind === 'study'), tasks = w.overflow.some((o) => o.kind === 'task');
    const fix = tasks && !study ? 'Add free hours or move a deadline.' : study && !tasks ? 'Add free hours, raise the daily limit or lower weekly hours.' : 'Add free hours or raise the daily limit.';
    return `<span class="warn">${formatMinutes(w.overflowMinutes)} doesn't fit</span> · ${esc(shown)}. ${fix}`;
  }
  return `<span class="num">${formatMinutes(w.planned)}</span> planned · <span class="num">${formatMinutes(Math.max(0, w.free - w.planned))}</span> free`;
}

function dayCell(key, today, cap) {
  const blocks = state.blocks.filter((b) => b.date === key && b.status !== 'missed');
  const load = blocks.reduce((s, b) => s + b.duration, 0);
  const off = !windowFor(state.settings, state.daysOff, key);
  const isPast = key < today;
  // Stacked bar: one segment per block, coloured by subject (tasks in neutral).
  const segs = blocks
    .sort((a, b) => a.start - b.start)
    .map((b) => {
      const c = b.kind === 'study' ? store.subjectById(b.subjectId)?.colour : null;
      return `<i style="height:${(b.duration / cap) * 100}%;${c ? `background:${c}` : ''}"${b.status === 'done' ? ' class="d"' : ''}></i>`;
    }).join('');
  const d = fromKey(key);
  return h(`
    <button class="day${isPast ? ' past' : ''}${key === today ? ' today' : ''}" data-day="${key}" aria-pressed="${key === selected}"
      aria-label="${esc(dayTitle(key))}, ${formatMinutes(load)} planned">
      <span class="dl">${LETTERS[(d.getDay() + 6) % 7]}</span>
      <span class="dn num">${d.getDate()}</span>
      <span class="load">${off && !load ? '<em>Off</em>' : segs}</span>
      <span class="dm num">${load ? shortMin(load) : ''}</span>
    </button>`);
}

const shortMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`);

function drawAgenda(sec) {
  const items = dayItems(selected);
  const load = items.filter((i) => i.type === 'block').reduce((s, i) => s + (i.end - i.start), 0);
  sec.innerHTML = `
    <div class="section-head"><h2>${esc(dayTitle(selected))}</h2><button class="link-button open-day" type="button">Open day ${icon('caretRight', 14)}</button></div>
    <ul class="rows tlist"></ul>`;
  const ul = sec.querySelector('ul');
  sec.querySelector(".open-day").addEventListener('click', (e) => openDayView(selected, e.currentTarget));
  if (!items.length) {
    const off = !windowFor(state.settings, state.daysOff, selected);
    ul.append(h(`<li><p class="empty">${off ? 'Day off.' : 'Nothing planned.'}</p></li>`));
    return;
  }
  items.forEach((it) => ul.append(itemRow(it, { live: selected === todayKey() })));
  if (selected >= todayKey()) enableListDrag(ul, selected);
}

/** On Sundays: a look at the week ahead. */
function weekSummary(today) {
  if (fromKey(today).getDay() !== 0) return null;
  const mon = addDays(today, 1), sun = addDays(today, 7);
  const blocks = state.blocks.filter((b) => b.date >= mon && b.date <= sun && b.status !== 'missed');
  const study = blocks.filter((b) => b.kind === 'study').reduce((s, b) => s + b.duration, 0);
  const tasks = new Set(blocks.filter((b) => b.kind === 'task').map((b) => b.taskId)).size;
  const reviews = blocks.filter((b) => b.kind === 'review').length;
  const loads = {};
  for (const b of blocks) loads[b.date] = (loads[b.date] || 0) + b.duration;
  const busiest = Object.entries(loads).sort((a, b) => b[1] - a[1])[0];
  const exams = state.tasks.filter((t) => t.type === 'exam' && !t.completed && t.deadline >= mon && t.deadline <= sun);
  const due = state.tasks.filter((t) => t.type !== 'exam' && !t.completed && t.deadline >= mon && t.deadline <= sun);
  const w = state.plan.weeks.find((x) => x.monday === mon);
  return h(`
    <section class="summary">
      <h2>Next week, ${esc(weekRange(mon))}</h2>
      <div class="zstats">
        <div><strong class="num">${formatMinutes(study)}</strong><span>study</span></div>
        <div><strong class="num">${tasks}</strong><span>task${tasks === 1 ? '' : 's'}</span></div>
        <div><strong class="num">${reviews}</strong><span>review${reviews === 1 ? '' : 's'}</span></div>
      </div>
      <ul class="summary-list">
        ${busiest ? `<li>Busiest day: ${esc(fromKey(busiest[0]).toLocaleDateString('en-GB', { weekday: 'long' }))}, <span class="num">${formatMinutes(busiest[1])}</span></li>` : ''}
        ${exams.length ? `<li>Exams: ${exams.map((e) => `${esc(e.title)} (${esc(fromKey(e.deadline).toLocaleDateString('en-GB', { weekday: 'short' }))})`).join(', ')}</li>` : ''}
        ${due.length ? `<li>Due: ${due.slice(0, 4).map((t) => esc(t.title)).join(', ')}${due.length > 4 ? ` and ${due.length - 4} more` : ''}</li>` : ''}
        ${w?.overflowMinutes ? `<li class="warn">${formatMinutes(w.overflowMinutes)} doesn't fit. Add hours or move a deadline.</li>` : ''}
      </ul>
    </section>`);
}
