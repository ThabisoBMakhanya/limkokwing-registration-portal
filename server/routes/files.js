'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAuth, ADMIN_ROLES } = require('../auth');
const { parseJson, UPLOAD_DIR } = require('../util');

const router = express.Router();
const folders = new Set(['documents', 'receipts', 'src', 'internship']);

router.get('/:folder/:filename', requireAuth, async (req, res, next) => {
  try {
    const { folder, filename } = req.params;
    if (!folders.has(folder) || !/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes('..')) {
      return res.status(404).json({ error: 'File not found' });
    }

    const url = `/uploads/${folder}/${filename}`;
    let allowed = false;
    if (req.user.role === 'student') {
      const apps = await db.all('SELECT registration_fee_receipt_url, documents FROM applications WHERE user_id = $1', [req.user.id]);
      allowed = apps.some(a => a.registration_fee_receipt_url === url ||
        Object.values(parseJson(a.documents, {})).includes(url));
      if (!allowed && folder === 'src') {
        allowed = !!await db.one('SELECT id FROM src_receipts WHERE student_id = $1 AND file_url = $2', [req.user.id, url]);
      }
      if (!allowed && folder === 'internship') {
        allowed = !!await db.one('SELECT id FROM internship_placements WHERE student_id = $1 AND placement_document_url = $2', [req.user.id, url]);
      }
    } else if (ADMIN_ROLES.includes(req.user.role)) {
      if (['super_admin', 'registrar'].includes(req.user.role)) {
        allowed = true;
      } else if (req.user.role === 'admissions_officer' && ['documents', 'receipts'].includes(folder)) {
        const app = folder === 'receipts'
          ? await db.one('SELECT id FROM applications WHERE registration_fee_receipt_url = $1', [url])
          : await db.all('SELECT documents FROM applications');
        allowed = folder === 'receipts' ? !!app : app.some(a => Object.values(parseJson(a.documents, {})).includes(url));
      } else if (req.user.role === 'registry_officer' && ['src', 'internship'].includes(folder)) {
        const row = folder === 'src'
          ? await db.one('SELECT id FROM src_receipts WHERE file_url = $1', [url])
          : await db.one('SELECT id FROM internship_placements WHERE placement_document_url = $1', [url]);
        allowed = !!row;
      }
    }
    if (!allowed) return res.status(404).json({ error: 'File not found' });

    res.setHeader('Cache-Control', 'private, no-store');
    const stored = await db.one(
      'SELECT content_type, file_data FROM uploaded_files WHERE folder = $1 AND filename = $2',
      [folder, filename]
    );
    if (stored) {
      res.type(stored.content_type).send(stored.file_data);
      return;
    }
    const filePath = path.resolve(UPLOAD_DIR, folder, filename);
    if (!filePath.startsWith(path.resolve(UPLOAD_DIR) + path.sep) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.sendFile(filePath);
  } catch (err) { next(err); }
});

module.exports = router;
