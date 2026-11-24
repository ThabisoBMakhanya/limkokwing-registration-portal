'use strict';

const { Pool } = require('pg');
const db = require('../db'); // Loads DATABASE_URL from the project .env file.
const programmes = require('../data/eswatini-programmes');

async function migrate() {
  const directUrl = new URL(process.env.DATABASE_URL);
  directUrl.hostname = directUrl.hostname.replace('-pooler.', '.');
  if (directUrl.hostname.includes('-pooler.')) {
    throw new Error('The migration requires a direct Neon connection URL.');
  }

  const pool = new Pool({
    connectionString: directUrl.toString(),
    ssl: { rejectUnauthorized: false },
    max: 1
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Match the current Eswatini Higher Education Council programme title.
    await client.query(
      `UPDATE programmes
       SET name = 'Bachelor of Science in Information Technology'
       WHERE name = 'Bachelor of Science (Hons) in Information Technology'
         AND NOT EXISTS (
           SELECT 1 FROM programmes
           WHERE name = 'Bachelor of Science in Information Technology'
         )`
    );

    let added = 0;
    for (const programme of programmes) {
      const result = await client.query(
        `INSERT INTO programmes (name, level, faculty, duration_years, total_semesters,
          internship_semester, credits_per_semester, minor_credits_required, description)
         SELECT $1, $2, NULL, $3, $4, $4, 18, 12, NULL
         WHERE NOT EXISTS (SELECT 1 FROM programmes WHERE name = $1)
         RETURNING id`,
        [programme.name, programme.level, programme.level === 'associate' ? 2 : 4,
          programme.level === 'associate' ? 5 : 8]
      );
      added += result.rowCount;
    }

    await client.query('COMMIT');
    console.log(`Programme migration complete. Added ${added} programmes; existing records were preserved.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
    await db.pool.end();
  }
}

migrate().catch(error => {
  console.error('Programme migration failed:', {
    name: error.name,
    code: error.code,
    message: error.message,
    detail: error.detail
  });
  process.exitCode = 1;
});
