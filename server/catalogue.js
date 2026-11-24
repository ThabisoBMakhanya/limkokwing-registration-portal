'use strict';
const db = require('./db');
const additionalProgrammes = require('./data/eswatini-programmes');

const certificates = [
  ['EGCSE', 'Eswatini General Certificate of Secondary Education'],
  ['IGCSE', 'International General Certificate of Secondary Education'],
  ['SAC', 'Swaziland Advanced Certificate of Education']
];

const coreProgrammes = [
  {
    name: 'Associate Degree in Information Technology', level: 'associate', semesters: 5,
    description: 'A two-year programme in information technology with an industry internship in the final semester.'
  },
  {
    name: 'Bachelor of Science in Information Technology', level: 'bachelors', semesters: 8,
    description: 'An honours programme in information technology with an industry internship in the final semester.'
  }
];

const requirements = [
  ['Associate Degree in Information Technology', 'EGCSE', 30, ['Mathematics', 'English'], 'Minimum points and subject rules are sample catalogue values; Admissions must confirm the current official criteria.'],
  ['Associate Degree in Information Technology', 'IGCSE', 6, ['Mathematics', 'English'], 'Minimum points and subject rules are sample catalogue values; Admissions must confirm the current official criteria.'],
  ['Associate Degree in Information Technology', 'SAC', 10, ['Mathematics', 'English'], 'Minimum points and subject rules are sample catalogue values; Admissions must confirm the current official criteria.'],
  ['Bachelor of Science in Information Technology', 'EGCSE', 35, ['Mathematics', 'English', 'Sciences (Physics/Computer Science)'], 'Minimum points and subject rules are sample catalogue values; Admissions must confirm the current official criteria.'],
  ['Bachelor of Science in Information Technology', 'IGCSE', 8, ['Mathematics', 'English', 'Sciences (Physics/Computer Science)'], 'Minimum points and subject rules are sample catalogue values; Admissions must confirm the current official criteria.'],
  ['Bachelor of Science in Information Technology', 'SAC', 12, ['Mathematics', 'English', 'Sciences'], 'Minimum points and subject rules are sample catalogue values; Admissions must confirm the current official criteria.']
];

/** Safely fills public catalogue rows on an empty deployment without touching users or modules. */
async function ensureCatalogue() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [77420311]);

    for (const [name, description] of certificates) {
      await client.query(
        'INSERT INTO certificates (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [name, description]
      );
    }

    for (const p of [...coreProgrammes, ...additionalProgrammes.map(item => ({
      name: item.name, level: item.level, semesters: item.level === 'associate' ? 5 : 8, description: null
    }))]) {
      const found = await client.query('SELECT id FROM programmes WHERE name = $1 LIMIT 1', [p.name]);
      if (found.rowCount) continue;
      const semesters = p.semesters;
      await client.query(
        `INSERT INTO programmes (name, level, duration_years, total_semesters, internship_semester,
          credits_per_semester, minor_credits_required, description)
         VALUES ($1, $2, $3, $4, $4, 18, $5, $6)`,
        [p.name, p.level, p.level === 'associate' ? 2 : 4, semesters, p.level === 'associate' ? 6 : 12, p.description]
      );
    }

    for (const [programmeName, certificateName, cutoff, subjects, notes] of requirements) {
      await client.query(
        `INSERT INTO programme_requirements (programme_id, certificate_id, min_cutoff_points, required_subjects, notes)
         SELECT p.id, c.id, $3, $4, $5 FROM programmes p, certificates c
         WHERE p.name = $1 AND c.name = $2
         ON CONFLICT (programme_id, certificate_id) DO NOTHING`,
        [programmeName, certificateName, cutoff, JSON.stringify(subjects), notes]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { ensureCatalogue };
