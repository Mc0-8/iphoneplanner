// Small IndexedDB wrapper. All data stays on the device.

const DB_NAME = 'planner';
const DB_VERSION = 2;
export const STORES = ['tasks', 'lists', 'settings', 'blocks', 'subjects', 'commitments', 'daysOff'];

let dbPromise;

// If storage is unavailable (e.g. a locked-down browser), the app still runs, just without saving.
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  return dbPromise;
}

export async function available() { return !!(await open()); }

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAll(store) {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, value) {
  const db = await open();
  if (!db) return;
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function remove(store, id) {
  const db = await open();
  if (!db) return;
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  return done(tx);
}

/** Replace the contents of one store (used for the scheduler's blocks). */
export async function replaceStore(store, items) {
  const db = await open();
  if (!db) return;
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  os.clear();
  for (const item of items) os.put(item);
  return done(tx);
}

/** Replace the contents of every store in one transaction (used by restore). */
export async function replaceAll(data) {
  const db = await open();
  if (!db) throw new Error('Storage is not available in this browser.');
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) {
    const os = tx.objectStore(name);
    os.clear();
    for (const item of data[name] || []) os.put(item);
  }
  return done(tx);
}

/** Ask the browser to keep our data even when storage runs low. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch { /* not supported — fine */ }
}
