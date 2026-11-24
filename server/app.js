'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const db = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const logDir = process.env.VERCEL ? path.join(os.tmpdir(), 'logs') : path.join(__dirname, '..', 'logs');
const apiLog = path.join(logDir, 'api-requests.log');
function logApiFailure(message) {
  if (process.env.VERCEL) {
    console.warn(`[API] ${message}`);
    return;
  }
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
  fs.appendFile(apiLog, `[${new Date().toISOString()}] ${message}\n`, () => {});
}
app.use('/api', (req, res, next) => {
  const started = Date.now();
  res.once('finish', () => {
    if (res.statusCode >= 400) logApiFailure(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - started}ms)`);
  });
  res.once('close', () => {
    if (!res.writableFinished) logApiFailure(`${req.method} ${req.path} -> connection closed before response (${Date.now() - started}ms)`);
  });
  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

let schemaPromise;
app.use((req, res, next) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      error: 'Database is not configured for this deployment. Add DATABASE_URL to the Vercel production environment and redeploy.'
    });
  }
  if (!schemaPromise) schemaPromise = db.initSchema();
  schemaPromise.then(() => next()).catch(next);
});

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.use('/uploads', require('./routes/files'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/public', require('./routes/public'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/reregister', require('./routes/reregistration'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/chatbot', require('./routes/chatbot'));
app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
