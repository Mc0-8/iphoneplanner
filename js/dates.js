// Date and duration helpers. Dates are stored as local "YYYY-MM-DD" strings.

const pad = (n) => String(n).padStart(2, '0');

export function toKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayKey = () => toKey(new Date());

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function daysBetween(fromK, toK) {
  return Math.round((fromKey(toK) - fromKey(fromK)) / 86400000);
}

/** "Today", "Tomorrow", "Yesterday", "Thu", or "3 Dec". */
export function shortDate(key) {
  const diff = daysBetween(todayKey(), key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = fromKey(key);
  if (diff > 1 && diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function longToday() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Monday of the week containing `key`. */
export function mondayOf(key) {
  const d = fromKey(key);
  const offset = (d.getDay() + 6) % 7; // Mon = 0
  d.setDate(d.getDate() - offset);
  return toKey(d);
}

export const weekday = (key) => fromKey(key).getDay(); // 0 = Sunday

/** "16:30" ⇄ 990 minutes after midnight. */
export function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}
export function fromMin(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
export function nowMin(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/** "16 – 22 Nov" or "30 Nov – 6 Dec". */
export function weekRange(mondayKey) {
  const a = fromKey(mondayKey), b = fromKey(addDays(mondayKey, 6));
  const mon = (d) => d.toLocaleDateString('en-GB', { month: 'short' });
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${mon(b)}`
    : `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)}`;
}

export function dayTitle(key) {
  const diff = daysBetween(todayKey(), key);
  const d = fromKey(key).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (diff === 0) return `Today, ${d}`;
  if (diff === 1) return `Tomorrow, ${d}`;
  return d;
}

/** 90 → "1 h 30 min", 45 → "45 min", 120 → "2 h". */
export function formatMinutes(min) {
  if (!min) return '0 min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
