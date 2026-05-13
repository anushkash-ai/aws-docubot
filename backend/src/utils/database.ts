import Database from "better-sqlite3";
import path from "path";

/**
 * DATABASE UTILITY — SQLite
 *
 * File-based database. No server, no password, zero setup.
 * Stored at: backend/data/chatbot.db
 *
 * Table: sessions
 *   session_id  — unique ID per chat session
 *   title       — first user message (used as chat title in sidebar)
 *   messages    — full conversation history as JSON
 *   model       — which LLM was used (gemini / claude)
 *   created_at  — when the session started
 *   updated_at  — last message time
 */

const dbPath = path.join(__dirname, "..", "..", "data", "chatbot.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

// ── Initialize table ─────────────────────────────────────────────────
export function initDatabase(): void {
  // Create table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id  TEXT     PRIMARY KEY,
      title       TEXT     NOT NULL DEFAULT 'New Chat',
      messages    TEXT     NOT NULL DEFAULT '[]',
      model       TEXT     NOT NULL DEFAULT 'gemini',
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add title column if it doesn't exist (for old databases)
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as any[];
  const hasTitle = columns.some((c: any) => c.name === "title");
  if (!hasTitle) {
    db.exec(`ALTER TABLE sessions ADD COLUMN title TEXT NOT NULL DEFAULT 'New Chat'`);
    console.log("🔄 Migrated: added title column to sessions table");
  }

  console.log("✅ SQLite database ready — sessions table initialized");
}

// ── Get all sessions (for sidebar list) ─────────────────────────────
export function getAllSessions(): any[] {
  return db.prepare(`
    SELECT session_id, title, model, created_at, updated_at
    FROM sessions
    ORDER BY updated_at DESC
  `).all();
}

// ── Get one session's messages ────────────────────────────────────────
export function getSession(sessionId: string): any[] {
  const row = db.prepare(
    "SELECT messages FROM sessions WHERE session_id = ?"
  ).get(sessionId) as any;
  if (!row) return [];
  return JSON.parse(row.messages);
}

// ── Save / update a session ──────────────────────────────────────────
export function saveSession(
  sessionId: string,
  title: string | undefined,
  messages: any[],
  model: string
): void {
  const messagesJson = JSON.stringify(messages);

  if (title !== undefined) {
    // New session — insert with title
    db.prepare(`
      INSERT INTO sessions (session_id, title, messages, model, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET
        title      = excluded.title,
        messages   = excluded.messages,
        model      = excluded.model,
        updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, title, messagesJson, model);
  } else {
    // Existing session — update messages but KEEP the original title
    db.prepare(`
      INSERT INTO sessions (session_id, title, messages, model, updated_at)
      VALUES (?, 'New Chat', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET
        messages   = excluded.messages,
        model      = excluded.model,
        updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, messagesJson, model);
  }
}

// ── Delete a session ─────────────────────────────────────────────────
export function deleteSession(sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
}
