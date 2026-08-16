'use strict';
/**
 * db.js — طبقة قاعدة البيانات (SQLite عبر node:sqlite المدمجة في Node.js)
 * لا تعتمد على أي حزمة خارجية أو خدمة مدفوعة.
 */
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.SILAH_DB_PATH || path.join(DATA_DIR, 'silah.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- كل شخص مملوك لمستخدم واحد (owner_id) لعزل البيانات بين المستخدمين
CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  father_name TEXT,
  grandfather_name TEXT,
  family_name TEXT,
  full_name TEXT,
  alt_names TEXT, -- JSON array
  gender TEXT NOT NULL CHECK (gender IN ('male','female','unknown')) DEFAULT 'unknown',
  birth_date TEXT,
  death_date TEXT,
  life_status TEXT NOT NULL CHECK (life_status IN ('alive','deceased','unknown')) DEFAULT 'unknown',
  birth_place TEXT,
  death_place TEXT,
  photo_url TEXT,
  notes TEXT,
  source TEXT,
  confidence TEXT CHECK (confidence IN ('confirmed','probable','uncertain')) DEFAULT 'confirmed',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_persons_owner ON persons(owner_id);
CREATE INDEX IF NOT EXISTS idx_persons_owner_active ON persons(owner_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_persons_full_name ON persons(owner_id, full_name);
CREATE INDEX IF NOT EXISTS idx_persons_first_name ON persons(owner_id, first_name);

-- علاقة أب/أم-ابن. كل صف يربط والدًا واحدًا بابن واحد (parent_role يحدد أب أو أم)
-- هذا يسمح بأي عدد من الأبناء من أي عدد من الأزواج، وبأب/أم مجهولين بدون أي صف.
CREATE TABLE IF NOT EXISTS parent_child (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  parent_role TEXT NOT NULL CHECK (parent_role IN ('father','mother')),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('biological','adoptive','step','unknown')) DEFAULT 'biological',
  marriage_id TEXT REFERENCES marriages(id) ON DELETE SET NULL,
  notes TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(child_id, parent_role, parent_id)
);
CREATE INDEX IF NOT EXISTS idx_pc_owner ON parent_child(owner_id);
CREATE INDEX IF NOT EXISTS idx_pc_parent ON parent_child(parent_id);
CREATE INDEX IF NOT EXISTS idx_pc_child ON parent_child(child_id);

CREATE TABLE IF NOT EXISTS marriages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spouse_a_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  spouse_b_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('married','divorced','separated','widowed','unknown')) DEFAULT 'married',
  place TEXT,
  notes TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (spouse_a_id <> spouse_b_id)
);
CREATE INDEX IF NOT EXISTS idx_marriages_owner ON marriages(owner_id);
CREATE INDEX IF NOT EXISTS idx_marriages_a ON marriages(spouse_a_id);
CREATE INDEX IF NOT EXISTS idx_marriages_b ON marriages(spouse_b_id);

CREATE TABLE IF NOT EXISTS person_aliases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  alias TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alias_owner ON person_aliases(owner_id);
CREATE INDEX IF NOT EXISTS idx_alias_text ON person_aliases(owner_id, alias);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  date TEXT,
  place TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id);
CREATE INDEX IF NOT EXISTS idx_events_person ON events(person_id);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_owner ON audit_log(owner_id, created_at);

-- جاهزة لمشاركة الأشجار العائلية مستقبلًا (Owner / Editor / Viewer) — غير مفعّلة افتراضيًا
CREATE TABLE IF NOT EXISTS family_shares (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')) DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_user_id, target_user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

db.exec(SCHEMA);

module.exports = db;
