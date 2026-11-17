import { icon } from '../icons.js';
import { esc, h } from '../ui.js';
import { state, sortTasks } from '../store.js';
import { taskRow } from '../task-ui.js';
import { openListManager } from './lists.js';
import { openSearch } from './search.js';
import { searchIcon } from './notes.js';

let inboxOpen = false;
let showCompleted = false;

export const addLabel = 'Add task';
export const addDefaults = () => ({});

export function render(el) {
  const open = state.tasks.filter((t) => !t.completed);
  const inbox = sortTasks(open.filter((t) => t.inbox));
  const filed = open.filter((t) => !t.inbox);
  const completed = state.tasks.filter((t) => t.completed).sort((a, b) => b.completedAt - a.completedAt).slice(0, 50);

  el.innerHTML = `
    <header class="header">
      <div>
        <h1>Tasks</h1>
        <p class="meta"><span class="num">${open.length}</span> open</p>
      </div>
      <div class="header-actions">
        <button class="icon-button" data-search aria-label="Search">${searchIcon()}</button>
        <button class="icon-button" data-lists aria-label="Manage lists">${icon('dots', 24)}</button>
      </div>
    </header>`;
  el.querySelector('[data-lists]').addEventListener('click', openListManager);
  el.querySelector('[data-search]').addEventListener('click', openSearch);

  // Inbox: collapsed, with a count
  const inboxEl = h(`
    <section class="section">
      <button class="section-head toggle" aria-expanded="${inboxOpen}">
        <h2>Inbox <span class="count num">${inbox.length}</span></h2>${icon('caretRight', 16)}
      </button>
      <ul class="rows"></ul>
    </section>`);
  inboxEl.querySelector('button').addEventListener('click', () => { inboxOpen = !inboxOpen; render(el); });
  if (inboxOpen) {
    const ul = inboxEl.querySelector('ul');
    if (inbox.length) {
      inbox.forEach((t) => ul.append(taskRow(t)));
      ul.append(h('<li><p class="fineprint">Inbox tasks aren\'t planned yet. Give one a list or a deadline and it gets a slot.</p></li>'));
    } else ul.append(h('<li><p class="empty">Inbox is empty. Tasks without a list or deadline land here.</p></li>'));
  }
  el.append(inboxEl);

  // One section per list, then tasks that have a deadline but no list
  const groups = state.lists.map((l) => ({ name: l.name, tasks: filed.filter((t) => t.listId === l.id) }));
  groups.push({ name: 'No list', tasks: filed.filter((t) => !t.listId || !state.lists.some((l) => l.id === t.listId)) });

  for (const g of groups) {
    if (!g.tasks.length) continue;
    const s = h(`
      <section class="section">
        <div class="section-head"><h2>${esc(g.name)}</h2><span class="count num">${g.tasks.length}</span></div>
        <ul class="rows"></ul>
      </section>`);
    const ul = s.querySelector('ul');
    sortTasks(g.tasks).forEach((t) => ul.append(taskRow(t, { showList: false })));
    el.append(s);
  }

  if (!open.length) el.append(h('<p class="empty">No open tasks.</p>'));

  if (completed.length) {
    const btn = h(`<button class="link-button">${showCompleted ? 'Hide completed' : `Show completed (${completed.length})`}</button>`);
    btn.addEventListener('click', () => { showCompleted = !showCompleted; render(el); });
    el.append(btn);
    if (showCompleted) {
      const ul = h('<ul class="rows"></ul>');
      completed.forEach((t) => ul.append(taskRow(t)));
      el.append(ul);
    }
  }
}
