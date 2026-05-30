import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

export interface Database {
  db: any; // SQL.Database
  save(): void;
  close(): void;
}

export async function initDatabase(dbPath: string): Promise<Database> {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const SQL = await initSqlJs();
  let db: any;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL-like behavior - sql.js runs in memory, we export on save
  db.run('PRAGMA journal_mode=OFF');

  db.run(`CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    display_name TEXT,
    token_hash TEXT NOT NULL,
    status TEXT DEFAULT 'offline',
    mode TEXT DEFAULT 'poll',
    last_heartbeat TEXT,
    connected_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    sender_type TEXT DEFAULT 'agent',
    to_agent TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at TEXT NOT NULL,
    delivered_at TEXT,
    read_at TEXT,
    ref_id TEXT,
    session_id TEXT,
    file_id TEXT,
    file_name TEXT,
    file_size INTEGER,
    caption TEXT
  )`);

  db.run('CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent, sent_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)');

  // Save initial state
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));

  const database: Database = {
    db,
    save() {
      const d = db.export();
      fs.writeFileSync(dbPath, Buffer.from(d));
    },
    close() {
      this.save();
      db.close();
    },
  };

  return database;
}
