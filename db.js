const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Chemin de la base configurable (les tests utilisent une base temporaire isolée).
const DB_FILE = process.env.DB_PATH || path.join(DATA_DIR, 'worktime.db');
const db = new Database(DB_FILE);

// WAL améliore la concurrence lecture/écriture ; les clés étrangères ne sont
// pas actives par défaut dans SQLite, on les active explicitement.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY,
    username         TEXT NOT NULL UNIQUE,
    email            TEXT UNIQUE,
    password         TEXT NOT NULL,
    role             TEXT NOT NULL DEFAULT 'user',
    active           INTEGER NOT NULL DEFAULT 1,
    activation_token TEXT,
    reset_token      TEXT,
    reset_expires    INTEGER,
    created_at       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS companies (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS time_entries (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
    hours       REAL NOT NULL,
    description TEXT,
    date        TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entries_user ON time_entries(user_id);

  -- Planning (le prévu) : créneaux planifiés par l'utilisateur, par société.
  CREATE TABLE IF NOT EXISTS plannings (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
    date        TEXT NOT NULL,          -- YYYY-MM-DD
    start_time  TEXT NOT NULL,          -- HH:MM
    end_time    TEXT NOT NULL,          -- HH:MM
    note        TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_plannings_user_date ON plannings(user_id, date);

  -- Pointage (le réel) : segments horodatés arrivée -> départ.
  CREATE TABLE IF NOT EXISTS pointages (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
    clock_in    TEXT NOT NULL,          -- ISO datetime
    clock_out   TEXT,                   -- ISO datetime (NULL = pointage en cours)
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pointages_user ON pointages(user_id, clock_in);
`);

// Ajout rétro-compatible de companies.created_by (bases déjà existantes).
const hasCreatedBy = db.prepare("PRAGMA table_info(companies)").all()
  .some((c) => c.name === 'created_by');
if (!hasCreatedBy) {
  db.exec("ALTER TABLE companies ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL");
}

// --- Migration ponctuelle depuis l'ancien stockage JSON ---------------------
// Si des fichiers *.json existent et que la table users est vide, on importe
// une seule fois puis on renomme les fichiers en .migrated pour ne pas rejouer.
function migrateFromJSON() {
  const usersFile = path.join(DATA_DIR, 'users.json');
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0 || !fs.existsSync(usersFile)) return;

  const read = (f) => {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); }
    catch { return []; }
  };
  const users = read('users.json');
  const companies = read('companies.json');
  const entries = read('time_entries.json');
  if (!users.length && !companies.length && !entries.length) return;

  const now = new Date().toISOString();
  const insUser = db.prepare(`INSERT OR IGNORE INTO users
    (id, username, email, password, role, active, created_at)
    VALUES (@id, @username, @email, @password, @role, 1, @created_at)`);
  const insCompany = db.prepare(`INSERT OR IGNORE INTO companies
    (id, name, created_at) VALUES (@id, @name, @created_at)`);
  const insEntry = db.prepare(`INSERT OR IGNORE INTO time_entries
    (id, user_id, company_id, hours, description, date)
    VALUES (@id, @user_id, @company_id, @hours, @description, @date)`);

  const run = db.transaction(() => {
    for (const u of users) insUser.run({
      id: u.id || crypto.randomUUID(), username: u.username,
      email: u.email || null, password: u.password,
      role: u.role || 'user', created_at: now,
    });
    for (const c of companies) insCompany.run({
      id: c.id || crypto.randomUUID(), name: c.name, created_at: now,
    });
    for (const e of entries) insEntry.run({
      id: e.id || crypto.randomUUID(), user_id: e.userId,
      company_id: e.companyId || null, hours: e.hours,
      description: e.description || '', date: e.date || now,
    });
  });
  run();

  // On archive les anciens fichiers pour éviter toute réimportation.
  for (const f of ['users.json', 'companies.json', 'time_entries.json']) {
    const p = path.join(DATA_DIR, f);
    if (fs.existsSync(p)) fs.renameSync(p, p + '.migrated');
  }
  console.log(`Migration JSON -> SQLite : ${users.length} users, ${companies.length} entreprises, ${entries.length} entrées.`);
}

migrateFromJSON();

module.exports = db;
