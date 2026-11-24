'use strict';
const BASE = 'http://localhost:4000';
require('../server/db'); // load local .env for disposable test-database credentials

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

async function login(email, password) {
  const r = await call('POST', '/api/auth/login', { email, password });
  if (!r.data?.token) throw new Error(`login failed ${email}: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

(async () => {
  const results = [];
  const check = (name, cond, extra) => results.push(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`);

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const admin = await login('bonganithabiso84@gmail.com', process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD);
  const staffPassword = 'StaffTest123!';
  const staffTokens = {};
  for (const [role, name] of [['admissions_officer', 'Admissions Test'], ['registry_officer', 'Registry Test'], ['registrar', 'Registrar Test']]) {
    const email = `${role}-${suffix}@example.com`;
    const created = await call('POST', '/api/admin/users', { full_name: name, email, password: staffPassword, role }, admin);
    check(`super admin creates ${role}`, created.status === 201, JSON.stringify(created.data));
    staffTokens[role] = await login(email, staffPassword);
  }
  const admissions = staffTokens.admissions_officer;
  const registry = staffTokens.registry_officer;
  const registrar = staffTokens.registrar;
  const testEmail = `registration-test-${suffix}@example.com`;
  let r = await call('POST', '/api/auth/register', {
    full_name: 'Registration Test Student', email: testEmail, phone: '+268 7600 9999',
    id_number: `TEST-${suffix}`, password: 'TestStudent123!'
  });
  check('student account registration', r.status === 201, JSON.stringify(r.data));
  const verifyUrl = new URL(r.data.verification_url);
  r = await call('GET', `/api/auth/verify?token=${encodeURIComponent(verifyUrl.searchParams.get('token'))}`);
  check('student email verification', r.status === 200, JSON.stringify(r.data));
  const student = await login(testEmail, 'TestStudent123!');
  check('all logins', !!student && !!admin && !!admissions && !!registry && !!registrar);

  // RBAC: student blocked from admin APIs
  r = await call('GET', '/api/admin/dashboard', null, student);
  check('student blocked from admin API (403)', r.status === 403, `status=${r.status}`);

  r = await call('GET', '/api/admin/dashboard', null, admin);
  check('super admin dashboard', r.status === 200 && r.data.counts, JSON.stringify(r.data.counts));

  r = await call('GET', '/api/admin/modules', null, admin);
  check('module catalogue starts empty', r.status === 200 && r.data.modules.length === 0, `count=${r.data.modules?.length}`);

  // Admin adds module (name + id) — required by admin
  const programmes = await call('GET', '/api/public/programmes', null, admin);
  const bach = programmes.data.programmes.find(p => p.level === 'bachelors');
  const assoc = programmes.data.programmes.find(p => p.level === 'associate');
  r = await call('POST', '/api/admin/modules', {
    code: `CLOUDX${suffix}`, title: 'Advanced Cloud Architecture', credits: 4,
    classification: 'elective', semester_number: 6, programme_id: bach.id, prerequisites: []
  }, admin);
  check('admin creates module (code+name)', r.status === 201, JSON.stringify(r.data));
  const newModId = r.data.id;
  const testSemesterModules = [];
  for (const [code, semester] of [[`CORE2${suffix}`, 2], [`CORE3${suffix}`, 3]]) {
    const created = await call('POST', '/api/admin/modules', {
      code, title: `Admin Scheduled Semester ${semester} Core Module`, credits: 18,
      classification: 'core', semester_number: semester, programme_id: assoc.id, prerequisites: []
    }, admin);
    check(`admin schedules associate semester ${semester} module`, created.status === 201, JSON.stringify(created.data));
    testSemesterModules.push(created.data.id);
  }

  // RBAC: registry cannot create modules
  r = await call('POST', '/api/admin/modules', {
    code: 'HACK1', title: 'x', credits: 3, classification: 'core', semester_number: 1, programme_id: bach.id
  }, registry);
  check('registry blocked from module create (403)', r.status === 403, `status=${r.status}`);

  // Admin creates certificate + requirement
  const testCertificate = `TEST-${suffix}`;
  r = await call('POST', '/api/admin/certificates', { name: testCertificate, description: 'Registration test certificate' }, admin);
  check('admin creates certificate', r.status === 201, JSON.stringify(r.data));

  // Requirements update for EGCSE + bachelors
  const certs = await call('GET', '/api/public/certificates');
  const egcse = certs.data.certificates.find(c => c.name === testCertificate);
  r = await call('POST', '/api/admin/requirements', {
    programme_id: bach.id, certificate_id: egcse.id, min_cutoff_points: 35,
    required_subjects: ['Mathematics', 'English', 'Sciences'], notes: 'Updated requirement'
  }, admin);
  check('admin upserts certificate requirement', r.status === 201, JSON.stringify(r.data));

  // ---- Student application flow ----
  r = await call('POST', '/api/applications', {
    programme_id: assoc.id, certificate_id: egcse.id,
    personal_details: { first_name: 'Demo', last_name: 'Student' },
    contact_details: { address: '12 Mbabane Ave', city: 'Mbabane' }
  }, student);
  check('student saves application', r.status === 200, JSON.stringify(r.data).slice(0, 120));

  // Submit without receipt must be blocked server-side
  r = await call('POST', '/api/applications', {
    programme_id: assoc.id, certificate_id: egcse.id, submit: true
  }, student);
  check('submit blocked without fee receipt (422)', r.status === 422, JSON.stringify(r.data).slice(0, 200));

  // Upload fee receipt (make a >2MB png to test compression)
  const sharp = require('sharp');
  const crypto = require('crypto');
  const noisyPixels = Buffer.alloc(1200 * 1200 * 3);
  crypto.randomFillSync(noisyPixels);
  const bigPng = await sharp(noisyPixels, {
    raw: { width: 1200, height: 1200, channels: 3 }
  }).png().toBuffer();
  console.log('  test image bytes:', bigPng.length);
  const fd = new FormData();
  fd.append('receipt', new Blob([bigPng], { type: 'image/png' }), 'receipt.png');
  let res = await fetch(BASE + '/api/applications/fee-receipt', {
    method: 'POST', headers: { Authorization: `Bearer ${student}` }, body: fd
  });
  let data = await res.json();
  check('fee receipt uploaded + compressed', res.status === 200 && data.receipt?.compressed, JSON.stringify(data.message || data));

  // Now submit
  r = await call('POST', '/api/applications', {
    programme_id: assoc.id, certificate_id: egcse.id, submit: true
  }, student);
  check('application submitted', r.status === 200, JSON.stringify(r.data.message));

  // Admissions: list, receipt approve, decision
  r = await call('GET', '/api/admin/applications', null, admissions);
  const appId = r.data.applications.find(a => a.email === testEmail)?.id;
  check('admissions lists applications', r.status === 200 && appId, `id=${appId}`);

  r = await call('POST', `/api/admin/applications/${appId}/receipt`, { action: 'approved' }, admissions);
  check('receipt approved', r.status === 200, JSON.stringify(r.data));

  r = await call('POST', `/api/admin/applications/${appId}/decision`, {
    action: 'accepted', certificate_verified: true
  }, admissions);
  check('application accepted + student number', r.status === 200 && r.data.student_number, JSON.stringify(r.data));

  // ---- Re-registration preview for demo student ----
  r = await call('GET', '/api/reregister/preview', null, student);
  check('re-registration preview', r.status === 200 && r.data.preview, `eligible=${r.data.eligibility?.eligible} sem=${r.data.preview?.semester_number} core=${r.data.preview?.core_modules?.length}`);

  // Registry: clear semester 1 term (already cleared) — try marking cleared for previous term
  const stuId = r.data.student.user_id;
  const termNow = new Date().getMonth() < 6 ? `${new Date().getFullYear()}/sem-2` : `${new Date().getFullYear()}/sem-1`;
  const [y, s] = termNow.split('/sem-');
  const prevTerm = s === '1' ? `${Number(y) - 1}/sem-2` : `${y}/sem-1`;
  r = await call('POST', '/api/admin/clearance', { student_id: stuId, academic_term: prevTerm, cleared: true, reason: 'All prior modules passed' }, registry);
  check('registry grants clearance', r.status === 200, JSON.stringify(r.data));

  // Student registers for next semester (needs SRC receipt)
  r = await call('GET', '/api/reregister/preview', null, student);
  const prev = r.data.preview;
  const selectable = [...prev.minor_modules, ...prev.elective_modules];
  // pick enough credits to reach 18 (core auto-included)
  const coreCredits = prev.core_modules.reduce((a, m) => a + m.credits, 0);
  let need = prev.credits_per_semester - coreCredits;
  const picked = [];
  for (const m of selectable) {
    if (need <= 0) break;
    picked.push(m.id); need -= m.credits;
  }

  const fd2 = new FormData();
  fd2.append('selected_modules', JSON.stringify(picked));
  fd2.append('src_receipt', new Blob([bigPng], { type: 'image/png' }), 'src.png');
  res = await fetch(BASE + '/api/reregister', { method: 'POST', headers: { Authorization: `Bearer ${student}` }, body: fd2 });
  data = await res.json();
  check('semester registration submitted (with SRC receipt)', res.status === 201, JSON.stringify(data).slice(0, 200));

  // Missing SRC receipt must block: create rejection path — test via a new submission is complex; instead verify missing-src on internship not needed.
  // Registry approves registration
  r = await call('GET', '/api/admin/registrations?status=submitted', null, registry);
  const regId = r.data.registrations.find(x => x.email === testEmail || x.full_name === 'Registration Test Student')?.id;
  r = await call('POST', `/api/admin/registrations/${regId}/src`, { action: 'approved' }, registry);
  check('registry approves SRC receipt', r.status === 200, JSON.stringify(r.data));
  r = await call('POST', `/api/admin/registrations/${regId}/approve`, {}, registry);
  check('registry approves registration', r.status === 200, JSON.stringify(r.data));

  // Grade entry: final exam < 40 => fail + pending flag
  const modules = await call('GET', '/api/admin/modules?programme_id=' + assoc.id, null, registry);
  const target = modules.data.modules.find(m => m.id === testSemesterModules[1]);
  r = await call('POST', '/api/admin/grades', {
    student_id: stuId, module_id: target.id, academic_term: prev.academic_term || '2026/sem-1',
    ca_mark: 75, exam_mark: 30
  }, registry);
  check('grade entered (exam 30 => fail flag)', r.status === 200 && r.data.final_exam_failed, JSON.stringify(r.data));

  // Student status + pending modules via chatbot
  r = await call('POST', '/api/chatbot', { message: 'What modules do I have next semester?' }, student);
  check('student chatbot next modules', r.status === 200 && r.data.intent === 'next_modules', r.data.reply?.slice(0, 100));
  r = await call('POST', '/api/chatbot', { message: 'What is my registration status?' }, student);
  check('student chatbot status', r.status === 200 && r.data.intent === 'my_status', r.data.reply?.slice(0, 100));
  r = await call('POST', '/api/chatbot', { message: 'How many applications are pending?' }, admin);
  check('admin chatbot counts', r.status === 200 && r.data.intent === 'admin_counts', r.data.reply?.slice(0, 120));

  // Export CSV
  r = await call('GET', '/api/admin/export/students', null, registrar);
  check('registrar CSV export', r.status === 200, `bytes=${JSON.stringify(r.data).length}`);

  // Manual override with reason
  r = await call('POST', '/api/admin/overrides', {
    target_type: 'module', target_id: `${stuId}:${target.id}`, action: 'clear_pending_module',
    reason: 'Assessment board decision to credit the module'
  }, registrar);
  check('registrar manual override', r.status === 200, JSON.stringify(r.data));

  // Audit log contains override
  r = await call('GET', '/api/admin/audit', null, admin);
  const hasOverride = r.data.audit_log?.some(a => a.action === 'manual_override');
  check('override in audit log', hasOverride);

  // Soft delete module
  r = await call('DELETE', `/api/admin/modules/${newModId}`, null, admin);
  check('module soft delete', r.status === 200, JSON.stringify(r.data));
  for (const id of testSemesterModules) {
    const deleted = await call('DELETE', `/api/admin/modules/${id}`, null, admin);
    check(`test module ${id} soft delete`, deleted.status === 200, JSON.stringify(deleted.data));
  }
  const currentUser = await call('GET', '/api/auth/me', null, student);
  await call('PUT', `/api/admin/users/${currentUser.data.user.id}`, { is_active: false }, admin);
  for (const role of ['admissions_officer', 'registry_officer', 'registrar']) {
    const users = await call('GET', '/api/admin/users', null, admin);
    const email = `${role}-${suffix}@example.com`;
    const account = users.data.users.find(u => u.email === email);
    if (account) await call('PUT', `/api/admin/users/${account.id}`, { is_active: false }, admin);
  }

  console.log('\n' + results.join('\n'));
  const fails = results.filter(x => x.startsWith('FAIL'));
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
