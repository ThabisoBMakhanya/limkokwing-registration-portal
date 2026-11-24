'use strict';
/* Limkokwing Eswatini Registration  SPA */
(() => {
const $ = sel => document.querySelector(sel);
const app = $('#app');
const navRoot = $('#nav-root');

const REG_FEE = 200; // Registration fee in Emalangeni (E)
const fmtE = n => 'E ' + Number(n).toLocaleString('en-SZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const state = {
  token: localStorage.getItem('lck_token') || null,
  user: JSON.parse(localStorage.getItem('lck_user') || 'null'),
  route: { path: '/', query: {} }
};

const ROLE_LABEL = {
  student: 'Student', super_admin: 'Super Admin', admissions_officer: 'Admissions Officer',
  registry_officer: 'Registry Officer', registrar: 'Registrar'
};

function saveAuth(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('lck_token', token);
  localStorage.setItem('lck_user', JSON.stringify(user));
}
function clearAuth() {
  state.token = null; state.user = null;
  localStorage.removeItem('lck_token');
  localStorage.removeItem('lck_user');
}
const isAdmin = () => state.user && state.user.role !== 'student';
const isStudent = () => state.user && state.user.role === 'student';

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
function esc(s) {
  return String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

async function api(method, path, body, isForm = false) {
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let payload;
  if (isForm) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch('/api' + path, { method, headers, body: payload });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { error: text }; }
  if (res.status === 401 && state.token) { clearAuth(); renderNav(); go('/login'); }
  if (!res.ok) { const err = new Error(data?.error || `Request failed (${res.status})`); err.data = data; err.status = res.status; throw err; }
  return data;
}

document.addEventListener('click', async event => {
  const closeButton = event.target.closest('[data-close-modal]');
  if (closeButton) {
    document.getElementById(closeButton.dataset.closeModal)?.remove();
    return;
  }
  if (event.target.classList.contains('modal-backdrop')) {
    event.target.remove();
    return;
  }
  const link = event.target.closest('[data-secure-file]');
  if (!link) return;
  event.preventDefault();
  try {
    const response = await fetch(link.dataset.secureFile, { headers: { Authorization: 'Bearer ' + state.token } });
    if (!response.ok) throw new Error('You do not have permission to view this file.');
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = link.dataset.filename || 'document';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  } catch (err) { toast(err.message, 'err'); }
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const modals = document.querySelectorAll('.modal-backdrop');
  modals[modals.length - 1]?.remove();
});

function secureFileLink(url, label) {
  if (!url) return '';
  const filename = String(url).split('/').pop() || 'document';
  return `<a href="#" data-secure-file="${esc(url)}" data-filename="${esc(filename)}">${esc(label)}</a>`;
}

/* ---------------- Navigation ---------------- */
function navLink(path, label) {
  const active = state.route.path === path ? 'active' : '';
  return `<a href="#${path}" class="${active}">${label}</a>`;
}
function renderNav() {
  const u = state.user;
  let links = '';
  if (!u) {
    links = `
      <a href="#/programmes" class="${state.route.path === '/programmes' ? 'active' : ''}">Programmes</a>
      <a href="#/login">Sign In</a>
      <a href="#/register" class="btn btn-gold btn-sm" style="text-decoration:none">Apply Now</a>`;
  } else if (u.role === 'student') {
    links = `${navLink('/student', 'Student Portal')}<button class="nav-link" data-logout>Sign Out</button>`;
  } else {
    links = `${navLink('/admin', 'Staff Portal')}<button class="nav-link" data-logout>Sign Out</button>`;
  }
  const chipClass = u ? (u.role === 'student' ? 'student' : 'staff') : '';
  navRoot.innerHTML = `
    <nav class="nav"><div class="nav-inner">
      <a class="nav-brand" href="#/" style="text-decoration:none">
        <img src="/assets/logo.png" alt="Limkokwing University">
        <span class="brand-text">Limkokwing University<small>Creative Technology Eswatini</small></span>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav-links">Menu</button>
      <div class="nav-links" id="site-nav-links">${links}</div>
      ${u ? `<div class="nav-user"><span class="role-chip ${chipClass}">${ROLE_LABEL[u.role] || u.role}</span><b>${esc(u.full_name)}</b></div>` : ''}
    </div></nav>`;
  const toggle = navRoot.querySelector('.nav-toggle');
  const navLinks = navRoot.querySelector('.nav-links');
  toggle.onclick = () => {
    const open = navLinks.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close' : 'Menu';
  };
  navLinks.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Menu';
  }));
  const lo = document.querySelector('[data-logout]');
  if (lo) lo.onclick = () => { clearAuth(); renderNav(); go('/'); toast('Signed out'); };
}

function adminNavLinks() {
  const r = state.user.role;
  const base = `<a href="#/admin" class="${state.route.path === '/admin' ? 'active' : ''}">Dashboard</a>`;
  const links = [base];
  if (r === 'super_admin' || r === 'admissions_officer' || r === 'registrar') {
    links.push(navLink('/admin/applications', 'Applications'));
  }
  links.push(navLink('/admin/students', 'Students'));
  if (r === 'registry_officer' || r === 'registrar' || r === 'super_admin') {
    links.push(navLink('/admin/registrations', 'Registrations'));
    links.push(navLink('/admin/internships', 'Internships'));
  }
  if (r === 'registry_officer' || r === 'super_admin') {
    links.push(navLink('/admin/grades', 'Grades'));
    links.push(navLink('/admin/clearance', 'Clearance'));
  }
  if (r === 'super_admin') {
    links.push(navLink('/admin/programmes', 'Programmes'));
    links.push(navLink('/admin/certificates', 'Certificates'));
    links.push(navLink('/admin/requirements', 'Requirements'));
    links.push(navLink('/admin/modules', 'Modules'));
    links.push(navLink('/admin/users', 'Accounts'));
  }
  if (r === 'registrar' || r === 'super_admin') {
    links.push(navLink('/admin/audit', 'Audit Log'));
  }
  if (r === 'registrar' || r === 'super_admin') {
    links.push(navLink('/admin/overrides', 'Overrides'));
    links.push(navLink('/admin/export', 'Export'));
  }
  links.push(`<button class="nav-link" data-logout>Sign Out</button>`);
  return links.join('');
}

/* ---------------- Router ---------------- */
function parseHash() {
  let h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const query = {};
  if (qs) qs.split('&').forEach(kv => { const [k, v] = kv.split('='); query[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
  return { path: path || '/', query };
}
async function go(path) { location.hash = path; }

const routes = [];
function route(path, roles, view) { routes.push({ path, roles, view }); }

async function render() {
  state.route = parseHash();
  renderNav();
  const path = state.route.path;
  let match = routes.find(r => r.path === path);
  if (!match) match = routes.find(r => r.path === '*');
  // RBAC on the client (server enforces API access independently)
  if (match.roles) {
    if (!state.user) { toast('Please sign in first', 'err'); return go('/login'); }
    if (!match.roles.includes(state.user.role)) {
      toast('You do not have access to that page', 'err');
      return go(state.user.role === 'student' ? '/student' : '/admin');
    }
  }
  app.innerHTML = '<div class="page-loading">Loading</div>';
  try { await match.view(); }
  catch (err) { app.innerHTML = `<div class="section"><div class="form-error">${esc(err.message)}</div></div>`; }
  if (path === '/programmes') {
    document.getElementById('programmes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', render);

/* ---------------- Shared pieces ---------------- */
function footer() {
  return `<footer class="footer"><div class="footer-inner">
    <div><b>Limkokwing University of Creative Technology</b>Eswatini Campus, Mbabane<br>Registration &amp; Admissions Portal</div>
    <div><b>Departments</b>
      Admissions: <a href="mailto:admissions@limkokwing.ac.sz">admissions@limkokwing.ac.sz</a><br>
      Registry: <a href="mailto:registry@limkokwing.ac.sz">registry@limkokwing.ac.sz</a><br>
      Registrar: <a href="mailto:registrar@limkokwing.ac.sz">registrar@limkokwing.ac.sz</a></div>
    <div><b>Portal</b><a href="#/login">Student Sign In</a><br><a href="#/register">Create Account</a><br>
      <span class="small">Fees shown in Emalangeni (E)</span></div>
  </div></footer>`;
}

function statusBadge(status) {
  const map = {
    submitted: 'blue', under_review: 'gold', accepted: 'green', rejected: 'red', registered: 'green',
    pending: 'gold', approved: 'green', draft: '', failed: 'red', completed: 'green', graded: 'violet'
  };
  return `<span class="badge ${map[status] || ''}">${String(status || '').replace(/_/g, ' ')}</span>`;
}

/* ---------------- Home (public portal) ---------------- */
let homeData = null;
let homeLoadError = null;
async function viewHome() {
  if (!homeData || homeLoadError) {
    try {
      homeData = await api('GET', '/public/programmes');
      homeLoadError = null;
    } catch (err) {
      homeLoadError = err.message || 'Programme information is temporarily unavailable.';
      homeData = { programmes: [] };
    }
  }
  const programmeLoadError = homeLoadError;
  const certs = [...new Set(homeData.programmes.flatMap(p => p.requirements.map(r => r.certificate_name)))].sort();
  // Wikimedia Commons course photographs. Commons file pages and license details
  // are also listed in public/assets/programmes/ATTRIBUTION.md.
  const coursePhotos = [
    { match: /graphic design|creative multimedia/i, file: 'Graphic_Designer.jpg', credit: 'Amuzujoe · CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Graphic_Designer.jpg' },
    { match: /music design/i, file: 'Music_studio.jpg', credit: 'DeltaRecords94 · CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Music_studio.jpg' },
    { match: /architectural technology/i, file: 'Section_Model_of_Building.jpg', credit: 'Nicholas Dorsey · CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Section_Model_of_Building.jpg' },
    { match: /public relations|events management/i, file: 'Event_Stage.jpg', credit: 'Avi01011 · CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Event_Stage.jpg' },
    { match: /journalism and media/i, file: 'Journalists_doing_their_job.jpg', credit: 'Rince · Public domain', page: 'https://commons.wikimedia.org/wiki/File:Journalists_doing_their_job.jpg' },
    { match: /tv and film production/i, file: 'Camerman_and_news_reporter_working.jpg', credit: 'Tess McBride, USFWS · Public domain', page: 'https://commons.wikimedia.org/wiki/File:Camerman_and_news_reporter_working.jpg' },
    { match: /international tourism/i, file: 'Tourist_Vehicle.jpg', credit: 'Ann-Kristin Mueller · CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Tourist_Vehicle.jpg' },
    { match: /hotel management/i, file: 'Hotel_Reception_.jpg', credit: 'The Down Town Hotel · CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Hotel_Reception_.jpg' },
    { match: /business management|international business management|professional communication/i, file: 'Work_Meeting.jpg', credit: 'Wikimedia Commons contributor · CC BY 2.0', page: 'https://commons.wikimedia.org/wiki/File:Work_Meeting.jpg' },
    { match: /information technology|business information technology/i, file: "A_Programmer's_Workstation.JPG", credit: 'Bsmalley · CC BY-SA 3.0', page: "https://commons.wikimedia.org/wiki/File:A_Programmer's_Workstation.JPG" }
  ];
  const photoFor = name => coursePhotos.find(item => item.match.test(name)) || coursePhotos[coursePhotos.length - 1];

  const programmeCards = homeData.programmes.map(p => {
    const photo = photoFor(p.name);
    const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(photo.file.replaceAll('_', ' '))}?width=1280`;
    const tabs = certs.map((c, ci) => `<button class="cert-tab ${ci === 0 ? 'active' : ''}" data-prog="${p.id}" data-cert="${c}">${c}</button>`).join('');
    const firstReq = p.requirements[0];
    return `
    <article class="card card-photo">
      <img src="${imageUrl}" alt="${esc(p.name)} course image" loading="lazy">
      <div class="card-body">
        <div class="flex-between">
          <span class="badge ${p.level === 'bachelors' ? 'violet' : 'blue'}">${p.level === 'bachelors' ? "Bachelor's Degree" : 'Associate Degree'}</span>
          <span class="badge gold">${p.total_semesters} semesters</span>
        </div>
        <h3 class="mt-1">${esc(p.name)}</h3>
        <p class="muted small">${esc(p.description || '')}</p>
        <p class="small"><b>${p.internship_semester === p.total_semesters ? `Semesters 1 to ${p.internship_semester - 1} academic. Semester ${p.internship_semester} internship` : ''}</b></p>
        <div class="cert-tabs" data-certgroup="${p.id}">${tabs}</div>
        <div class="req-box" data-reqbox="${p.id}">
          ${reqBoxHtml(firstReq)}
        </div>
        <div class="flex mt-2">
          <a class="btn btn-gold btn-sm" href="#/register">Apply Now</a>
          <span class="hint">Entry requirements per certificate shown above</span>
        </div>
      </div>
    </article>`;
  }).join('');

  app.innerHTML = `
  <section class="hero">
    <div class="hero-inner">
      <span class="badge gold">Eswatini Campus Online Registration</span>
      <h1>Register for your <em>future</em> in creative technology</h1>
      <p class="lead">Browse programmes and their certificate-specific entry requirements, apply online, upload your registration fee receipt, and re-register for every semester, all in one portal.</p>
      <div class="hero-cta">
        <a class="btn btn-gold" href="#/register">Apply Now</a>
        <a class="btn btn-outline" style="border-color:#fff;color:#fff" href="#/login">Student Sign In</a>
        <a class="btn btn-ghost hero-browse" href="#/programmes">Browse Programmes</a>
      </div>
      <div class="hero-stats">
        <div class="stat"><b>${programmeLoadError ? '—' : homeData.programmes.length}</b><span>Programmes</span></div>
        <div class="stat"><b>${programmeLoadError ? '—' : certs.length}</b><span>Accepted certificates</span></div>
        <div class="stat"><b>100%</b><span>Online registration</span></div>
        <div class="stat"><b>${fmtE(REG_FEE)}</b><span>Registration fee (first-timers)</span></div>
      </div>
    </div>
  </section>

  ${programmeLoadError ? `<section class="section" style="padding-bottom:0"><div class="home-data-notice" role="status">
    The programme list could not be loaded: ${esc(programmeLoadError)}. You can still create an account or sign in.
    <button class="btn btn-ghost btn-sm" id="retry-programmes">Retry</button>
  </div></section>` : ''}

  <section class="section" id="programmes">
    <div class="section-head">
      <div><h2>Programmes &amp; Admission Requirements</h2>
      <p>Entry requirements are mapped to each certificate. Choose a certificate tab to see the minimum cut-off points and required subjects for that qualification.</p></div>
    </div>
    ${programmeCards ? `<div class="grid grid-2">${programmeCards}</div>` : '<p class="muted">Programme requirements are being updated. Please contact Admissions for current entry requirements.</p>'}
    <p class="hint mt-2">Programme names were checked against the <a href="https://eshec.org.sz/wp-content/uploads/2026/08/ESHEC-HEI-List-Aug-2026_Final_V8.pdf" target="_blank" rel="noopener noreferrer">Eswatini Higher Education Council list, August 2026</a> and the <a href="https://www.gov.sz/images/MinistryOfLabour/PRIORITY%20LIST%202023-%202027%20MARCH%202%202_250312_154639.pdf" target="_blank" rel="noopener noreferrer">Government of Eswatini priority programme list</a>. The published lists do not provide certificate-specific entry points or subject rules for every programme. Contact Admissions for those details.</p>
  </section>

  <section class="section" style="padding-top:0">
    <div class="section-head"><div><h2>How registration works</h2>
      <p>From creating your account to starting your first semester.</p></div></div>
    <div class="grid grid-4">
      <div class="card feature-card">
        <h3>1. Create account</h3><p class="muted small">Full name, email, phone, national ID/passport and password, then verify your email.</p></div>
      <div class="card feature-card">
        <h3>2. Apply online</h3><p class="muted small">Multi-step form: personal, contact, programme, certificate/qualification, academic history and documents.</p></div>
      <div class="card feature-card">
        <h3>3. Upload fee receipt</h3><p class="muted small">Registration fee of <b>${fmtE(REG_FEE)}</b>. Upload your receipt (PDF/JPG/PNG, auto-compressed over 2MB).</p></div>
      <div class="card feature-card">
        <h3>4. Register each semester</h3><p class="muted small">Once cleared, pick your modules, upload your SRC receipt and submit. Prerequisites are checked automatically.</p></div>
    </div>
  </section>

  <section class="section" style="padding-top:0">
    <div class="grid grid-3">
      <div class="card card-photo"><img src="/assets/students-2.jpg" alt="Students"><div class="card-body">
        <h3>Certificate-specific entry</h3><p class="muted small">EGCSE, IGCSE, SAC and vocational qualifications each have their own cut-off points and subject rules.</p></div></div>
      <div class="card card-photo"><img src="/assets/campus-2.jpg" alt="Campus"><div class="card-body">
        <h3>Track everything online</h3><p class="muted small">Follow your application: Submitted, then Under Review, then Accepted or Rejected, then Registered, with email updates at every step.</p></div></div>
      <div class="card card-photo"><img src="/assets/cyberjaya.jpg" alt="Creative campus"><div class="card-body">
        <h3>Ask the assistant</h3><p class="muted small">The help button answers questions like What are the EGCSE requirements for the IT Degree? at any time.</p></div></div>
    </div>
  </section>
  ${footer()}`;

  document.querySelectorAll('.cert-tab').forEach(btn => {
    btn.onclick = () => {
      const progId = Number(btn.dataset.prog);
      const prog = homeData.programmes.find(p => p.id === progId);
      btn.parentElement.querySelectorAll('.cert-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const req = prog.requirements.find(r => r.certificate_name === btn.dataset.cert);
      document.querySelector(`[data-reqbox="${progId}"]`).innerHTML = reqBoxHtml(req);
    };
  });
  const retryProgrammes = $('#retry-programmes');
  if (retryProgrammes) retryProgrammes.onclick = () => { homeData = null; homeLoadError = null; viewHome(); };
}
function reqBoxHtml(r) {
  if (!r) return `<p class="muted">Certificate-specific cut-off points and subjects are not published here. Contact Admissions to confirm requirements for this programme.</p>`;
  const subjects = r.required_subjects || [];
  return `<div class="flex" style="gap:16px;align-items:flex-start">
      <div class="cutoff">${r.min_cutoff_points}<small>min. cut-off points<br>(${esc(r.certificate_name)})</small></div>
      <div>
        <b class="small">Required subjects</b>
        <ul>${subjects.map(s => `<li>${esc(s)}</li>`).join('') || '<li class="muted">None specified</li>'}</ul>
        ${r.notes ? `<div class="notes">${esc(r.notes)}</div>` : ''}
      </div>
    </div>`;
}

/* ---------------- Auth pages ---------------- */
function viewLogin() {
  const verified = state.route.query.verified ? `<div class="form-ok mb-1">Email verified. You can sign in now.</div>` : '';
  app.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-photo" style="background-image:url('/assets/students-1.jpg')">
      <div class="auth-quote">
        <h2>Welcome back</h2>
        <p>Sign in to apply, register for the semester, upload documents and track your progress.</p>
      </div>
    </div>
    <div class="auth-form"><div class="auth-card">
      <div class="logo-row"><img src="/assets/logo.png" alt="Limkokwing"><div><b>Student &amp; Staff Portal</b><div class="hint">Limkokwing University Eswatini</div></div></div>
      ${verified}
      <div id="login-err"></div>
      <form id="login-form">
        <div class="field mb-1"><label>Email <span class="req">*</span></label><input type="email" name="email" required autocomplete="email"></div>
        <div class="field mb-1"><label>Password <span class="req">*</span></label><input type="password" name="password" required autocomplete="current-password"></div>
        <button class="btn btn-block" type="submit">Sign In</button>
      </form>
      <p class="center mt-2">New student? <a href="#/register">Create an account &amp; apply</a></p>
      <div class="card mt-2" style="background:var(--paper-2)">
        <b class="small">Need an account?</b>
        <p class="hint" style="margin:6px 0 0">Prospective students can create an account below. Staff should sign in with their institution-issued credentials.</p>
      </div>
    </div></div>
  </div>`;
  $('#login-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/auth/login', { email: f.get('email'), password: f.get('password') });
      saveAuth(r.token, r.user);
      renderNav();
      toast('Welcome, ' + r.user.full_name, 'ok');
      go(r.user.role === 'student' ? '/student' : '/admin');
    } catch (err) { $('#login-err').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
  };
}

async function viewRegister() {
  app.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-photo" style="background-image:url('/assets/campus-1.jpg')">
      <div class="auth-quote">
        <h2>Start your application</h2>
        <p>Create your account, verify your email, then complete the multi-step application with your certificate and fee receipt.</p>
      </div>
    </div>
    <div class="auth-form"><div class="auth-card">
      <div class="logo-row"><img src="/assets/logo.png" alt="Limkokwing"><div><b>Create student account</b><div class="hint">Step 1 of your application</div></div></div>
      <div id="reg-err"></div>
      <form id="reg-form">
        <div class="form-grid">
          <div class="field full"><label>Full name <span class="req">*</span></label><input name="full_name" required></div>
          <div class="field full"><label>Email <span class="req">*</span></label><input type="email" name="email" required></div>
          <div class="field"><label>Phone number <span class="req">*</span></label><input name="phone" required></div>
          <div class="field"><label>National ID / Passport <span class="req">*</span></label><input name="id_number" required></div>
          <div class="field full"><label>Password <span class="req">*</span></label><input type="password" name="password" required minlength="8"></div>
          <div class="field full"><label>Confirm password <span class="req">*</span></label><input type="password" name="confirm" required minlength="8"></div>
        </div>
        <button class="btn btn-gold btn-block mt-2" type="submit">Create Account &amp; Continue</button>
      </form>
      <p class="center mt-2">Already have an account? <a href="#/login">Sign in</a></p>
    </div></div>
  </div>`;
  $('#reg-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('password') !== f.get('confirm')) {
      $('#reg-err').innerHTML = '<div class="form-error">Passwords do not match</div>'; return;
    }
    try {
      const r = await api('POST', '/auth/register', {
        full_name: f.get('full_name'), email: f.get('email'), phone: f.get('phone'),
        id_number: f.get('id_number'), password: f.get('password')
      });
      app.innerHTML = `<div class="auth-wrap">
        <div class="auth-photo" style="background-image:url('/assets/campus-1.jpg')"><div class="auth-quote"><h2>Your application starts here</h2><p>Verify your email to activate your account and continue with online registration.</p></div></div>
        <div class="auth-form"><div class="auth-card">
          <div class="logo-row"><img src="/assets/logo.png" alt="Limkokwing University"><div><b>Student Registration Portal</b><div class="hint">Eswatini Campus</div></div></div>
          <span class="verification-label">Account created</span>
          <h2 class="mt-1">Check your email</h2>
          <p class="muted">We sent an account activation link to <b>${esc(f.get('email'))}</b>. Open the link in your email to verify your address.</p>
          <a class="btn btn-block mt-2" href="${esc(r.verification_url)}">Verify email now</a>
          <p class="hint mt-2">After verification, sign in to complete your application.</p>
          <div class="mt-2"><a href="#/login">Go to sign in</a></div>
        </div></div>`;
      toast('Account created. Verify your email.', 'ok');
    } catch (err) { $('#reg-err').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
  };
}

/* ---------------- Student portal ---------------- */
function studentShell(title, sub, body, activePath) {
  const links = [
    ['/student', 'Dashboard'],
    ['/student/apply', 'Apply'],
    ['/student/status', 'Application Status'],
    ['/student/reregister', 'Re-Registration'],
    ['/student/results', 'Results'],
    ['/student/profile', 'Profile']
  ].map(([p, l]) => navLink(p, l)).join('');
  app.innerHTML = `
  <div class="portal">
    <aside class="portal-side"><div class="side-title">Student Portal</div>${links}</aside>
    <section class="portal-main">
      <div class="portal-header"><div><h1>${title}</h1><div class="sub">${sub}</div></div></div>
      <div id="portal-body">${body || ''}</div>
    </section>
  </div>`;
  void activePath;
}

async function viewStudentDashboard() {
  studentShell('Student Dashboard', 'Welcome back', '<div class="page-loading">Loading</div>');
  const [me, preview] = await Promise.all([
    api('GET', '/applications/me').catch(() => ({ application: null })),
    api('GET', '/reregister/preview').catch(() => null)
  ]);
  const student = me.student;
  const app2 = me.application;
  const cards = [];
  cards.push(`<div class="stat-card">
    <div><b>${student?.student_number ? esc(student.student_number) : ''}</b><span>Student number${student ? `, semester ${student.current_semester}` : ''}</span></div></div>`);
  cards.push(`<div class="stat-card">
    <div><b>${app2 ? statusBadge(app2.status) : 'No application'}</b><span>Application status</span></div></div>`);
  cards.push(`<div class="stat-card">
    <div><b>${app2 ? statusBadge(app2.receipt_verification_status) : ''}</b><span>Fee receipt (${fmtE(REG_FEE)})</span></div></div>`);
  cards.push(`<div class="stat-card">
    <div><b>${preview?.eligibility?.eligible ? 'Eligible' : 'Locked'}</b><span>Re-registration${preview?.eligibility?.reason ? ': ' + esc(preview.eligibility.reason) : ''}</span></div></div>`);

  $('#portal-body').innerHTML = `
    <div class="stat-cards mb-2">${cards.join('')}</div>
    <div class="grid grid-2">
      <div class="card">
        <h3>Next steps</h3>
        ${!app2 ? `<p class="muted">You have not applied yet.</p><a class="btn btn-gold" href="#/student/apply">Start Application</a>` :
          app2.status !== 'accepted' && app2.status !== 'registered'
          ? `<p class="muted">Track your application and re-upload the fee receipt if it was rejected.</p><a class="btn" href="#/student/status">View Status</a>`
          : `<p class="muted">Register for your next semester.</p><a class="btn btn-gold" href="#/student/reregister">Go to Re-Registration</a>`}
      </div>
      <div class="card">
        <h3>Programme</h3>
        ${me.programme ? `<p><b>${esc(me.programme.name)}</b><br><span class="muted">${me.programme.total_semesters} semesters. Internship in semester ${me.programme.internship_semester}</span></p>
        <p class="small muted">Certificate: ${esc(me.certificate?.name || '')}</p>` : '<p class="muted">No programme selected yet.</p>'}
      </div>
    </div>
    ${preview ? `<div class="card mt-2"><h3>Upcoming semester preview</h3>
      <p class="muted small">Semester ${preview.preview.semester_number}, ${esc(preview.preview.academic_term)}</p>
      <div class="module-list">${preview.preview.core_modules.slice(0, 6).map(m => `
        <div class="module-row"><div class="m-main"><span class="m-code">${esc(m.code)}</span> <span class="m-title">${esc(m.title)}</span></div>
        <span class="m-credits">${m.credits} cr</span></div>`).join('')}</div>
      <a class="btn btn-outline mt-2" href="#/student/reregister">Full preview &amp; registration</a></div>` : ''}`;
}

/* ----- Multi-step application ----- */
const applyState = { step: 0, data: {}, programmes: null, certificates: null, application: null };
const APPLY_STEPS = ['Personal', 'Contact', 'Programme', 'Certificate', 'Academic History', 'Documents', 'Review'];

async function viewApply() {
  if (!applyState.programmes) {
    const [p, me, certs] = await Promise.all([
      api('GET', '/public/programmes'), api('GET', '/applications/me'), api('GET', '/public/certificates')
    ]);
    applyState.programmes = p.programmes;
    applyState.certificates = certs.certificates;
    applyState.application = me.application;
    if (me.application) {
      applyState.data = { ...me.application.personal_details, ...me.application.contact_details,
        programme_id: me.application.programme_id, certificate_id: me.application.certificate_id,
        academic_history: me.application.academic_history, documents: me.application.documents,
        fee_receipt: me.application.registration_fee_receipt_url };
    }
  }
  if (applyState.application && ['accepted', 'registered'].includes(applyState.application.status)) {
    studentShell('Apply', 'Application complete', `
      <div class="card"><div class="form-ok">Your application has been accepted${applyState.application.student_number ? ` (student number <b>${esc(applyState.application.student_number)}</b>)` : ''}.</div>
      <a class="btn mt-2" href="#/student/status">View status</a></div>`);
    return;
  }
  studentShell('Application', 'First-time registration. Multi-step form', renderStep());
  bindStep();
}
function renderStep() {
  const s = applyState.step;
  const chips = APPLY_STEPS.map((label, i) =>
    `<span class="step-chip ${i === s ? 'active' : i < s ? 'done' : ''}">${i + 1}. ${label}</span>`).join('');
  let body = '';
  const d = applyState.data;
  if (s === 0) body = `
    <div class="form-grid">
      <div class="field"><label>First name <span class="req">*</span></label><input data-k="first_name" value="${esc(d.first_name || '')}"></div>
      <div class="field"><label>Last name <span class="req">*</span></label><input data-k="last_name" value="${esc(d.last_name || '')}"></div>
      <div class="field"><label>Date of birth</label><input type="date" data-k="dob" value="${esc(d.dob || '')}"></div>
      <div class="field"><label>Gender</label><select data-k="gender">
        ${['', 'Female', 'Male', 'Other'].map(g => `<option value="${g}" ${d.gender === g ? 'selected' : ''}>${g || 'Select'}</option>`).join('')}</select></div>
      <div class="field"><label>Nationality</label><input data-k="nationality" value="${esc(d.nationality || 'Eswatini')}"></div>
      <div class="field"><label>Disability (optional)</label><input data-k="disability" value="${esc(d.disability || '')}"></div>
    </div>`;
  else if (s === 1) body = `
    <div class="form-grid">
      <div class="field full"><label>Residential address <span class="req">*</span></label><input data-k="address" value="${esc(d.address || '')}"></div>
      <div class="field"><label>City / Town <span class="req">*</span></label><input data-k="city" value="${esc(d.city || '')}"></div>
      <div class="field"><label>Phone <span class="req">*</span></label><input data-k="phone" value="${esc(d.phone || state.user.phone || '')}"></div>
      <div class="field full"><label>Email</label><input value="${esc(state.user.email)}" disabled></div>
      <div class="field full"><label>Next of kin (optional)</label><input data-k="next_of_kin" value="${esc(d.next_of_kin || '')}"></div>
    </div>`;
  else if (s === 2) body = `
    <div class="grid grid-2">
      ${applyState.programmes.map(p => `
        <label class="card" style="cursor:pointer;border-color:${Number(d.programme_id) === p.id ? 'var(--violet)' : 'var(--line)'}">
          <input type="radio" name="prog" value="${p.id}" ${Number(d.programme_id) === p.id ? 'checked' : ''} style="width:auto">
          <b>${esc(p.name)}</b>
          <div class="muted small">${p.total_semesters} semesters (${p.level === 'bachelors' ? "Bachelor's" : 'Associate'}); ${p.credits_per_semester} credits/semester</div>
          <div class="small muted">${esc(p.description || '')}</div>
        </label>`).join('')}
    </div>`;
  else if (s === 3) {
    const prog = applyState.programmes.find(p => p.id === Number(d.programme_id));
    const certs = prog ? applyState.certificates.map(c => ({
      certificate_id: c.id,
      certificate_name: c.name,
      requirement: prog.requirements.find(r => r.certificate_id === c.id) || null
    })) : [];
    body = `
      <p class="muted">Select the certificate/qualification you hold. Entry requirements differ per certificate.</p>
      <div class="grid grid-2">
        ${certs.map(item => `
          <label class="card" style="cursor:pointer;border-color:${Number(d.certificate_id) === item.certificate_id ? 'var(--violet)' : 'var(--line)'}">
            <input type="radio" name="cert" value="${item.certificate_id}" ${Number(d.certificate_id) === item.certificate_id ? 'checked' : ''} style="width:auto">
            <b>${esc(item.certificate_name)}</b>
            <div class="req-box mt-1">${item.requirement ? reqBoxHtml(item.requirement) : '<p class="muted">Certificate-specific cut-off points and subjects are not published here. Contact Admissions to confirm requirements for this programme.</p>'}</div>
          </label>`).join('')}
      </div>`;
  } else if (s === 4) {
    const hist = d.academic_history || [];
    body = `
      <p class="muted small">Add your subject results (add rows as needed).</p>
      <div class="table-wrap"><table><thead><tr><th>Subject</th><th>Level</th><th>Grade</th><th>Points</th><th></th></tr></thead>
      <tbody id="hist-rows">
      ${hist.map((h, i) => `<tr>
        <td><input data-h="${i}" data-hk="subject" value="${esc(h.subject || '')}"></td>
        <td><input data-h="${i}" data-hk="level" value="${esc(h.level || '')}"></td>
        <td><input data-h="${i}" data-hk="grade" value="${esc(h.grade || '')}"></td>
        <td><input data-h="${i}" data-hk="points" value="${esc(h.points ?? '')}"></td>
        <td><button class="btn btn-ghost btn-sm" data-del-h="${i}">Remove</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No subjects yet.</td></tr>'}
      </tbody></table></div>
      <button class="btn btn-ghost btn-sm mt-1" id="add-h">Add subject</button>`;
  } else if (s === 5) {
    const docs = d.documents || {};
    const feeUrl = d.fee_receipt;
    body = `
      <div class="grid grid-2">
        <div class="card">
          <h3>Supporting documents</h3>
          ${uploadField('id_copy', 'National ID / Passport copy', docs.id_copy)}
          ${uploadField('academic_cert', 'Academic certificate (required)', docs.academic_cert)}
        </div>
        <div class="card" style="border-color:var(--gold)">
          <h3> Registration fee receipt <span class="badge gold">Mandatory</span></h3>
          <p class="muted small">First-time applicants must pay the registration fee of <b>${fmtE(REG_FEE)}</b> and upload the receipt. The academic certificate and fee receipt are both required before submission.</p>
          <div class="upload-zone" id="fee-zone">
            
            <div>${feeUrl ? '<span class="file-name"> Receipt uploaded. Click to replace</span>' : '<b>Click to upload receipt</b>'}</div>
            <div class="upload-note">PDF, JPG or PNG, max 5MB</div>
            <input type="file" id="fee-file" accept=".pdf,.jpg,.jpeg,.png,.webp">
          </div>
          <div id="fee-msg" class="mt-1"></div>
        </div>
      </div>`;
  } else {
    const prog = applyState.programmes.find(p => p.id === Number(d.programme_id));
    const cert = prog?.requirements.find(r => r.certificate_id === Number(d.certificate_id));
    const certName = applyState.certificates?.find(c => c.id === Number(d.certificate_id))?.name;
    const docs = d.documents || {};
    body = `
      <div class="grid grid-2">
        <div class="card"><h3>Personal &amp; contact</h3><dl class="kv">
          <dt>Name</dt><dd>${esc((d.first_name || '') + ' ' + (d.last_name || ''))}</dd>
          <dt>Phone</dt><dd>${esc(d.phone || '')}</dd>
          <dt>Address</dt><dd>${esc(d.address || '')}, ${esc(d.city || '')}</dd>
          <dt>Email</dt><dd>${esc(state.user.email)}</dd></dl></div>
        <div class="card"><h3>Programme &amp; certificate</h3><dl class="kv">
          <dt>Programme</dt><dd>${esc(prog?.name || '')}</dd>
          <dt>Certificate</dt><dd>${esc(cert?.certificate_name || certName || '')}</dd>
          <dt>Cut-off points</dt><dd>${cert ? cert.min_cutoff_points : 'Confirm with Admissions'}</dd>
          <dt>Required subjects</dt><dd>${cert ? esc((cert.required_subjects || []).join(', ')) : 'Confirm with Admissions'}</dd></dl></div>
        <div class="card"><h3>Documents</h3><ul class="small">
          <li>ID copy: ${docs.id_copy ? ' uploaded' : ' not uploaded'}</li>
          <li>Academic certificate: ${docs.academic_cert ? ' uploaded' : ' not uploaded'}</li>
          <li>Fee receipt (${fmtE(REG_FEE)}): ${d.fee_receipt ? ' uploaded' : '<b style="color:var(--red)">missing</b>'}</li></ul></div>
        <div class="card"><h3>Declaration</h3>
          <p class="small muted">I confirm that the information provided is true and correct. I understand that submission is blocked until the registration fee receipt is uploaded and that an Admissions Officer will verify my certificate and receipt.</p></div>
      </div>`;
  }
  const canNext = true;
  return `
    <div class="steps">${chips}</div>
    <div id="step-err"></div>
    <div class="card">${body}
      <div class="flex-between mt-2">
        <button class="btn btn-ghost" id="step-prev" ${applyState.step === 0 ? 'disabled' : ''}>Back</button>
        <div class="flex">
          <button class="btn btn-ghost" id="step-save">Save draft</button>
          ${applyState.step < APPLY_STEPS.length - 1
            ? `<button class="btn btn-gold" id="step-next" ${canNext ? '' : 'disabled'}>Next</button>`
            : `<button class="btn btn-green" id="step-submit">Submit Application</button>`}
        </div>
      </div>
    </div>`;
}
function uploadField(key, label, url) {
  return `<div class="field mb-1"><label>${label}</label>
    <div class="upload-zone" data-doc="${key}">
      
      <div>${url ? '<span class="file-name">Uploaded. Click to replace</span>' : '<b>Click to upload</b>'}</div>
      <div class="upload-note">PDF, JPG or PNG, max 5MB</div>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp">
    </div><div class="upload-msg" data-msg="${key}"></div></div>`;
}
function bindStep() {
  document.querySelectorAll('[data-k]').forEach(el => el.onchange = () => { applyState.data[el.dataset.k] = el.value; });
  document.querySelectorAll('input[name="prog"]').forEach(el => el.onchange = () => { applyState.data.programme_id = Number(el.value); applyState.data.certificate_id = null; viewApply(); });
  document.querySelectorAll('input[name="cert"]').forEach(el => el.onchange = () => { applyState.data.certificate_id = Number(el.value); viewApply(); });
  const addH = $('#add-h');
  if (addH) addH.onclick = () => { collectHist(); (applyState.data.academic_history ||= []).push({}); viewApply(); };
  document.querySelectorAll('[data-del-h]').forEach(b => b.onclick = () => {
    collectHist(); applyState.data.academic_history.splice(Number(b.dataset.delH), 1); viewApply();
  });
  const prev = $('#step-prev'); if (prev) prev.onclick = () => { collectStepData(); applyState.step--; viewApply(); };
  const next = $('#step-next'); if (next) next.onclick = async () => {
    collectStepData();
    const err = validateStep();
    if (err) { $('#step-err').innerHTML = `<div class="form-error">${esc(err)}</div>`; return; }
    if (applyState.step === 4) {
      const d = applyState.data;
      next.disabled = true;
      next.textContent = 'Saving application';
      try {
        const saved = await api('POST', '/applications', {
          programme_id: d.programme_id, certificate_id: d.certificate_id,
          personal_details: { first_name: d.first_name, last_name: d.last_name, dob: d.dob, gender: d.gender, nationality: d.nationality, disability: d.disability },
          contact_details: { address: d.address, city: d.city, phone: d.phone, next_of_kin: d.next_of_kin },
          academic_history: d.academic_history || [], documents: d.documents || {}, submit: false
        });
        applyState.application = saved.application;
      } catch (saveError) {
        $('#step-err').innerHTML = `<div class="form-error">Could not save your application before document upload. ${esc(saveError.message)}</div>`;
        next.disabled = false;
        next.textContent = 'Next';
        return;
      }
    }
    applyState.step++; viewApply();
  };
  const save = $('#step-save'); if (save) save.onclick = () => { collectStepData(); saveApplication(false); };
  const submit = $('#step-submit'); if (submit) submit.onclick = () => { collectStepData(); saveApplication(true); };

  document.querySelectorAll('[data-doc]').forEach(zone => {
    const input = zone.querySelector('input[type=file]');
    zone.onclick = event => { if (event.target !== input) input.click(); };
    input.onchange = async () => {
      if (!input.files[0]) return;
      const key = zone.dataset.doc;
      const fd = new FormData();
      fd.append('key', key);
      fd.append('document', input.files[0]);
      try {
        const r = await api('POST', '/applications/documents', fd, true);
        (applyState.data.documents ||= {})[key] = r.url;
        toast(r.message, 'ok');
        viewApply();
      } catch (err) { $(`[data-msg="${key}"]`).innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
    };
  });
  const feeZone = $('#fee-zone');
  if (feeZone) {
    const feeInput = $('#fee-file');
    feeZone.onclick = event => { if (event.target !== feeInput) feeInput.click(); };
    feeInput.onchange = async () => {
      if (!feeInput.files[0]) return;
      const fd = new FormData();
      fd.append('receipt', feeInput.files[0]);
      try {
        const r = await api('POST', '/applications/fee-receipt', fd, true);
        applyState.data.fee_receipt = r.application.registration_fee_receipt_url;
        toast(r.message, 'ok');
        viewApply();
      } catch (err) { $('#fee-msg').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
    };
  }
}
function collectStepData() {
  document.querySelectorAll('[data-k]').forEach(el => applyState.data[el.dataset.k] = el.value);
  collectHist();
}
function collectHist() {
  const rows = [...document.querySelectorAll('[data-h]')];
  if (!rows.length) return;
  const hist = applyState.data.academic_history || [];
  rows.forEach(el => {
    const i = Number(el.dataset.h);
    hist[i] = hist[i] || {};
    hist[i][el.dataset.hk] = el.value;
  });
  applyState.data.academic_history = hist;
}
function validateStep() {
  const s = applyState.step, d = applyState.data;
  if (s === 0 && (!d.first_name || !d.last_name)) return 'First and last name are required.';
  if (s === 1 && (!d.address || !d.city)) return 'Address and city are required.';
  if (s === 2 && !d.programme_id) return 'Select a programme.';
  if (s === 3 && !d.certificate_id) return 'Select your certificate/qualification.';
  return null;
}
async function saveApplication(submit) {
  const d = applyState.data;
  if (!d.programme_id || !d.certificate_id) { toast('Programme and certificate are required', 'err'); return; }
  try {
    const r = await api('POST', '/applications', {
      programme_id: d.programme_id, certificate_id: d.certificate_id,
      personal_details: { first_name: d.first_name, last_name: d.last_name, dob: d.dob, gender: d.gender, nationality: d.nationality, disability: d.disability },
      contact_details: { address: d.address, city: d.city, phone: d.phone, next_of_kin: d.next_of_kin },
      academic_history: d.academic_history || [],
      documents: d.documents || {},
      submit
    });
    applyState.application = r.application || applyState.application;
    if (submit) {
      toast(r.message, 'ok');
      go('/student/status');
    } else toast('Draft saved', 'ok');
  } catch (err) {
    const detail = err.data?.missing ? `<br>Missing: ${err.data.missing.map(esc).join(', ')}` : '';
    if (err.data?.missing) {
      applyState.step = 5; viewApply();
      setTimeout(() => { const el = $('#step-err'); if (el) el.innerHTML = `<div class="form-error">${esc(err.message)}${detail}</div>`; }, 50);
    } else toast(err.message, 'err');
  }
}

async function viewStatus() {
  studentShell('Application Status', 'Track your admission progress', '<div class="page-loading">Loading</div>');
  const me = await api('GET', '/applications/me');
  const a = me.application;
  if (!a) {
    $('#portal-body').innerHTML = `<div class="card empty">
      <p>No application yet.</p><a class="btn btn-gold" href="#/student/apply">Start Application</a></div>`;
    return;
  }
  const order = ['submitted', 'under_review', 'accepted', 'registered'];
  let curIdx = order.indexOf(a.status);
  if (a.status === 'rejected') curIdx = -1;
  const nodes = ['Submitted', 'Under Review', 'Accepted', 'Registered'].map((label, i) => {
    let cls = '';
    if (a.status === 'rejected') cls = i === 0 ? 'done' : i === 1 ? 'current' : '';
    else if (i < curIdx) cls = 'done';
    else if (i === curIdx) cls = a.status === 'accepted' || a.status === 'registered' ? 'done' : 'current';
    if (a.status === 'registered' && i <= 3) cls = 'done';
    return `<div class="node ${cls}"><span>${label}</span></div>`;
  }).join('');
  const receiptMsg = a.receipt_verification_status === 'rejected'
    ? `<div class="form-error">Receipt rejected: ${esc(a.receipt_rejection_reason || 'no reason given')}. Please re-upload below.</div>` : '';
  let nextStepTitle = 'No action needed right now';
  let nextStepText = 'Your application is being processed. Check this page for updates.';
  let nextStepAction = '';
  if (a.status === 'rejected') {
    nextStepTitle = 'Review your application';
    nextStepText = a.decision_reason || 'Contact Admissions if you need clarification about this decision.';
    nextStepAction = '<a class="btn btn-outline" href="#/student/apply">Review application</a>';
  } else if (a.receipt_verification_status === 'rejected' || !a.registration_fee_receipt_url) {
    nextStepTitle = a.registration_fee_receipt_url ? 'Replace your fee receipt' : 'Upload your fee receipt';
    nextStepText = a.receipt_rejection_reason || 'Admissions needs an approved registration fee receipt to continue reviewing your application.';
    nextStepAction = '<button class="btn btn-outline" type="button" id="status-upload-action">Upload receipt</button>';
  } else if (a.status === 'accepted' || a.status === 'registered') {
    nextStepTitle = 'Continue to semester registration';
    nextStepText = 'Your admission is accepted. Open the registration page to view your semester options and eligibility.';
    nextStepAction = '<a class="btn btn-outline" href="#/student/reregister">Open registration</a>';
  } else if (a.status === 'under_review') {
    nextStepTitle = 'Admissions is reviewing your application';
    nextStepText = 'Your receipt and qualification are being checked. You do not need to submit anything else now.';
  } else if (a.receipt_verification_status === 'approved') {
    nextStepTitle = 'Receipt verified';
    nextStepText = 'Your fee receipt is approved. Admissions will review your application and qualification next.';
  } else {
    nextStepTitle = 'Receipt review in progress';
    nextStepText = 'Admissions is checking your registration fee receipt. You can return here for updates.';
  }
  $('#portal-body').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <div><b>${esc(me.programme?.name || '')}</b><div class="muted small">Certificate: ${esc(me.certificate?.name || '')}</div></div>
        ${statusBadge(a.status)}
      </div>
      ${a.status === 'rejected' ? `<div class="form-error mt-1">Application rejected. ${esc(a.decision_reason || '')}</div>` : ''}
      <div class="tracker">${nodes}</div>
      <dl class="kv">
        <dt>Application ID</dt><dd>#${a.id}</dd>
        <dt>Student number</dt><dd>${esc(a.student_number || me.student?.student_number || ' assigned on acceptance')}</dd>
        <dt>Fee receipt</dt><dd>${statusBadge(a.receipt_verification_status)} ${a.registration_fee_receipt_url ? secureFileLink(a.registration_fee_receipt_url, 'download uploaded receipt') : ' not uploaded'}</dd>
        <dt>Certificate verified</dt><dd>${a.certificate_verified ? 'Yes' : 'No. Pending admissions review'}</dd>
        <dt>Submitted</dt><dd>${new Date(a.created_at).toLocaleString()}</dd>
        <dt>Last updated</dt><dd>${new Date(a.updated_at).toLocaleString()}</dd>
      </dl>
      <section class="next-step" aria-labelledby="next-step-title">
        <div><span class="next-step-label">Your next step</span><h2 id="next-step-title">${esc(nextStepTitle)}</h2>
          <p>${esc(nextStepText)}</p></div>
        ${nextStepAction}
      </section>
      ${receiptMsg}
      ${a.receipt_verification_status === 'rejected' || !a.registration_fee_receipt_url ? `
        <div class="upload-zone mt-2" id="re-receipt">
          
          <div><b>${a.registration_fee_receipt_url ? 'Re-upload registration fee receipt' : 'Upload registration fee receipt'}</b></div>
          <div class="upload-note">Registration fee ${fmtE(REG_FEE)}. PDF/JPG/PNG, max 5MB</div>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp">
        </div><div id="re-msg" class="mt-1"></div>` : ''}
    </div>
    <div class="card mt-2"><h3>What happens next</h3>
      <ol class="small muted">
        <li>An <b>Admissions Officer</b> verifies your registration fee receipt. Rejected receipts are emailed back to you for re-upload.</li>
        <li>Your certificate/qualification is checked against the requirements for the certificate you selected.</li>
        <li>You receive an acceptance email with your student number, then you can register for semester 1.</li>
      </ol></div>`;
  const zone = $('#re-receipt');
  if (zone) {
    const input = zone.querySelector('input');
    zone.onclick = event => { if (event.target !== input) input.click(); };
    input.onchange = async () => {
      if (!input.files[0]) return;
      const fd = new FormData(); fd.append('receipt', input.files[0]);
      try {
        const r = await api('POST', '/applications/fee-receipt', fd, true);
        toast(r.message, 'ok'); viewStatus();
      } catch (err) { $('#re-msg').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
    };
  }
  const uploadAction = $('#status-upload-action');
  if (uploadAction && zone) uploadAction.onclick = () => zone.querySelector('input[type="file"]').click();
}

/* ----- Re-registration ----- */
let rrData = null;
async function viewReregister() {
  studentShell('Semester Re-Registration', 'Eligibility, module selection and uploads', '<div class="page-loading">Loading</div>');
  rrData = await api('GET', '/reregister/preview');
  const { eligibility: elig, preview } = rrData;
  if (!preview) { $('#portal-body').innerHTML = '<div class="card">No programme assigned.</div>'; return; }

  const locked = !elig.eligible;
  const isIntern = preview.is_internship;
  const allMods = [...preview.core_modules, ...preview.minor_modules, ...preview.elective_modules];
  const noScheduledModules = allMods.length === 0;

  const modRow = m => {
    const auto = m.classification === 'core';
    const disabled = locked || auto || !m.prereqs_ok || m.already_passed;
    return `<div class="module-row ${disabled && !auto ? 'locked' : ''}">
      <input type="checkbox" data-mod="${m.id}" data-credits="${m.credits}" data-class="${m.classification}"
        ${auto ? 'checked disabled' : ''} ${disabled && !auto ? 'disabled' : ''}>
      <div class="m-main">
        <span class="m-code">${esc(m.code)}</span> <span class="m-title">${esc(m.title)}</span>
        ${auto ? '<span class="badge blue">core, auto</span>' : ''}
        ${m.already_passed ? '<span class="badge green">already passed</span>' : ''}
        ${!m.prereqs_ok ? '<span class="badge red">prerequisites missing</span>' : ''}
      </div>
      <span class="m-credits">${m.credits} cr</span>
    </div>`;
  };

  const reg = rrData.active_registration;
  $('#portal-body').innerHTML = `
    <div class="card ${elig.eligible ? '' : ''}" style="border-color:${elig.eligible ? 'var(--green)' : 'var(--red)'}">
      <div class="flex-between">
        <div><b>Eligibility gate</b>
          <div class="small ${elig.eligible ? '' : 'muted'}" style="color:${elig.eligible ? 'var(--green)' : 'var(--red)'}">
            ${elig.eligible ? ' You are cleared for re-registration' : ' ' + esc(elig.reason)}</div></div>
        <span class="badge ${elig.eligible ? 'green' : 'red'}">${elig.eligible ? 'Eligible' : 'Locked'}</span>
      </div>
      ${elig.pending_modules.length ? `<ul class="small mt-1">${elig.pending_modules.map(p =>
        `<li style="color:var(--red)">${esc(p.code)} - ${esc(p.title)}${p.grade ? ` (${p.grade})` : ''}</li>`).join('')}</ul>` : ''}
      ${elig.clearance_reason ? `<div class="hint mt-1">Clearance: ${esc(elig.clearance_reason)} (${esc(elig.clearance_term || '')})</div>` : ''}
      ${reg ? `<div class="hint mt-1">Active registration for ${esc(reg.academic_term)}: ${statusBadge(reg.status)}${reg.rejection_reason ? `: ${esc(reg.rejection_reason)}` : ''}</div>` : ''}
    </div>

    ${noScheduledModules ? `<div class="form-error mt-2">No modules have been scheduled for semester ${preview.semester_number}. Contact the Super Admin or Registry before registering.</div>` : ''}

    ${isIntern ? `
      <div class="card mt-2">
        <h3> Internship registration. Semester ${preview.semester_number}</h3>
        <p class="muted small">Final semester. Upload your placement documents and supervisor details.</p>
        <div class="form-grid">
          <div class="field"><label>Organisation <span class="req">*</span></label><input id="org" placeholder="Company name"></div>
          <div class="field"><label>Placement title</label><input id="ptitle" placeholder="e.g. Junior Developer"></div>
          <div class="field"><label>Supervisor name</label><input id="supname"></div>
          <div class="field"><label>Supervisor email</label><input id="supemail" type="email"></div>
        </div>
        <div class="upload-zone mt-1" id="place-zone">
          
          <div><b>Upload placement documents</b></div>
          <div class="upload-note">PDF/JPG/PNG, max 5MB. Compressed automatically</div>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp">
        </div>
        <div id="place-msg" class="mt-1"></div>
      </div>` : `
      <div class="card mt-2">
        <div class="flex-between"><h3>Next Semester Preview. Semester ${preview.semester_number}</h3>
          <span class="badge gold">${esc(preview.academic_term)}</span></div>
        <p class="muted small">Core modules are auto-selected. Choose minor/elective modules to reach at least <b>${preview.credits_per_semester} credits</b>. Prerequisites are checked server-side.</p>
        <div class="credit-meter">
          <b id="cr-label">0 / ${preview.credits_per_semester} credits</b>
          <div class="bar"><i id="cr-bar" style="width:0%"></i></div>
          <span class="hint">minor credits completed: ${preview.minor_credits_completed}/${preview.minor_credits_required}</span>
        </div>
        ${preview.core_modules.length ? `<h4>Core (auto-selected)</h4><div class="module-list mb-1">${preview.core_modules.map(modRow).join('')}</div>` : ''}
        ${preview.minor_modules.length ? `<h4>Minor modules</h4><div class="module-list mb-1">${preview.minor_modules.map(modRow).join('')}</div>` : ''}
        ${preview.elective_modules.length ? `<h4>Electives</h4><div class="module-list">${preview.elective_modules.map(modRow).join('')}</div>` : ''}
      </div>`}

    <div class="card mt-2">
      <h3> SRC Subscription Receipt <span class="badge gold">Mandatory</span></h3>
      <p class="muted small">Submission is blocked server-side without this receipt. Verified by the Registry Officer.</p>
      <div class="upload-zone" id="src-zone">
        
        <div><b>Upload SRC receipt</b></div>
        <div class="upload-note">PDF/JPG/PNG, max 5MB</div>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp">
      </div>
      <div id="src-msg" class="mt-1"></div>
    </div>

    <div class="flex mt-2">
      <button class="btn btn-gold" id="rr-submit" ${locked || noScheduledModules ? 'disabled' : ''}>Submit Registration</button>
      ${locked ? '<span class="hint">Locked until you are cleared with no pending modules.</span>' : ''}
    </div>`;

  // credit meter
  const updateMeter = () => {
    let total = 0;
    document.querySelectorAll('[data-mod]:checked').forEach(cb => { total += Number(cb.dataset.credits); });
    const need = preview.credits_per_semester;
    const pct = Math.min(100, Math.round(total / need * 100));
    const bar = $('#cr-bar');
    if (bar) {
      bar.style.width = pct + '%';
      bar.classList.toggle('over', total > need);
      $('#cr-label').textContent = `${total} / ${need} minimum credits${total >= need ? ' ' : ''}`;
      $('#cr-label').style.color = total >= need ? 'var(--green)' : '';
    }
  };
  document.querySelectorAll('[data-mod]').forEach(cb => cb.onchange = updateMeter);
  updateMeter();

  const bindUpload = (zoneId, inputSel, msgId, setter) => {
    const zone = $(zoneId); if (!zone) return;
    const input = zone.querySelector(inputSel);
    zone.onclick = event => { if (event.target !== input) input.click(); };
    input.onchange = () => setter(input.files[0], msgId);
  };
  let srcFile = null, placeFile = null;
  bindUpload('#src-zone', 'input[type=file]', '#src-msg', (f, m) => { srcFile = f; $(m).innerHTML = `<div class="form-ok"> ${esc(f.name)}</div>`; });
  bindUpload('#place-zone', 'input[type=file]', '#place-msg', (f, m) => { placeFile = f; $(m).innerHTML = `<div class="form-ok"> ${esc(f.name)}</div>`; });

  const submitBtn = $('#rr-submit');
  if (submitBtn) submitBtn.onclick = async () => {
    const selected = [...document.querySelectorAll('[data-mod]:checked')].map(cb => Number(cb.dataset.mod));
    if (!srcFile) { $('#src-msg').innerHTML = '<div class="form-error">SRC receipt is mandatory. Upload it first.</div>'; return; }
    if (isIntern && !placeFile) { $('#place-msg').innerHTML = '<div class="form-error">Placement documents are mandatory for internship registration.</div>'; return; }
    const fd = new FormData();
    fd.append('selected_modules', JSON.stringify(selected));
    fd.append('src_receipt', srcFile);
    if (isIntern) {
      fd.append('placement_document', placeFile);
      fd.append('organisation', $('#org').value);
      fd.append('placement_title', $('#ptitle').value);
      fd.append('supervisor_name', $('#supname').value);
      fd.append('supervisor_email', $('#supemail').value);
    }
    try {
      const r = await api('POST', '/reregister', fd, true);
      toast(r.message, 'ok');
      viewReregister();
    } catch (err) {
      const probs = err.data?.problems?.map(p => `${p.module}: missing ${p.missing_prerequisite}`).join('; ');
      toast(err.message + (probs ? '  ' + probs : ''), 'err');
    }
  };
}

async function viewResults() {
  studentShell('Results & Transcript', 'Your semester results and pending modules', '<div class="page-loading">Loading</div>');
  const r = await api('GET', '/reregister');
  const byTerm = {};
  r.results.forEach(x => { (byTerm[x.academic_term] ||= []).push(x); });
  const terms = Object.keys(byTerm).sort().reverse();
  $('#portal-body').innerHTML = `
    ${r.pending_modules.length ? `<div class="card mb-2" style="border-color:var(--red)">
      <b style="color:var(--red)"> ${r.pending_modules.length} pending module(s)</b>
      <ul class="small">${r.pending_modules.map(p => `<li>${esc(p.code)} - ${esc(p.title)} ${p.grade ? `(${p.grade})` : ''}</li>`).join('')}</ul></div>` :
      `<div class="form-ok mb-2"> No pending modules</div>`}
    ${terms.length ? terms.map(t => `
      <div class="card mb-2"><h3>${esc(t)}</h3>
        <div class="table-wrap"><table><thead><tr><th>Code</th><th>Module</th><th>Credits</th><th>CA</th><th>Exam</th><th>Final</th><th>Grade</th></tr></thead>
        <tbody>${byTerm[t].map(x => `<tr>
          <td>${esc(x.code)}</td><td>${esc(x.title)}</td><td>${x.credits}</td>
          <td>${x.ca_mark ?? ''}</td><td>${x.exam_mark ?? ''}</td><td>${x.final_mark ?? ''}</td>
          <td><b style="color:${['F','X','DNC','DNS'].includes(x.grade) ? 'var(--red)' : 'var(--green)'}">${esc(x.grade || '')}</b>
          ${x.final_exam_failed ? '<span class="badge red">final exam fail</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
      </div>`).join('') : `<div class="card empty"><p>No results recorded yet.</p></div>`}
    <div class="card"><h3>Grading scale</h3><div id="gscale" class="small muted">Loading</div></div>`;
  const gs = await api('GET', '/public/grading-scale');
  $('#gscale').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Grade</th><th>Mark range</th><th>Points</th><th>Meaning</th></tr></thead>
    <tbody>${gs.grading_scale.map(g => `<tr><td><b>${esc(g.grade)}</b></td>
      <td>${g.min_mark != null ? `${g.min_mark}${g.max_mark}` : ''}</td>
      <td>${g.points ?? ''}</td><td>${esc(g.description || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function viewProfile() {
  studentShell('Profile', 'View and edit your details', '<div class="page-loading">Loading</div>');
  const me = await api('GET', '/auth/me');
  const u = me.user;
  $('#portal-body').innerHTML = `
    <div class="card" style="max-width:620px">
      <div class="flex mb-2">
        
        <div><b>${esc(u.full_name)}</b><div class="hint">${esc(u.email)}. ${ROLE_LABEL[u.role]}</div></div>
      </div>
      <div id="prof-err"></div>
      <form id="prof-form">
        <div class="form-grid">
          <div class="field full"><label>Full name</label><input name="full_name" value="${esc(u.full_name)}"></div>
          <div class="field"><label>Phone</label><input name="phone" value="${esc(u.phone || '')}"></div>
          <div class="field"><label>National ID / Passport</label><input name="id_number" value="${esc(u.id_number || '')}"></div>
          <div class="field full"><label>New password (leave blank to keep)</label><input type="password" name="password" autocomplete="new-password"></div>
        </div>
        <button class="btn mt-2" type="submit">Save changes</button>
      </form>
      ${u.student ? `<dl class="kv mt-2">
        <dt>Student number</dt><dd>${esc(u.student.student_number || '')}</dd>
        <dt>Current semester</dt><dd>${u.student.current_semester}</dd>
        <dt>Status</dt><dd>${statusBadge(u.student.status)}</dd></dl>` : ''}
    </div>`;
  $('#prof-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { full_name: f.get('full_name'), phone: f.get('phone'), id_number: f.get('id_number') };
    if (f.get('password')) body.password = f.get('password');
    try {
      const r = await api('PUT', '/auth/profile', body);
      state.user = { ...state.user, ...r.user };
      localStorage.setItem('lck_user', JSON.stringify(state.user));
      renderNav(); toast('Profile updated', 'ok'); viewProfile();
    } catch (err) { $('#prof-err').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
  };
}

/* ---------------- Admin portal ---------------- */
function adminShell(title, sub, body) {
  app.innerHTML = `
  <div class="portal">
    <aside class="portal-side"><div class="side-title">Registry Portal</div>${adminNavLinks().replace(/<button class="nav-link" data-logout>Sign Out<\/button>/, '')}</aside>
    <section class="portal-main">
      <div class="portal-header"><div><h1>${title}</h1><div class="sub">${sub}</div></div></div>
      <div id="portal-body">${body || ''}</div>
    </section>
  </div>`;
  const lo = document.querySelector('[data-logout]');
  if (lo) lo.onclick = () => { clearAuth(); renderNav(); go('/'); };
}

async function viewAdminDashboard() {
  adminShell('Dashboard', `${ROLE_LABEL[state.user.role]} overview`, '<div class="page-loading">Loading</div>');
  const d = await api('GET', '/admin/dashboard');
  const c = d.counts;
  const card = (num, label) => `<div class="stat-card"><div><b>${num}</b><span>${label}</span></div></div>`;
  const role = state.user.role;
  const actions = [];
  if (['admissions_officer', 'super_admin'].includes(role)) actions.push('<a class="btn btn-sm" href="#/admin/applications">Review applications</a>');
  if (['registry_officer', 'super_admin'].includes(role)) {
    actions.push('<a class="btn btn-sm btn-ghost" href="#/admin/registrations">Verify SRC receipts</a>');
    actions.push('<a class="btn btn-sm btn-ghost" href="#/admin/grades">Enter grades</a>');
    actions.push('<a class="btn btn-sm btn-ghost" href="#/admin/clearance">Student clearance</a>');
  }
  if (['registry_officer', 'registrar', 'super_admin'].includes(role)) actions.push('<a class="btn btn-sm btn-ghost" href="#/admin/students">Student records</a>');
  if (role === 'super_admin') actions.push('<a class="btn btn-sm btn-ghost" href="#/admin/modules">Manage modules</a>');
  if (['registrar', 'super_admin'].includes(role)) {
    actions.push('<a class="btn btn-sm btn-ghost" href="#/admin/overrides">Manual overrides</a>');
    actions.push('<a class="btn btn-sm btn-ghost" href="#/admin/export">Export data</a>');
  }
  $('#portal-body').innerHTML = `
    <div class="stat-cards mb-2">
      ${card(c.pending_applications, 'Applications pending review')}
      ${card(c.pending_receipts, 'Fee receipts to verify')}
      ${card(c.pending_registrations, 'Registrations to approve')}
      ${card(c.pending_src, 'SRC receipts to verify')}
      ${card(c.pending_internships, 'Internships submitted')}
      ${card(c.total_students, 'Registered students')}
    </div>
    <div class="grid grid-2">
      <div class="card"><h3>Quick actions</h3><div class="flex">${actions.join('')}</div></div>
      <div class="card"><h3>Ask me</h3>
        <p class="muted small">Open the assistant (bottom-right) and ask e.g. <i>How many applications are pending?</i>, <i>How do I add a module?</i> or <i>How do I clear a student?</i>.</p></div>
    </div>`;
}

async function viewAdminApplications() {
  adminShell('Applications', 'Verify receipts, certificates and make decisions', '<div class="page-loading">Loading</div>');
  const d = await api('GET', '/admin/applications');
  const rows = d.applications.map(a => `<tr>
    <td>#${a.id}</td>
    <td><b>${esc(a.full_name)}</b><div class="hint">${esc(a.email)}</div></td>
    <td>${esc(a.programme_name)}<div class="hint">${esc(a.certificate_name)}</div></td>
    <td>${statusBadge(a.status)}</td>
    <td>${statusBadge(a.receipt_verification_status)}</td>
    <td>${esc(a.student_number || a.profile_student_number || '')}</td>
    <td><div class="actions">
      <button class="btn btn-sm" data-view="${a.id}">Review</button>
    </div></td></tr>`).join('');
  $('#portal-body').innerHTML = d.applications.length ? `
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Applicant</th><th>Programme / Cert</th>
      <th>Status</th><th>Receipt</th><th>Student #</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="card empty"><p>No applications yet.</p></div>`;
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => openApplication(Number(b.dataset.view)));
}

async function openApplication(id) {
  const d = await api('GET', `/admin/applications/${id}`);
  const a = d.application, req = d.requirement;
  const canDecide = ['admissions_officer', 'super_admin'].includes(state.user.role);
  const canVerifyCertificate = ['admissions_officer', 'super_admin'].includes(state.user.role);
  const pd = a.personal_details, cd = a.contact_details;
  const docs = a.documents || {};
  const hist = (a.academic_history || []).map(h =>
    `<tr><td>${esc(h.subject)}</td><td>${esc(h.level)}</td><td>${esc(h.grade)}</td><td>${esc(h.points)}</td></tr>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-backdrop" id="app-modal">
    <div class="modal">
      <div class="flex-between"><h2>Application #${a.id}</h2>${statusBadge(a.status)}</div>
      <dl class="kv">
        <dt>Applicant</dt><dd>${esc(a.full_name)} (${esc(a.email)}), ${esc(a.id_number || 'no ID')}</dd>
        <dt>Programme</dt><dd>${esc(a.programme_name)}, ${esc(a.certificate_name)} certificate</dd>
        <dt>Fee receipt</dt><dd>${statusBadge(a.receipt_verification_status)}
          ${a.registration_fee_receipt_url ? secureFileLink(a.registration_fee_receipt_url, 'download') : 'not uploaded'}
          ${a.receipt_rejection_reason ? `<div class="hint">Rejected: ${esc(a.receipt_rejection_reason)}</div>` : ''}</dd>
        <dt>Certificate verified</dt><dd>${a.certificate_verified ? 'Yes' : 'No'}</dd>
        <dt>Student number</dt><dd>${esc(a.student_number || '')}</dd>
      </dl>
      <h3 class="mt-2">Requirements for ${esc(a.certificate_name)}</h3>
      ${req ? `<div class="req-box">${reqBoxHtml(req)}</div>` : '<p class="muted">No certificate-specific entry rules are published for this programme. Confirm requirements with Admissions before deciding.</p>'}
      <h3 class="mt-2">Declared subjects</h3>
      <div class="table-wrap"><table><thead><tr><th>Subject</th><th>Level</th><th>Grade</th><th>Points</th></tr></thead>
        <tbody>${hist || '<tr><td colspan="4" class="muted">None</td></tr>'}</tbody></table></div>
      <section class="card mt-2">
        <h3>Academic certificate verification</h3>
        <p class="small">Selected qualification: <b>${esc(a.certificate_name)}</b></p>
        <p>${docs.academic_cert ? secureFileLink(docs.academic_cert, 'Download uploaded academic certificate') : 'The applicant has not uploaded an academic certificate.'}</p>
        <p>Verification: <b>${a.certificate_verified ? 'Verified' : 'Not verified'}</b></p>
        ${canVerifyCertificate ? `
          ${docs.academic_cert ? `<div class="flex">
            ${a.certificate_verified
              ? '<button class="btn btn-outline btn-sm" type="button" data-cert-action="revoked">Revoke verification</button>'
              : '<button class="btn btn-outline btn-sm" type="button" data-cert-action="verified">Verify academic certificate</button>'}
          </div>` : '<p class="hint">Verification is unavailable until the academic certificate is uploaded.</p>'}
          ${a.certificate_verified ? '<div class="field mt-1"><label for="cert-revoke-reason">Reason for revoking verification</label><input id="cert-revoke-reason" autocomplete="off" placeholder="Required to revoke"></div>' : ''}
        ` : ''}
        ${docs.id_copy ? `<p class="small">Identity document: ${secureFileLink(docs.id_copy, 'Download ID or passport copy')}</p>` : ''}
      </section>
      <h3 class="mt-2">Personal / contact</h3>
      <dl class="kv">
        <dt>Name</dt><dd>${esc((pd.first_name || '') + ' ' + (pd.last_name || ''))} ${pd.gender ? ` ${esc(pd.gender)}` : ''}</dd>
        <dt>Address</dt><dd>${esc(cd.address || '')}, ${esc(cd.city || '')}</dd>
        <dt>Phone</dt><dd>${esc(cd.phone || a.phone || '')}</dd>
      </dl>
      ${canDecide ? `
      <div class="card mt-2" style="background:var(--paper-2)">
        <h3>Receipt verification</h3>
        <div class="flex mb-1">
          <button class="btn btn-green btn-sm" data-rc="approved">Approve receipt</button>
          <button class="btn btn-red btn-sm" data-rc="rejected">Reject receipt</button>
        </div>
        <div class="field"><label>Rejection reason (required for reject)</label><input id="rc-reason" placeholder="e.g. Amount or date not visible"></div>
        <h3 class="mt-2">Application decision</h3>
        <div class="field mt-1"><label>Decision reason (required for reject)</label><input id="dec-reason" placeholder="Reason"></div>
        <div class="flex mt-1">
          <button class="btn btn-green btn-sm" data-dec="accepted">Accept &amp; generate student number</button>
          <button class="btn btn-red btn-sm" data-dec="rejected">Reject</button>
        </div>
      </div>` : ''}
      <div class="modal-actions"><button class="btn btn-ghost" type="button" data-close-modal="app-modal">Close</button></div>
    </div>
  </div>`);
  const close = () => $('#app-modal').remove();
  document.querySelectorAll('[data-rc]').forEach(b => b.onclick = async () => {
    try {
      const r = await api('POST', `/admin/applications/${id}/receipt`, { action: b.dataset.rc, reason: $('#rc-reason').value });
      toast(r.message, 'ok'); close(); viewAdminApplications();
    } catch (err) { toast(err.message, 'err'); }
  });
  document.querySelectorAll('[data-cert-action]').forEach(b => b.onclick = async () => {
    const action = b.dataset.certAction;
    const reason = action === 'revoked' ? ($('#cert-revoke-reason')?.value || '').trim() : '';
    if (action === 'revoked' && !reason) {
      toast('Enter a reason before revoking certificate verification', 'err');
      $('#cert-revoke-reason')?.focus();
      return;
    }
    b.disabled = true;
    try {
      const r = await api('POST', `/admin/applications/${id}/certificate-verification`, { action, reason });
      toast(r.message, 'ok');
      close();
      openApplication(id);
    } catch (err) {
      toast(err.message, 'err');
      b.disabled = false;
    }
  });
  document.querySelectorAll('[data-dec]').forEach(b => b.onclick = async () => {
    try {
      const r = await api('POST', `/admin/applications/${id}/decision`, {
        action: b.dataset.dec, reason: $('#dec-reason').value
      });
      toast(r.message, 'ok'); close(); viewAdminApplications();
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function viewAdminStudents() {
  adminShell('Students', 'Registered and applying students', '<div class="page-loading">Loading</div>');
  const d = await api('GET', '/admin/students');
  const rows = d.students.map(s => `<tr>
    <td>${esc(s.student_number || '')}</td>
    <td><b>${esc(s.full_name)}</b><div class="hint">${esc(s.email)}</div></td>
    <td>${esc(s.programme_name || '')}</td>
    <td>${esc(s.certificate_name || '')}</td>
    <td>${s.current_semester}</td>
    <td>${statusBadge(s.status)}</td>
    <td><div class="actions">${state.user.role === 'admissions_officer' ? '' : `<button class="btn btn-sm btn-ghost" data-rec="${s.user_id}">Record</button>`}</div></td></tr>`).join('');
  $('#portal-body').innerHTML = `
    <div class="table-wrap"><table><thead><tr><th>Student #</th><th>Name</th><th>Programme</th>
      <th>Certificate</th><th>Sem</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">None yet</td></tr>'}</tbody></table></div>`;
  document.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => openStudentRecord(Number(b.dataset.rec)));
}

async function openStudentRecord(userId) {
  const d = await api('GET', `/admin/students/${userId}/record`);
  const s = d.student;
  const results = d.results.map(r => `<tr><td>${esc(r.academic_term)}</td><td>${esc(r.code)}</td><td>${esc(r.title)}</td>
    <td>${r.final_mark ?? ''}</td><td><b>${esc(r.grade || '')}</b></td></tr>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-backdrop" id="rec-modal"><div class="modal">
    <div class="flex-between"><h2>${esc(s.full_name)}</h2>${statusBadge(s.status)}</div>
    <dl class="kv">
      <dt>Student number</dt><dd>${esc(s.student_number || '')}</dd>
      <dt>Programme</dt><dd>${esc(s.programme_name || '')}</dd>
      <dt>Certificate</dt><dd>${esc(s.certificate_name || '')}</dd>
      <dt>Current semester</dt><dd>${s.current_semester}</dd>
      <dt>Email</dt><dd>${esc(s.email)}</dd>
    </dl>
    <h3 class="mt-2">Results</h3>
    <div class="table-wrap"><table><thead><tr><th>Term</th><th>Code</th><th>Module</th><th>Final</th><th>Grade</th></tr></thead>
      <tbody>${results || '<tr><td colspan="5" class="muted">No results</td></tr>'}</tbody></table></div>
    <h3 class="mt-2">Pending modules</h3>
    ${d.pending_modules.length ? `<ul class="small">${d.pending_modules.map(p => `<li style="color:var(--red)">${esc(p.code)} - ${esc(p.title)} ${p.grade ? `(${p.grade})` : ''}</li>`).join('')}</ul>`
      : '<div class="form-ok"> None</div>'}
    <div class="modal-actions"><button class="btn btn-ghost" type="button" data-close-modal="rec-modal">Close</button></div>
  </div></div>`);
}

async function viewAdminGrades() {
  adminShell('Grade Entry', 'CA and exam marks. Final exam below 40 flags a pending module', '<div class="page-loading">Loading</div>');
  const [students, modules] = await Promise.all([
    api('GET', '/admin/students'), api('GET', '/admin/modules')
  ]);
  $('#portal-body').innerHTML = `
    <div class="card" style="max-width:760px">
      <div id="grade-err"></div>
      <form id="grade-form" class="form-grid">
        <div class="field"><label>Student</label><select name="student_id" required>
          <option value="">Select</option>
          ${students.students.filter(s => s.student_number).map(s => `<option value="${s.user_id}">${esc(s.student_number)} - ${esc(s.full_name)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Module</label><select name="module_id" required>
          <option value="">Select</option>
          ${modules.modules.map(m => `<option value="${m.id}">${esc(m.code)} - ${esc(m.title)} (${esc(m.programme_name)})</option>`).join('')}
        </select></div>
        <div class="field"><label>Academic term</label><input name="academic_term" placeholder="2026/sem-1" required></div>
        <div class="field"><label>CA mark (0100)</label><input name="ca_mark" type="number" min="0" max="100" required></div>
        <div class="field"><label>Final exam mark (0100)</label><input name="exam_mark" type="number" min="0" max="100" required></div>
        <div class="field" style="justify-content:flex-end"><button class="btn btn-gold" type="submit">Record grade</button></div>
      </form>
      <p class="hint">Final mark equals CA times 40 percent plus exam times 60 percent. Exam under 40 means grade F, student flagged with a pending module.</p>
    </div>`;
  $('#grade-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/admin/grades', {
        student_id: Number(f.get('student_id')), module_id: Number(f.get('module_id')),
        academic_term: f.get('academic_term'), ca_mark: Number(f.get('ca_mark')), exam_mark: Number(f.get('exam_mark'))
      });
      toast(r.message, r.final_exam_failed ? 'err' : 'ok');
      e.target.reset();
    } catch (err) { $('#grade-err').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
  };
}

async function viewAdminClearance() {
  adminShell('Clearance', 'Mark students as cleared for re-registration', '<div class="page-loading">Loading</div>');
  const students = await api('GET', '/admin/students');
  $('#portal-body').innerHTML = `
    <div class="card" style="max-width:720px">
      <div id="clr-err"></div>
      <form id="clr-form" class="form-grid">
        <div class="field"><label>Student</label><select name="student_id" required>
          <option value="">Select</option>
          ${students.students.filter(s => s.student_number).map(s => `<option value="${s.user_id}">${esc(s.student_number)} - ${esc(s.full_name)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Academic term (completed)</label><input name="academic_term" placeholder="2026/sem-1" required></div>
        <div class="field"><label>Decision</label><select name="cleared"><option value="1">Cleared </option><option value="0">Not cleared</option></select></div>
        <div class="field full"><label>Reason (required when clearing)</label><input name="reason" placeholder="All modules passed"></div>
        <div class="field"><button class="btn btn-gold" type="submit">Save clearance</button></div>
      </form>
      <p class="hint">A student's re-registration unlocks only after clearance <b>and</b> zero pending modules.</p>
    </div>`;
  $('#clr-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/admin/clearance', {
        student_id: Number(f.get('student_id')), academic_term: f.get('academic_term'),
        cleared: f.get('cleared') === '1', reason: f.get('reason')
      });
      toast(r.message, 'ok'); e.target.reset();
    } catch (err) { $('#clr-err').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
  };
}

async function viewAdminRegistrations() {
  adminShell('Semester Registrations', 'Verify SRC receipts and approve registrations', '<div class="page-loading">Loading</div>');
  const d = await api('GET', '/admin/registrations');
  const rows = d.registrations.map(r => `<tr>
    <td>#${r.id}</td>
    <td><b>${esc(r.full_name || '')}</b><div class="hint">${esc(r.student_number || '')}</div></td>
    <td>${esc(r.academic_term)}<div class="hint">sem ${r.semester_number}, ${esc(r.type)}</div></td>
    <td>${(r.selected_modules || []).length} modules</td>
    <td>${r.src_receipt ? statusBadge(r.src_receipt.verification_status) : '<span class="badge red">missing</span>'}</td>
    <td>${statusBadge(r.status)}${r.rejection_reason ? `<div class="hint">${esc(r.rejection_reason)}</div>` : ''}</td>
    <td><div class="actions">
      <button class="btn btn-sm btn-outline" type="button" data-view-reg="${r.id}">View details</button>
      ${['registry_officer', 'super_admin'].includes(state.user.role) && r.src_receipt && r.src_receipt.verification_status === 'pending' ? `
        <button class="btn btn-sm btn-outline" type="button" data-src="${r.id}" data-act="approved">Approve SRC</button>
        <button class="btn btn-sm btn-outline" type="button" data-src="${r.id}" data-act="rejected">Reject SRC</button>` : ''}
      ${['registry_officer', 'super_admin'].includes(state.user.role) && r.status === 'submitted' && r.src_receipt?.verification_status === 'approved' ? `
        <button class="btn btn-sm btn-blue" data-app="${r.id}">Approve</button>
        <button class="btn btn-sm btn-red" data-rej="${r.id}">Reject</button>` : ''}
    </div></td></tr>`).join('');
  $('#portal-body').innerHTML = `
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Student</th><th>Term</th><th>Modules</th>
      <th>SRC receipt</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">No registrations</td></tr>'}</tbody></table></div>`;
  document.querySelectorAll('[data-view-reg]').forEach(b => b.onclick = () => openRegistrationRecord(Number(b.dataset.viewReg)));
  document.querySelectorAll('[data-src]').forEach(b => b.onclick = async () => {
    let notes = null;
    if (b.dataset.act === 'rejected') { notes = prompt('Rejection reason:'); if (!notes) return; }
    try {
      const r = await api('POST', `/admin/registrations/${b.dataset.src}/src`, { action: b.dataset.act, notes });
      toast(r.message, 'ok'); viewAdminRegistrations();
    } catch (err) { toast(err.message, 'err'); }
  });
  document.querySelectorAll('[data-app]').forEach(b => b.onclick = async () => {
    try { const r = await api('POST', `/admin/registrations/${b.dataset.app}/approve`, {}); toast(r.message, 'ok'); viewAdminRegistrations(); }
    catch (err) { toast(err.message, 'err'); }
  });
  document.querySelectorAll('[data-rej]').forEach(b => b.onclick = async () => {
    const reason = prompt('Rejection reason:'); if (!reason) return;
    try { const r = await api('POST', `/admin/registrations/${b.dataset.rej}/reject`, { reason }); toast(r.message, 'ok'); viewAdminRegistrations(); }
    catch (err) { toast(err.message, 'err'); }
  });
}

async function openRegistrationRecord(id) {
  try {
    const d = await api('GET', `/admin/registrations/${id}/details`);
    const r = d.registration;
    const modules = d.modules.map(m => `<tr><td>${esc(m.code)}</td><td>${esc(m.title)}</td><td>${m.credits}</td><td>${esc(m.classification)}</td></tr>`).join('');
    const receipt = r.src_receipt;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-backdrop" id="registration-modal">
        <article class="modal" role="dialog" aria-modal="true" aria-labelledby="registration-modal-title">
          <div class="flex-between"><h2 id="registration-modal-title">Registration ${esc(r.academic_term)}</h2>${statusBadge(r.status)}</div>
          <dl class="kv">
            <dt>Student</dt><dd>${esc(r.full_name)} (${esc(r.student_number || 'No student number')})</dd>
            <dt>Programme</dt><dd>${esc(r.programme_name || '')}</dd>
            <dt>Semester</dt><dd>${r.semester_number}</dd>
            <dt>Registration type</dt><dd>${esc(r.type)}</dd>
            <dt>SRC receipt</dt><dd>${receipt ? `${statusBadge(receipt.verification_status)} ${secureFileLink(receipt.file_url, 'Download SRC receipt')}` : 'No receipt uploaded'}</dd>
            ${receipt?.notes ? `<dt>Receipt note</dt><dd>${esc(receipt.notes)}</dd>` : ''}
          </dl>
          <h3 class="mt-2">Selected modules</h3>
          <div class="table-wrap"><table><thead><tr><th>Code</th><th>Module</th><th>Credits</th><th>Type</th></tr></thead>
            <tbody>${modules || '<tr><td colspan="4">No module details available</td></tr>'}</tbody></table></div>
          <div class="modal-actions"><button class="btn btn-outline" type="button" data-close-modal="registration-modal">Close</button></div>
        </article>
      </div>`);
  } catch (err) { toast(err.message, 'err'); }
}

async function viewAdminInternships() {
  adminShell('Internship Placements', 'Review placements and log final grades', '<div class="page-loading">Loading</div>');
  const d = await api('GET', '/admin/internships');
  const rows = d.internships.map(i => `<tr>
    <td>#${i.id}</td>
    <td><b>${esc(i.full_name)}</b><div class="hint">${esc(i.student_number || '')}</div></td>
    <td>${esc(i.organisation || '')}<div class="hint">${esc(i.placement_title || '')}</div></td>
    <td>${i.placement_document_url ? secureFileLink(i.placement_document_url, 'download documents') : ''}</td>
    <td>${statusBadge(i.status)}</td>
    <td>${esc(i.final_grade || '')}</td>
    <td><div class="actions">${['registry_officer', 'super_admin'].includes(state.user.role) ? `
      <button class="btn btn-sm btn-green" data-int="${i.id}" data-act="approved">Approve</button>
      <button class="btn btn-sm btn-blue" data-grade="${i.id}">Log grade</button>
      <button class="btn btn-sm btn-red" data-int="${i.id}" data-act="rejected">Reject</button>` : 'View only'}</div></td></tr>`).join('');
  $('#portal-body').innerHTML = `
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Student</th><th>Placement</th><th>Docs</th>
      <th>Status</th><th>Final grade</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">No placements</td></tr>'}</tbody></table></div>`;
  document.querySelectorAll('[data-int]').forEach(b => b.onclick = async () => {
    try { const r = await api('POST', `/admin/internships/${b.dataset.int}`, { action: b.dataset.act }); toast(r.message, 'ok'); viewAdminInternships(); }
    catch (err) { toast(err.message, 'err'); }
  });
  document.querySelectorAll('[data-grade]').forEach(b => b.onclick = async () => {
    const g = prompt('Final grade (A+  D, PX):'); if (!g) return;
    try { const r = await api('POST', `/admin/internships/${b.dataset.grade}`, { action: 'graded', final_grade: g.trim().toUpperCase() }); toast(r.message, 'ok'); viewAdminInternships(); }
    catch (err) { toast(err.message, 'err'); }
  });
}

async function viewAdminProgrammes() {
  adminShell('Programmes', 'Create and edit programmes (Super Admin)', '<div class="page-loading">Loading</div>');
  const d = await api('GET', '/admin/programmes');
  const rows = d.programmes.map(p => `<tr>
    <td>#${p.id}</td><td><b>${esc(p.name)}</b><div class="hint">${esc(p.faculty || '')}</div></td>
    <td>${esc(p.level)}</td><td>${p.total_semesters}</td><td>${p.internship_semester}</td>
    <td>${p.credits_per_semester}</td><td>${p.minor_credits_required}</td>
    <td>${p.is_active ? '<span class="badge green">active</span>' : '<span class="badge red">inactive</span>'}</td>
    <td><button class="btn btn-sm btn-ghost" data-edit="${p.id}">Edit</button></td></tr>`).join('');
  $('#portal-body').innerHTML = `
    <div class="card mb-2"><h3>Add programme</h3>
      <form id="prog-form" class="form-grid">
        <div class="field full"><label>Name <span class="req">*</span></label><input name="name" required placeholder="Bachelor of Science (Hons) in ..."></div>
        <div class="field"><label>Level</label><select name="level"><option value="bachelors">Bachelor's</option><option value="associate">Associate</option></select></div>
        <div class="field"><label>Total semesters <span class="req">*</span></label><input name="total_semesters" type="number" min="1" value="8" required></div>
        <div class="field"><label>Internship semester <span class="req">*</span></label><input name="internship_semester" type="number" min="1" value="8" required></div>
        <div class="field"><label>Credits per semester</label><input name="credits_per_semester" type="number" value="18"></div>
        <div class="field"><label>Minor credits required</label><input name="minor_credits_required" type="number" value="12"></div>
        <div class="field full"><label>Description</label><textarea name="description"></textarea></div>
        <div class="field"><button class="btn btn-gold" type="submit">Create programme</button></div>
      </form></div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Level</th><th>Semesters</th>
      <th>Internship</th><th>Credits/sem</th><th>Minor req.</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $('#prog-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/admin/programmes', {
        name: f.get('name'), level: f.get('level'), total_semesters: Number(f.get('total_semesters')),
        internship_semester: Number(f.get('internship_semester')), credits_per_semester: Number(f.get('credits_per_semester')),
        minor_credits_required: Number(f.get('minor_credits_required')), description: f.get('description')
      });
      toast(r.message, 'ok'); viewAdminProgrammes();
    } catch (err) { toast(err.message, 'err'); }
  };
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const p = d.programmes.find(x => x.id === Number(b.dataset.edit));
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="p-modal"><div class="modal">
      <h2>Edit programme</h2>
      <form id="p-form" class="form-grid">
        <div class="field full"><label>Name</label><input name="name" value="${esc(p.name)}"></div>
        <div class="field"><label>Total semesters</label><input name="total_semesters" type="number" value="${p.total_semesters}"></div>
        <div class="field"><label>Internship semester</label><input name="internship_semester" type="number" value="${p.internship_semester}"></div>
        <div class="field"><label>Credits/semester</label><input name="credits_per_semester" type="number" value="${p.credits_per_semester}"></div>
        <div class="field"><label>Minor credits</label><input name="minor_credits_required" type="number" value="${p.minor_credits_required}"></div>
        <div class="field"><label>Active</label><select name="is_active"><option value="1" ${p.is_active ? 'selected' : ''}>Yes</option><option value="0" ${!p.is_active ? 'selected' : ''}>No</option></select></div>
        <div class="field full"><label>Description</label><textarea name="description">${esc(p.description || '')}</textarea></div>
      </form>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" data-close-modal="p-modal">Cancel</button>
        <button class="btn btn-gold" id="p-save">Save</button>
      </div></div></div>`);
    $('#p-save').onclick = async () => {
      const f = new FormData($('#p-form'));
      try {
        await api('PUT', `/admin/programmes/${p.id}`, {
          name: f.get('name'), total_semesters: Number(f.get('total_semesters')),
          internship_semester: Number(f.get('internship_semester')), credits_per_semester: Number(f.get('credits_per_semester')),
          minor_credits_required: Number(f.get('minor_credits_required')), description: f.get('description'),
          is_active: f.get('is_active') === '1'
        });
        toast('Programme updated', 'ok'); $('#p-modal').remove(); viewAdminProgrammes();
      } catch (err) { toast(err.message, 'err'); }
    };
  });
}

async function viewAdminCertificates() {
  adminShell('Certificates', 'Accepted qualifications (EGCSE, IGCSE, )', '<div class="page-loading">Loading</div>');
  const d = await api('GET', '/admin/certificates');
  const rows = d.certificates.map(c => `<tr>
    <td>#${c.id}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.description || '')}</td>
    <td>${c.is_active ? '<span class="badge green">active</span>' : '<span class="badge red">inactive</span>'}</td>
    <td><button class="btn btn-sm btn-ghost" data-tog="${c.id}" data-val="${c.is_active ? 0 : 1}">${c.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('');
  $('#portal-body').innerHTML = `
    <div class="card mb-2"><h3>Add certificate</h3>
      <form id="cert-form" class="form-grid">
        <div class="field"><label>Certificate name <span class="req">*</span></label><input name="name" required placeholder="e.g. HIGHSCHOOL"></div>
        <div class="field full"><label>Description</label><input name="description"></div>
        <div class="field"><button class="btn btn-gold" type="submit">Add certificate</button></div>
      </form></div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Description</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  $('#cert-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { const r = await api('POST', '/admin/certificates', { name: f.get('name'), description: f.get('description') }); toast(r.message, 'ok'); viewAdminCertificates(); }
    catch (err) { toast(err.message, 'err'); }
  };
  document.querySelectorAll('[data-tog]').forEach(b => b.onclick = async () => {
    try { await api('PUT', `/admin/certificates/${b.dataset.tog}`, { is_active: b.dataset.val === '1' }); viewAdminCertificates(); }
    catch (err) { toast(err.message, 'err'); }
  });
}

async function viewAdminRequirements() {
  adminShell('Admission Requirements', 'Cut-off points and subjects per programme + certificate', '<div class="page-loading">Loading</div>');
  const [reqs, progs, certs] = await Promise.all([
    api('GET', '/admin/requirements'), api('GET', '/public/programmes'), api('GET', '/public/certificates')
  ]);
  const rows = reqs.requirements.map(r => `<tr>
    <td>#${r.id}</td><td>${esc(r.programme_name)}</td><td><b>${esc(r.certificate_name)}</b></td>
    <td><b>${r.min_cutoff_points}</b></td><td>${(r.required_subjects || []).map(s => `<span class="badge">${esc(s)}</span>`).join(' ')}</td>
    <td class="small muted">${esc(r.notes || '')}</td>
    <td><div class="actions">
      <button class="btn btn-sm btn-ghost" data-edit='${JSON.stringify(r).replace(/'/g, "&#39;")}'>Edit</button>
      <button class="btn btn-sm btn-red" data-del="${r.id}">Delete</button>
    </div></td></tr>`).join('');
  $('#portal-body').innerHTML = `
    <div class="card mb-2"><h3>Set requirement</h3>
      <p class="hint">For each programme + certificate combination define the minimum cut-off points and required subjects.</p>
      <form id="req-form" class="form-grid">
        <div class="field"><label>Programme</label><select name="programme_id" required>
          ${progs.programmes.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Certificate</label><select name="certificate_id" required>
          ${certs.certificates.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Minimum cut-off points <span class="req">*</span></label><input name="min_cutoff_points" type="number" step="0.5" required></div>
        <div class="field full"><label>Required subjects (comma-separated)</label><input name="required_subjects" placeholder="Mathematics, English"></div>
        <div class="field full"><label>Notes</label><input name="notes"></div>
        <div class="field"><button class="btn btn-gold" type="submit">Save requirement</button></div>
      </form></div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Programme</th><th>Certificate</th><th>Cut-off</th>
      <th>Subjects</th><th>Notes</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $('#req-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/admin/requirements', {
        programme_id: Number(f.get('programme_id')), certificate_id: Number(f.get('certificate_id')),
        min_cutoff_points: Number(f.get('min_cutoff_points')),
        required_subjects: f.get('required_subjects').split(',').map(s => s.trim()).filter(Boolean),
        notes: f.get('notes')
      });
      toast(r.message, 'ok'); viewAdminRequirements();
    } catch (err) { toast(err.message, 'err'); }
  };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this requirement?')) return;
    try { await api('DELETE', `/admin/requirements/${b.dataset.del}`); viewAdminRequirements(); }
    catch (err) { toast(err.message, 'err'); }
  });
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const r = JSON.parse(b.dataset.edit.replace(/&#39;/g, "'"));
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="r-modal"><div class="modal">
      <h2>Edit requirement</h2>
      <form id="r-form" class="form-grid">
        <div class="field"><label>Cut-off points</label><input name="min_cutoff_points" type="number" step="0.5" value="${r.min_cutoff_points}"></div>
        <div class="field full"><label>Required subjects (comma-separated)</label><input name="required_subjects" value="${esc((r.required_subjects || []).join(', '))}"></div>
        <div class="field full"><label>Notes</label><input name="notes" value="${esc(r.notes || '')}"></div>
      </form>
      <div class="modal-actions"><button class="btn btn-ghost" type="button" data-close-modal="r-modal">Cancel</button><button class="btn btn-gold" type="button" id="r-save">Save</button></div>
    </div></div>`);
    $('#r-save').onclick = async () => {
      const f = new FormData($('#r-form'));
      try {
        await api('POST', '/admin/requirements', {
          programme_id: r.programme_id, certificate_id: r.certificate_id,
          min_cutoff_points: Number(f.get('min_cutoff_points')),
          required_subjects: f.get('required_subjects').split(',').map(s => s.trim()).filter(Boolean),
          notes: f.get('notes')
        });
        toast('Requirement updated', 'ok'); $('#r-modal').remove(); viewAdminRequirements();
      } catch (err) { toast(err.message, 'err'); }
    };
  });
}

async function viewAdminModules() {
  adminShell('Module Management', 'Add module ID + name, classify, schedule and set prerequisites', '<div class="page-loading">Loading</div>');
  const [mods, progs] = await Promise.all([api('GET', '/admin/modules?include_inactive=true'), api('GET', '/public/programmes')]);
  const allModules = mods.modules;
  const rows = allModules.map(m => `<tr ${!m.is_active ? 'style="opacity:.55"' : ''}>
    <td>#${m.id}</td><td><b>${esc(m.code)}</b></td><td>${esc(m.title)}</td>
    <td>${esc(m.programme_name)}</td><td>${m.semester_number}</td>
    <td><span class="badge ${m.classification === 'core' ? 'blue' : m.classification === 'minor' ? 'violet' : 'gold'}">${esc(m.classification)}</span></td>
    <td>${m.credits}</td>
    <td class="small">${(m.prerequisites || []).map(p => esc(p.code)).join(', ') || ''}</td>
    <td>${m.is_active ? '<span class="badge green">active</span>' : '<span class="badge red">deleted</span>'}</td>
    <td><div class="actions">
      <button class="btn btn-sm btn-ghost" data-edit="${m.id}">Edit</button>
      ${m.is_active ? `<button class="btn btn-sm btn-red" data-del="${m.id}">Delete</button>`
        : `<button class="btn btn-sm btn-green" data-rest="${m.id}">Restore</button>`}
    </div></td></tr>`).join('');

  const prereqOptions = (programmeId, excludeId = null, selectedIds = []) => allModules
    .filter(m => m.is_active && Number(m.programme_id) === Number(programmeId) && m.id !== Number(excludeId))
    .map(m => `<option value="${m.id}" ${selectedIds.includes(Number(m.id)) ? 'selected' : ''}>${esc(m.code)} - ${esc(m.title)}</option>`).join('');

  $('#portal-body').innerHTML = `
    <div class="card mb-2"><h3>Add module <span class="badge gold">admin enters ID + name</span></h3>
      <form id="mod-form" class="form-grid">
        <div class="field"><label>Module ID / code <span class="req">*</span></label><input name="code" required placeholder="e.g. AIOP3111"></div>
        <div class="field"><label>Module name / title <span class="req">*</span></label><input name="title" required placeholder="e.g. Artificial Intelligence"></div>
        <div class="field"><label>Programme</label><select name="programme_id" required>
          ${progs.programmes.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Semester number</label><input name="semester_number" type="number" min="1" value="1" required></div>
        <div class="field"><label>Credits</label><input name="credits" type="number" min="1" value="3" required></div>
        <div class="field"><label>Classification</label><select name="classification">
          <option value="core">Core</option><option value="minor">Minor</option><option value="elective">Elective</option></select></div>
        <div class="field full"><label>Prerequisites (multi-select)</label>
          <select name="prerequisites" multiple size="4">${prereqOptions(progs.programmes[0]?.id)}</select></div>
        <div class="field"><button class="btn btn-gold" type="submit">Create module</button></div>
      </form></div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Code</th><th>Name</th><th>Programme</th><th>Sem</th>
      <th>Class</th><th>Credits</th><th>Prerequisites</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;

  $('#mod-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/admin/modules', {
        code: f.get('code'), title: f.get('title'), programme_id: Number(f.get('programme_id')),
        semester_number: Number(f.get('semester_number')), credits: Number(f.get('credits')),
        classification: f.get('classification'),
        prerequisites: [...f.getAll('prerequisites').map(Number)]
      });
      toast(r.message, 'ok'); viewAdminModules();
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#mod-form [name="programme_id"]').onchange = e => {
    $('#mod-form [name="prerequisites"]').innerHTML = prereqOptions(e.target.value);
  };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Soft-delete this module? History is preserved.')) return;
    try { const r = await api('DELETE', `/admin/modules/${b.dataset.del}`); toast(r.message, 'ok'); viewAdminModules(); }
    catch (err) { toast(err.message, 'err'); }
  });
  document.querySelectorAll('[data-rest]').forEach(b => b.onclick = async () => {
    try { await api('POST', `/admin/modules/${b.dataset.rest}/restore`); viewAdminModules(); }
    catch (err) { toast(err.message, 'err'); }
  });
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const m = allModules.find(x => x.id === Number(b.dataset.edit));
    const preIds = new Set((m.prerequisites || []).map(p => p.id));
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="m-modal"><div class="modal">
      <h2>Edit module</h2>
      <form id="m-form" class="form-grid">
        <div class="field"><label>Module ID</label><input name="code" value="${esc(m.code)}"></div>
        <div class="field"><label>Module name</label><input name="title" value="${esc(m.title)}"></div>
        <div class="field"><label>Programme assignment</label><select name="programme_id">
          ${progs.programmes.map(p => `<option value="${p.id}" ${Number(m.programme_id) === Number(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Scheduled semester</label><input name="semester_number" type="number" min="1" max="${progs.programmes.find(p => Number(p.id) === Number(m.programme_id))?.total_semesters || ''}" value="${m.semester_number}"></div>
        <div class="field"><label>Credits</label><input name="credits" type="number" value="${m.credits}"></div>
        <div class="field"><label>Classification</label><select name="classification">
          ${['core', 'minor', 'elective'].map(c => `<option ${m.classification === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>Active</label><select name="is_active">
          <option value="1" ${m.is_active ? 'selected' : ''}>Yes</option><option value="0" ${!m.is_active ? 'selected' : ''}>No</option></select></div>
        <div class="field full"><label>Prerequisites</label>
          <select name="prerequisites" multiple size="4">${prereqOptions(m.programme_id, m.id, [...preIds])}</select></div>
      </form>
      <div class="modal-actions"><button class="btn btn-ghost" type="button" data-close-modal="m-modal">Cancel</button><button class="btn btn-gold" type="button" id="m-save">Save</button></div>
    </div></div>`);
    const editForm = $('#m-form');
    editForm.elements.programme_id.onchange = () => {
      const programme = progs.programmes.find(p => Number(p.id) === Number(editForm.elements.programme_id.value));
      editForm.elements.semester_number.max = programme?.total_semesters || '';
      if (programme && Number(editForm.elements.semester_number.value) > Number(programme.total_semesters)) {
        editForm.elements.semester_number.value = programme.total_semesters;
      }
      editForm.elements.prerequisites.innerHTML = prereqOptions(editForm.elements.programme_id.value, m.id);
    };
    $('#m-save').onclick = async () => {
      const f = new FormData($('#m-form'));
      try {
        await api('PUT', `/admin/modules/${m.id}`, {
          code: f.get('code'), title: f.get('title'), semester_number: Number(f.get('semester_number')),
          programme_id: Number(f.get('programme_id')),
          credits: Number(f.get('credits')), classification: f.get('classification'),
          is_active: f.get('is_active') === '1', prerequisites: [...f.getAll('prerequisites').map(Number)]
        });
        toast('Module updated', 'ok'); $('#m-modal').remove(); viewAdminModules();
      } catch (err) { toast(err.message, 'err'); }
    };
  });
}

async function viewAdminUsers() {
  adminShell('Staff & Student Accounts', 'Manage admin accounts (Super Admin)', '<div class="page-loading">Loading</div>');
  const showDisabled = state.route.query.disabled === '1';
  const d = await api('GET', `/admin/users${showDisabled ? '?include_inactive=true' : ''}`);
  const visibleUsers = showDisabled ? d.users : d.users.filter(u => u.is_active);
  const rows = visibleUsers.map(u => `<tr>
    <td>#${u.id}</td><td><b>${esc(u.full_name)}</b><div class="hint">${esc(u.email)}</div></td>
    <td><span class="badge ${u.role === 'student' ? '' : 'violet'}">${esc(u.role)}</span></td>
    <td>${esc(u.student_number || '')}</td>
    <td>${u.is_active ? '<span class="badge green">active</span>' : '<span class="badge red">disabled</span>'}</td>
    <td><div class="actions">
      <button class="btn btn-sm btn-ghost" data-edit="${u.id}">Edit</button>
      ${u.id !== state.user.id ? `<button class="btn btn-sm ${u.is_active ? 'btn-red' : 'btn-green'}" data-tog="${u.id}" data-val="${u.is_active ? 0 : 1}">${u.is_active ? 'Disable' : 'Enable'}</button>` : ''}
    </div></td></tr>`).join('');
  $('#portal-body').innerHTML = `
    <div class="flex-between mb-1"><span class="hint">Only active accounts are listed by default.</span>
      <a class="btn btn-sm btn-ghost" href="#/admin/users${showDisabled ? '' : '?disabled=1'}">${showDisabled ? 'Hide disabled accounts' : 'Show disabled accounts'}</a></div>
    <div class="card mb-2"><h3>Create staff account</h3>
      <form id="user-form" class="form-grid">
        <div class="field"><label>Full name <span class="req">*</span></label><input name="full_name" required></div>
        <div class="field"><label>Email <span class="req">*</span></label><input type="email" name="email" required></div>
        <div class="field"><label>Password <span class="req">*</span></label><input type="password" name="password" required minlength="8"></div>
        <div class="field"><label>Role</label><select name="role">
          <option value="admissions_officer">Admissions Officer</option>
          <option value="registry_officer">Registry Officer</option>
          <option value="registrar">Registrar</option>
          <option value="super_admin">Super Admin</option></select></div>
        <div class="field"><button class="btn btn-gold" type="submit">Create account</button></div>
      </form></div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Role</th><th>Student #</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  $('#user-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/admin/users', {
        full_name: f.get('full_name'), email: f.get('email'), password: f.get('password'), role: f.get('role')
      });
      toast(r.message, 'ok'); viewAdminUsers();
    } catch (err) { toast(err.message, 'err'); }
  };
  document.querySelectorAll('[data-tog]').forEach(b => b.onclick = async () => {
    try { await api('PUT', `/admin/users/${b.dataset.tog}`, { is_active: b.dataset.val === '1' }); viewAdminUsers(); }
    catch (err) { toast(err.message, 'err'); }
  });
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const u = d.users.find(x => x.id === Number(b.dataset.edit));
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="u-modal"><div class="modal">
      <h2>Edit account</h2>
      <form id="u-form" class="form-grid">
        <div class="field"><label>Full name</label><input name="full_name" value="${esc(u.full_name)}"></div>
        <div class="field"><label>Role</label><select name="role">
          ${['super_admin', 'admissions_officer', 'registry_officer', 'registrar']
            .map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <div class="field"><label>Phone</label><input name="phone" value="${esc(u.phone || '')}"></div>
        <div class="field"><label>New password</label><input type="password" name="password" placeholder="leave blank to keep"></div>
      </form>
      <div class="modal-actions"><button class="btn btn-ghost" type="button" data-close-modal="u-modal">Cancel</button><button class="btn btn-gold" type="button" id="u-save">Save</button></div>
    </div></div>`);
    $('#u-save').onclick = async () => {
      const f = new FormData($('#u-form'));
      const body = { full_name: f.get('full_name'), role: f.get('role'), phone: f.get('phone') };
      if (f.get('password')) body.password = f.get('password');
      try { await api('PUT', `/admin/users/${u.id}`, body); toast('Account updated', 'ok'); $('#u-modal').remove(); viewAdminUsers(); }
      catch (err) { toast(err.message, 'err'); }
    };
  });
}

async function viewAdminAudit() {
  adminShell('Audit Log', 'Permanent record of every system action', '<div class="page-loading">Loading</div>');
  const d = await api('GET', '/admin/audit');
  const rows = d.audit_log.map(a => `<tr>
    <td>${new Date(a.created_at).toLocaleString()}</td>
    <td>${esc(a.user_name || 'system')}<div class="hint">${esc(a.user_role || '')}</div></td>
    <td><b>${esc(a.action)}</b></td><td>${esc(a.entity || '')} ${esc(a.entity_id || '')}</td>
    <td class="small"><code>${esc(JSON.stringify(a.details)).slice(0, 160)}</code></td></tr>`).join('');
  $('#portal-body').innerHTML = `
    <div class="table-wrap"><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

async function viewAdminOverrides() {
  adminShell('Manual Overrides', 'Registrar only. Every override is permanently logged', '<div class="page-loading">Loading</div>');
  const students = await api('GET', '/admin/students');
  $('#portal-body').innerHTML = `
    <div class="card" style="max-width:760px">
      <div class="form-error mb-1">Overrides bypass normal rules. A mandatory reason is recorded in the Audit Log forever.</div>
      <div id="ov-err"></div>
      <form id="ov-form" class="form-grid">
        <div class="field"><label>Action</label><select name="action">
          <option value="clear_pending_module">Clear a pending module (mark PX)</option>
          <option value="force_clearance">Force clearance for re-registration</option>
          <option value="change_grade">Change a recorded grade</option>
          <option value="set_semester">Set current semester</option>
        </select></div>
        <div class="field"><label>Student</label><select name="student_id" required>
          <option value="">Select</option>
          ${students.students.filter(s => s.student_number).map(s => `<option value="${s.user_id}">${esc(s.student_number)} - ${esc(s.full_name)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Module (for module actions)</label><select name="module_id">
          <option value=""></option>${(await api('GET', '/admin/modules')).modules.map(m => `<option value="${m.id}">${esc(m.code)}</option>`).join('')}</select></div>
        <div class="field"><label>Academic term</label><input name="academic_term" placeholder="2026/sem-1"></div>
        <div class="field"><label>New value (grade / semester)</label><input name="new_value" placeholder="e.g. B+ or 3"></div>
        <div class="field full"><label>Mandatory reason <span class="req">*</span></label>
          <textarea name="reason" required placeholder="Why is this override necessary?"></textarea></div>
        <div class="field"><button class="btn btn-red" type="submit">Apply override</button></div>
      </form></div>`;
  $('#ov-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const action = f.get('action');
    const sid = f.get('student_id');
    const mid = f.get('module_id');
    const term = f.get('academic_term');
    let target_id = sid;
    if (action === 'clear_pending_module' || action === 'change_grade') {
      if (!mid || !term) { $('#ov-err').innerHTML = '<div class="form-error">Module and academic term are required for this action.</div>'; return; }
      target_id = `${sid}:${mid}${action === 'change_grade' ? ':' + term : ''}`;
    }
    if (action === 'force_clearance') {
      if (!term) { $('#ov-err').innerHTML = '<div class="form-error">Academic term is required.</div>'; return; }
      target_id = `${sid}:${term}`;
    }
    try {
      const r = await api('POST', '/admin/overrides', {
        target_type: action, target_id, action, reason: f.get('reason'), new_value: f.get('new_value')
      });
      toast(r.message, 'ok'); e.target.reset();
    } catch (err) { $('#ov-err').innerHTML = `<div class="form-error">${esc(err.message)}</div>`; }
  };
}

async function viewAdminExport() {
  adminShell('Export Data', 'Download CSV files (Registrar)', '<div class="page-loading">Loading</div>');
  const entities = [
    ['applications', 'Applications'],
    ['students', 'Students'],
    ['results', 'Results / grades'],
    ['requirements', 'Admission requirements']
  ];
  $('#portal-body').innerHTML = `
    <div class="grid grid-4">
      ${entities.map(([key, label]) => `
        <div class="card feature-card center">
          
          <h3>${label}</h3>
          <button class="btn btn-sm" data-exp="${key}">Download CSV</button>
        </div>`).join('')}
    </div>`;
  document.querySelectorAll('[data-exp]').forEach(b => b.onclick = async () => {
    try {
      const res = await fetch(`/api/admin/export/${b.dataset.exp}`, { headers: { Authorization: 'Bearer ' + state.token } });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Export failed'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${b.dataset.exp}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast('CSV downloaded', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
}

/* ---------------- Route table ---------------- */
route('/', null, viewHome);
route('/programmes', null, viewHome);
route('/login', null, viewLogin);
route('/register', null, viewRegister);
route('/student', ['student'], viewStudentDashboard);
route('/student/apply', ['student'], viewApply);
route('/student/status', ['student'], viewStatus);
route('/student/reregister', ['student'], viewReregister);
route('/student/results', ['student'], viewResults);
route('/student/profile', ['student'], viewProfile);
route('/admin', ['super_admin', 'admissions_officer', 'registry_officer', 'registrar'], viewAdminDashboard);
route('/admin/applications', ['super_admin', 'admissions_officer', 'registrar'], viewAdminApplications);
route('/admin/students', ['super_admin', 'admissions_officer', 'registry_officer', 'registrar'], viewAdminStudents);
route('/admin/grades', ['registry_officer', 'super_admin'], viewAdminGrades);
route('/admin/clearance', ['registry_officer', 'super_admin'], viewAdminClearance);
route('/admin/registrations', ['super_admin', 'registry_officer', 'registrar'], viewAdminRegistrations);
route('/admin/internships', ['super_admin', 'registry_officer', 'registrar'], viewAdminInternships);
route('/admin/programmes', ['super_admin'], viewAdminProgrammes);
route('/admin/certificates', ['super_admin'], viewAdminCertificates);
route('/admin/requirements', ['super_admin'], viewAdminRequirements);
route('/admin/modules', ['super_admin'], viewAdminModules);
route('/admin/users', ['super_admin'], viewAdminUsers);
route('/admin/audit', ['super_admin', 'registrar'], viewAdminAudit);
route('/admin/overrides', ['registrar', 'super_admin'], viewAdminOverrides);
route('/admin/export', ['registrar', 'super_admin'], viewAdminExport);
route('*', null, viewHome);

render();
})();

