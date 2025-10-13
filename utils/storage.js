// utils/storage.js
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';

const locks = new Map();

export async function ensureFile(filePath, defaultContent = '[]') {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, defaultContent);
  }
}

async function withLock(filePath, fn) {
  const q = locks.get(filePath) || Promise.resolve();
  let resolve;
  const next = new Promise(res => (resolve = res));
  locks.set(filePath, q.then(async () => {
    try { return await fn(); }
    finally { resolve(); }
  }));
  return locks.get(filePath);
}

export async function readJSON(filePath, fallback = []) {
  await ensureFile(filePath, JSON.stringify(fallback, null, 2));
  const raw = await fs.readFile(filePath, 'utf-8');
  try { return JSON.parse(raw || '[]'); } catch { return fallback; }
}

export async function writeJSON(filePath, data) {
  await ensureFile(filePath, JSON.stringify(data, null, 2));
  return withLock(filePath, async () => {
    const tmp = filePath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, filePath);
  });
}
