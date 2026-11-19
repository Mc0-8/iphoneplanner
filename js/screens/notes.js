import { icon } from '../icons.js';
import { esc, h, openSheet, toast, confirmSheet } from '../ui.js';
import * as store from '../store.js';
import { state, flashcards, topicsDue } from '../store.js';
import { todayKey, shortDate } from '../dates.js';
import { openReview } from './review.js';
import { openQuiz, quizCount } from './quiz.js';
import { openFlashcards, boxBar, countsFor } from './flip.js';
import { openSearch } from './search.js';
import { openTaskEditor } from '../task-ui.js';
import {
  splitCards, joinCards, mapBlanks, renderNote, renderInline, plainText, toggleTodo,
  wrapSelection, toggleLinePrefix, insertAtCursor, taskLink,
} from '../notes-format.js';

export const addLabel = 'Add note';
export const onAdd = () => openNoteEditor(null);

const open = new Set(); // expanded subjects

export function render(el) {
  const today = todayKey();
  const due = topicsDue(today);
  const todays = state.notes.filter((n) => n.date === today).sort((a, b) => b.createdAt - a.createdAt);

  el.innerHTML = `
    <header class="header">
      <div>
        <h1>Notes</h1>
        <p class="meta"><span class="num">${state.topics.length}</span> topic${state.topics.length === 1 ? '' : 's'} · <span class="num">${due.length}</span> to review today</p>
      </div>
      <div class="header-actions">
        <button class="icon-button" data-search aria-label="Search">${searchIcon()}</button>
      </div>
    </header>`;
  el.querySelector('[data-search]').addEventListener('click', openSearch);

  // 1. Today's reviews
  const rev = h(`
    <section class="section">
      <div class="section-head"><h2>Today's reviews</h2><span class="count num">${due.length || ''}</span></div>
    </section>`);
  if (due.length) {
    const btn = h(`<button class="review-start">
      <span><strong>Start review</strong><span class="muted">${esc(due.slice(0, 3).map((t) => t.name).join(', '))}${due.length > 3 ? ` and ${due.length - 3} more` : ''}</span></span>
      <span class="num">${Math.ceil(due.length / 3) * 15} min</span></button>`);
    btn.addEventListener('click', () => openReview(due.map((t) => t.id)));
    rev.append(btn);
  } else {
    rev.append(h(`<p class="empty">${state.topics.length ? 'All caught up.' : 'Write a note with a topic and it comes back for review tomorrow, then after 3 days, a week, 2 weeks and a month.'}</p>`));
  }
  el.append(rev);

  // 2. Today's notes
  if (todays.length) {
    const sec = h(`<section class="section"><div class="section-head"><h2>Written today</h2><span class="count num">${todays.length}</span></div><ul class="rows"></ul></section>`);
    todays.forEach((n) => sec.querySelector('ul').append(noteRow(n)));
    el.append(sec);
  }

  // 3. Topics by subject
  const groups = [...state.subjects.map((s) => ({ s, id: s.id })), { s: null, id: null }];
  const topicsSec = h(`<section class="section"><div class="section-head"><h2>Topics</h2></div><div class="tgroups"></div></section>`);
  const wrap = topicsSec.querySelector('.tgroups');
  let any = false;
  for (const g of groups) {
    const sid = (x) => (x.subjectId && store.subjectById(x.subjectId) ? x.subjectId : null); // deleted subject → "No subject"
    const topics = state.topics.filter((t) => sid(t) === g.id).sort((a, b) => a.name.localeCompare(b.name));
    const loose = state.notes.filter((n) => !n.topicId && sid(n) === g.id);
    if (!topics.length && !loose.length) continue;
    any = true;
    const isOpen = open.has(String(g.id));
    const grp = h(`
      <div class="tgroup${g.s ? ' tinted' : ''}"${g.s ? ` style="--sc:${g.s.colour}"` : ''}>
        <button class="tgroup-head" aria-expanded="${isOpen}">
          <span>${g.s ? `<span class="dot" style="background:${g.s.colour}"></span>${esc(g.s.name)}` : 'No subject'}</span>
          <span class="muted num">${topics.length} topic${topics.length === 1 ? '' : 's'}${loose.length ? ` · ${loose.length} loose` : ''} ${icon('caretRight', 14)}</span>
        </button>
        <ul class="rows"></ul>
      </div>`);
    grp.querySelector('button').addEventListener('click', () => { isOpen ? open.delete(String(g.id)) : open.add(String(g.id)); render(el); });
    if (isOpen) {
      const ul = grp.querySelector('ul');
      for (const t of topics) {
        const n = state.notes.filter((x) => x.topicId === t.id);
        const cards = n.reduce((c, x) => c + flashcards(x.text).length, 0);
        const row = h(`
          <li class="row"><div class="row-inner">
            <button class="row-body" type="button">
              <span class="title">${esc(t.name)}</span>
              <span class="sub"><span class="num">${n.length} note${n.length === 1 ? '' : 's'}</span>${cards ? `<span class="num">${cards} card${cards === 1 ? '' : 's'}</span>${boxBar(countsFor([t.id]))}` : ''}<span>${t.nextReview <= todayKey() ? '<span class="late">Review today</span>' : `Next review ${esc(shortDate(t.nextReview).replace(/^Tomorrow$/, 'tomorrow'))}`}</span></span>
            </button>
            <span class="chev">${icon('caretRight', 16)}</span>
          </div></li>`);
        row.querySelector('.row-body').addEventListener('click', () => openTopic(t.id));
        ul.append(row);
      }
      loose.forEach((x) => ul.append(noteRow(x)));
    }
    wrap.append(grp);
  }
  if (!any) wrap.append(h('<p class="empty">No notes yet. Tap "Add note" after a class.</p>'));
  el.append(topicsSec);
}

export function searchIcon() {
  return `<svg class="icon" width="22" height="22" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/></svg>`;
}

function noteRow(n) {
  const subject = store.subjectById(n.subjectId);
  const topic = state.topics.find((t) => t.id === n.topicId);
  const first = plainText(splitCards(n.text).body || n.text).split('\n').find((l) => l.trim()) || '';
  const row = h(`
    <li class="row${subject ? ' tinted' : ''}"${subject ? ` style="--sc:${subject.colour}"` : ''}><div class="row-inner">
      <button class="row-body" type="button">
        <span class="title note-text">${esc(first)}</span>
        <span class="sub">${subject ? `<span class="dot" style="background:${subject.colour}"></span><span>${esc(subject.name)}</span>` : ''}${topic ? `<span>${esc(topic.name)}</span>` : '<span>No topic</span>'}<span>${esc(shortDate(n.date))}</span></span>
      </button>
    </div></li>`);
  row.querySelector('.row-body').addEventListener('click', () => openNoteEditor(n));
  return row;
}

export function openTopic(id) {
  const t = state.topics.find((x) => x.id === id);
  if (!t) return;
  const subject = store.subjectById(t.subjectId);
  openSheet({
    title: t.name,
    full: true,
    build(body, close) {
      const draw = () => {
        const notes = state.notes.filter((n) => n.topicId === t.id).sort((a, b) => a.createdAt - b.createdAt);
        const counts = countsFor([t.id]);
        body.innerHTML = `
          <p class="fineprint" style="margin-top:0">${subject ? `<span class="dot" style="background:${subject.colour}"></span>${esc(subject.name)} · ` : ''}Next review ${esc(shortDate(t.nextReview).toLowerCase())}${t.lastRating ? ` · last rated ${t.lastRating === 'ok' ? 'OK' : t.lastRating}` : ''}</p>
          ${counts.some(Boolean) ? `<div class="flip-start${subject ? ' tinted' : ''}"${subject ? ` style="--sc:${subject.colour}"` : ''}>
            <button class="quiz-btn wide" data-flip>Flashcards · ${counts.reduce((a, b) => a + b, 0)} cards</button>
            ${boxBar(counts, { labels: true })}
          </div>` : ''}
          <div class="review-tools">
            <button class="text-button primary with-icon" data-review>${icon('check', 18)} Review now</button>
            ${quizCount([t.id]) ? '<button class="text-button primary" data-quiz>Quiz me</button>' : ''}
          </div>
          <ul class="rows notes-full"></ul>
          <button class="text-button primary with-icon" data-add>${icon('plus', 18)} Add note to this topic</button>
          <div class="delete-row"><button class="text-button danger with-icon" data-del>${icon('trash', 18)} Delete topic and its notes</button></div>`;
        const ul = body.querySelector('ul');
        for (const n of notes) ul.append(noteFull(n));
        body.querySelector('[data-review]').addEventListener('click', () => { close(); openReview([t.id]); });
        body.querySelector('[data-flip]')?.addEventListener('click', () => openFlashcards([t.id]));
        body.querySelector('[data-quiz]')?.addEventListener('click', () => openQuiz([t.id]));
        body.querySelector('[data-add]').addEventListener('click', () => openNoteEditor(null, { subjectId: t.subjectId, topicName: t.name }));
        body.querySelector('[data-del]').addEventListener('click', async () => {
          if (!(await confirmSheet({ title: 'Delete topic?', message: `"${t.name}" and its ${notes.length} note${notes.length === 1 ? '' : 's'} will be deleted.`, confirm: 'Delete' }))) return;
          await store.deleteTopic(t.id);
          close();
          toast('Topic deleted');
        });
      };
      draw();
      const unsub = store.subscribe(() => { if (document.body.contains(body)) draw(); else unsub(); });
    },
  });
}


/* ---------- Formatted notes ---------- */

const fmt = { taskById: (id) => state.tasks.find((t) => t.id === id) };

/** Formatted body HTML for a note's text (cards left out). */
export function noteBodyHTML(text) {
  return renderNote(text, fmt);
}

/**
 * Makes the links and checklist boxes inside rendered note HTML work.
 * `onTick(line)` is called with the line number of a tapped checklist box.
 */
export function wireNoteBody(el, onTick) {
  el.addEventListener('click', (e) => {
    const link = e.target.closest('[data-task]');
    if (link) {
      e.stopImmediatePropagation();
      const task = state.tasks.find((t) => t.id === link.dataset.task);
      if (task) openTaskEditor(task); else toast('That task was deleted.');
      return;
    }
    const box = e.target.closest('[data-line]');
    if (box && onTick) { e.stopImmediatePropagation(); onTick(Number(box.dataset.line)); return; }
    if (e.target.closest('a, .task-link')) e.stopImmediatePropagation();
  });
}

/** A fill-in-the-blank sentence with its blanks marked; `hide` covers them until tapped (reviews). */
export function clozeHTML(q, opts, hide = false) {
  return mapBlanks(q, (w) => `<mark class="blank${hide ? ' hidden-blank' : ''}">${esc(w)}</mark>`, (s) => renderInline(s, opts));
}

/** A note in the topic view: formatted text and its cards. Tap to edit. */
function noteFull(n) {
  const { body, cards } = splitCards(n.text);
  const li = h(`
    <li class="note-full" role="button" tabindex="0">
      <span class="num muted">${esc(shortDate(n.date))}</span>
      <div class="note-body">${noteBodyHTML(body)}</div>
      ${cards.length ? `<ul class="note-cards-mini">${cards.map((c) => `
        <li>${c.type === 'cloze' ? `<span class="q">${clozeHTML(c.q, fmt)}</span>`
          : `<span class="q">${renderInline(c.q, fmt)}</span><span class="a">${c.a ? renderInline(c.a, fmt) : '<span class="muted">No answer yet</span>'}</span>`}</li>`).join('')}</ul>` : ''}
    </li>`);
  const topicName = state.topics.find((t) => t.id === n.topicId)?.name || '';
  // Ticking saves the note in the same shape the editor does (cards together at the end).
  wireNoteBody(li, (line) => store.saveNote({ ...n, text: joinCards(toggleTodo(body, line), cards), topicName }));
  const open = () => openNoteEditor(n);
  li.addEventListener('click', open);
  li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) open(); });
  return li;
}

/* ---------- Editor ---------- */

const TOOLS = [
  { wrap: '**', label: 'Bold', html: '<strong>B</strong>' },
  { wrap: '*', label: 'Italic', html: '<em>I</em>' },
  { wrap: '==', label: 'Highlight', html: '<mark>ab</mark>' },
  { line: 'heading', label: 'Heading', html: '<strong>H</strong>' },
  { line: 'bullet', label: 'Bullet list', html: icon('list', 20) },
  { line: 'todo', label: 'Checklist', html: '<span class="tool-box"></span>' },
];

export function openNoteEditor(existing, defaults = {}) {
  const isNew = !existing;
  const topic = existing && state.topics.find((t) => t.id === existing.topicId);
  const note = isNew
    ? { id: store.uid(), date: todayKey(), text: '', subjectId: defaults.subjectId ?? state.settings.lastNoteSubject ?? null, topicName: defaults.topicName || '', topicId: null, createdAt: Date.now() }
    : { ...existing, topicName: topic?.name || '' };
  if (note.subjectId && !store.subjectById(note.subjectId)) note.subjectId = null;
  const split = splitCards(note.text);
  let bodyText = split.body;
  const cards = split.cards.map((c) => ({ ...c }));
  const compose = () => { note.text = joinCards(bodyText, cards); };

  openSheet({
    title: isNew ? 'New note' : 'Edit note',
    action: 'Save',
    full: true,
    extra: isNew ? null : { icon: 'trash', label: 'Delete note', onClick: async (close) => {
      close();
      const removed = await store.deleteNote(note.id);
      toast('Note deleted', { undo: () => store.saveNote({ ...removed, topicName: topic?.name || '' }) });
    } },
    onAction: async (close) => {
      compose();
      if (!note.text.trim()) return;
      await store.saveNote(note);
      if (note.subjectId) store.updateSettings({ lastNoteSubject: note.subjectId });
      close();
      toast(note.topicName.trim() ? `Saved to ${note.topicName.trim()}` : 'Note saved');
    },
    build(body, close, saveBtn) {
      body.innerHTML = `
        <div class="field" style="padding-top:0">
          <span class="label">Subject</span>
          <div class="chips">
            ${state.subjects.map((s) => `<button type="button" class="chip" data-s="${s.id}" aria-pressed="${note.subjectId === s.id}"><span class="dot" style="background:${s.colour}"></span>${esc(s.name)}</button>`).join('')}
            ${state.subjects.length ? '' : '<span class="fineprint" style="margin:0">Add subjects in the Study tab to tag notes.</span>'}
          </div>
        </div>
        <div class="field">
          <label class="label" for="topic">Topic <span class="hint" style="display:inline">· topics come back for review</span></label>
          <input id="topic" class="input" list="topic-list" placeholder="e.g. Mitosis" value="${esc(note.topicName)}" autocomplete="off">
          <datalist id="topic-list"></datalist>
        </div>
        <div class="note-tools" role="toolbar" aria-label="Formatting">
          ${TOOLS.map((t, i) => `<button type="button" class="tool" data-tool="${i}" aria-label="${t.label}" title="${t.label}">${t.html}</button>`).join('')}
          <button type="button" class="tool tool-text" data-link aria-label="Link a task">${icon('tasks', 18)} Task</button>
          <button type="button" class="tool tool-text tool-preview" data-preview aria-pressed="false" aria-label="Preview">View</button>
        </div>
        <textarea class="note-input" placeholder="What did you learn?" aria-label="Note">${esc(bodyText)}</textarea>
        <div class="note-preview note-body" hidden></div>
        <div class="field note-cards">
          <span class="label">Flashcards<span class="hint">Asked in your reviews and quizzes</span></span>
          <ol class="card-edits"></ol>
          <div class="card-adds">
            <button type="button" class="text-button primary with-icon" data-add-card>${icon('plus', 18)} Question card</button>
            <button type="button" class="text-button primary with-icon" data-add-cloze>${icon('plus', 18)} Fill-in-the-blank</button>
          </div>
        </div>`;

      const list = body.querySelector('#topic-list');
      const fillTopics = () => {
        list.innerHTML = state.topics.filter((t) => t.subjectId === note.subjectId).map((t) => `<option value="${esc(t.name)}">`).join('');
      };
      fillTopics();
      body.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
        note.subjectId = note.subjectId === b.dataset.s ? null : b.dataset.s;
        body.querySelectorAll('[data-s]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.s === note.subjectId));
        fillTopics();
      }));
      body.querySelector('#topic').addEventListener('input', (e) => { note.topicName = e.target.value; });

      const ta = body.querySelector('.note-input');
      const preview = body.querySelector('.note-preview');
      const previewBtn = body.querySelector('[data-preview]');
      const sync = () => { compose(); saveBtn.disabled = !note.text.trim(); };
      const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, 180) + 'px'; };
      ta.addEventListener('input', () => { bodyText = ta.value; grow(); sync(); });

      // Formatting buttons keep the keyboard up: don't let a tap take focus from the note.
      const tools = body.querySelector('.note-tools');
      tools.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-tool]')) e.preventDefault(); });
      tools.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
        if (!preview.hidden) setPreview(false);
        const t = TOOLS[b.dataset.tool];
        if (t.wrap) wrapSelection(ta, t.wrap); else toggleLinePrefix(ta, t.line);
        ta.focus();
      }));

      const drawPreview = () => {
        preview.innerHTML = bodyText.trim() ? noteBodyHTML(bodyText) : '<p class="empty">Nothing written yet.</p>';
      };
      const setPreview = (on) => {
        previewBtn.setAttribute('aria-pressed', on);
        preview.hidden = !on;
        ta.hidden = on;
        if (on) drawPreview(); else grow();
      };
      previewBtn.addEventListener('click', () => setPreview(preview.hidden));
      wireNoteBody(preview, (line) => {
        bodyText = toggleTodo(bodyText, line);
        ta.value = bodyText;
        sync();
        drawPreview();
      });

      body.querySelector('[data-link]').addEventListener('click', () => pickTask((task) => {
        setPreview(false);
        ta.focus();
        insertAtCursor(ta, taskLink(task));
      }));

      // Card editor
      const cardList = body.querySelector('.card-edits');
      const growField = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
      const drawCards = (focus) => {
        cardList.innerHTML = cards.map((c, i) => `
          <li class="card-edit${c.type === 'cloze' ? ' cloze' : ''}" data-i="${i}">
            <div class="card-edit-fields">
              ${c.type === 'cloze' ? `
              <textarea class="card-field q" rows="1" data-k="q" placeholder="Sentence, e.g. The capital of France is {Paris}" aria-label="Fill-in-the-blank sentence ${i + 1}" enterkeyhint="next">${esc(c.q)}</textarea>
              <div class="cloze-tools"><button type="button" class="tool tool-text" data-blank>Blank</button><span class="hint">Select words, then tap Blank to hide them</span></div>` : `
              <textarea class="card-field q" rows="1" data-k="q" placeholder="Question" aria-label="Question ${i + 1}" enterkeyhint="next">${esc(c.q)}</textarea>
              <textarea class="card-field a" rows="1" data-k="a" placeholder="Answer" aria-label="Answer ${i + 1}" enterkeyhint="next">${esc(c.a)}</textarea>`}
            </div>
            <button type="button" class="icon-button" data-rm aria-label="Remove card ${i + 1}">${icon('x', 16)}</button>
          </li>`).join('');
        cardList.querySelectorAll('.card-field').forEach(growField);
        if (focus) cardList.querySelector(`[data-i="${focus.i}"] [data-k="${focus.k}"]`)?.focus();
      };
      const addCard = (type) => { cards.push(type === 'cloze' ? { type, q: '', a: '' } : { q: '', a: '' }); drawCards({ i: cards.length - 1, k: 'q' }); };
      // "Blank" wraps the selected words in {braces}; with nothing selected it wraps the word at the cursor.
      // A textarea keeps its selection after it loses focus, so tapping Blank can still read it.
      const makeBlank = (li) => {
        const f = li.querySelector('.card-field');
        let s = f.selectionStart ?? f.value.length, e = f.selectionEnd ?? s;
        const v = f.value;
        if (s === e) { // grow to the word around the cursor
          while (s > 0 && /[^\s{}]/.test(v[s - 1])) s--;
          while (e < v.length && /[^\s{}]/.test(v[e])) e++;
        }
        while (s < e && /\s/.test(v[s])) s++;
        while (e > s && /[\s.,;:!?]/.test(v[e - 1])) e--;
        if (s === e) { toast('Select the words to hide first'); f.focus(); return; }
        f.value = v.slice(0, s) + '{' + v.slice(s, e) + '}' + v.slice(e);
        cards[li.dataset.i].q = f.value;
        growField(f);
        sync();
        f.focus();
        f.setSelectionRange(e + 2, e + 2);
      };
      cardList.addEventListener('input', (e) => {
        const f = e.target.closest('.card-field');
        if (!f) return;
        if (f.value.includes('\n')) f.value = f.value.replace(/\s*\n\s*/g, ' '); // pasted line breaks
        cards[f.closest('[data-i]').dataset.i][f.dataset.k] = f.value;
        growField(f);
        sync();
      });
      cardList.addEventListener('keydown', (e) => {
        const f = e.target.closest('.card-field');
        if (!f || e.key !== 'Enter') return;
        e.preventDefault();
        const i = Number(f.closest('[data-i]').dataset.i);
        if (f.dataset.k === 'q') cardList.querySelector(`[data-i="${i}"] [data-k="a"]`).focus();
        else if (i === cards.length - 1) { if (cards[i].q.trim() || cards[i].a.trim()) addCard(cards[i].type); }
        else cardList.querySelector(`[data-i="${i + 1}"] [data-k="q"]`).focus();
      });
      cardList.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-blank]')) e.preventDefault(); }); // keep the selection
      cardList.addEventListener('click', (e) => {
        const bl = e.target.closest('[data-blank]');
        if (bl) { makeBlank(bl.closest('[data-i]')); return; }
        const rm = e.target.closest('[data-rm]');
        if (!rm) return;
        cards.splice(Number(rm.closest('[data-i]').dataset.i), 1);
        drawCards();
        sync();
      });
      body.querySelector('[data-add-card]').addEventListener('click', () => addCard());
      body.querySelector('[data-add-cloze]').addEventListener('click', () => addCard('cloze'));

      drawCards();
      requestAnimationFrame(grow);
      sync();
      if (isNew) setTimeout(() => ta.focus(), 60);
    },
  });
}

/** A sheet for choosing a task to link. Open tasks first; search finds done ones too. */
function pickTask(onPick) {
  openSheet({
    title: 'Link a task',
    full: true,
    build(body, close) {
      body.innerHTML = `
        <input class="input" type="search" placeholder="Search tasks" aria-label="Search tasks" autocomplete="off" enterkeyhint="search">
        <ul class="rows pick-tasks" style="margin-top:12px"></ul>`;
      const input = body.querySelector('input');
      const ul = body.querySelector('ul');
      const draw = () => {
        const q = input.value.trim().toLowerCase();
        const tasks = state.tasks
          .filter((t) => (q ? t.title.toLowerCase().includes(q) : !t.completed))
          .sort((a, b) => a.completed - b.completed || (a.deadline || '9999').localeCompare(b.deadline || '9999'))
          .slice(0, 60);
        ul.innerHTML = '';
        if (!tasks.length) { ul.append(h(`<li class="empty">${q ? 'No tasks match.' : 'No open tasks. Search to find done ones.'}</li>`)); return; }
        for (const t of tasks) {
          const row = h(`<li class="row${t.completed ? ' done' : ''}"><div class="row-inner"><button class="row-body" type="button">
            <span class="title">${esc(t.title)}</span>
            <span class="sub">${t.completed ? '<span>Done</span>' : t.deadline ? `<span>${t.dateMode === 'on' ? 'On' : 'Due'} ${esc(shortDate(t.deadline))}</span>` : '<span>No date</span>'}</span>
          </button></div></li>`);
          row.querySelector('button').addEventListener('click', () => { close(); onPick(t); });
          ul.append(row);
        }
      };
      input.addEventListener('input', draw);
      draw();
    },
  });
}
