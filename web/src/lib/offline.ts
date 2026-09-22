// Reports made without a connection are saved on the device and sent automatically once back online.
// Photos are stored as Blobs in IndexedDB, which (unlike localStorage) can hold binary data.

export interface QueuedReport {
  id: string;
  createdAt: number;
  fields: Record<string, unknown>;
  photos: Blob[];
  video?: Blob | null;
  tracking: boolean;
}

const DB = 'civicpulse';
const STORE = 'outbox';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const queueReport = (r: QueuedReport) => tx('readwrite', (s) => s.put(r));
export const queuedReports = () => tx<QueuedReport[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedReport[]>);
export const removeQueued = (id: string) => tx('readwrite', (s) => s.delete(id));

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
