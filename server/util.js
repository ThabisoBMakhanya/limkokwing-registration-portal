'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const db = require('./db');

const runtimeDir = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, '..');
const UPLOAD_DIR = path.join(runtimeDir, 'uploads');
const LOG_DIR = path.join(runtimeDir, 'logs');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;   // hard limit before compression
const COMPRESS_THRESHOLD = 2 * 1024 * 1024; // images above this are compressed
const COMPRESS_TARGET = 1.5 * 1024 * 1024;  // aim below this after compression

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_EXTS = new Set([...IMAGE_EXTS, '.pdf']);

async function audit(userId, action, entity, entityId, details = {}) {
  try {
    await db.run(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [userId ?? null, action, entity ?? null, entityId != null ? String(entityId) : null, JSON.stringify(details)]
    );
  } catch (err) {
    console.error('audit log failed:', err.message);
  }
}

function nowTerm() {
  const d = new Date();
  const year = d.getFullYear();
  const sem = d.getMonth() < 6 ? 1 : 2;
  return `${year}/sem-${sem}`;
}
function nextTerm(term) {
  const [y, s] = term.split('/sem-');
  const year = parseInt(y, 10);
  const sem = parseInt(s, 10);
  return sem === 1 ? `${year}/sem-2` : `${year + 1}/sem-1`;
}

function gradeFor(mark) {
  if (mark == null) return null;
  if (mark >= 80) return 'A+';
  if (mark >= 75) return 'A';
  if (mark >= 70) return 'A-';
  if (mark >= 65) return 'B+';
  if (mark >= 60) return 'B';
  if (mark >= 55) return 'B-';
  if (mark >= 50) return 'C+';
  if (mark >= 45) return 'C';
  if (mark >= 40) return 'D';
  return 'F';
}

const PASSING_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'PX'];

function slugExt(originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  return ALLOWED_EXTS.has(ext) ? ext : '.bin';
}

/**
 * Saves an uploaded file. Images larger than 2MB are compressed with sharp.
 * Enforces the 5MB hard limit (multer already rejects beyond this).
 */
async function saveUpload(file, folder = 'documents') {
  if (!file) throw Object.assign(new Error('No file provided'), { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) throw Object.assign(new Error('File exceeds the 5MB maximum limit'), { status: 400 });
  const ext = slugExt(file.originalname);
  if (!ALLOWED_EXTS.has(ext)) throw Object.assign(new Error('Only PDF, JPG, PNG or WEBP files are allowed'), { status: 400 });

  const destDir = path.join(UPLOAD_DIR, folder);
  if (!process.env.VERCEL && !fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const base = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  let filename = base + ext;
  let outputBuffer = file.buffer;
  let contentType = file.mimetype || 'application/octet-stream';
  let compressed = false;
  const originalBytes = file.size;
  let storedBytes = file.size;

  const isImage = IMAGE_EXTS.has(ext);

  if (isImage && file.size > COMPRESS_THRESHOLD) {
    const sharp = require('sharp');
    let quality = 80;
    let buf = null;
    const meta = await sharp(file.buffer).metadata();
    const width = meta.width || 1600;
    const resizeOpts = width > 1600 ? { width: 1600, withoutEnlargement: true } : { withoutEnlargement: true };
    for (let i = 0; i < 8; i++) {
      buf = await sharp(file.buffer).rotate().resize(resizeOpts)
        .jpeg({ quality, mozjpeg: true }).toBuffer();
      if (buf.length <= COMPRESS_TARGET) break;
      quality -= 10;
      if (quality < 30) break;
    }
    filename = base + '.jpg';
    outputBuffer = buf;
    contentType = 'image/jpeg';
    compressed = true;
    storedBytes = buf.length;
  }

  filename = compressed ? base + '.jpg' : filename;
  await db.run(
    `INSERT INTO uploaded_files (folder, filename, content_type, file_data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (folder, filename) DO UPDATE SET content_type = EXCLUDED.content_type, file_data = EXCLUDED.file_data`,
    [folder, filename, contentType, outputBuffer]
  );
  // Local copies help local development; Vercel instances use Neon as durable storage.
  if (!process.env.VERCEL) fs.writeFileSync(path.join(destDir, filename), outputBuffer);

  return {
    url: `/uploads/${folder}/${filename}`,
    filename,
    compressed,
    originalBytes,
    storedBytes
  };
}

/** E-mail sender: logs to console + logs/emails.log (swap for SMTP in production). */
function sendEmail(to, subject, body) {
  const line = `[${new Date().toISOString()}] TO: ${to}\nSUBJECT: ${subject}\n${body}\n---\n`;
  if (!process.env.VERCEL) {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOG_DIR, 'emails.log'), line);
    } catch (_) {}
  }
  console.log(`\n[EMAIL] To: ${to} | ${subject}\n${body}\n`);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, full_name: u.full_name, email: u.email, phone: u.phone,
    id_number: u.id_number, role: u.role, email_verified: !!u.email_verified,
    is_active: !!u.is_active, created_at: u.created_at
  };
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

module.exports = {
  audit, nowTerm, nextTerm, gradeFor, PASSING_GRADES, saveUpload, sendEmail,
  publicUser, parseJson, UPLOAD_DIR, MAX_UPLOAD_BYTES, ALLOWED_EXTS
};
