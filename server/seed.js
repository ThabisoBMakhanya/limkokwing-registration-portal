'use strict';
const bcrypt = require('bcryptjs');
const db = require('./db');
const eswatiniProgrammes = require('./data/eswatini-programmes');

async function seed({ reset = true } = {}) {
  const bootstrapPassword = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
  if (!bootstrapPassword || bootstrapPassword.length < 12) {
    throw new Error('Set BOOTSTRAP_SUPER_ADMIN_PASSWORD to a unique password of at least 12 characters before seeding.');
  }

  if (reset) {
    await db.exec(`
      TRUNCATE TABLE
        chatbot_logs, audit_log, internship_placements, src_receipts,
        semester_registrations, clearance_status, semester_results,
        enrolments, applications, module_prerequisites, modules,
        programme_requirements, students, student_number_sequences, programmes, certificates,
        grading_scale, users
      RESTART IDENTITY CASCADE;
    `);
  }

  // ---- Certificates ----
  const certs = [
    ['EGCSE', 'Eswatini General Certificate of Secondary Education (local EGCSE)'],
    ['IGCSE', 'International General Certificate of Secondary Education (Cambridge)'],
    ['SAC', 'Swaziland Advanced Certificate of Education (Grade 12 / A-Level equivalent)']
  ];
  const certIds = {};
  for (const [name, description] of certs) {
    const r = await db.run('INSERT INTO certificates (name, description) VALUES ($1, $2) RETURNING id', [name, description]);
    certIds[name] = r.lastInsertRowid;
  }

  // ---- Programmes ----
  const assoc = await db.run(
    `INSERT INTO programmes (name, level, faculty, duration_years, total_semesters, internship_semester,
      credits_per_semester, minor_credits_required, description)
     VALUES ($1, 'associate', $2, 2, 5, 5, 18, 6, $3) RETURNING id`,
    ['Associate Degree in Information Technology', 'School of Information Technology',
      'A two-year programme covering programming fundamentals, web and mobile development, databases and systems analysis, ending with a one-semester industry internship.']
  );
  const bach = await db.run(
    `INSERT INTO programmes (name, level, faculty, duration_years, total_semesters, internship_semester,
      credits_per_semester, minor_credits_required, description)
     VALUES ($1, 'bachelors', $2, 4, 8, 8, 18, 12, $3) RETURNING id`,
    ['Bachelor of Science in Information Technology', 'School of Information Technology',
      'A four-year programme covering information technology and a final-semester industry internship.']
  );
  const assocId = assoc.lastInsertRowid;
  const bachId = bach.lastInsertRowid;

  // Additional Eswatini offerings from the published ESHEC programme list.
  // Requirement rows are deliberately not created without verified criteria.
  for (const programme of eswatiniProgrammes) {
    await db.run(
      `INSERT INTO programmes (name, level, faculty, duration_years, total_semesters,
        internship_semester, credits_per_semester, minor_credits_required, description)
       VALUES ($1, $2, NULL, $3, $4, $4, 18, 12, NULL)`,
      [programme.name, programme.level, programme.level === 'associate' ? 2 : 4,
        programme.level === 'associate' ? 5 : 8]
    );
  }

  // ---- Certificate-specific admission requirements ----
  const reqs = [
    [assocId, certIds.EGCSE, 30, ['Mathematics', 'English'], 'Minimum 30 points on the EGCSE aggregate scale; Mathematics and English must be passed (grade C or better).'],
    [assocId, certIds.IGCSE, 6, ['Mathematics', 'English'], 'Minimum 6 points (best 6 subjects); Mathematics and English must be grade C or better.'],
    [assocId, certIds.SAC, 10, ['Mathematics', 'English'], 'Minimum 10 points from best 5 subjects; Mathematics and English at SAC level required.'],
    [bachId, certIds.EGCSE, 35, ['Mathematics', 'English', 'Sciences (Physics/Computer Science)'], 'Minimum 35 points on the EGCSE aggregate scale; Mathematics, English and a Science must be passed at grade C or better.'],
    [bachId, certIds.IGCSE, 8, ['Mathematics', 'English', 'Sciences (Physics/Computer Science)'], 'Minimum 8 points across best 8 subjects; Mathematics, English and a Science must be grade C or better.'],
    [bachId, certIds.SAC, 12, ['Mathematics', 'English', 'Sciences'], 'Minimum 12 points from best 5 SAC subjects; Mathematics, English and a Science required.']
  ];
  for (const [p, c, pts, subjects, notes] of reqs) {
    await db.run(
      'INSERT INTO programme_requirements (programme_id, certificate_id, min_cutoff_points, required_subjects, notes) VALUES ($1, $2, $3, $4, $5)',
      [p, c, pts, JSON.stringify(subjects), notes]
    );
  }

  // ---- Limkokwing grading scale ----
  const grades = [
    ['A+', 80, 100, 4.0, 'Distinction'],
    ['A', 75, 79.99, 4.0, 'Distinction'],
    ['A-', 70, 74.99, 3.7, 'Distinction'],
    ['B+', 65, 69.99, 3.3, 'Credit'],
    ['B', 60, 64.99, 3.0, 'Credit'],
    ['B-', 55, 59.99, 2.7, 'Credit'],
    ['C+', 50, 54.99, 2.3, 'Pass'],
    ['C', 45, 49.99, 2.0, 'Pass'],
    ['D', 40, 44.99, 1.0, 'Pass (marginal)'],
    ['F', 0, 39.99, 0.0, 'Fail'],
    ['PX', null, null, 0.0, 'Pass (exemption / credit granted)'],
    ['X', null, null, 0.0, 'Absent for assessment'],
    ['DNC', null, null, 0.0, 'Did Not Complete'],
    ['DNS', null, null, 0.0, 'Did Not Sit (final exam not written)']
  ];
  for (const [g, min, max, pts, desc] of grades) {
    await db.run('INSERT INTO grading_scale (grade, min_mark, max_mark, points, description) VALUES ($1, $2, $3, $4, $5)',
      [g, min, max, pts, desc]);
  }

  // Modules are added by the Super Admin after setup; the seed catalogue is intentionally empty.

  // ---- Admin accounts ----
  const admins = [
    ['Thabiso Makhanya', 'bonganithabiso84@gmail.com', 'super_admin', bootstrapPassword]
  ];
  for (const [name, email, role, configuredPassword] of admins) {
    const hash = bcrypt.hashSync(configuredPassword, 10);
    await db.run(
      "INSERT INTO users (full_name, email, password_hash, role, email_verified) VALUES ($1, $2, $3, $4, 1)",
      [name, email, hash, role]
    );
  }

  console.log('Seed complete (Neon Postgres).');
  console.log('Only the configured Super Admin account was seeded. Add staff accounts through Admin > Accounts.');
}

if (require.main === module) {
  db.initSchema()
    .then(() => seed({ reset: process.argv.includes('--no-reset') ? false : true }))
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { seed };

