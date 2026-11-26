/**
 * Minimal IndexedDB-backed job queue for the field scanner.
 * Scans and surplus captures (photos included, as Blobs) survive network loss,
 * page reloads and app switching; they are replayed in order when the device is
 * back online. Each job carries a client-generated id used as an idempotency key.
 */
export type FieldJobKind = "scan" | "surplus";

export interface FieldJob {
  id: string;
  kind: FieldJobKind;
  campaignId: string;
  payload: Record<string, unknown>;
  photo?: Blob | null;
  label: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

const DB_NAME = "immotrack-field";
const STORE = "jobs";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB indisponible"));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("campaignId", "campaignId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    let result: T | undefined;
    if (req) req.onsuccess = () => (result = req.result);
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function enqueueJob(job: FieldJob): Promise<void> {
  await withStore("readwrite", (s) => s.put(job));
}

export async function updateJob(job: FieldJob): Promise<void> {
  await withStore("readwrite", (s) => s.put(job));
}

export async function removeJob(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

export async function listJobs(campaignId: string): Promise<FieldJob[]> {
  const rows = await withStore<FieldJob[]>("readonly", (s) => s.index("campaignId").getAll(IDBKeyRange.only(campaignId)));
  return (rows ?? []).sort((a, b) => a.createdAt - b.createdAt);
}
