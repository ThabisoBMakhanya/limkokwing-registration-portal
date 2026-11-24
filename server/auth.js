'use strict';
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'limkokwing-eswatini-dev-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '12h';

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.full_name, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (_) { return null; }
}

/** Requires a valid token; attaches req.user (full DB row). */
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  try {
    const user = await db.one('SELECT * FROM users WHERE id = $1 AND is_active = 1', [payload.id]);
    if (!user) return res.status(401).json({ error: 'Account not found or disabled' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Optional auth: attaches req.user when a valid token is present. */
async function optionalAuth(req, _res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        const user = await db.one('SELECT * FROM users WHERE id = $1 AND is_active = 1', [payload.id]);
        if (user) req.user = user;
      }
    }
    next();
  } catch (_) { next(); }
}

/** Server-side RBAC: exact role check before any privileged API executes. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: requires role ${roles.join(' or ')}` });
    }
    next();
  };
}

const ADMIN_ROLES = ['super_admin', 'admissions_officer', 'registry_officer', 'registrar'];

function requireAdmin(...roles) {
  if (roles.length === 0) return requireRole(...ADMIN_ROLES);
  return requireRole(...roles);
}

module.exports = { signToken, verifyToken, extractToken, requireAuth, optionalAuth, requireRole, requireAdmin, ADMIN_ROLES, JWT_SECRET };
