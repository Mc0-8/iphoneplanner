import { icon } from '../icons.js';
import { esc, openSheet, toast, confirmSheet } from '../ui.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { applyTheme } from '../theme.js';
import { todayKey, formatMinutes, shortDate } from '../dates.js';
import { openAvailability, openCommitments, openDaysOff, WEEK } from './schedule.js';
import { badgeSupported, enableBadge, updateBadge } from '../badge.js';

export const VERSION = '0.10.0';

export function openSettings() {
  openSheet({
    title: 'Settings',
    full: true,
    build(body) {
      const theme = state.settings.theme;
      body.innerHTML = `
        <section class="group">
          <h3>Appearance</h3>
          <div class="setting">
            <span>Theme</span>
            <div class="segmented" data-seg="theme">
              ${[['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']].map(([v, l]) =>
                `<button type="button" data-v="${v}" aria-pressed="${theme === v}">${l}</button>`).join('')}
            </div>
          </div>
        </section>

        <section class="group">
          <h3>Schedule</h3>
          <button class="setting" data-open="availability">
            <span>Available hours<span class="hint" data-hint="availability"></span></span>${icon('caretRight', 16)}
          </button>
          <label class="setting" for="daily-cap">
            <span>Daily limit<span class="hint">Most planned work in one day</span></span>
            <select id="daily-cap" class="select num" style="width:auto">
              ${[60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480].map((m) => `<option value="${m}" ${state.settings.dailyCap === m ? 'selected' : ''}>${formatMinutes(m)}</option>`).join('')}
            </select>
          </label>
          <button class="setting" data-open="commitments">
            <span>Fixed commitments<span class="hint" data-hint="commitments"></span></span>${icon('caretRight', 16)}
          </button>
          <button class="setting" data-open="daysoff">
            <span>Days off<span class="hint" data-hint="daysoff"></span></span>${icon('caretRight', 16)}
          </button>
          <label class="setting" for="cutoff">
            <span>Hard subjects before<span class="hint">Hard subjects are planned earlier in the day</span></span>
            <input id="cutoff" class="input num" type="time" step="900" value="${state.settings.hardCutoff}" style="width:auto">
          </label>
        </section>

        <section class="group">
          <h3>Study and tasks</h3>
          <label class="setting" for="session-length">
            <span>Study session length<span class="hint">With a ${state.settings.breakMinutes}-minute break between blocks</span></span>
            <select id="session-length" class="select num" style="width:auto">
              ${[30, 45, 60, 75, 90].map((m) => `<option value="${m}" ${state.settings.sessionLength === m ? 'selected' : ''}>${formatMinutes(m)}</option>`).join('')}
            </select>
          </label>
          <label class="setting" for="day-before">
            <span>Finish tasks the day before they're due<span class="hint">For homework you hand in on the due day. The due day is used only if there's no room before.</span></span>
            <input id="day-before" type="checkbox" class="switch" ${state.settings.finishDayBefore !== false ? 'checked' : ''}>
          </label>
          <label class="setting" for="pomodoro">
            <span>Pomodoro in focus mode<span class="hint">25 minutes of work, then a 5-minute break</span></span>
            <input id="pomodoro" type="checkbox" class="switch" ${state.settings.pomodoro ? 'checked' : ''}>
          </label>
          <label class="setting" for="badge">
            <span>Number on the app icon<span class="hint">${badgeSupported() ? 'Overdue tasks and reviews due. Asks to allow notifications, which iPhone needs for this.' : 'Needs iOS 16.4 or later, with the app added to your Home Screen.'}</span></span>
            <input id="badge" type="checkbox" class="switch" ${state.settings.badge ? 'checked' : ''} ${badgeSupported() ? '' : 'disabled'}>
          </label>
          <label class="setting" for="default-duration">
            <span>Default time for a task</span>
            <select id="default-duration" class="select num" style="width:auto">
              ${[15, 30, 45, 60, 90].map((m) => `<option value="${m}" ${state.settings.defaultDuration === m ? 'selected' : ''}>${formatMinutes(m)}</option>`).join('')}
            </select>
          </label>
        </section>

        <section class="group">
          <h3>Data</h3>
          <button class="setting" data-backup>
            <span>Back up<span class="hint">Save all your data as one file, e.g. to iCloud Drive</span></span>${icon('download', 22)}
          </button>
          <button class="setting" data-restore>
            <span>Restore<span class="hint">Replace everything with a backup file</span></span>${icon('upload', 22)}
          </button>
          <label class="setting" for="backup-every">
            <span>Backup reminder<span class="hint" data-hint="backup"></span></span>
            <select id="backup-every" class="select" style="width:auto">
              ${[[0, 'Off'], [7, 'Weekly'], [14, 'Every 2 weeks'], [30, 'Monthly']].map(([v, l]) => `<option value="${v}" ${(state.settings.backupEvery || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <input type="file" accept="application/json,.json" hidden data-file>
          <p class="fineprint">Your data is stored only on this phone. Back up now and then, so nothing is lost if Safari's data is cleared or you change phones.</p>
        </section>

        <section class="group">
          <h3>App</h3>
          <button class="setting" data-update>
            <span>Check for updates<span class="hint num">You have version ${esc(VERSION)}</span></span>${icon('download', 22)}
          </button>
        </section>`;

      body.querySelectorAll('[data-seg="theme"] button').forEach((b) => b.addEventListener('click', async () => {
        body.querySelectorAll('[data-seg="theme"] button').forEach((x) => x.setAttribute('aria-pressed', x === b));
        await store.updateSettings({ theme: b.dataset.v });
        applyTheme(b.dataset.v);
      }));

      body.querySelector('#default-duration').addEventListener('change', (e) =>
        store.updateSettings({ defaultDuration: Number(e.target.value) }));

      body.querySelector('#daily-cap').addEventListener('change', (e) => store.updateSettings({ dailyCap: Number(e.target.value) }));
      body.querySelector('#day-before').addEventListener('change', (e) => store.updateSettings({ finishDayBefore: e.target.checked }));
      body.querySelector('#pomodoro').addEventListener('change', (e) => store.updateSettings({ pomodoro: e.target.checked }));
      body.querySelector('#badge').addEventListener('change', async (e) => {
        if (e.target.checked) {
          const r = await enableBadge();
          if (r !== 'ok') {
            e.target.checked = false;
            toast(r === 'denied' ? 'Notifications are off for this app. Turn them on in iPhone Settings, then try again.' : 'Your iPhone doesn\'t support this yet.');
            return;
          }
        }
        await store.updateSettings({ badge: e.target.checked });
        updateBadge();
      });
      body.querySelector('#backup-every').addEventListener('change', (e) => store.updateSettings({ backupEvery: Number(e.target.value), backupSnoozedUntil: null }));
      body.querySelector('#session-length').addEventListener('change', (e) => store.updateSettings({ sessionLength: Number(e.target.value) }));
      body.querySelector('#cutoff').addEventListener('change', (e) => { if (e.target.value) store.updateSettings({ hardCutoff: e.target.value }); });
      const opens = { availability: openAvailability, commitments: openCommitments, daysoff: openDaysOff };
      body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => opens[b.dataset.open]()));
      const hints = () => {
        const on = WEEK.filter(([wd]) => state.settings.availability[wd].on);
        const wk = state.settings.availability[1], we = state.settings.availability[6];
        body.querySelector('[data-hint="availability"]').textContent = `${on.length} days · weekdays ${wk.on ? `${wk.start}–${wk.end}` : 'off'}, Sat ${we.on ? `${we.start}–${we.end}` : 'off'}`;
        const active = state.commitments.filter((c) => !c.date || c.date >= todayKey());
        const n = active.length;
        body.querySelector('[data-hint="commitments"]').textContent = n ? `${n} set: ${[...new Set(active.map((c) => c.name))].slice(0, 3).join(', ')}` : 'School, sport, work shifts…';
        const off = state.daysOff.filter((d) => d.weekday !== null && d.weekday !== undefined).length + state.daysOff.filter((d) => (d.date && d.date >= todayKey()) || (d.to && d.to >= todayKey())).length;
        body.querySelector('[data-hint="daysoff"]').textContent = off ? `${off} set` : 'Holidays, sick days, a rest day';
        const last = state.settings.lastBackup;
        body.querySelector('[data-hint="backup"]').textContent = last ? `Last backup: ${shortDate(last)}` : 'You haven\'t backed up yet';
      };
      hints();
      const unsub = store.subscribe(hints);
      new MutationObserver((_, obs) => { if (!document.body.contains(body)) { unsub(); obs.disconnect(); } }).observe(document.getElementById('sheet-layer'), { childList: true });

      body.querySelector('[data-update]').addEventListener('click', async () => {
        toast('Checking for updates…');
        const { checkForUpdates } = await import('../app.js');
        const r = await checkForUpdates();
        if (r === 'latest') toast(`You have the latest version (${VERSION})`);
        if (r === 'offline') toast("Couldn't check. Are you online?");
      });

      body.querySelector('[data-backup]').addEventListener('click', backup);

      const file = body.querySelector('[data-file]');
      body.querySelector('[data-restore]').addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files[0];
        file.value = '';
        if (!f) return;
        let checked;
        try {
          checked = store.validateBackup(JSON.parse(await f.text()));
        } catch (err) {
          toast(err instanceof store.BackupError ? err.message : 'That file could not be read. Is it a Planner backup?');
          return;
        }
        const when = checked.exportedAt ? ` from ${checked.exportedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
        const ok = await confirmSheet({
          title: 'Restore backup?',
          message: `The backup${when} has ${checked.summary}. Everything now in the app is replaced by it, and that can't be undone. If you're not sure, back up first.`,
          confirm: 'Restore',
        });
        if (!ok) return;
        try {
          await store.importData({ app: 'planner', format: store.BACKUP_FORMAT, data: checked.data });
          applyTheme(state.settings.theme);
          toast('Backup restored');
        } catch (err) {
          toast(err instanceof store.BackupError ? err.message : 'Restoring failed. Your data may not have changed; check before trying again.');
        }
      });
    },
  });
}

/** Save all data as a file (share sheet on iPhone, download elsewhere). Resolves true if it was saved. */
export async function backup() {
  const name = `planner-backup-${todayKey()}.json`;
  const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Planner backup' });
      await store.markBackedUp();
      toast('Backup saved');
      return true;
    }
  } catch (err) {
    if (err.name === 'AbortError') return false;
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await store.markBackedUp();
  toast('Backup saved');
  return true;
}
