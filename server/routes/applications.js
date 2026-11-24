'use strict';
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { saveUpload, audit, publicUser, parseJson } = require('../util');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

async function latestApplication(userId) {
  return db.one('SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [userId]);
}

// GET /api/applications/me — status tracker + latest application
router.get('/me', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    const app = await latestApplication(req.user.id);
    const student = await db.one('SELECT * FROM students WHERE user_id = $1', [req.user.id]);
    let programme = null, certificate = null;
    if (app) {
      programme = await db.one('SELECT * FROM programmes WHERE id = $1', [app.programme_id]);
      certificate = await db.one('SELECT * FROM certificates WHERE id = $1', [app.certificate_id]);
    }
    res.json({
      application: app ? {
        ...app,
        personal_details: parseJson(app.personal_details, {}),
        contact_details: parseJson(app.contact_details, {}),
        academic_history: parseJson(app.academic_history, []),
        documents: parseJson(app.documents, {})
      } : null,
      programme, certificate, student,
      user: publicUser(req.user)
    });
  } catch (err) { next(err); }
});

// Server-side validation before an application can be submitted
async function finalizeSubmission(req, res) {
  const app = await latestApplication(req.user.id);
  if (!app) return res.status(400).json({ error: 'No application to submit' });

  const missing = [];
  const personal = parseJson(app.personal_details, {});
  const contact = parseJson(app.contact_details, {});
  const documents = parseJson(app.documents, {});
  if (!personal.first_name || !personal.last_name) missing.push('personal details (first and last name)');
  if (!contact.address || !contact.city) missing.push('contact details (address and city)');
  if (!documents.academic_cert) missing.push('academic certificate upload');
  if (!app.registration_fee_receipt_url) missing.push('registration fee receipt upload');

  if (missing.length) {
    return res.status(422).json({
      error: 'Application cannot be submitted',
      missing,
      detail: 'The academic certificate and registration fee receipt are mandatory and enforced server-side.'
    });
  }

  await db.run(
    `UPDATE applications SET status = 'submitted', receipt_verification_status = 'pending', updated_at = now()
     WHERE id = $1`,
    [app.id]
  );
  await audit(req.user.id, 'application.submit', 'applications', app.id, { certificate_id: app.certificate_id });

  const fresh = await latestApplication(req.user.id);
  res.json({
    message: 'Application submitted. An Admissions Officer will verify your registration fee receipt.',
    application: fresh
  });
}

// POST /api/applications — create/replace application (multi-step form data)
router.post('/', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    const {
      programme_id, certificate_id, personal_details, contact_details,
      academic_history, documents, submit
    } = req.body || {};

    if (!programme_id) return res.status(400).json({ error: 'Programme selection is required' });
    if (!certificate_id) return res.status(400).json({ error: 'Certificate/qualification selection is required' });

    const programme = await db.one('SELECT * FROM programmes WHERE id = $1 AND is_active = 1', [programme_id]);
    if (!programme) return res.status(400).json({ error: 'Invalid programme' });
    const certificate = await db.one('SELECT * FROM certificates WHERE id = $1 AND is_active = 1', [certificate_id]);
    if (!certificate) return res.status(400).json({ error: 'Invalid certificate' });

    const existing = await latestApplication(req.user.id);
    if (existing && ['accepted', 'registered'].includes(existing.status)) {
      return res.status(409).json({ error: 'You already have an accepted application' });
    }

    const personal = { ...parseJson(existing?.personal_details, {}), ...(personal_details || {}) };
    const contact = { ...parseJson(existing?.contact_details, {}), ...(contact_details || {}) };
    const history = academic_history || parseJson(existing?.academic_history, []);
    const docs = { ...parseJson(existing?.documents, {}), ...(documents || {}) };

    let appId;
    if (existing) {
      await db.run(
        `UPDATE applications SET programme_id = $1, certificate_id = $2, personal_details = $3,
          contact_details = $4, academic_history = $5, documents = $6, updated_at = now()
         WHERE id = $7`,
        [programme_id, certificate_id, JSON.stringify(personal), JSON.stringify(contact),
          JSON.stringify(history), JSON.stringify(docs), existing.id]
      );
      appId = existing.id;
    } else {
      const r = await db.run(
        `INSERT INTO applications (user_id, programme_id, certificate_id, personal_details, contact_details, academic_history, documents)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.user.id, programme_id, certificate_id, JSON.stringify(personal),
          JSON.stringify(contact), JSON.stringify(history), JSON.stringify(docs)]
      );
      appId = r.lastInsertRowid;
    }

    if (submit) return finalizeSubmission(req, res);
    await audit(req.user.id, 'application.save_draft', 'applications', appId, { programme_id, certificate_id });
    res.json({ message: 'Application saved', application: await latestApplication(req.user.id) });
  } catch (err) { next(err); }
});

// POST /api/applications/fee-receipt — mandatory first-time registration fee receipt
router.post('/fee-receipt', requireAuth, requireRole('student'), upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Registration fee receipt file is required' });
    const saved = await saveUpload(req.file, 'receipts');

    const app = await latestApplication(req.user.id);
    if (!app) return res.status(400).json({ error: 'Start your application before uploading the receipt' });

    await db.run(
      `UPDATE applications SET registration_fee_receipt_url = $1, receipt_verification_status = 'pending',
        receipt_rejection_reason = NULL, updated_at = now() WHERE id = $2`,
      [saved.url, app.id]
    );
    await audit(req.user.id, 'application.fee_receipt_upload', 'applications', app.id, {
      compressed: saved.compressed, originalBytes: saved.originalBytes, storedBytes: saved.storedBytes
    });
    res.json({
      message: saved.compressed
        ? `Receipt uploaded and compressed from ${(saved.originalBytes / 1048576).toFixed(2)}MB to ${(saved.storedBytes / 1048576).toFixed(2)}MB`
        : 'Receipt uploaded',
      receipt: saved,
      application: await latestApplication(req.user.id)
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/applications/documents — supporting documents (ID copy, academic certificates, …)
router.post('/documents', requireAuth, requireRole('student'), upload.single('document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const key = String(req.body?.key || '').trim();
    if (!key || !/^[a-z0-9_]+$/i.test(key)) return res.status(400).json({ error: 'A valid document key is required' });
    const app = await latestApplication(req.user.id);
    if (!app) return res.status(400).json({ error: 'Start your application before uploading documents' });
    const saved = await saveUpload(req.file, 'documents');
    const docs = parseJson(app.documents, {});
    docs[key] = saved.url;
    await db.run('UPDATE applications SET documents = $1, updated_at = now() WHERE id = $2',
      [JSON.stringify(docs), app.id]);
    await audit(req.user.id, 'application.document_upload', 'applications', app.id, { key, compressed: saved.compressed });
    res.json({ message: saved.compressed ? `${key} uploaded (compressed)` : `${key} uploaded`, key, url: saved.url, receipt: saved });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/applications/:id/documents/:name — student downloads own documents only
router.get('/:id/documents/:name', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    const app = await db.one('SELECT * FROM applications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const key = req.params.name;
    if (key === 'fee_receipt' && app.registration_fee_receipt_url) return res.redirect(app.registration_fee_receipt_url);
    const docs = parseJson(app.documents, {});
    if (!docs[key]) return res.status(404).json({ error: 'Document not found' });
    res.redirect(docs[key]);
  } catch (err) { next(err); }
});

module.exports = router;
