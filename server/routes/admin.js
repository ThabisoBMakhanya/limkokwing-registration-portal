'use strict';
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole, ADMIN_ROLES } = require('../auth');
const { audit, gradeFor, PASSING_GRADES, sendEmail, nowTerm, parseJson } = require('../util');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Every route in this router requires an authenticated staff role
router.use(requireAuth, requireRole(...ADMIN_ROLES));

function wrap(fn) {
  return (req, res, next) => fn(req, res).catch(next);
}

// ============ DASHBOARD ============
router.get('/dashboard', wrap(async (req, res) => {
  const counts = {};
  const q = async (key, sql, params = []) => { counts[key] = Number((await db.one(sql, params))?.n || 0); };
  await q('pending_applications', `SELECT count(*) n FROM applications WHERE status IN ('submitted','under_review')`);
  await q('pending_receipts', `SELECT count(*) n FROM applications WHERE receipt_verification_status = 'pending' AND registration_fee_receipt_url IS NOT NULL`);
  await q('total_students', `SELECT count(*) n FROM students WHERE status = 'registered'`);
  await q('pending_src', `SELECT count(*) n FROM src_receipts WHERE verification_status = 'pending'`);
  await q('pending_registrations', `SELECT count(*) n FROM semester_registrations WHERE status = 'submitted'`);
  await q('pending_internships', `SELECT count(*) n FROM internship_placements WHERE status = 'submitted'`);
  await q('cleared_students', `SELECT count(*) n FROM clearance_status WHERE cleared = 1`);
  res.json({ counts, role: req.user.role });
}));

// ============ AUDIT LOG (Super Admin + Registrar) ============
router.get('/audit', requireRole('super_admin', 'registrar'), wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = await db.all(
    `SELECT a.*, u.full_name AS user_name, u.role AS user_role
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT $1`,
    [limit]
  );
  res.json({ audit_log: rows.map(r => ({ ...r, details: parseJson(r.details, {}) })) });
}));

// ============ PROGRAMMES ============
router.get('/programmes', wrap(async (_req, res) => {
  res.json({ programmes: await db.all('SELECT * FROM programmes ORDER BY id') });
}));

router.post('/programmes', requireRole('super_admin'), wrap(async (req, res) => {
  const { name, level, faculty, duration_years, total_semesters, internship_semester,
    credits_per_semester, minor_credits_required, description } = req.body || {};
  if (!name || !level || !total_semesters || !internship_semester) {
    return res.status(400).json({ error: 'name, level, total_semesters and internship_semester are required' });
  }
  if (!['associate', 'bachelors'].includes(level)) return res.status(400).json({ error: 'level must be associate or bachelors' });
  const r = await db.run(
    `INSERT INTO programmes (name, level, faculty, duration_years, total_semesters, internship_semester,
      credits_per_semester, minor_credits_required, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [name, level, faculty || 'School of Information Technology', duration_years || 2,
      total_semesters, internship_semester, credits_per_semester || 18, minor_credits_required || 12, description || null]
  );
  await audit(req.user.id, 'programme.create', 'programmes', r.lastInsertRowid, { name, level });
  res.status(201).json({ message: 'Programme created', id: r.lastInsertRowid });
}));

router.put('/programmes/:id', requireRole('super_admin'), wrap(async (req, res) => {
  const p = await db.one('SELECT * FROM programmes WHERE id = $1', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Programme not found' });
  const b = req.body || {};
  await db.run(
    `UPDATE programmes SET name = $1, level = $2, faculty = $3, duration_years = $4, total_semesters = $5,
      internship_semester = $6, credits_per_semester = $7, minor_credits_required = $8, description = $9, is_active = $10
     WHERE id = $11`,
    [b.name ?? p.name, b.level ?? p.level, b.faculty ?? p.faculty, b.duration_years ?? p.duration_years,
      b.total_semesters ?? p.total_semesters, b.internship_semester ?? p.internship_semester,
      b.credits_per_semester ?? p.credits_per_semester, b.minor_credits_required ?? p.minor_credits_required,
      b.description ?? p.description, b.is_active !== undefined ? (b.is_active ? 1 : 0) : p.is_active, p.id]
  );
  await audit(req.user.id, 'programme.update', 'programmes', p.id, b);
  res.json({ message: 'Programme updated' });
}));

// ============ CERTIFICATES ============
router.get('/certificates', wrap(async (_req, res) => {
  res.json({ certificates: await db.all('SELECT * FROM certificates ORDER BY name') });
}));

router.post('/certificates', requireRole('super_admin'), wrap(async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Certificate name is required' });
  try {
    const r = await db.run('INSERT INTO certificates (name, description) VALUES ($1, $2) RETURNING id',
      [String(name).trim().toUpperCase(), description || null]);
    await audit(req.user.id, 'certificate.create', 'certificates', r.lastInsertRowid, { name });
    res.status(201).json({ message: 'Certificate added', id: r.lastInsertRowid });
  } catch (err) {
    if (String(err.message).includes('unique')) return res.status(409).json({ error: 'Certificate already exists' });
    throw err;
  }
}));

router.put('/certificates/:id', requireRole('super_admin'), wrap(async (req, res) => {
  const c = await db.one('SELECT * FROM certificates WHERE id = $1', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Certificate not found' });
  const b = req.body || {};
  await db.run('UPDATE certificates SET name = $1, description = $2, is_active = $3 WHERE id = $4',
    [b.name ?? c.name, b.description ?? c.description, b.is_active !== undefined ? (b.is_active ? 1 : 0) : c.is_active, c.id]);
  await audit(req.user.id, 'certificate.update', 'certificates', c.id, b);
  res.json({ message: 'Certificate updated' });
}));

// ============ PROGRAMME REQUIREMENTS (cut-off points + subjects per certificate) ============
router.get('/requirements', wrap(async (req, res) => {
  const rows = await db.all(
    `SELECT pr.*, p.name AS programme_name, p.level AS programme_level, c.name AS certificate_name
     FROM programme_requirements pr
     JOIN programmes p ON p.id = pr.programme_id
     JOIN certificates c ON c.id = pr.certificate_id
     ORDER BY p.name, c.name`
  );
  res.json({ requirements: rows.map(r => ({ ...r, required_subjects: parseJson(r.required_subjects, []) })) });
}));

router.post('/requirements', requireRole('super_admin'), wrap(async (req, res) => {
  const { programme_id, certificate_id, min_cutoff_points, required_subjects, notes } = req.body || {};
  if (!programme_id || !certificate_id || min_cutoff_points === undefined) {
    return res.status(400).json({ error: 'programme_id, certificate_id and min_cutoff_points are required' });
  }
  const r = await db.run(
    `INSERT INTO programme_requirements (programme_id, certificate_id, min_cutoff_points, required_subjects, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (programme_id, certificate_id)
     DO UPDATE SET min_cutoff_points = $3, required_subjects = $4, notes = $5, updated_at = now()
     RETURNING id`,
    [programme_id, certificate_id, min_cutoff_points,
      JSON.stringify(required_subjects || []), notes || null]
  );
  await audit(req.user.id, 'requirement.upsert', 'programme_requirements', r.lastInsertRowid,
    { programme_id, certificate_id, min_cutoff_points });
  res.status(201).json({ message: 'Requirement saved', id: r.lastInsertRowid });
}));

router.delete('/requirements/:id', requireRole('super_admin'), wrap(async (req, res) => {
  const row = await db.one('SELECT * FROM programme_requirements WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Requirement not found' });
  await db.run('DELETE FROM programme_requirements WHERE id = $1', [row.id]);
  await audit(req.user.id, 'requirement.delete', 'programme_requirements', row.id, {});
  res.json({ message: 'Requirement deleted' });
}));

// ============ MODULES (admin adds module ID/code + name; soft delete) ============
router.get('/modules', wrap(async (req, res) => {
  const { programme_id, semester, include_inactive } = req.query;
  const where = [];
  const params = [];
  if (programme_id) { params.push(programme_id); where.push(`m.programme_id = $${params.length}`); }
  if (semester) { params.push(semester); where.push(`m.semester_number = $${params.length}`); }
  if (include_inactive !== 'true') where.push('m.is_active = 1');
  const rows = await db.all(
    `SELECT m.*, p.name AS programme_name,
       (SELECT COALESCE(json_agg(json_build_object('id', pr.id, 'code', pr.code, 'title', pr.title)), '[]')
        FROM module_prerequisites mp JOIN modules pr ON pr.id = mp.prerequisite_module_id
        WHERE mp.module_id = m.id) AS prerequisites
     FROM modules m JOIN programmes p ON p.id = m.programme_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY m.programme_id, m.semester_number, m.code`,
    params
  );
  res.json({ modules: rows });
}));

// Admin creates a module: must provide code (ID) and title (name)
router.post('/modules', requireRole('super_admin'), wrap(async (req, res) => {
  const { code, title, credits, classification, semester_number, programme_id, prerequisites } = req.body || {};
  if (!code || !title) return res.status(400).json({ error: 'Module ID (code) and module name (title) are required' });
  if (!credits || !classification || !semester_number || !programme_id) {
    return res.status(400).json({ error: 'credits, classification, semester_number and programme_id are required' });
  }
  if (!['core', 'minor', 'elective'].includes(classification)) {
    return res.status(400).json({ error: 'classification must be core, minor or elective' });
  }
  const programme = await db.one('SELECT * FROM programmes WHERE id = $1', [programme_id]);
  if (!programme) return res.status(400).json({ error: 'Invalid programme' });
  if (semester_number > programme.total_semesters) {
    return res.status(400).json({ error: `Semester must be between 1 and ${programme.total_semesters}` });
  }
  try {
    const r = await db.run(
      `INSERT INTO modules (code, title, credits, classification, semester_number, programme_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [String(code).trim().toUpperCase(), title, credits, classification, semester_number, programme_id]
    );
    const moduleId = r.lastInsertRowid;
    if (Array.isArray(prerequisites)) {
      for (const pid of prerequisites) {
        await db.run('INSERT INTO module_prerequisites (module_id, prerequisite_module_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [moduleId, Number(pid)]);
      }
    }
    await audit(req.user.id, 'module.create', 'modules', moduleId, { code, title, semester_number });
    res.status(201).json({ message: 'Module created', id: moduleId });
  } catch (err) {
    if (String(err.message).includes('unique')) return res.status(409).json({ error: 'That module code already exists for this programme' });
    throw err;
  }
}));

router.put('/modules/:id', requireRole('super_admin'), wrap(async (req, res) => {
  const m = await db.one('SELECT * FROM modules WHERE id = $1', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Module not found' });
  const b = req.body || {};
  await db.run(
    `UPDATE modules SET code = $1, title = $2, credits = $3, classification = $4, semester_number = $5, is_active = $6
     WHERE id = $7`,
    [(b.code ?? m.code).toUpperCase(), b.title ?? m.title, b.credits ?? m.credits,
      b.classification ?? m.classification, b.semester_number ?? m.semester_number,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : m.is_active, m.id]
  );
  if (Array.isArray(b.prerequisites)) {
    await db.run('DELETE FROM module_prerequisites WHERE module_id = $1', [m.id]);
    for (const pid of b.prerequisites) {
      if (Number(pid) === m.id) continue;
      await db.run('INSERT INTO module_prerequisites (module_id, prerequisite_module_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [m.id, Number(pid)]);
    }
  }
  await audit(req.user.id, 'module.update', 'modules', m.id, b);
  res.json({ message: 'Module updated' });
}));

// Soft delete
router.delete('/modules/:id', requireRole('super_admin'), wrap(async (req, res) => {
  const m = await db.one('SELECT * FROM modules WHERE id = $1', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Module not found' });
  await db.run('UPDATE modules SET is_active = 0 WHERE id = $1', [m.id]);
  await audit(req.user.id, 'module.soft_delete', 'modules', m.id, { code: m.code });
  res.json({ message: `Module ${m.code} soft-deleted (is_active = 0)` });
}));

router.post('/modules/:id/restore', requireRole('super_admin'), wrap(async (req, res) => {
  await db.run('UPDATE modules SET is_active = 1 WHERE id = $1', [req.params.id]);
  await audit(req.user.id, 'module.restore', 'modules', req.params.id, {});
  res.json({ message: 'Module restored' });
}));

// ============ STAFF ACCOUNTS (Super Admin) ============
router.get('/users', requireRole('super_admin'), wrap(async (_req, res) => {
  const includeInactive = _req.query.include_inactive === 'true';
  const users = await db.all(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.email_verified, u.is_active, u.created_at,
            s.student_number, s.programme_id, s.current_semester, s.status AS student_status
     FROM users u LEFT JOIN students s ON s.user_id = u.id
     ${includeInactive ? '' : 'WHERE u.is_active = 1'}
     ORDER BY CASE u.role WHEN 'super_admin' THEN 0 WHEN 'admissions_officer' THEN 1
       WHEN 'registry_officer' THEN 2 WHEN 'registrar' THEN 3 ELSE 4 END, u.full_name`
  );
  res.json({ users });
}));

router.post('/users', requireRole('super_admin'), wrap(async (req, res) => {
  const { full_name, email, password, role, phone } = req.body || {};
  if (!full_name || !email || !password || !role) return res.status(400).json({ error: 'full_name, email, password and role are required' });
  if (!ADMIN_ROLES.includes(role) && role !== 'student') return res.status(400).json({ error: 'Invalid role' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const r = await db.run(
      `INSERT INTO users (full_name, email, phone, password_hash, role, email_verified) VALUES ($1, $2, $3, $4, $5, 1) RETURNING id`,
      [full_name, String(email).toLowerCase(), phone || null, bcrypt.hashSync(password, 10), role]
    );
    await audit(req.user.id, 'user.create', 'users', r.lastInsertRowid, { email, role });
    res.status(201).json({ message: 'Account created', id: r.lastInsertRowid });
  } catch (err) {
    if (String(err.message).includes('unique')) return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
}));

router.put('/users/:id', requireRole('super_admin'), wrap(async (req, res) => {
  const u = await db.one('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id && req.body.is_active === false) {
    return res.status(400).json({ error: 'You cannot disable your own account' });
  }
  const b = req.body || {};
  await db.run(
    `UPDATE users SET full_name = $1, phone = $2, role = $3, is_active = $4 WHERE id = $5`,
    [b.full_name ?? u.full_name, b.phone ?? u.phone, b.role ?? u.role,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : u.is_active, u.id]
  );
  if (b.password) await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(b.password, 10), u.id]);
  await audit(req.user.id, 'user.update', 'users', u.id, { role: b.role, is_active: b.is_active });
  res.json({ message: 'Account updated' });
}));

// ============ APPLICATIONS (Admissions Officer) ============
router.get('/applications', requireRole('admissions_officer', 'registrar', 'super_admin'), wrap(async (req, res) => {
  const { status, receipt } = req.query;
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`a.status = $${params.length}`); }
  if (receipt) { params.push(receipt); where.push(`a.receipt_verification_status = $${params.length}`); }
  const rows = await db.all(
    `SELECT a.*, u.full_name, u.email, u.phone, u.id_number,
            p.name AS programme_name, p.level AS programme_level,
            c.name AS certificate_name,
            s.student_number AS profile_student_number, s.status AS student_status, s.current_semester
     FROM applications a
     JOIN users u ON u.id = a.user_id
     JOIN programmes p ON p.id = a.programme_id
     JOIN certificates c ON c.id = a.certificate_id
     LEFT JOIN students s ON s.user_id = a.user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.updated_at DESC`,
    params
  );
  res.json({ applications: rows });
}));

router.get('/applications/:id', requireRole('admissions_officer', 'registrar', 'super_admin'), wrap(async (req, res) => {
  const a = await db.one(
    `SELECT a.*, u.full_name, u.email, u.phone, u.id_number,
            p.name AS programme_name, p.level AS programme_level, p.total_semesters, p.internship_semester,
            c.name AS certificate_name, c.description AS certificate_description
     FROM applications a
     JOIN users u ON u.id = a.user_id
     JOIN programmes p ON p.id = a.programme_id
     JOIN certificates c ON c.id = a.certificate_id
     WHERE a.id = $1`,
    [req.params.id]
  );
  if (!a) return res.status(404).json({ error: 'Application not found' });

  // The exact requirement for the applicant's chosen certificate
  const requirement = await db.one(
    `SELECT * FROM programme_requirements WHERE programme_id = $1 AND certificate_id = $2`,
    [a.programme_id, a.certificate_id]
  );
  res.json({
    application: {
      ...a,
      personal_details: parseJson(a.personal_details, {}),
      contact_details: parseJson(a.contact_details, {}),
      academic_history: parseJson(a.academic_history, []),
      documents: parseJson(a.documents, {})
    },
    requirement: requirement ? { ...requirement, required_subjects: parseJson(requirement.required_subjects, []) } : null
  });
}));

// Verify / reject the registration fee receipt (email sent on rejection)
router.post('/applications/:id/receipt', requireRole('admissions_officer'), wrap(async (req, res) => {
  const { action, reason } = req.body || {};
  if (!['approved', 'rejected'].includes(action)) return res.status(400).json({ error: 'action must be approved or rejected' });
  const a = await db.one(
    `SELECT a.*, u.email, u.full_name FROM applications a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
    [req.params.id]
  );
  if (!a) return res.status(404).json({ error: 'Application not found' });
  if (!a.registration_fee_receipt_url) return res.status(400).json({ error: 'No receipt has been uploaded yet' });
  if (action === 'rejected' && !reason) return res.status(400).json({ error: 'A rejection reason is required' });

  await db.run(
    `UPDATE applications SET receipt_verification_status = $1, receipt_rejection_reason = $2,
      status = CASE WHEN $1 = 'rejected' THEN 'under_review' WHEN status = 'submitted' THEN 'under_review' ELSE status END,
      reviewed_by = $3, updated_at = now() WHERE id = $4`,
    [action, action === 'rejected' ? reason : null, req.user.id, a.id]
  );
  if (action === 'rejected') {
    sendEmail(a.email, 'Registration fee receipt rejected â€” action required',
      `Hello ${a.full_name},\n\nYour registration fee receipt was rejected.\nReason: ${reason}\n\nPlease sign in and re-upload a valid receipt to continue your application.`);
  }
  await audit(req.user.id, `application.receipt_${action}`, 'applications', a.id, { reason });
  res.json({ message: action === 'approved' ? 'Receipt approved' : 'Receipt rejected â€” applicant notified' });
}));

// Verify or revoke the applicant's uploaded academic certificate.
router.post('/applications/:id/certificate-verification', requireRole('admissions_officer', 'super_admin'), wrap(async (req, res) => {
  const { action, reason } = req.body || {};
  if (!['verified', 'revoked'].includes(action)) {
    return res.status(400).json({ error: 'action must be verified or revoked' });
  }
  const application = await db.one(
    `SELECT a.*, u.email, u.full_name FROM applications a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
    [req.params.id]
  );
  if (!application) return res.status(404).json({ error: 'Application not found' });

  const documents = parseJson(application.documents, {});
  if (action === 'verified' && !documents.academic_cert) {
    return res.status(400).json({ error: 'The applicant must upload an academic certificate before it can be verified' });
  }
  if (action === 'revoked') {
    if (!application.certificate_verified) return res.status(409).json({ error: 'This certificate is not currently verified' });
    if (!String(reason || '').trim()) return res.status(400).json({ error: 'A reason is required to revoke certificate verification' });
  }

  await db.run(
    `UPDATE applications SET certificate_verified = $1,
       status = CASE WHEN $1 = 0 AND status = 'accepted' THEN 'under_review' ELSE status END,
       reviewed_by = $2, updated_at = now() WHERE id = $3`,
    [action === 'verified' ? 1 : 0, req.user.id, application.id]
  );
  if (action === 'revoked') {
    await sendEmail(application.email, 'Academic certificate verification revoked',
      `Hello ${application.full_name},\n\nAdmissions has revoked verification of the academic certificate on your application.\nReason: ${String(reason).trim()}\n\nPlease contact admissions@limkokwing.ac.sz for next steps.`);
  }
  await audit(req.user.id, `application.certificate_${action}`, 'applications', application.id, {
    reason: action === 'revoked' ? String(reason).trim() : null,
    document: documents.academic_cert
  });
  res.json({ message: action === 'verified' ? 'Academic certificate verified' : 'Certificate verification revoked and applicant notified' });
}));

// Verify certificate, accept/reject application, generate student number
router.post('/applications/:id/decision', requireRole('admissions_officer'), wrap(async (req, res) => {
  const { action, reason, student_number } = req.body || {};
  if (!['accepted', 'rejected', 'under_review'].includes(action)) {
    return res.status(400).json({ error: 'action must be accepted, rejected or under_review' });
  }
  const a = await db.one(
    `SELECT a.*, u.email, u.full_name FROM applications a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
    [req.params.id]
  );
  if (!a) return res.status(404).json({ error: 'Application not found' });
  if (action === 'rejected' && !reason) return res.status(400).json({ error: 'A rejection reason is required' });
  if (a.receipt_verification_status !== 'approved' && action === 'accepted') {
    return res.status(400).json({ error: 'The registration fee receipt must be approved before accepting the application' });
  }
  if (action === 'accepted' && !a.certificate_verified) {
    return res.status(400).json({ error: 'Verify the uploaded academic certificate before accepting this application' });
  }
  if (action === 'accepted' && !parseJson(a.documents, {}).academic_cert) {
    return res.status(400).json({ error: 'The applicant must upload an academic certificate before acceptance' });
  }

  let number = a.student_number;
  if (action === 'accepted') {
    number = student_number || await generateStudentNumber();
    const personal = parseJson(a.personal_details, {});
    await db.run(
      `INSERT INTO students (user_id, student_number, programme_id, certificate_id, current_semester, status)
       VALUES ($1, $2, $3, $4, 1, 'registered')
       ON CONFLICT (user_id) DO UPDATE SET student_number = EXCLUDED.student_number,
         programme_id = EXCLUDED.programme_id, certificate_id = EXCLUDED.certificate_id,
         current_semester = CASE WHEN students.status = 'applicant' THEN 1 ELSE students.current_semester END,
         status = CASE WHEN students.status = 'applicant' THEN 'registered' ELSE students.status END`,
      [a.user_id, number, a.programme_id, a.certificate_id]
    );
    await db.run(`UPDATE applications SET student_number = $1 WHERE id = $2`, [number, a.id]);
    void personal;
  }

  await db.run(
    `UPDATE applications SET status = $1, decision_reason = $2,
      reviewed_by = $3, updated_at = now() WHERE id = $4`,
    [action, reason || null, req.user.id, a.id]
  );

  if (action === 'accepted') {
    sendEmail(a.email, 'Your Limkokwing application has been accepted',
      `Hello ${a.full_name},\n\nCongratulations! Your application has been accepted.\nYour student number is: ${number}\n\nYou can now sign in and register for your first semester.`);
  } else if (action === 'rejected') {
    sendEmail(a.email, 'Application outcome â€” Limkokwing Eswatini',
      `Hello ${a.full_name},\n\nYour application was not accepted.\nReason: ${reason}\n\nContact admissions@limkokwing.ac.sz for more information.`);
  }
  await audit(req.user.id, `application.${action}`, 'applications', a.id, { reason });
  res.json({ message: action === 'accepted' ? `Application accepted â€” student number ${number}` : `Application ${action}`, student_number: number });
}));

async function generateStudentNumber() {
  const year = new Date().getFullYear();
  const row = await db.one(
    `INSERT INTO student_number_sequences (year, last_value)
     VALUES ($1, COALESCE((
       SELECT MAX(split_part(student_number, '-', 3)::INTEGER)
       FROM students
       WHERE student_number ~ $2
     ), 0) + 1)
     ON CONFLICT (year) DO UPDATE
       SET last_value = GREATEST(
         student_number_sequences.last_value,
         COALESCE((
           SELECT MAX(split_part(student_number, '-', 3)::INTEGER)
           FROM students
           WHERE student_number ~ $2
         ), 0)
       ) + 1
     RETURNING last_value`,
    [year, `^LCK-${year}-[0-9]+$`]
  );
  const seq = String(row.last_value).padStart(4, '0');
  return `LCK-${year}-${seq}`;
}

// ============ STUDENTS & REGISTRATION (Registry Officer) ============
router.get('/students', requireRole('registry_officer', 'registrar', 'super_admin', 'admissions_officer'), wrap(async (_req, res) => {
  const rows = await db.all(
    `SELECT s.*, u.full_name, u.email, u.phone, p.name AS programme_name, c.name AS certificate_name
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN programmes p ON p.id = s.programme_id
     LEFT JOIN certificates c ON c.id = s.certificate_id
     ORDER BY s.student_number NULLS LAST, u.full_name`
  );
  res.json({ students: rows });
}));

router.get('/students/:id/record', requireRole('registry_officer', 'registrar', 'super_admin'), wrap(async (req, res) => {
  const student = await db.one(
    `SELECT s.*, u.full_name, u.email, u.phone, p.name AS programme_name, p.total_semesters, p.internship_semester,
            c.name AS certificate_name
     FROM students s JOIN users u ON u.id = s.user_id
     LEFT JOIN programmes p ON p.id = s.programme_id
     LEFT JOIN certificates c ON c.id = s.certificate_id
     WHERE s.user_id = $1`,
    [req.params.id]
  );
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const results = await db.all(
    `SELECT r.*, m.code, m.title, m.credits, m.classification
     FROM semester_results r JOIN modules m ON m.id = r.module_id
     WHERE r.student_id = $1 ORDER BY r.academic_term, m.code`,
    [req.params.id]
  );
  const registrations = await db.all(
    'SELECT * FROM semester_registrations WHERE student_id = $1 ORDER BY id DESC',
    [req.params.id]
  );
  const clearance = await db.all('SELECT * FROM clearance_status WHERE student_id = $1 ORDER BY id DESC', [req.params.id]);
  const { pendingModules } = require('./reregistration');
  res.json({
    student,
    results,
    registrations: registrations.map(r => ({ ...r, selected_modules: parseJson(r.selected_modules, []) })),
    clearance,
    pending_modules: await pendingModules(Number(req.params.id))
  });
}));

// Per-module grade entry; final exam < 40 => failed + flagged pending module
router.post('/grades', requireRole('registry_officer'), wrap(async (req, res) => {
  const { student_id, module_id, academic_term, ca_mark, exam_mark } = req.body || {};
  if (!student_id || !module_id || !academic_term || ca_mark == null || exam_mark == null) {
    return res.status(400).json({ error: 'student_id, module_id, academic_term, ca_mark and exam_mark are required' });
  }
  const ca = Number(ca_mark), exam = Number(exam_mark);
  if (isNaN(ca) || isNaN(exam) || ca < 0 || ca > 100 || exam < 0 || exam > 100) {
    return res.status(400).json({ error: 'Marks must be numbers between 0 and 100' });
  }
  const moduleRow = await db.one('SELECT * FROM modules WHERE id = $1', [module_id]);
  if (!moduleRow) return res.status(400).json({ error: 'Invalid module' });
  const student = await db.one('SELECT * FROM students WHERE user_id = $1', [student_id]);
  if (!student) return res.status(400).json({ error: 'Invalid student' });

  const final = Math.round((ca * 0.4 + exam * 0.6) * 10) / 10;
  const finalExamFailed = exam < 40; // final exam rule
  const grade = finalExamFailed ? 'F' : gradeFor(final);
  const passed = (!finalExamFailed && PASSING_GRADES.includes(grade)) ? 1 : 0;

  await db.run(
    `INSERT INTO semester_results (student_id, module_id, academic_term, ca_mark, exam_mark, final_mark, grade, passed, final_exam_failed, entered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (student_id, module_id, academic_term)
     DO UPDATE SET ca_mark = $4, exam_mark = $5, final_mark = $6, grade = $7, passed = $8,
       final_exam_failed = $9, entered_by = $10`,
    [student_id, module_id, academic_term, ca, exam, final, grade, passed, finalExamFailed ? 1 : 0, req.user.id]
  );
  await db.run(
    `UPDATE enrolments SET status = $1 WHERE student_id = $2 AND module_id = $3 AND academic_term = $4`,
    [passed ? 'completed' : 'failed', student_id, module_id, academic_term]
  );
  await audit(req.user.id, 'grade.enter', 'semester_results', `${student_id}:${module_id}:${academic_term}`,
    { ca, exam, final, grade, finalExamFailed });
  res.json({
    message: finalExamFailed
      ? `Grade ${grade} recorded â€” FAILED final exam, student flagged with a pending module`
      : `Grade ${grade} recorded`,
    final_mark: final, grade, passed: !!passed, final_exam_failed: finalExamFailed
  });
}));

// Mark student as cleared for re-registration
router.post('/clearance', requireRole('registry_officer'), wrap(async (req, res) => {
  const { student_id, academic_term, cleared, reason } = req.body || {};
  if (!student_id || !academic_term) return res.status(400).json({ error: 'student_id and academic_term are required' });
  if (cleared && !reason) return res.status(400).json({ error: 'A reason is required when clearing a student' });
  await db.run(
    `INSERT INTO clearance_status (student_id, academic_term, cleared, reason, cleared_by, cleared_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (student_id, academic_term)
     DO UPDATE SET cleared = $3, reason = $4, cleared_by = $5, cleared_at = now()`,
    [student_id, academic_term, cleared ? 1 : 0, reason || null, req.user.id]
  );
  await audit(req.user.id, cleared ? 'clearance.granted' : 'clearance.revoked', 'clearance_status',
    `${student_id}:${academic_term}`, { reason });
  res.json({ message: cleared ? 'Student cleared for re-registration' : 'Clearance revoked' });
}));

// ============ SEMESTER REGISTRATIONS + SRC RECEIPTS ============
router.get('/registrations', requireRole('registry_officer', 'registrar', 'super_admin'), wrap(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = 'WHERE r.status = $1'; }
  const rows = await db.all(
    `SELECT r.*, u.full_name, u.email, s.student_number, p.name AS programme_name,
            (SELECT json_build_object('file_url', sr.file_url, 'verification_status', sr.verification_status, 'id', sr.id)
             FROM src_receipts sr WHERE sr.registration_id = r.id ORDER BY sr.id DESC LIMIT 1) AS src_receipt
     FROM semester_registrations r
     JOIN users u ON u.id = r.student_id
     LEFT JOIN students s ON s.user_id = r.student_id
     LEFT JOIN programmes p ON p.id = s.programme_id
     ${where}
     ORDER BY r.updated_at DESC`,
    params
  );
  res.json({
    registrations: rows.map(r => ({
      ...r,
      selected_modules: parseJson(r.selected_modules, []),
      src_receipt: r.src_receipt && typeof r.src_receipt === 'string' ? parseJson(r.src_receipt, null) : r.src_receipt
    }))
  });
}));

router.get('/registrations/:id/details', requireRole('registry_officer', 'registrar', 'super_admin'), wrap(async (req, res) => {
  const registration = await db.one(
    `SELECT r.*, u.full_name, u.email, s.student_number, p.name AS programme_name,
       (SELECT json_build_object('file_url', sr.file_url, 'verification_status', sr.verification_status, 'notes', sr.notes)
        FROM src_receipts sr WHERE sr.registration_id = r.id ORDER BY sr.id DESC LIMIT 1) AS src_receipt
     FROM semester_registrations r
     JOIN users u ON u.id = r.student_id
     LEFT JOIN students s ON s.user_id = r.student_id
     LEFT JOIN programmes p ON p.id = s.programme_id
     WHERE r.id = $1`,
    [req.params.id]
  );
  if (!registration) return res.status(404).json({ error: 'Registration not found' });
  registration.selected_modules = parseJson(registration.selected_modules, []);
  if (registration.src_receipt && typeof registration.src_receipt === 'string') {
    registration.src_receipt = parseJson(registration.src_receipt, null);
  }
  const modules = registration.selected_modules.length
    ? await db.all('SELECT id, code, title, credits, classification FROM modules WHERE id = ANY($1::int[]) ORDER BY code', [registration.selected_modules])
    : [];
  res.json({ registration, modules });
}));

// Verify SRC receipt (approve/reject)
router.post('/registrations/:id/src', requireRole('registry_officer'), wrap(async (req, res) => {
  const { action, notes } = req.body || {};
  if (!['approved', 'rejected'].includes(action)) return res.status(400).json({ error: 'action must be approved or rejected' });
  if (action === 'rejected' && !notes) return res.status(400).json({ error: 'A rejection note is required' });
  const reg = await db.one('SELECT * FROM semester_registrations WHERE id = $1', [req.params.id]);
  if (!reg) return res.status(404).json({ error: 'Registration not found' });
  const src = await db.one('SELECT * FROM src_receipts WHERE registration_id = $1 ORDER BY id DESC LIMIT 1', [reg.id]);
  if (!src) return res.status(404).json({ error: 'No SRC receipt uploaded' });

  await db.run('UPDATE src_receipts SET verification_status = $1, notes = $2, verified_by = $3 WHERE id = $4',
    [action, notes || null, req.user.id, src.id]);
  if (action === 'rejected') {
    await db.run(`UPDATE semester_registrations SET status = 'rejected', rejection_reason = $1, updated_at = now() WHERE id = $2`,
      [`SRC receipt rejected: ${notes}`, reg.id]);
  }
  await audit(req.user.id, `src.${action}`, 'src_receipts', src.id, { notes });
  res.json({ message: action === 'approved' ? 'SRC receipt approved' : 'SRC receipt rejected' });
}));

// Approve registration â†’ create enrolments, advance semester
router.post('/registrations/:id/approve', requireRole('registry_officer'), wrap(async (req, res) => {
  const reg = await db.one('SELECT * FROM semester_registrations WHERE id = $1', [req.params.id]);
  if (!reg) return res.status(404).json({ error: 'Registration not found' });
  if (reg.status === 'approved') return res.status(400).json({ error: 'Already approved' });

  const src = await db.one('SELECT * FROM src_receipts WHERE registration_id = $1 ORDER BY id DESC LIMIT 1', [reg.id]);
  if (!src || src.verification_status !== 'approved') {
    return res.status(400).json({ error: 'The SRC receipt must be verified before approving the registration' });
  }

  const moduleIds = parseJson(reg.selected_modules, []);
  if (!moduleIds.length) return res.status(400).json({ error: 'Registration has no modules' });

  for (const mid of moduleIds) {
    await db.run(
      `INSERT INTO enrolments (student_id, module_id, semester_number, academic_term, status)
       VALUES ($1, $2, $3, $4, 'registered')
       ON CONFLICT (student_id, module_id, academic_term) DO NOTHING`,
      [reg.student_id, mid, reg.semester_number, reg.academic_term]
    );
  }
  await db.run(`UPDATE semester_registrations SET status = 'approved', updated_at = now() WHERE id = $1`, [reg.id]);
  await db.run(`UPDATE students SET current_semester = $1, status = 'registered' WHERE user_id = $2`,
    [reg.semester_number, reg.student_id]);
  await audit(req.user.id, 'registration.approve', 'semester_registrations', reg.id, { modules: moduleIds.length });
  res.json({ message: `Registration approved â€” ${moduleIds.length} module(s) enrolled` });
}));

router.post('/registrations/:id/reject', requireRole('registry_officer'), wrap(async (req, res) => {
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'A rejection reason is required' });
  const reg = await db.one('SELECT * FROM semester_registrations WHERE id = $1', [req.params.id]);
  if (!reg) return res.status(404).json({ error: 'Registration not found' });
  await db.run(`UPDATE semester_registrations SET status = 'rejected', rejection_reason = $1, updated_at = now() WHERE id = $2`,
    [reason, reg.id]);
  await audit(req.user.id, 'registration.reject', 'semester_registrations', reg.id, { reason });
  res.json({ message: 'Registration rejected' });
}));

// ============ INTERNSHIP PLACEMENTS ============
router.get('/internships', requireRole('registry_officer', 'registrar', 'super_admin'), wrap(async (_req, res) => {
  const rows = await db.all(
    `SELECT i.*, u.full_name, u.email, s.student_number, p.name AS programme_name
     FROM internship_placements i
     JOIN users u ON u.id = i.student_id
     LEFT JOIN students s ON s.user_id = i.student_id
     LEFT JOIN programmes p ON p.id = s.programme_id
     ORDER BY i.created_at DESC`
  );
  res.json({ internships: rows });
}));

router.post('/internships/:id', requireRole('registry_officer'), wrap(async (req, res) => {
  const { action, notes, final_grade } = req.body || {};
  if (!['approved', 'rejected', 'graded'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const row = await db.one('SELECT * FROM internship_placements WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Placement not found' });
  if (action === 'graded' && !final_grade) return res.status(400).json({ error: 'final_grade is required' });

  await db.run('UPDATE internship_placements SET status = $1, notes = $2, final_grade = COALESCE($3, final_grade) WHERE id = $4',
    [action, notes || null, final_grade || null, row.id]);

  // Log the internship grade into semester_results when graded
  if (action === 'graded') {
    const reg = row.registration_id ? await db.one('SELECT * FROM semester_registrations WHERE id = $1', [row.registration_id]) : null;
    const student = await db.one('SELECT * FROM students WHERE user_id = $1', [row.student_id]);
    if (reg && student) {
      const mods = await db.all(
        `SELECT id FROM modules WHERE programme_id = $1 AND semester_number = $2 AND classification = 'core' AND is_active = 1 LIMIT 1`,
        [student.programme_id, reg.semester_number]
      );
      if (mods[0]) {
        await db.run(
          `INSERT INTO semester_results (student_id, module_id, academic_term, ca_mark, exam_mark, final_mark, grade, passed, entered_by)
           VALUES ($1, $2, $3, NULL, NULL, NULL, $4, $5, $6)
           ON CONFLICT (student_id, module_id, academic_term)
           DO UPDATE SET grade = $4, passed = $5, entered_by = $6`,
          [row.student_id, mods[0].id, reg.academic_term, final_grade, PASSING_GRADES.includes(final_grade) ? 1 : 0, req.user.id]
        );
      }
    }
  }
  await audit(req.user.id, `internship.${action}`, 'internship_placements', row.id, { notes, final_grade });
  res.json({ message: `Internship ${action}` });
}));

// ============ MANUAL OVERRIDES (Registrar â€” mandatory reason, permanently logged) ============
router.post('/overrides', requireRole('registrar'), wrap(async (req, res) => {
  const { target_type, target_id, action, reason, new_value } = req.body || {};
  if (!target_type || !target_id || !action || !reason) {
    return res.status(400).json({ error: 'target_type, target_id, action and reason are required' });
  }
  if (String(reason).trim().length < 5) {
    return res.status(400).json({ error: 'A detailed reason (min 5 characters) is mandatory for every override' });
  }

  let applied = 'override recorded';
  if (action === 'clear_pending_module') {
    // Remove failing results + enrolments for a module so the student can progress
    await db.run(
      `UPDATE semester_results SET grade = 'PX', passed = 1, final_exam_failed = 0, entered_by = $1
       WHERE student_id = $2 AND module_id = $3`,
      [req.user.id, target_id.split(':')[0], target_id.split(':')[1]]
    );
    await db.run(
      `UPDATE enrolments SET status = 'completed' WHERE student_id = $1 AND module_id = $2`,
      [target_id.split(':')[0], target_id.split(':')[1]]
    );
    applied = 'pending module cleared (PX)';
  } else if (action === 'force_clearance') {
    const [studentId, term] = String(target_id).split(':');
    await db.run(
      `INSERT INTO clearance_status (student_id, academic_term, cleared, reason, cleared_by, cleared_at)
       VALUES ($1, $2, 1, $3, $4, now())
       ON CONFLICT (student_id, academic_term)
       DO UPDATE SET cleared = 1, reason = $3, cleared_by = $4, cleared_at = now()`,
      [studentId, term, `MANUAL OVERRIDE: ${reason}`, req.user.id]
    );
    applied = 'clearance forced';
  } else if (action === 'change_grade') {
    const [studentId, moduleId, term] = String(target_id).split(':');
    const grade = new_value;
    const passed = PASSING_GRADES.includes(grade) ? 1 : 0;
    await db.run(
      `UPDATE semester_results SET grade = $1, passed = $2, entered_by = $3
       WHERE student_id = $4 AND module_id = $5 AND academic_term = $6`,
      [grade, passed, req.user.id, studentId, moduleId, term]
    );
    applied = `grade changed to ${grade}`;
  } else if (action === 'set_semester') {
    await db.run('UPDATE students SET current_semester = $1 WHERE user_id = $2', [Number(new_value), target_id]);
    applied = `current semester set to ${new_value}`;
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }

  // Permanent audit trail (this row is never updated or deleted)
  await audit(req.user.id, 'manual_override', 'overrides', String(target_id), {
    target_type, action, reason, new_value, applied
  });
  res.json({ message: `Manual override applied: ${applied}` });
}));

// ============ EXPORTS (Registrar â€” CSV) ============
router.get('/export/:entity', requireRole('registrar', 'super_admin'), wrap(async (req, res) => {
  const { entity } = req.params;
  const queries = {
    applications: `SELECT a.id, u.full_name, u.email, u.id_number, p.name AS programme, c.name AS certificate,
        a.status, a.receipt_verification_status, a.student_number, a.created_at, a.updated_at
      FROM applications a JOIN users u ON u.id = a.user_id
      JOIN programmes p ON p.id = a.programme_id JOIN certificates c ON c.id = a.certificate_id
      ORDER BY a.id`,
    students: `SELECT s.student_number, u.full_name, u.email, u.phone, u.id_number, p.name AS programme,
        c.name AS certificate, s.current_semester, s.status, s.created_at
      FROM students s JOIN users u ON u.id = s.user_id
      LEFT JOIN programmes p ON p.id = s.programme_id LEFT JOIN certificates c ON c.id = s.certificate_id
      ORDER BY s.student_number`,
    results: `SELECT s.student_number, u.full_name, m.code, m.title, r.academic_term, r.ca_mark, r.exam_mark,
        r.final_mark, r.grade, r.passed, r.final_exam_failed
      FROM semester_results r JOIN users u ON u.id = r.student_id
      LEFT JOIN students s ON s.user_id = u.id JOIN modules m ON m.id = r.module_id
      ORDER BY s.student_number, r.academic_term, m.code`,
    requirements: `SELECT p.name AS programme, c.name AS certificate, pr.min_cutoff_points,
        pr.required_subjects, pr.notes
      FROM programme_requirements pr JOIN programmes p ON p.id = pr.programme_id
      JOIN certificates c ON c.id = pr.certificate_id ORDER BY p.name, c.name`
  };
  const sql = queries[entity];
  if (!sql) return res.status(404).json({ error: 'Unknown export entity. Use: applications, students, results, requirements' });
  const rows = await db.all(sql);
  if (!rows.length) return res.status(404).json({ error: 'No data to export' });

  const headers = Object.keys(rows[0]);
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
  await audit(req.user.id, 'data.export', 'export', entity, { rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${entity}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

module.exports = router;

