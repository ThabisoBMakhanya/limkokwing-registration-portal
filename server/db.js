'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Minimal .env loader (no extra dependency)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

let pool;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') || connectionString.includes('neon.tech')
      ? { rejectUnauthorized: false }
      : undefined,
    max: 10
  });
  pool.on('error', err => console.error('Unexpected PG pool error:', err.message));
  return pool;
}

/** Run a query, return all rows. */
async function all(sql, params = []) {
  const r = await getPool().query(sql, params);
  return r.rows;
}

/** Run a query, return first row or undefined. */
async function one(sql, params = []) {
  const r = await getPool().query(sql, params);
  return r.rows[0];
}

/**
 * Run a statement.
 * Returns { rows, rowCount, lastInsertRowid } — lastInsertRowid is read from
 * RETURNING id when the statement provides it.
 */
async function run(sql, params = []) {
  const r = await getPool().query(sql, params);
  return {
    rows: r.rows,
    rowCount: r.rowCount,
    lastInsertRowid: r.rows[0] && r.rows[0].id !== undefined ? Number(r.rows[0].id) : undefined
  };
}

/** Execute multiple statements (no parameters). */
async function exec(sql) {
  await getPool().query(sql);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  id_number TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','super_admin','admissions_officer','registry_officer','registrar')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certificates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS programmes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('associate','bachelors')),
  faculty TEXT DEFAULT 'School of Information Technology',
  duration_years INTEGER DEFAULT 2,
  total_semesters INTEGER NOT NULL,
  internship_semester INTEGER NOT NULL,
  credits_per_semester INTEGER NOT NULL DEFAULT 18,
  minor_credits_required INTEGER NOT NULL DEFAULT 12,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS programme_requirements (
  id SERIAL PRIMARY KEY,
  programme_id INTEGER NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
  certificate_id INTEGER NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  min_cutoff_points REAL NOT NULL,
  required_subjects TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (programme_id, certificate_id)
);

CREATE TABLE IF NOT EXISTS students (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  student_number TEXT UNIQUE,
  programme_id INTEGER REFERENCES programmes(id),
  certificate_id INTEGER REFERENCES certificates(id),
  current_semester INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'applicant' CHECK (status IN ('applicant','registered','on_hold','graduated','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_number_sequences (
  year INTEGER PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  credits INTEGER NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('core','minor','elective')),
  semester_number INTEGER NOT NULL,
  programme_id INTEGER NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (programme_id, code)
);

CREATE TABLE IF NOT EXISTS module_prerequisites (
  module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  prerequisite_module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  PRIMARY KEY (module_id, prerequisite_module_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  programme_id INTEGER NOT NULL REFERENCES programmes(id),
  certificate_id INTEGER NOT NULL REFERENCES certificates(id),
  personal_details TEXT NOT NULL DEFAULT '{}',
  contact_details TEXT NOT NULL DEFAULT '{}',
  academic_history TEXT NOT NULL DEFAULT '[]',
  documents TEXT NOT NULL DEFAULT '{}',
  registration_fee_receipt_url TEXT,
  receipt_verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (receipt_verification_status IN ('pending','approved','rejected')),
  receipt_rejection_reason TEXT,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','under_review','accepted','rejected','registered')),
  student_number TEXT,
  certificate_verified INTEGER NOT NULL DEFAULT 0,
  decision_reason TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrolments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id INTEGER NOT NULL REFERENCES modules(id),
  semester_number INTEGER NOT NULL,
  academic_term TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered','completed','failed','pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, module_id, academic_term)
);

CREATE TABLE IF NOT EXISTS grading_scale (
  id SERIAL PRIMARY KEY,
  grade TEXT NOT NULL UNIQUE,
  min_mark REAL,
  max_mark REAL,
  points REAL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS semester_results (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id INTEGER NOT NULL REFERENCES modules(id),
  academic_term TEXT NOT NULL,
  ca_mark REAL,
  exam_mark REAL,
  final_mark REAL,
  grade TEXT,
  passed INTEGER NOT NULL DEFAULT 0,
  final_exam_failed INTEGER NOT NULL DEFAULT 0,
  entered_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, module_id, academic_term)
);

CREATE TABLE IF NOT EXISTS clearance_status (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academic_term TEXT NOT NULL,
  cleared INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  cleared_by INTEGER REFERENCES users(id),
  cleared_at TIMESTAMPTZ,
  UNIQUE (student_id, academic_term)
);

CREATE TABLE IF NOT EXISTS semester_registrations (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  semester_number INTEGER NOT NULL,
  academic_term TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'academic' CHECK (type IN ('academic','internship')),
  selected_modules TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft','submitted','approved','rejected')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, academic_term)
);

CREATE TABLE IF NOT EXISTS src_receipts (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registration_id INTEGER NOT NULL REFERENCES semester_registrations(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','approved','rejected')),
  notes TEXT,
  verified_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS internship_placements (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registration_id INTEGER REFERENCES semester_registrations(id) ON DELETE SET NULL,
  organisation TEXT,
  placement_title TEXT,
  supervisor_name TEXT,
  supervisor_email TEXT,
  placement_document_url TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected','graded')),
  final_grade TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chatbot_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  response TEXT NOT NULL,
  intent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uploaded_files (
  folder TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (folder, filename)
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_results_student ON semester_results(student_id);
CREATE INDEX IF NOT EXISTS idx_enrolments_student ON enrolments(student_id);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON semester_registrations(status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
`;

async function initSchema() {
  await exec(SCHEMA);
}

const db = { all, one, run, exec, initSchema, SCHEMA };
Object.defineProperty(db, 'pool', { enumerable: true, get: getPool });
module.exports = db;
