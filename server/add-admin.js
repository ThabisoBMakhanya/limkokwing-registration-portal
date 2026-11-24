'use strict';
const db = require('../server/db');
const bcrypt = require('bcryptjs');

db.initSchema().then(async () => {
  const hash = bcrypt.hashSync('mandla76964082', 10);
  const email = 'bonganithabiso84@gmail.com';
  const existing = await db.one('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    await db.run(
      'UPDATE users SET full_name = $1, password_hash = $2, role = $3, email_verified = 1, is_active = 1 WHERE email = $4',
      ['Thabiso Makhanya', hash, 'super_admin', email]
    );
    console.log('Updated admin user id', existing.id);
  } else {
    const r = await db.run(
      'INSERT INTO users (full_name, email, password_hash, role, email_verified) VALUES ($1, $2, $3, $4, 1) RETURNING id',
      ['Thabiso Makhanya', email, hash, 'super_admin']
    );
    console.log('Created admin user id', r.lastInsertRowid);
  }
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
