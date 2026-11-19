// Entry point: tab bar, screen switching, add button.

import { icon } from './icons.js';
import { toast } from './ui.js';
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

/* ---------- Updates ---------- */

let reloading = false;
function setupUpdates() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => {
      if (!navigator.serviceWorker.controller) return; // first install: nothing to replace
      toast('A new version is ready', { action: () => worker.postMessage('activate-update'), actionLabel: 'Update', sticky: true });
    };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    // Look for a new version whenever the app comes back to the front.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}

/** Used by Settings → Check for updates. Resolves to 'updating', 'latest' or 'offline'. */
export async function checkForUpdates() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) { location.reload(); return 'updating'; }
  try { await reg.update(); } catch { return 'offline'; }
  if (!reg.waiting && !reg.installing) return 'latest';
  // Wait (up to 20 s) for the new version to finish downloading, then switch to it.
  for (let i = 0; i < 80 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 250));
  if (!reg.waiting) return 'offline';
  reg.waiting.postMessage('activate-update');
  return 'updating';
}

async function start() {
  await store.load();
  applyTheme(store.state.settings.theme);
  store.subscribe(render);
  render();
  requestPersistence();
  import('./badge.js').then((m) => { store.subscribe(m.updateBadge); m.updateBadge(); });

  setupUpdates();
}

start().catch((err) => {
  screenEl.innerHTML = `<p class="empty">Something went wrong while loading your data: ${String(err.message || err)}</p>`;
});
