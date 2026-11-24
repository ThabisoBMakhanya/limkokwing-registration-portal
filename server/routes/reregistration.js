'use strict';
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { saveUpload, audit, nowTerm, nextTerm, PASSING_GRADES, parseJson } = require('../util');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PG_PASSING = PASSING_GRADES; // ['A+'...'D','PX']

function placeholders(n, offset = 0) {
  return Array.from({ length: n }, (_, i) => `$${i + 1 + offset}`).join(', ');
}

async function getStudent(userId) {
  return db.one('SELECT * FROM students WHERE user_id = $1', [userId]);
}
async function getProgramme(student) {
  return student?.programme_id ? db.one('SELECT * FROM programmes WHERE id = $1', [student.programme_id]) : null;
}

/** Module ids the student has passed. */
async function passedModuleIds(studentId) {
  const rows = await db.all(
    `SELECT module_id, grade FROM semester_results WHERE student_id = $1`,
    [studentId]
  );
  return new Set(rows.filter(r => PG_PASSING.includes(r.grade)).map(r => r.module_id));
}

/** Pending = failed modules, flagged final-exam failures, or enrolments without results. */
async function pendingModules(studentId) {
  const rows = await db.all(
    `SELECT m.id, m.code, m.title, m.credits, r.grade, r.final_mark, r.final_exam_failed, r.academic_term
     FROM semester_results r JOIN modules m ON m.id = r.module_id
     WHERE r.student_id = $1`,
    [studentId]
  );
  const pending = rows.filter(r => !PG_PASSING.includes(r.grade));
  const enrolments = await db.all(
    `SELECT m.id, m.code, m.title, m.credits, e.academic_term, e.status
     FROM enrolments e JOIN modules m ON m.id = e.module_id
     WHERE e.student_id = $1 AND e.status IN ('registered','failed','pending')`,
    [studentId]
  );
  const seen = new Set(pending.map(p => p.id));
  for (const e of enrolments) {
    const hasResult = rows.some(r => r.module_id === e.id && r.academic_term === e.academic_term);
    if (!hasResult && !seen.has(e.id)) {
      pending.push({ id: e.id, code: e.code, title: e.title, credits: e.credits, grade: null, academic_term: e.academic_term });
      seen.add(e.id);
    } else if (e.status === 'failed' && !seen.has(e.id)) {
      pending.push({ id: e.id, code: e.code, title: e.title, credits: e.credits, grade: 'F', academic_term: e.academic_term });
      seen.add(e.id);
    }
  }
  return pending;
}

/** Eligibility gate: admin clearance + zero pending modules. */
async function eligibility(studentId) {
  const student = await getStudent(studentId);
  const term = nowTerm();
  const [y, s] = term.split('/sem-');
  const previousTerm = s === '1' ? `${Number(y) - 1}/sem-2` : `${y}/sem-1`;
  const clearance = await db.one(
    'SELECT * FROM clearance_status WHERE student_id = $1 AND academic_term = $2',
    [studentId, previousTerm]
  ) || await db.one('SELECT * FROM clearance_status WHERE student_id = $1 ORDER BY id DESC LIMIT 1', [studentId]);
  const pending = await pendingModules(studentId);
  const cleared = !!(clearance && clearance.cleared);
  const application = await db.one(
    'SELECT status, certificate_verified FROM applications WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
    [studentId]
  );
  const admissionConfirmed = !application || (['accepted', 'registered'].includes(application.status) && !!application.certificate_verified);
  return {
    eligible: cleared && pending.length === 0 && student?.status === 'registered' && admissionConfirmed,
    cleared_by_admin: cleared,
    clearance_term: clearance?.academic_term || null,
    clearance_reason: clearance?.reason || null,
    pending_modules: pending,
    reason: !cleared
      ? 'An Administrator has not yet marked you as cleared for re-registration.'
      : !admissionConfirmed
        ? 'Admissions must verify your academic certificate and confirm your application before re-registration.'
      : pending.length > 0
        ? `You have ${pending.length} pending/failed module(s) that must be passed first.`
        : null
  };
}

async function prereqCheck(moduleIds, studentId) {
  const passed = await passedModuleIds(studentId);
  const problems = [];
  for (const id of moduleIds) {
    const prereqs = await db.all('SELECT prerequisite_module_id FROM module_prerequisites WHERE module_id = $1', [id]);
    for (const p of prereqs) {
      if (!passed.has(p.prerequisite_module_id)) {
        const m = await db.one('SELECT code, title FROM modules WHERE id = $1', [p.prerequisite_module_id]);
        const target = await db.one('SELECT code, title FROM modules WHERE id = $1', [id]);
        problems.push({
          module: target?.code, module_title: target?.title,
          missing_prerequisite: m?.code, missing_prerequisite_title: m?.title
        });
      }
    }
  }
  return problems;
}

/** Next semester preview: modules the admin scheduled for the upcoming semester. */
async function nextSemesterPreview(student) {
  const programme = await getProgramme(student);
  if (!programme) return null;
  const nextSem = student.current_semester + 1;
  const isInternship = nextSem === programme.internship_semester;
  const modules = await db.all(
    `SELECT m.id, m.code, m.title, m.credits, m.classification, m.semester_number
     FROM modules m WHERE m.programme_id = $1 AND m.semester_number = $2 AND m.is_active = 1
     ORDER BY CASE m.classification WHEN 'core' THEN 0 WHEN 'minor' THEN 1 ELSE 2 END, m.code`,
    [programme.id, nextSem]
  );

  const passed = await passedModuleIds(student.user_id);

  const core = [], minor = [], elective = [];
  for (const m of modules) {
    const entry = { ...m, already_passed: passed.has(m.id), prereqs_ok: (await prereqCheck([m.id], student.user_id)).length === 0 };
    if (m.classification === 'core') core.push(entry);
    else if (m.classification === 'minor') minor.push(entry);
    else elective.push(entry);
  }

  const minorRow = await db.one(
    `SELECT COALESCE(SUM(m.credits),0) AS c FROM semester_results r JOIN modules m ON m.id = r.module_id
     WHERE r.student_id = $1 AND m.classification = 'minor' AND r.grade = ANY($2::text[])`,
    [student.user_id, PG_PASSING]
  );
  const completedMinorCredits = Number(minorRow?.c || 0);

  return {
    semester_number: nextSem,
    academic_term: nextTerm(nowTerm()),
    programme,
    is_internship: isInternship,
    core_modules: core,
    minor_modules: minor,
    elective_modules: elective,
    credits_per_semester: programme.credits_per_semester,
    minor_credits_required: programme.minor_credits_required,
    minor_credits_completed: completedMinorCredits,
    minor_credits_remaining: Math.max(0, programme.minor_credits_required - completedMinorCredits)
  };
}

// GET /api/reregister/preview — eligibility + next semester module preview
router.get('/preview', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    const student = await getStudent(req.user.id);
    if (!student || !student.programme_id) return res.status(400).json({ error: 'No programme assigned to your profile' });
    const elig = await eligibility(req.user.id);
    const preview = await nextSemesterPreview(student);
    const activeReg = await db.one(
      `SELECT * FROM semester_registrations WHERE student_id = $1 AND status IN ('submitted','approved') ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ student, eligibility: elig, preview, active_registration: activeReg || null });
  } catch (err) { next(err); }
});

// GET /api/reregister — history, results, pending modules
router.get('/', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    const regs = await db.all('SELECT * FROM semester_registrations WHERE student_id = $1 ORDER BY id DESC', [req.user.id]);
    const results = await db.all(
      `SELECT r.*, m.code, m.title, m.credits FROM semester_results r JOIN modules m ON m.id = r.module_id
       WHERE r.student_id = $1 ORDER BY r.academic_term DESC, m.code`,
      [req.user.id]
    );
    res.json({
      registrations: regs.map(r => ({ ...r, selected_modules: parseJson(r.selected_modules, []) })),
      results,
      pending_modules: await pendingModules(req.user.id)
    });
  } catch (err) { next(err); }
});

// POST /api/reregister — submit semester registration (all rules enforced server-side)
router.post('/', requireAuth, requireRole('student'), upload.fields([
  { name: 'src_receipt', maxCount: 1 },
  { name: 'placement_document', maxCount: 1 }
]), async (req, res) => {
  try {
    const student = await getStudent(req.user.id);
    if (!student?.programme_id) return res.status(400).json({ error: 'No programme assigned to your profile' });
    const programme = await getProgramme(student);

    const elig = await eligibility(req.user.id);
    if (!elig.eligible) {
      return res.status(403).json({ error: 'Not eligible for re-registration', detail: elig });
    }

    const preview = await nextSemesterPreview(student);
    const term = preview.academic_term;

    const existing = await db.one(
      'SELECT * FROM semester_registrations WHERE student_id = $1 AND academic_term = $2',
      [req.user.id, term]
    );
    if (existing && existing.status !== 'rejected') {
      return res.status(409).json({ error: `You already submitted a registration for ${term}` });
    }

    // ---- Module selection ----
    let selected = req.body.selected_modules;
    if (typeof selected === 'string') { try { selected = JSON.parse(selected); } catch (_) { selected = null; } }
    if (!Array.isArray(selected)) return res.status(400).json({ error: 'Module selection is required' });

    if (preview.is_internship) {
      const internshipModule = preview.core_modules[0];
      if (!internshipModule) return res.status(400).json({ error: 'Internship module not configured for your programme' });
      selected = [internshipModule.id];
    } else {
      const activeIds = new Set([...preview.core_modules, ...preview.minor_modules, ...preview.elective_modules].map(m => m.id));
      const coreIds = preview.core_modules.map(m => m.id);
      selected = [...new Set([...coreIds, ...selected.map(Number)])];
      for (const id of selected) {
        if (!activeIds.has(id)) return res.status(400).json({ error: `Module ${id} is not offered in your next semester` });
      }
      const rows = await db.all(`SELECT * FROM modules WHERE id = ANY($1::int[])`, [selected]);
      const totalCredits = rows.reduce((s, m) => s + m.credits, 0);
      if (totalCredits < programme.credits_per_semester) {
        return res.status(400).json({
          error: `Your selection totals ${totalCredits} credits; at least ${programme.credits_per_semester} credits are required for the semester`,
          selected_credits: totalCredits, required_credits: programme.credits_per_semester
        });
      }
      const problems = await prereqCheck(selected, req.user.id);
      if (problems.length) {
        return res.status(400).json({ error: 'Prerequisite requirements not met', problems });
      }
      const passed = await passedModuleIds(req.user.id);
      const retakes = rows.filter(m => passed.has(m.id));
      if (retakes.length) {
        return res.status(400).json({ error: 'You cannot re-register for modules you have already passed', modules: retakes.map(m => m.code) });
      }
      const minorSelectedCredits = rows.filter(m => m.classification === 'minor').reduce((s, m) => s + m.credits, 0);
      const completedMinor = preview.minor_credits_completed;
      if (completedMinor + minorSelectedCredits > programme.minor_credits_required) {
        return res.status(400).json({
          error: `Minor credits exceeded: at most ${Math.max(0, programme.minor_credits_required - completedMinor)} more minor credits allowed`,
          completed: completedMinor, selected: minorSelectedCredits, required_total: programme.minor_credits_required
        });
      }
    }

    // ---- Mandatory SRC receipt (server-side block) ----
    const srcFile = req.files?.src_receipt?.[0];
    if (!srcFile) {
      return res.status(422).json({ error: 'SRC Subscription Receipt is mandatory and must be uploaded before submitting' });
    }
    const srcSaved = await saveUpload(srcFile, 'src');

    // ---- Internship placement documents (final semester) ----
    let placementSaved = null;
    let placementPayload = null;
    if (preview.is_internship) {
      const placementFile = req.files?.placement_document?.[0];
      if (!placementFile) {
        return res.status(422).json({ error: 'Placement documents are mandatory for internship registration' });
      }
      placementPayload = {
        organisation: req.body.organisation || '',
        placement_title: req.body.placement_title || '',
        supervisor_name: req.body.supervisor_name || '',
        supervisor_email: req.body.supervisor_email || ''
      };
      if (!placementPayload.organisation) {
        return res.status(422).json({ error: 'Organisation name is required for internship placement' });
      }
      placementSaved = await saveUpload(placementFile, 'internship');
    }

    // ---- Persist registration ----
    let regId;
    if (existing) {
      await db.run(
        `UPDATE semester_registrations SET type = $1, selected_modules = $2, status = 'submitted',
          rejection_reason = NULL, updated_at = now() WHERE id = $3`,
        [preview.is_internship ? 'internship' : 'academic', JSON.stringify(selected), existing.id]
      );
      regId = existing.id;
      await db.run('DELETE FROM src_receipts WHERE registration_id = $1', [existing.id]);
    } else {
      const r = await db.run(
        `INSERT INTO semester_registrations (student_id, semester_number, academic_term, type, selected_modules, status)
         VALUES ($1, $2, $3, $4, $5, 'submitted') RETURNING id`,
        [req.user.id, preview.semester_number, term, preview.is_internship ? 'internship' : 'academic', JSON.stringify(selected)]
      );
      regId = r.lastInsertRowid;
    }

    await db.run(
      'INSERT INTO src_receipts (student_id, registration_id, file_url) VALUES ($1, $2, $3)',
      [req.user.id, regId, srcSaved.url]
    );

    if (preview.is_internship) {
      await db.run(
        `INSERT INTO internship_placements (student_id, registration_id, organisation, placement_title,
          supervisor_name, supervisor_email, placement_document_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.user.id, regId, placementPayload.organisation, placementPayload.placement_title,
          placementPayload.supervisor_name, placementPayload.supervisor_email, placementSaved.url]
      );
    }

    await audit(req.user.id, 'reregistration.submit', 'semester_registrations', regId, {
      semester: preview.semester_number, term, modules: selected.length, internship: preview.is_internship
    });

    res.status(201).json({
      message: preview.is_internship
        ? 'Internship registration submitted pending SRC receipt verification.'
        : 'Semester registration submitted pending SRC receipt verification.',
      registration_id: regId,
      src_receipt: srcSaved,
      placement_document: placementSaved
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.pendingModules = pendingModules;
module.exports.passedModuleIds = passedModuleIds;
module.exports.eligibility = eligibility;
module.exports.nextSemesterPreview = nextSemesterPreview;
