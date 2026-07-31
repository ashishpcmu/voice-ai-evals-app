/**
 * A synchronous-style SQLite wrapper using sql.js
 * Provides an API compatible with better-sqlite3
 */

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';

let sqlJs: SqlJsStatic | null = null;
let db: Database | null = null;
let dbPath: string | null = null;

const SAVE_DEBOUNCE_MS = 500;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (db && dbPath) {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    }
  }, SAVE_DEBOUNCE_MS);
}

export async function initDatabase(filePath: string): Promise<void> {
  dbPath = filePath;

  const wasmPath = path.join(
    path.dirname(require.resolve('sql.js')),
    'sql-wasm.wasm'
  );

  sqlJs = await initSqlJs({
    locateFile: () => wasmPath
  });

  if (fs.existsSync(filePath)) {
    const fileBuffer = fs.readFileSync(filePath);
    db = new sqlJs.Database(fileBuffer);
  } else {
    db = new sqlJs.Database();
  }

  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');
}

function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export interface Statement {
  run: (...params: unknown[]) => { changes: number; lastInsertRowid: number };
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
}

export const sqlite = {
  exec(sql: string) {
    getDb().run(sql);
    scheduleSave();
  },

  prepare(sql: string): Statement {
    const database = getDb();

    return {
      run(...params: unknown[]) {
        database.run(sql, params as any[]);
        scheduleSave();
        return { changes: 1, lastInsertRowid: 0 };
      },
      get(...params: unknown[]) {
        const stmt = database.prepare(sql);
        stmt.bind(params as any[]);
        if (stmt.step()) {
          const result = stmt.getAsObject() as Record<string, unknown>;
          stmt.free();
          return result;
        }
        stmt.free();
        return undefined;
      },
      all(...params: unknown[]) {
        const results: Record<string, unknown>[] = [];
        const stmt = database.prepare(sql);
        stmt.bind(params as any[]);
        while (stmt.step()) {
          results.push(stmt.getAsObject() as Record<string, unknown>);
        }
        stmt.free();
        return results;
      }
    };
  }
};

export default sqlite;
