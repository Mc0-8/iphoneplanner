// Entry point: tab bar, screen switching, add button.

import { icon } from './icons.js';
import * as store from './store.js';
import { requestPersistence } from './db.js';
import { applyTheme } from './theme.js';
import { openTaskEditor } from './task-ui.js';
import * as today from './screens/today.js';
import * as tasks from './screens/tasks.js';
import { placeholder } from './screens/placeholder.js';

const TABS = [
  { id: 'today', label: 'Today', icon: 'today', screen: today },
  { id: 'week', label: 'Week', icon: 'week', screen: placeholder('Week', 'Your week view arrives with the scheduler in phase 2.') },
  { id: 'study', label: 'Study', icon: 'study', screen: placeholder('Study', 'Subjects and weekly study hours arrive in phase 2.') },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', screen: tasks },
  { id: 'notes', label: 'Notes', icon: 'notes', screen: placeholder('Notes', 'Notes and reviews arrive in phase 4.') },
];

const screenEl = document.getElementById('screen');
const tabbar = document.getElementById('tabbar');
const addBtn = document.getElementById('add');

function currentTab() {
  const id = location.hash.slice(1);
  return TABS.find((t) => t.id === id) || TABS[0];
}

function renderTabbar(active) {
  tabbar.innerHTML = TABS.map((t) => `
    <a class="tab" href="#${t.id}" ${t === active ? 'aria-current="page"' : ''}>
      ${icon(t.icon, 24)}<span>${t.label}</span>
    </a>`).join('');
}

function render() {
  const tab = currentTab();
  renderTabbar(tab);
  tab.screen.render(screenEl);
  const label = tab.screen.addLabel;
  addBtn.hidden = !label;
  if (label) addBtn.innerHTML = `${icon('plus', 20)}<span>${label}</span>`;
}

addBtn.addEventListener('click', () => {
  const tab = currentTab();
  openTaskEditor(null, tab.screen.addDefaults ? tab.screen.addDefaults() : {});
});

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

// Re-render when the day changes while the app stays open.
let lastDay = new Date().toDateString();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && new Date().toDateString() !== lastDay) {
    lastDay = new Date().toDateString();
    render();
  }
});

async function start() {
  await store.load();
  applyTheme(store.state.settings.theme);
  store.subscribe(render);
  render();
  requestPersistence();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start().catch((err) => {
  screenEl.innerHTML = `<p class="empty">Something went wrong while loading your data: ${String(err.message || err)}</p>`;
});
