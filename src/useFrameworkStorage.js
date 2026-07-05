import { useState, useEffect, useCallback } from 'react';

const DB_NAME = 'qafg-storage';
const STORE = 'frameworks';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export function useFrameworkStorage() {
  const [saved, setSaved] = useState([]);

  const refresh = useCallback(async () => {
    const db = await openDb();
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    all.sort((a, b) => b.createdAt - a.createdAt);
    setSaved(all);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (framework, config) => {
    const domain = (() => {
      try { return new URL(config.targetUrl).hostname.replace(/^www\./, ''); } catch { return config.targetUrl; }
    })();
    const entry = {
      id: `fw-${Date.now()}`,
      name: `${config.language}-${config.framework}-${domain}`,
      language: config.language,
      framework: config.framework,
      targetUrl: config.targetUrl,
      files: framework.files,
      fileCount: framework.files.length,
      createdAt: Date.now(),
    };
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(entry);
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
    await refresh();
    return entry;
  }, [refresh]);

  const remove = useCallback(async (id) => {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
    await refresh();
  }, [refresh]);

  return { saved, save, remove };
}
