const DB_NAME = "auto-audio-subtitles";
const STORE_NAME = "file-handles";
const OUTPUT_KEY = "output-directory";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function getSavedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await transact("readonly", (store) => store.get(OUTPUT_KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function saveDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await transact("readwrite", (store) => store.put(handle, OUTPUT_KEY));
}

export async function ensureDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  requestIfNeeded: boolean,
): Promise<boolean> {
  const descriptor = { mode: "readwrite" as const };
  if ((await handle.queryPermission(descriptor)) === "granted") return true;
  if (!requestIfNeeded) return false;
  return (await handle.requestPermission(descriptor)) === "granted";
}
