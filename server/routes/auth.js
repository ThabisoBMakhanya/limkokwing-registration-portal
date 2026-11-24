'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');
const { sendEmail, publicUser, audit } = require('../util');

const router = express.Router();

function verificationPage(success) {
  const title = success ? 'Your email is verified' : 'This verification link is no longer valid';
  const message = success
    ? 'Your account is ready. Sign in to continue your application.'
    : 'The link may have expired or already been used. Sign in if your account is active, or create a new account.';
  const actionHref = success ? '/#/login?verified=1' : '/#/login';
  const actionLabel = success ? 'Sign in to your account' : 'Go to sign in';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#111"><title>${title} | Limkokwing Eswatini</title>
<style>
:root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#111;background:#f3f3f3}
*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;grid-template-columns:minmax(260px,1fr) minmax(360px,1fr);background:#fff}
.photo{position:relative;min-height:100vh;background:linear-gradient(180deg,rgba(0,0,0,.12),rgba(0,0,0,.78)),url('/assets/students-1.jpg') center/cover no-repeat;color:#fff;display:flex;align-items:flex-end;padding:clamp(28px,6vw,76px)}
.photo-copy{max-width:480px}.photo-copy small{font-size:.75rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.photo-copy h2{font-size:clamp(2rem,4vw,3.4rem);line-height:1.05;margin:.7rem 0}.photo-copy p{max-width:400px;line-height:1.65;color:#eee}
.content{display:grid;place-items:center;padding:36px 24px}.card{width:min(100%,480px);padding:clamp(26px,5vw,52px);border:1px solid #ddd;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.09)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:42px}.brand img{width:56px;height:56px;object-fit:contain;border:1px solid #ddd;border-radius:8px;padding:4px}.brand b{display:block;font-size:.95rem}.brand span{display:block;margin-top:4px;color:#555;font-size:.75rem}
.label{display:inline-block;padding:6px 10px;border:1px solid #111;border-radius:999px;background:#111;color:#fff;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
h1{margin:18px 0 10px;font-size:clamp(1.8rem,3vw,2.5rem);line-height:1.1}p{color:#444;line-height:1.65}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}.button{display:inline-flex;min-height:48px;align-items:center;justify-content:center;padding:12px 18px;border:1px solid #111;border-radius:7px;background:#111;color:#fff;text-decoration:none;font-size:.9rem;font-weight:700}.button:hover{background:#333}.secondary{background:#fff;color:#111}.secondary:hover{background:#eee;color:#111}.note{margin-top:28px;padding-top:18px;border-top:1px solid #ddd;color:#555;font-size:.82rem}
@media(max-width:760px){body{grid-template-columns:1fr}.photo{min-height:220px;padding:26px}.photo-copy h2{font-size:1.8rem}.photo-copy p{margin-bottom:0}.content{padding:18px}.card{padding:26px}.brand{margin-bottom:28px}}
</style></head><body>
<section class="photo" aria-label="Limkokwing students"><div class="photo-copy"><small>Limkokwing University · Eswatini</small><h2>Your next chapter starts here.</h2><p>Complete your registration online and keep track of your application in one place.</p></div></section>
<main class="content"><article class="card"><div class="brand"><img src="/assets/logo.png" alt="Limkokwing University"><div><b>Student Registration Portal</b><span>Eswatini Campus</span></div></div>
<span class="label">${success ? 'Email verified' : 'Verification needed'}</span><h1>${title}</h1><p>${message}</p>
<div class="actions"><a class="button" href="${actionHref}">${actionLabel}</a><a class="button secondary" href="/#/">Return to portal home</a></div>
<div class="note">If you need help, contact <a href="mailto:admissions@limkokwing.ac.sz">Admissions</a>.</div></article></main></body></html>`;
}

// POST /api/auth/register — student account creation + email verification link
router.post('/register', async (req, res, next) => {
  try {
    const { full_name, email, phone, id_number, password } = req.body || {};
    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'Full name, email and password are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await db.one('SELECT id FROM users WHERE email = $1', [String(email).toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const token = crypto.randomBytes(32).toString('hex');
    const hash = bcrypt.hashSync(password, 10);
    const r = await db.run(
      `INSERT INTO users (full_name, email, phone, id_number, password_hash, role, email_verified, verification_token)
       VALUES ($1, $2, $3, $4, $5, 'student', 0, $6) RETURNING id`,
      [String(full_name).trim(), String(email).toLowerCase(), phone || null, id_number || null, hash, token]
    );
    const userId = r.lastInsertRowid;
    await db.run('INSERT INTO students (user_id, status) VALUES ($1, $2)', [userId, 'applicant']);

    const verifyUrl = `${req.protocol}://${req.get('host')}/api/auth/verify?token=${token}`;
    sendEmail(String(email).toLowerCase(), 'Verify your Limkokwing Eswatini registration account',
      `Hello ${full_name},\n\nPlease verify your email address by opening this link:\n${verifyUrl}\n\nIf you did not create this account, ignore this email.`);

    await audit(userId, 'student.register', 'users', userId, { email });
    res.status(201).json({
      message: 'Account created. Check your email for the verification link.',
      verification_url: verifyUrl
    });
  } catch (err) { next(err); }
});

// GET /api/auth/verify?token=
router.get('/verify', async (req, res, next) => {
  try {
    const { token } = req.query;
    const wantsHtml = req.accepts('html');
    if (!token) {
      if (wantsHtml) return res.status(400).type('html').send(verificationPage(false));
      return res.status(400).json({ error: 'Verification token missing' });
    }
    const user = await db.one('SELECT * FROM users WHERE verification_token = $1', [String(token)]);
    if (!user) {
      if (wantsHtml) return res.status(400).type('html').send(verificationPage(false));
      return res.status(400).json({ error: 'Invalid or already used verification token' });
    }
    await db.run('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = $1', [user.id]);
    await audit(user.id, 'student.email_verified', 'users', user.id, {});
    if (wantsHtml) return res.type('html').send(verificationPage(true));
    res.json({ message: 'Email verified. You can now sign in.', redirect: '/#/login?verified=1' });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = await db.one('SELECT * FROM users WHERE email = $1', [String(email).toLowerCase()]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    if (!user.is_active) return res.status(403).json({ error: 'Account is disabled' });
    if (user.role === 'student' && !user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email address before signing in' });
    }
    await audit(user.id, 'auth.login', 'users', user.id, {});
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = publicUser(req.user);
    if (req.user.role === 'student') {
      user.student = await db.one('SELECT * FROM students WHERE user_id = $1', [req.user.id]) || null;
    }
    res.json({ user });
  } catch (err) { next(err); }
});

// PUT /api/auth/profile — students may edit only their own profile
router.put('/profile', requireAuth, async (req, res, next) => {
  try {
    const { full_name, phone, id_number, password } = req.body || {};
    const fields = [];
    const values = [];
    if (full_name) { values.push(String(full_name).trim()); fields.push(`full_name = $${values.length}`); }
    if (phone !== undefined) { values.push(phone || null); fields.push(`phone = $${values.length}`); }
    if (req.user.role === 'student' && id_number !== undefined) { values.push(id_number || null); fields.push(`id_number = $${values.length}`); }
    if (password) {
      if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      values.push(bcrypt.hashSync(password, 10)); fields.push(`password_hash = $${values.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.user.id);
    await db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
    await audit(req.user.id, 'profile.update', 'users', req.user.id, { fields: fields.length });
    const fresh = await db.one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json({ message: 'Profile updated', user: publicUser(fresh) });
  } catch (err) { next(err); }
});

module.exports = router;
