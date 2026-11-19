// Notes are stored as plain text with a little Markdown, so backups, search and old notes keep working.
//   **bold**  *italic*  ==highlight==  # Heading  - bullet  1. numbered  - [ ] checklist
//   [Essay draft](task:abc123) links to a task, web links are tappable.
//   Q: question / A: answer lines are flashcards (kept together at the end of the note by the card editor).
//   C: sentence with {hidden words} is a fill-in-the-blank card.

import { esc } from './ui.js';

const CARD_LINE = /^\s*([QA])\s*[:.)]\s*(.*)$/i;
const CLOZE_LINE = /^\s*C\s*:\s*(.*\{[^{}\n]+\}.*)$/i; // needs a {blank}, so "c) item" lists stay text
const BLANK = /\{([^{}\n]+)\}/g;

/**
 * Splits a note into its body text and its flashcards.
 * A line after an answer continues that answer until a blank line.
 * A question with no answer yet is kept as a card with an empty answer.
 */
export function splitCards(text = '') {
  const body = [];
  const cards = [];
  let open = null; // the card whose answer may continue on the next line
  for (const line of String(text).split('\n')) {
    const c = line.match(CLOZE_LINE);
    if (c) { cards.push({ type: 'cloze', q: c[1].trim(), a: '' }); open = null; continue; }
    const m = line.match(CARD_LINE);
    if (m) {
      const isQ = m[1].toUpperCase() === 'Q';
      const last = cards.at(-1);
      if (isQ) { cards.push({ q: m[2].trim(), a: '' }); open = null; continue; }
      if (last && last.type !== 'cloze' && !last.a && !open) { last.a = m[2].trim(); open = last; continue; }
      // An answer with no question stays in the body.
    } else if (open && line.trim()) {
      open.a += ' ' + line.trim();
      continue;
    }
    if (!line.trim()) open = null;
    body.push(line);
  }
  return { body: body.join('\n').replace(/\n{3,}/g, '\n\n').trim(), cards };
}

/** Body text plus cards written back as Q:/A: lines. Newlines inside a card become spaces. */
export function joinCards(body, cards) {
  const one = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim();
  const lines = cards
    .map((c) => ({ type: c.type, q: one(c.q), a: one(c.a) }))
    .filter((c) => c.q || c.a)
    // A fill-in-the-blank card without a {blank} yet is saved as a plain question, so nothing is lost.
    .map((c) => (c.type === 'cloze' && blanks(c.q).length ? `C: ${c.q}` : `Q: ${c.q}${c.a ? `\nA: ${c.a}` : ''}`));
  return [String(body || '').trim(), lines.join('\n\n')].filter(Boolean).join('\n\n');
}

/** Cards that can be asked: Q/A cards with both sides, and fill-in-the-blank cards. */
export const flashcards = (text) => splitCards(text).cards.filter((c) => (c.type === 'cloze' ? blanks(c.q).length : c.q && c.a));

/** The hidden words of a fill-in-the-blank sentence, in order. */
export const blanks = (q = '') => [...String(q).matchAll(BLANK)].map((m) => m[1].trim());

/**
 * A fill-in-the-blank sentence with its blanks swapped out. `fn(word, i)` returns the text for blank i.
 * The other parts are passed through `outside` (e.g. inline rendering).
 */
export function mapBlanks(q, fn, outside = (s) => s) {
  let out = '', last = 0, i = 0;
  for (const m of String(q).matchAll(BLANK)) {
    out += outside(q.slice(last, m.index)) + fn(m[1].trim(), i++);
    last = m.index + m[0].length;
  }
  return out + outside(q.slice(last));
}

/**
 * Quiz questions from cards: one per Q/A card, one per blank of a fill-in-the-blank card
 * (the other blanks of that sentence are shown filled in).
 * @returns [{ prompt, answer, cloze, i }] where prompt is plain text with "____" for the blank
 */
export function quizItems(cards) {
  const out = [];
  for (const c of cards) {
    if (c.type !== 'cloze') { if (c.q && c.a) out.push({ prompt: c.q, answer: c.a, cloze: false }); continue; }
    blanks(c.q).forEach((answer, i) => out.push({ prompt: mapBlanks(c.q, (w, j) => (j === i ? '____' : w)), answer, cloze: true }));
  }
  return out;
}

/** Loose comparison for typed answers: case, accents, punctuation, spacing and a leading "the/a/an" don't matter. */
export function normalizeAnswer(s = '') {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an) /, '');
}

/** 'right', 'close' (one small typo per ~6 letters) or 'wrong'. */
export function checkAnswer(typed, answer) {
  const a = normalizeAnswer(typed), b = normalizeAnswer(answer);
  if (!a) return 'wrong';
  if (a === b) return 'right';
  return b.length >= 5 && editDistance(a, b) <= Math.max(1, Math.floor(b.length / 6)) ? 'close' : 'wrong';
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Ids of the tasks a note links to. */
export function linkedTaskIds(text = '') {
  return [...String(text).matchAll(/\]\(task:([\w-]+)\)/g)].map((m) => m[1]);
}

/** Text without formatting marks, for one-line previews and search. */
export function plainText(text = '') {
  return String(text)
    .replace(/\[([^\]\n]+)\]\((?:task:[\w-]+|https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/^(\s*)[-*] \[[ xX]\] /gm, '$1')
    .replace(/^\s*#{1,3}\s+/gm, '')
    .replace(/^(\s*)[-*]\s+/gm, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2');
}

/* ---------- Rendering ---------- */

const LINK = /\[([^\]\n]+)\]\((task:[\w-]+|https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)'"])/g;

function emphasis(s) {
  // s is already escaped; * and = are left alone by esc().
  return s
    .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/==(?=\S)(.+?)==/g, '<mark>$1</mark>')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
}

/**
 * One line of formatted text as HTML.
 * `taskById(id)` returns the task (or nothing) so a link shows the task's current title.
 * `inert` draws task links as plain labels, for text inside another button.
 */
export function renderInline(text, { taskById, inert = false } = {}) {
  text = String(text);
  let out = '', i = 0;
  for (const m of String(text).matchAll(LINK)) {
    out += emphasis(esc(text.slice(i, m.index)));
    i = m.index + m[0].length;
    if (m[3]) {
      out += inert ? `<u>${esc(m[3].replace(/^https?:\/\/(www\.)?/, ''))}</u>` : `<a href="${esc(m[3])}" target="_blank" rel="noopener">${esc(m[3].replace(/^https?:\/\/(www\.)?/, ''))}</a>`;
    } else if (m[2].startsWith('task:')) {
      const id = m[2].slice(5);
      const task = taskById?.(id);
      out += task && inert
        ? `<span class="task-link${task.completed ? ' done' : ''}">${esc(task.title)}</span>`
        : task
        ? `<button type="button" class="task-link${task.completed ? ' done' : ''}" data-task="${esc(id)}">${esc(task.title)}</button>`
        : `<span class="task-link gone" title="This task was deleted">${esc(m[1])}</span>`;
    } else {
      out += inert ? `<u>${emphasis(esc(m[1]))}</u>` : `<a href="${esc(m[2])}" target="_blank" rel="noopener">${emphasis(esc(m[1]))}</a>`;
    }
  }
  return out + emphasis(esc(text.slice(i)));
}

/**
 * A note's body as HTML: headings, lists, checklists and paragraphs.
 * Checklist boxes carry data-line (the line number in `text`) so a tap can tick them.
 */
export function renderNote(text, opts = {}) {
  const lines = String(text).split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  let para = [];
  const flushPara = () => { if (para.length) out.push(`<p>${para.join('<br>')}</p>`); para = []; };
  const closeList = () => { if (list) out.push(`</${list}>`); list = null; };
  const openList = (kind) => { flushPara(); if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; } };

  lines.forEach((line, n) => {
    let m;
    if (!line.trim()) { flushPara(); closeList(); return; }
    if ((m = line.match(/^\s*(#{1,3})\s+(.*)$/))) {
      flushPara(); closeList();
      out.push(`<h${m[1].length + 2}>${renderInline(m[2], opts)}</h${m[1].length + 2}>`);
    } else if ((m = line.match(/^\s*[-*] \[([ xX])\] ?(.*)$/))) {
      openList('ul');
      const done = m[1] !== ' ';
      out.push(`<li class="todo${done ? ' done' : ''}"><button type="button" class="todo-box" data-line="${n}" role="checkbox" aria-checked="${done}" aria-label="${done ? 'Untick' : 'Tick'}"></button><span>${renderInline(m[2], opts)}</span></li>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      openList('ul');
      out.push(`<li>${renderInline(m[1], opts)}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      openList('ol');
      out.push(`<li>${renderInline(m[1], opts)}</li>`);
    } else {
      closeList();
      para.push(renderInline(line, opts));
    }
  });
  flushPara(); closeList();
  return out.join('');
}

/** Ticks or unticks the checklist item on line `n`. */
export function toggleTodo(text, n) {
  const lines = String(text).split('\n');
  lines[n] = lines[n]?.replace(/^(\s*[-*] \[)([ xX])\]/, (_, a, b) => `${a}${b === ' ' ? 'x' : ' '}]`) ?? lines[n];
  return lines.join('\n');
}

/* ---------- Editing helpers for a <textarea> ---------- */

/** Wraps the selection in a mark like ** or ==, or removes it if it's already there. */
export function wrapSelection(ta, mark) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const before = v.slice(s - mark.length, s), after = v.slice(e, e + mark.length);
  if (before === mark && after === mark) {
    ta.setRangeText(v.slice(s, e), s - mark.length, e + mark.length, 'select');
  } else {
    ta.setRangeText(mark + v.slice(s, e) + mark, s, e, 'end');
    if (s === e) ta.setSelectionRange(s + mark.length, s + mark.length);
    else ta.setSelectionRange(s + mark.length, e + mark.length);
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

const PREFIXES = { heading: /^#{1,3}\s+/, bullet: /^[-*]\s+(?!\[[ xX]\])/, todo: /^[-*] \[[ xX]\] ?/ };
const ADD = { heading: '# ', bullet: '- ', todo: '- [ ] ' };

/** Turns the selected lines into a heading, bullet or checklist item, or back to plain lines. */
export function toggleLinePrefix(ta, kind) {
  const v = ta.value;
  const from = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let end = ta.selectionEnd;
  if (end > ta.selectionStart && v[end - 1] === '\n') end--; // a selection ending at a line break doesn't include the next line
  let to = v.indexOf('\n', end);
  if (to < 0) to = v.length;
  const lines = v.slice(from, to).split('\n');
  const all = lines.every((l) => PREFIXES[kind].test(l));
  const strip = (l) => l.replace(PREFIXES.todo, '').replace(PREFIXES.heading, '').replace(PREFIXES.bullet, '');
  const next = lines.map((l) => (all ? strip(l) : ADD[kind] + strip(l))).join('\n');
  ta.setRangeText(next, from, to, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Inserts text at the cursor, with a space either side when needed. */
export function insertAtCursor(ta, text) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const pre = s > 0 && !/\s/.test(v[s - 1]) ? ' ' : '';
  const post = e < v.length && !/\s/.test(v[e]) ? ' ' : '';
  ta.setRangeText(pre + text + post, s, e, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A task as a link: [Title](task:id). Brackets in the title would break the link, so they're dropped. */
export const taskLink = (task) => `[${task.title.replace(/[[\]]/g, '').trim() || 'Task'}](task:${task.id})`;
