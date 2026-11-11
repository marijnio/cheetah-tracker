/**
 * File System Access API Utilities
 * 
 * Provides native direct file opening, saving, and handle persistence
 * for supported browsers (Chrome, Edge, Brave, Opera, Arc) with graceful
 * fallback handling.
 */

const DB_NAME = "cheetah_portfolio_fsa";
const DB_VERSION = 1;
const STORE_NAME = "file_handles";
const KEY = "active_portfolio_handle";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if the browser supports the File System Access API
 */
export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "showOpenFilePicker" in window &&
    "showSaveFilePicker" in window
  );
}

/**
 * Prompt user to select an XML portfolio file and read its contents.
 */
export async function openPortfolioWithPicker(): Promise<{
  handle: FileSystemFileHandle;
  file: File;
  text: string;
} | null> {
  if (!isFileSystemAccessSupported()) return null;

  try {
    const pickerFn = (window as unknown as { showOpenFilePicker: (options?: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
    const [handle] = await pickerFn({
      types: [
        {
          description: "XML Portfolio File",
          accept: {
            "application/xml": [".xml"],
            "text/xml": [".xml"],
          },
        },
      ],
      multiple: false,
    });

    if (!handle) return null;

    const file = await handle.getFile();
    const text = await file.text();

    await setStoredFileHandle(handle);

    return { handle, file, text };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "name" in err && err.name === "AbortError") {
      return null;
    }
    throw err;
  }
}

/**
 * Save XML portfolio directly back to the active file handle, or prompt for a new file.
 */
export async function savePortfolioToFile(
  xmlContent: string,
  activeHandle: FileSystemFileHandle | null,
  suggestedName: string,
  forceSaveAs = false
): Promise<{ handle: FileSystemFileHandle; fileName: string } | null> {
  if (!isFileSystemAccessSupported()) return null;

  let handle = activeHandle;

  if (!handle || forceSaveAs) {
    try {
      const savePickerFn = (window as unknown as { showSaveFilePicker: (options?: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
      handle = await savePickerFn({
        suggestedName: suggestedName || "cheetah-portfolio.xml",
        types: [
          {
            description: "XML Portfolio File",
            accept: {
              "application/xml": [".xml"],
              "text/xml": [".xml"],
            },
          },
        ],
      });
    } catch (err: unknown) {
      if (err && typeof err === "object" && "name" in err && err.name === "AbortError") {
        return null;
      }
      throw err;
    }
  }

  if (!handle) return null;

  // Request write permission if not already granted
  const handleWithPerms = handle as unknown as {
    queryPermission?: (descriptor: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: string }) => Promise<PermissionState>;
    createWritable: () => Promise<FileSystemWritableFileStream>;
  };

  if (handleWithPerms.requestPermission) {
    const query = handleWithPerms.queryPermission
      ? await handleWithPerms.queryPermission({ mode: "readwrite" })
      : "prompt";

    if (query !== "granted") {
      const req = await handleWithPerms.requestPermission({ mode: "readwrite" });
      if (req !== "granted") {
        throw new Error("Permission to save to the file was not granted.");
      }
    }
  }

  const writable = await handleWithPerms.createWritable();
  await writable.write(xmlContent);
  await writable.close();

  await setStoredFileHandle(handle);

  return {
    handle,
    fileName: handle.name,
  };
}

/**
 * Retrieve cached FileSystemFileHandle from IndexedDB if available and permitted.
 */
export async function getStoredFileHandle(): Promise<FileSystemFileHandle | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return null;

  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY);

      req.onsuccess = async () => {
        const handle = req.result as FileSystemFileHandle | undefined;
        if (!handle) {
          resolve(null);
          return;
        }

        const handleWithPerms = handle as unknown as {
          queryPermission?: (descriptor: { mode: string }) => Promise<PermissionState>;
        };

        if (handleWithPerms.queryPermission) {
          try {
            const perm = await handleWithPerms.queryPermission({ mode: "readwrite" });
            if (perm === "granted") {
              resolve(handle);
              return;
            }
          } catch {
            // Permission query failed or denied
          }
        }
        resolve(handle);
      };

      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Save a FileSystemFileHandle to IndexedDB for session restoration.
 */
export async function setStoredFileHandle(handle: FileSystemFileHandle): Promise<void> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;

  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(handle, KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore persistence failures
  }
}

/**
 * Clear the stored FileSystemFileHandle from IndexedDB.
 */
export async function clearStoredFileHandle(): Promise<void> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;

  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore persistence failures
  }
}

