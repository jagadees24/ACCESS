require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const db = require('./src/db');
const { authenticateAdmin } = require('./src/auth');
const query = db.query;

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || 'http://localhost:5173';

const accessRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many validation attempts. Please wait a moment.' },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/access', accessRateLimiter);

function formatErrorResponse(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

async function logAccessEvent(qrCodeId, guestIdentifier, action, reason = null) {
  if (!qrCodeId) {
    return;
  }

  await query(
    'INSERT INTO access_logs (qr_code_id, guest_identifier, action, reason) VALUES (?, ?, ?, ?)',
    [qrCodeId, guestIdentifier, action, reason]
  );
}

async function updateQrCodeStatus(id, status, extraFields = []) {
  const parts = [
    'status = ?',
    ...extraFields,
  ];
  const values = [status, ...extraFields.map((field) => field.value), id];

  const sql = `UPDATE qr_codes SET ${parts.join(', ')} WHERE id = ?`;
  await query(sql, values);
}

function getPublicAppUrl(req) {
  const requestOrigin = req.get('origin');

  // When the administrator opens the app through a LAN address or deployed
  // host, encode that same reachable address into the QR code. APP_PUBLIC_URL
  // remains the safe fallback for non-browser/API clients.
  if (requestOrigin) {
    try {
      const origin = new URL(requestOrigin);
      if (origin.protocol === 'http:' || origin.protocol === 'https:') {
        return origin.origin;
      }
    } catch (_) {
      // Use the configured fallback when the Origin header is malformed.
    }
  }

  return APP_PUBLIC_URL.replace(/\/$/, '');
}

function buildGuestUrl(token, publicAppUrl = APP_PUBLIC_URL) {
  return `${publicAppUrl.replace(/\/$/, '')}/access?token=${encodeURIComponent(token)}`;
}

// SQLite returns DATETIME values as `YYYY-MM-DD HH:mm:ss` strings. Those
// values are written in UTC, so explicitly mark them as UTC before parsing;
// otherwise JavaScript treats them as local time and can expire fresh codes.
function parseDatabaseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }

  return new Date(value);
}

function serializeQrCode(record) {
  const expiresAt = parseDatabaseDate(record.expires_at);
  return {
    ...record,
    expires_at: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : record.expires_at,
  };
}

async function getQrRecordByToken(token) {
  const [rows] = await query('SELECT * FROM qr_codes WHERE token = ?', [token]);
  return rows[0] || null;
}

async function markExpiredIfNeeded(record) {
  if (!record || !record.expires_at) {
    return record;
  }

  const expiresAt = parseDatabaseDate(record.expires_at).getTime();
  if (Date.now() > expiresAt && record.status !== 'expired' && record.status !== 'revoked') {
    if (db._usingSqlite()) {
      await query('UPDATE qr_codes SET status = ? WHERE id = ?', ['expired', record.id]);
    } else {
      await query('UPDATE qr_codes SET status = ?, expired_at = NOW() WHERE id = ?', ['expired', record.id]);
    }
    await logAccessEvent(record.id, 'system', 'expired', 'Token expired by server clock');
    return { ...record, status: 'expired' };
  }

  return record;
}

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is up' });
});

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return formatErrorResponse(res, 400, 'Email and password are required');
  }

  const [rows] = await query('SELECT * FROM admins WHERE email = ?', [email]);
  const admin = rows[0];

  if (!admin) {
    return formatErrorResponse(res, 401, 'Invalid credentials');
  }

  const isValid = await bcrypt.compare(password, admin.password_hash);
  if (!isValid) {
    return formatErrorResponse(res, 401, 'Invalid credentials');
  }

  const token = jwt.sign(
    { id: admin.id, email: admin.email, name: admin.name },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    success: true,
    token,
    admin: { id: admin.id, name: admin.name, email: admin.email },
  });
});

app.get('/api/admin/me', authenticateAdmin, async (req, res) => {
  res.json({ success: true, admin: req.admin });
});

app.post('/api/admin/qr/generate', authenticateAdmin, async (req, res) => {
  const { access_type, duration_minutes } = req.body || {};
  const normalizedType = access_type === 'one_time' ? 'one_time' : 'time_based';
  const duration = Number(duration_minutes || 60);

  if (!Number.isFinite(duration) || duration <= 0) {
    return formatErrorResponse(res, 400, 'Duration must be a positive number');
  }

  const expiresAt = new Date(Date.now() + duration * 60 * 1000);
  const payload = {
    jti: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    accessType: normalizedType,
    durationMinutes: duration,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: duration * 60 });

  const [result] = await query(
    'INSERT INTO qr_codes (token, access_type, duration_minutes, created_by, expires_at, status) VALUES (?, ?, ?, ?, ?, ?) ',
    [token, normalizedType, duration, req.admin.id, expiresAt.toISOString().slice(0, 19).replace('T', ' '), 'active']
  );

  const qrUrl = buildGuestUrl(token, getPublicAppUrl(req));
  let qrImage;

  try {
    qrImage = await QRCode.toDataURL(qrUrl);
  } catch (error) {
    qrImage = null;
  }

  res.json({
    success: true,
    token,
    qrCodeUrl: qrUrl,
    qrCodeImage: qrImage,
    access_type: normalizedType,
    duration_minutes: duration,
    expires_at: expiresAt.toISOString(),
    id: result.insertId,
  });
});

app.get('/api/admin/qr', authenticateAdmin, async (req, res) => {
  const [rows] = await query('SELECT * FROM qr_codes ORDER BY created_at DESC');
  res.json({ success: true, qrCodes: rows.map(serializeQrCode) });
});

app.post('/api/admin/qr/:id/revoke', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const [rows] = await query('SELECT * FROM qr_codes WHERE id = ?', [id]);
  const record = rows[0];

  if (!record) {
    return formatErrorResponse(res, 404, 'QR record not found');
  }

  if (record.status === 'revoked' || record.status === 'expired') {
    return res.json({ success: true, message: 'Access already inactive', qrCode: record });
  }

  const revokeSql = db._usingSqlite()
    ? 'UPDATE qr_codes SET status = ? WHERE id = ? AND status IN (?, ?)'
    : 'UPDATE qr_codes SET status = ?, revoked_at = NOW() WHERE id = ? AND status IN (?, ?)';
  const revokeParams = ['revoked', id, 'active', 'used'];
  const [result] = await query(revokeSql, revokeParams);

  if (!result || result.affectedRows === 0) {
    return formatErrorResponse(res, 400, 'QR code could not be revoked');
  }

  await logAccessEvent(record.id, 'admin', 'revoked', 'Revoked by administrator');

  res.json({ success: true, message: 'QR access revoked', id });
});

app.get('/api/admin/logs', authenticateAdmin, async (req, res) => {
  const { startDate, endDate, guest, status } = req.query;
  let sql = `
    SELECT l.*, q.access_type, q.token
    FROM access_logs l
    LEFT JOIN qr_codes q ON q.id = l.qr_code_id
    WHERE 1 = 1
  `;
  const params = [];

  if (startDate) {
    sql += ' AND DATE(l.timestamp) >= DATE(?)';
    params.push(startDate);
  }

  if (endDate) {
    sql += ' AND DATE(l.timestamp) <= DATE(?)';
    params.push(endDate);
  }

  if (guest) {
    sql += ' AND l.guest_identifier LIKE ?';
    params.push(`%${guest}%`);
  }

  if (status) {
    sql += ' AND l.action = ?';
    params.push(status);
  }

  sql += ' ORDER BY l.timestamp DESC';

  const [rows] = await query(sql, params);
  res.json({ success: true, logs: rows });
});

app.get('/api/admin/dashboard', authenticateAdmin, async (req, res) => {
  const nowExpr = db._usingSqlite() ? "datetime('now')" : 'NOW()';
  const todayExpr = db._usingSqlite() ? "date('now')" : 'CURDATE()';
  const [statsRows] = await query(
    `SELECT
      SUM(CASE WHEN action = 'granted' AND DATE(timestamp) = ${todayExpr} THEN 1 ELSE 0 END) AS guests_today
     FROM access_logs l
     LEFT JOIN qr_codes q ON q.id = l.qr_code_id`
  );

  const [activeRows] = await query(
    `SELECT COUNT(*) AS active_sessions
     FROM qr_codes
     WHERE status IN ('active', 'used') AND expires_at > ${nowExpr}`
  );

  const [typeRows] = await query(
    `SELECT access_type, COUNT(*) AS count FROM qr_codes GROUP BY access_type ORDER BY count DESC LIMIT 1`
  );

  const latest = statsRows[0] || {};
  res.json({
    success: true,
    stats: {
      totalGuestsToday: Number(latest.guests_today || 0),
      currentlyActiveSessions: Number((activeRows[0] || {}).active_sessions || 0),
      mostUsedAccessType: typeRows[0] ? typeRows[0].access_type : 'time_based',
    },
  });
});

app.get('/api/access/validate', async (req, res) => {
  const token = req.query.token;
  const guestIdentifier = req.query.guest_id || `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (!token) {
    return formatErrorResponse(res, 400, 'Token is required');
  }

  let payload;

  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ success: false, valid: false, status: 'denied', reason: 'Invalid or expired token' });
  }

  const record = await getQrRecordByToken(token);

  if (!record) {
    await logAccessEvent(null, guestIdentifier, 'denied', 'Token not found in database');
    return res.status(404).json({ success: false, valid: false, status: 'denied', reason: 'Token not found' });
  }

  const expiresAt = parseDatabaseDate(record.expires_at);
  if (record.status === 'revoked') {
    await logAccessEvent(record.id, guestIdentifier, 'denied', 'Code was revoked');
    return res.status(403).json({ success: false, valid: false, status: 'denied', reason: 'This QR code was revoked' });
  }

  if (record.status === 'used' && record.access_type === 'one_time') {
    await logAccessEvent(record.id, guestIdentifier, 'denied', 'One-time code already used');
    return res.status(409).json({ success: false, valid: false, status: 'denied', reason: 'This one-time code has already been used' });
  }

  if (Date.now() > expiresAt.getTime()) {
    await query('UPDATE qr_codes SET status = ? WHERE id = ?', ['expired', record.id]);
    await logAccessEvent(record.id, guestIdentifier, 'expired', 'Token expired by server clock');
    return res.status(403).json({ success: false, valid: false, status: 'expired', reason: 'Access token has expired' });
  }

  if (record.access_type === 'one_time') {
    const updateSql = db._usingSqlite()
      ? "UPDATE qr_codes SET status = ?, used_at = datetime('now'), granted_at = datetime('now') WHERE id = ? AND status = ?"
      : 'UPDATE qr_codes SET status = ?, used_at = NOW(), granted_at = NOW() WHERE id = ? AND status = ?';
    const [result] = await query(updateSql, ['used', record.id, 'active']);

    if (result.affectedRows === 0) {
      await logAccessEvent(record.id, guestIdentifier, 'denied', 'Replay attempt blocked');
      return res.status(409).json({ success: false, valid: false, status: 'denied', reason: 'This one-time code has already been used' });
    }
  }

  await logAccessEvent(record.id, guestIdentifier, 'granted', 'Guest granted access');

  const remainingMs = Math.max(0, expiresAt.getTime() - Date.now());
  return res.json({
    success: true,
    valid: true,
    status: 'granted',
    accessType: record.access_type,
    reason: 'Access granted',
    expiresAt: expiresAt.toISOString(),
    remainingMs,
    qrCodeId: record.id,
  });
});

app.get('/api/access/status', async (req, res) => {
  const token = req.query.token;

  if (!token) {
    return formatErrorResponse(res, 400, 'Token is required');
  }

  try {
    jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ success: false, valid: false, status: 'denied', reason: 'Invalid token' });
  }

  const record = await getQrRecordByToken(token);

  if (!record) {
    return res.status(404).json({ success: false, valid: false, status: 'denied', reason: 'Token not found' });
  }

  if (record.status === 'revoked') {
    return res.status(403).json({ success: false, valid: false, status: 'revoked', reason: 'Access revoked' });
  }

  if (record.status === 'expired') {
    return res.status(403).json({ success: false, valid: false, status: 'expired', reason: 'Access expired' });
  }

  const expiresAt = parseDatabaseDate(record.expires_at).getTime();
  const remainingMs = Math.max(0, expiresAt - Date.now());

  if (remainingMs <= 0) {
    await query('UPDATE qr_codes SET status = ? WHERE id = ?', ['expired', record.id]);
    return res.status(403).json({ success: false, valid: false, status: 'expired', reason: 'Access expired' });
  }

  const isValid = record.status === 'active' || record.status === 'used';
  return res.json({
    success: true,
    valid: isValid,
    status: isValid ? 'granted' : 'denied',
    remainingMs,
    expiresAt: new Date(expiresAt).toISOString(),
    accessType: record.access_type,
  });
});

async function bootstrapDatabase() {
  try {
    // Try a lightweight check that works for either backend. If it errors,
    // the schema likely hasn't been created yet and we log a warning.
    try {
      await query('SELECT 1 FROM admins LIMIT 1');
    } catch (e) {
      console.warn('Database tables are missing or not accessible:', e.message);
    }
  } catch (error) {
    console.error('Database connection failed:', error.message);
    if (!db._usingSqlite()) {
      process.exit(1);
    } else {
      console.warn('Continuing with sqlite fallback.');
    }
  }
}

app.listen(PORT, async () => {
  await bootstrapDatabase();
  console.log(`Server running on http://localhost:${PORT}`);
});
