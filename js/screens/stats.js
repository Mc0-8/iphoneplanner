// Stats for the Study tab: study hours over the last weeks, planned vs actual time, hardest topics.
// Grades and the "what do I need" calculator live in the subject sheet.

import { icon } from '../icons.js';
import { esc, h } from '../ui.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { todayKey, addDays, mondayOf, fromKey, formatMinutes } from '../dates.js';

export function statsSection() {
  const s = h(`<section class="section"><div class="section-head"><h2>Stats</h2></div><div class="stats"></div></section>`);
  const box = s.querySelector('.stats');

  // Study hours per week, last 6 weeks (done blocks), stacked by subject
  const thisMon = mondayOf(todayKey());
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(thisMon, (i - 5) * 7));
  const data = weeks.map((wk) => {
    const end = addDays(wk, 6);
    const per = state.subjects.map((sub) => state.blocks
      .filter((b) => b.kind === 'study' && b.status === 'done' && b.subjectId === sub.id && b.date >= wk && b.date <= end)
      .reduce((n, b) => n + b.duration, 0));
    return { wk, per, total: per.reduce((a, b) => a + b, 0) };
  });
  const target = state.subjects.reduce((n, x) => n + x.hoursPerWeek * 60, 0);
  const max = Math.max(target, ...data.map((d) => d.total), 60);
  const W = 320, H = 132, pad = 22, bw = 30, gap = (W - pad - bw * 6) / 6;
  const yv = (m) => H - 18 - (m / max) * (H - 30);
  const bars = data.map((d, i) => {
    const x = pad + gap / 2 + i * (bw + gap);
    let y0 = H - 18;
    const segs = d.per.map((m, j) => {
      if (!m) return '';
      const hgt = (m / max) * (H - 30);
      y0 -= hgt;
      return `<rect x="${x}" y="${y0}" width="${bw}" height="${hgt}" fill="${state.subjects[j].colour}"/>`;
    }).join('');
    const label = fromKey(d.wk).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `${segs}<text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle" class="ax">${i === 5 ? 'This wk' : label}</text>
      ${d.total ? `<text x="${x + bw / 2}" y="${yv(d.total) - 4}" text-anchor="middle" class="val">${Math.round(d.total / 6) / 10}</text>` : ''}`;
  }).join('');
  box.append(h(`
    <div class="stat-block">
      <p class="stat-title">Study done per week <span class="muted">(hours)</span></p>
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Study hours done in each of the last 6 weeks">
        ${target ? `<line x1="${pad}" x2="${W}" y1="${yv(target)}" y2="${yv(target)}" class="target"/><text x="0" y="${yv(target) + 4}" class="ax">${Math.round(target / 6) / 10}</text>` : ''}
        <line x1="${pad}" x2="${W}" y1="${H - 18}" y2="${H - 18}" class="base"/>
        ${bars}
      </svg>
      ${target ? `<p class="fineprint" style="margin-top:4px">Dashed line: your weekly target, ${formatMinutes(target)}.</p>` : ''}
    </div>`));

  // Planned vs actual (focus timer)
  const logs = state.timeLogs;
  if (logs.length) {
    const planned = logs.reduce((n, l) => n + l.planned, 0);
    const actual = logs.reduce((n, l) => n + l.minutes, 0);
    const r = store.estimateRatio();
    box.append(h(`
      <div class="stat-block">
        <p class="stat-title">Timed with focus mode</p>
        <div class="zstats">
          <div><strong class="num">${formatMinutes(actual)}</strong><span>actual</span></div>
          <div><strong class="num">${formatMinutes(planned)}</strong><span>planned</span></div>
          <div><strong class="num">${logs.length}</strong><span>sessions</span></div>
        </div>
        ${r ? `<p class="fineprint">Tasks take you ${Math.abs(Math.round((r - 1) * 100))}% ${r >= 1 ? 'longer' : 'less'} than planned.${r > 1.1 ? ' Try estimating a bit more time.' : ''}</p>` : ''}
      </div>`));
  }

  // Topics rated Hard most often
  const hard = state.topics.filter((t) => t.hardCount).sort((a, b) => b.hardCount - a.hardCount).slice(0, 3);
  if (hard.length) {
    box.append(h(`
      <div class="stat-block">
        <p class="stat-title">Hardest topics</p>
        <ul class="plain">${hard.map((t) => {
          const sub = store.subjectById(t.subjectId);
          return `<li>${sub ? `<span class="dot" style="background:${sub.colour}"></span>` : ''}${esc(t.name)} <span class="muted num">rated Hard ${t.hardCount}×</span></li>`;
        }).join('')}</ul>
      </div>`));
  }
  return s;
}

/* ---------- Grades (inside the subject sheet) ---------- */

export function gradesField(subjectId) {
  const wrap = h('<div class="field grades"></div>');
  const draw = () => {
    const grades = state.grades.filter((g) => g.subjectId === subjectId).sort((a, b) => a.date.localeCompare(b.date));
    const pcts = grades.map((g) => (g.score / g.max) * 100);
    const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    wrap.innerHTML = `
      <span class="label">Grades${avg !== null ? ` · average <strong class="num">${avg.toFixed(1)}%</strong>` : ''}</span>
      <ul class="plain grade-list">${grades.map((g) => `
        <li><span>${esc(g.name)}</span><span class="num">${g.score}/${g.max} <span class="muted">${((g.score / g.max) * 100).toFixed(0)}%</span></span>
        <button class="icon-button" data-del="${g.id}" aria-label="Remove">${icon('x', 16)}</button></li>`).join('')}</ul>
      <form class="grade-form">
        <input class="input" name="name" placeholder="Test" aria-label="Test name" required>
        <input class="input num" name="score" inputmode="decimal" placeholder="Score" aria-label="Score" required>
        <input class="input num" name="max" inputmode="decimal" placeholder="Out of" aria-label="Out of" value="100" required>
        <button class="text-button primary" type="submit">Add</button>
      </form>
      ${grades.length ? `
        <div class="whatif">
          <label for="goal">What do I need on the next test to average</label>
          <span class="whatif-row"><input id="goal" class="input num" inputmode="decimal" value="${Math.min(100, Math.ceil((avg + 5) / 5) * 5)}" aria-label="Goal percent">%?</span>
          <p class="whatif-out num" data-out></p>
        </div>` : ''}`;
    wrap.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await store.deleteGrade(b.dataset.del); draw(); }));
    wrap.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const score = parseFloat(f.score.value.replace(',', '.')), max = parseFloat(f.max.value.replace(',', '.'));
      if (!f.name.value.trim() || !(max > 0) || !(score >= 0)) return;
      await store.addGrade({ subjectId, name: f.name.value.trim(), score, max });
      draw();
    });
    const goal = wrap.querySelector('#goal');
    if (goal) {
      const out = wrap.querySelector('[data-out]');
      const calc = () => {
        const g = parseFloat(goal.value.replace(',', '.'));
        if (!(g >= 0)) { out.textContent = ''; return; }
        const need = g * (pcts.length + 1) - pcts.reduce((a, b) => a + b, 0);
        out.textContent = need > 100 ? `${need.toFixed(0)}%, so not reachable with one test.` : need <= 0 ? 'You already have it, even with 0%.' : `You need ${need.toFixed(0)}%.`;
      };
      goal.addEventListener('input', calc);
      calc();
    }
  };
  draw();
  return wrap;
}
