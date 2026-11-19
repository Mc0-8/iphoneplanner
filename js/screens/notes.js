import { icon } from '../icons.js';
import { esc, h, openSheet, toast, confirmSheet } from '../ui.js';
import * as store from '../store.js';
import { state, flashcards, topicsDue } from '../store.js';
import { todayKey, shortDate } from '../dates.js';
import { openReview } from './review.js';
import { openSearch } from './search.js';

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
      <div class="tgroup">
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
              <span class="sub"><span class="num">${n.length} note${n.length === 1 ? '' : 's'}</span>${cards ? `<span class="num">${cards} card${cards === 1 ? '' : 's'}</span>` : ''}<span>${t.nextReview <= todayKey() ? '<span class="late">Review today</span>' : `Next review ${esc(shortDate(t.nextReview).replace(/^Tomorrow$/, 'tomorrow'))}`}</span></span>
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
  const first = n.text.split('\n')[0];
  const row = h(`
    <li class="row"><div class="row-inner">
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
        body.innerHTML = `
          <p class="fineprint" style="margin-top:0">${subject ? `<span class="dot" style="background:${subject.colour}"></span>${esc(subject.name)} · ` : ''}Next review ${esc(shortDate(t.nextReview).toLowerCase())}${t.lastRating ? ` · last rated ${t.lastRating === 'ok' ? 'OK' : t.lastRating}` : ''}</p>
          <button class="text-button primary with-icon" data-review>${icon('check', 18)} Review now</button>
          <ul class="rows notes-full"></ul>
          <button class="text-button primary with-icon" data-add>${icon('plus', 18)} Add note to this topic</button>
          <div class="delete-row"><button class="text-button danger with-icon" data-del>${icon('trash', 18)} Delete topic and its notes</button></div>`;
        const ul = body.querySelector('ul');
        for (const n of notes) {
          const li = h(`<li class="note-full"><button type="button"><span class="num muted">${esc(shortDate(n.date))}</span><span class="nt">${esc(n.text).replace(/\n/g, '<br>')}</span></button></li>`);
          li.querySelector('button').addEventListener('click', () => openNoteEditor(n));
          ul.append(li);
        }
        body.querySelector('[data-review]').addEventListener('click', () => { close(); openReview([t.id]); });
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

export function openNoteEditor(existing, defaults = {}) {
  const isNew = !existing;
  const topic = existing && state.topics.find((t) => t.id === existing.topicId);
  const note = isNew
    ? { id: store.uid(), date: todayKey(), text: '', subjectId: defaults.subjectId ?? state.settings.lastNoteSubject ?? null, topicName: defaults.topicName || '', topicId: null, createdAt: Date.now() }
    : { ...existing, topicName: topic?.name || '' };
  if (note.subjectId && !store.subjectById(note.subjectId)) note.subjectId = null;

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
        <textarea class="note-input" placeholder="What did you learn?&#10;&#10;Tip: write Q: question and A: answer on two lines to make a flashcard.">${esc(note.text)}</textarea>`;
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
      const sync = () => { saveBtn.disabled = !note.text.trim(); };
      ta.addEventListener('input', () => { note.text = ta.value; sync(); });
      sync();
      if (isNew) setTimeout(() => ta.focus(), 60);
    },
  });
}
