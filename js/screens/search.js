// Search across notes, topics and tasks.

import { esc, h, openSheet } from '../ui.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { shortDate } from '../dates.js';
import { openTaskEditor } from '../task-ui.js';
import { plainText } from '../notes-format.js';

export function openSearch() {
  openSheet({
    title: 'Search',
    full: true,
    build(body) {
      body.innerHTML = `
        <input class="input" type="search" placeholder="Search notes and tasks" aria-label="Search" enterkeyhint="search" autocomplete="off">
        <div class="results"></div>`;
      const input = body.querySelector('input');
      const results = body.querySelector('.results');
      const run = () => {
        const q = input.value.trim().toLowerCase();
        results.innerHTML = '';
        if (q.length < 2) return;
        const topics = state.topics.filter((t) => t.name.toLowerCase().includes(q));
        const notes = state.notes.map((n) => ({ n, text: plainText(n.text) })).filter((x) => x.text.toLowerCase().includes(q));
        const tasks = state.tasks.filter((t) => t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q))
          .sort((a, b) => a.completed - b.completed);
        if (!topics.length && !notes.length && !tasks.length) { results.append(h('<p class="empty">No results.</p>')); return; }

        const section = (title, items, rowFn) => {
          if (!items.length) return;
          const s = h(`<section class="section" style="margin-top:16px"><div class="section-head"><h2>${title}</h2><span class="count num">${items.length}</span></div><ul class="rows"></ul></section>`);
          items.slice(0, 30).forEach((it) => s.querySelector('ul').append(rowFn(it)));
          results.append(s);
        };
        const mark = (text) => {
          const i = text.toLowerCase().indexOf(q);
          if (i < 0) return esc(text.slice(0, 90));
          const from = Math.max(0, i - 30);
          return (from ? '…' : '') + esc(text.slice(from, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length, i + q.length + 50));
        };
        const row = (title, sub, onClick) => {
          const r = h(`<li class="row"><div class="row-inner"><button class="row-body" type="button"><span class="title">${title}</span><span class="sub">${sub}</span></button></div></li>`);
          r.querySelector('button').addEventListener('click', onClick);
          return r;
        };

        section('Topics', topics, (t) => row(mark(t.name), esc(store.subjectById(t.subjectId)?.name || 'No subject'),
          () => import('./notes.js').then((m) => m.openTopic(t.id))));
        section('Notes', notes, ({ n, text }) => row(mark(text.replace(/\n/g, ' ')), `${esc(store.subjectById(n.subjectId)?.name || '')} ${esc(shortDate(n.date))}`,
          () => import('./notes.js').then((m) => m.openNoteEditor(n))));
        section('Tasks', tasks, (t) => row(mark(t.title), `${t.completed ? 'Done' : t.deadline ? `Due ${esc(shortDate(t.deadline))}` : 'No deadline'}`,
          () => openTaskEditor(t)));
      };
      input.addEventListener('input', run);
      setTimeout(() => input.focus(), 60);
    },
  });
}
