// Notes are stored as plain text with a little Markdown, so backups, search and old notes keep working.
//   **bold**  *italic*  ==highlight==  # Heading  - bullet  1. numbered  - [ ] checklist
//   [Essay draft](task:abc123) links to a task, web links are tappable.
//   Q: question / A: answer lines are flashcards (kept together at the end of the note by the card editor).

import { esc } from './ui.js';

const CARD_LINE = /^\s*([QA])\s*[:.)]\s*(.*)$/i;

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
    const m = line.match(CARD_LINE);
    if (m) {
      const isQ = m[1].toUpperCase() === 'Q';
      const last = cards.at(-1);
      if (isQ) { cards.push({ q: m[2].trim(), a: '' }); open = null; continue; }
      if (last && !last.a && !open) { last.a = m[2].trim(); open = last; continue; }
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
    .map((c) => ({ q: one(c.q), a: one(c.a) }))
    .filter((c) => c.q || c.a)
    .map((c) => `Q: ${c.q}${c.a ? `\nA: ${c.a}` : ''}`);
  return [String(body || '').trim(), lines.join('\n\n')].filter(Boolean).join('\n\n');
}

/** Cards with both a question and an answer, for reviews and counts. */
export const flashcards = (text) => splitCards(text).cards.filter((c) => c.q && c.a);

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
