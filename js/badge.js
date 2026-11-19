// Number on the app icon: overdue tasks + reviews due. Needs iOS 16.4+ with the app on the
// Home Screen and notifications allowed. It updates while the app is open (no server, no push).

import { state, topicsDue } from './store.js';
import { todayKey } from './dates.js';

export const badgeSupported = () => 'setAppBadge' in navigator;

export function badgeCount() {
  const today = todayKey();
  const overdue = state.tasks.filter((t) => !t.completed && t.type !== 'exam' && t.deadline && t.deadline < today).length;
  return overdue + topicsDue(today).length;
}

export async function updateBadge() {
  if (!badgeSupported()) return;
  try {
    if (!state.settings.badge) { await navigator.clearAppBadge(); return; }
    const n = badgeCount();
    if (n) await navigator.setAppBadge(n); else await navigator.clearAppBadge();
  } catch { /* not allowed: notifications are off */ }
}

/** Turning it on asks for notification permission, which iOS needs for badges. */
export async function enableBadge() {
  if (!badgeSupported()) return 'unsupported';
  if ('Notification' in window && Notification.permission !== 'granted') {
    const r = await Notification.requestPermission();
    if (r !== 'granted') return 'denied';
  }
  return 'ok';
}
