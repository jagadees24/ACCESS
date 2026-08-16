const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

let pool = null;
let sqliteDb = null;
let usingSqlite = false;

async function tryConnectMySQL() {
  if (pool) return pool;

  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'wifi_access_demo',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    // try a quick connection
    const conn = await pool.getConnection();
    conn.release();
    usingSqlite = false;
    return pool;
  } catch (err) {
    pool = null;
    return null;
  }
}

function initSqlite() {
  if (sqliteDb) return sqliteDb;

  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'dev.sqlite');
  sqliteDb = new sqlite3.Database(file);
  usingSqlite = true;

  // initialize minimal schema if tables missing
  sqliteDb.serialize(() => {
    sqliteDb.run(`CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now'))
    )`);

    sqliteDb.run(`CREATE TABLE IF NOT EXISTS qr_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      access_type TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now')),
      expires_at DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      granted_at DATETIME NULL,
      revoked_at DATETIME NULL,
      used_at DATETIME NULL
    )`);

    sqliteDb.run(`CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      qr_code_id INTEGER NOT NULL,
      guest_identifier TEXT NOT NULL,
      action TEXT NOT NULL,
      timestamp DATETIME DEFAULT (datetime('now')),
      reason TEXT NULL
    )`);

    sqliteDb.run(`CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now'))
    )`);
  });

  return sqliteDb;
}

async function query(sql, params = []) {
  // Try MySQL first unless explicitly disabled
  const mysqlPool = await tryConnectMySQL();
  if (mysqlPool) {
    return mysqlPool.query(sql, params);
  }

  // Fallback to sqlite
  const db = initSqlite();

  return new Promise((resolve, reject) => {
    const sqlTrim = sql.trim().toUpperCase();
    if (sqlTrim.startsWith('SELECT') || sqlTrim.startsWith('PRAGMA')) {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve([rows, []]);
      });
    } else {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        // mimic mysql2 result structure: [result]
        resolve([{ affectedRows: this.changes, insertId: this.lastID }]);
      });
    }
  });
}

module.exports = {
  query,
  // exposed for diagnostics
  _usingSqlite: () => usingSqlite,
};
