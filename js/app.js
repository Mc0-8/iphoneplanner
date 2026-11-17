// Entry point: tab bar, screen switching, add button.

import { icon } from './icons.js';
import * as store from './store.js';
import { requestPersistence } from './db.js';
import { applyTheme } from './theme.js';
import { openTaskEditor } from './task-ui.js';
import * as today from './screens/today.js';
import * as tasks from './screens/tasks.js';
import * as week from './screens/week.js';
import * as study from './screens/study.js';
import * as notes from './screens/notes.js';
import { closeDayView } from './screens/day-view.js';

const TABS = [
  { id: 'today', label: 'Today', icon: 'today', screen: today },
  { id: 'week', label: 'Week', icon: 'week', screen: week },
  { id: 'study', label: 'Study', icon: 'study', screen: study },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', screen: tasks },
  { id: 'notes', label: 'Notes', icon: 'notes', screen: notes },
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
  if (tab.screen.onAdd) tab.screen.onAdd();
  else openTaskEditor(null, tab.screen.addDefaults ? tab.screen.addDefaults() : {});
});

window.addEventListener('focuschange', () => render());

// If the app stays open past midnight, plan the new day.
import { todayKey } from './dates.js';
let planDay = todayKey();
function checkDay() {
  if (todayKey() !== planDay) { planDay = todayKey(); store.replan(); return true; }
  return false;
}
setInterval(checkDay, 60000);
window.addEventListener('hashchange', () => { closeDayView(true); window.scrollTo(0, 0); if (!checkDay()) render(); });

// Re-plan when the app comes back to the front (time has moved on, maybe a new day).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') store.replan();
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
