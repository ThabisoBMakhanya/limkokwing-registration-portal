'use strict';
const express = require('express');
const db = require('../db');
const { parseJson } = require('../util');
const { ensureCatalogue } = require('../catalogue');

const router = express.Router();

// GET /api/public/programmes — programme list with certificate-specific requirements
router.get('/programmes', async (_req, res, next) => {
  try {
    await ensureCatalogue();
    const programmes = await db.all('SELECT * FROM programmes WHERE is_active = 1 ORDER BY total_semesters, name');
    const out = [];
    for (const p of programmes) {
      const reqs = await db.all(
        `SELECT pr.id, pr.min_cutoff_points, pr.required_subjects, pr.notes,
                c.id AS certificate_id, c.name AS certificate_name, c.description AS certificate_description
         FROM programme_requirements pr
         JOIN certificates c ON c.id = pr.certificate_id
         WHERE pr.programme_id = $1 AND c.is_active = 1
         ORDER BY c.name`,
        [p.id]
      );
      out.push({
        ...p,
        requirements: reqs.map(r => ({ ...r, required_subjects: parseJson(r.required_subjects, []) }))
      });
    }
    res.json({ programmes: out });
  } catch (err) { next(err); }
});

// GET /api/public/programmes/:id
router.get('/programmes/:id', async (req, res, next) => {
  try {
    const p = await db.one('SELECT * FROM programmes WHERE id = $1 AND is_active = 1', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Programme not found' });
    const reqs = await db.all(
      `SELECT pr.id, pr.min_cutoff_points, pr.required_subjects, pr.notes,
              c.id AS certificate_id, c.name AS certificate_name
       FROM programme_requirements pr JOIN certificates c ON c.id = pr.certificate_id
       WHERE pr.programme_id = $1 AND c.is_active = 1 ORDER BY c.name`,
      [p.id]
    );
    res.json({ programme: { ...p, requirements: reqs.map(r => ({ ...r, required_subjects: parseJson(r.required_subjects, []) })) } });
  } catch (err) { next(err); }
});

// GET /api/public/certificates
router.get('/certificates', async (_req, res, next) => {
  try {
    await ensureCatalogue();
    res.json({ certificates: await db.all('SELECT * FROM certificates WHERE is_active = 1 ORDER BY name') });
  } catch (err) { next(err); }
});

// GET /api/public/grading-scale
router.get('/grading-scale', async (_req, res, next) => {
  try {
    res.json({ grading_scale: await db.all('SELECT * FROM grading_scale ORDER BY id') });
  } catch (err) { next(err); }
});

module.exports = router;
