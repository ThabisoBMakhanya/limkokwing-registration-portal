'use strict';
const express = require('express');
const db = require('../db');
const { optionalAuth } = require('../auth');
const { parseJson, nowTerm } = require('../util');

const router = express.Router();

const CONTACTS = {
  admissions: 'admissions@limkokwing.ac.sz',
  registry: 'registry@limkokwing.ac.sz',
  registrar: 'registrar@limkokwing.ac.sz',
  helpdesk: 'it.support@limkokwing.ac.sz'
};

function esc(s) {
  return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// ---------- Fact helpers ----------
async function findRequirements(text) {
  const t = text.toLowerCase();
  const certs = await db.all('SELECT id, name FROM certificates');
  const cert = certs.find(c => t.includes(c.name.toLowerCase()));
  const programmes = await db.all('SELECT * FROM programmes WHERE is_active = 1');
  const programme = programmes.find(p => {
    const name = p.name.toLowerCase();
    if (t.includes('bachelor') || t.includes('bachelors') || t.includes('honours')) {
      return p.level === 'bachelors';
    }
    if (t.includes('associate')) return p.level === 'associate';
    if (t.includes('it degree') || t.includes('information technology') || t.includes(' bsc') || t.includes(' it ')) {
      return name.includes('information technology');
    }
    return name.split(' ').some(w => w.length > 4 && t.includes(w.toLowerCase()));
  });
  if (!programme || !cert) return null;

  const req = await db.one(
    `SELECT pr.*, c.name AS certificate_name, p.name AS programme_name
     FROM programme_requirements pr
     JOIN certificates c ON c.id = pr.certificate_id
     JOIN programmes p ON p.id = pr.programme_id
     WHERE pr.programme_id = $1 AND pr.certificate_id = $2`,
    [programme.id, cert.id]
  );
  if (!req) return null;
  const subjects = parseJson(req.required_subjects, []);
  return {
    intent: 'requirements',
    text: `Entry requirements for the **${req.programme_name}** using **${req.certificate_name}**:\n` +
      `- Minimum cut-off points: **${req.min_cutoff_points}**\n` +
      `- Required subjects: **${subjects.join(', ') || 'None specified'}**` +
      (req.notes ? `\n- Note: ${esc(req.notes)}` : '')
  };
}

async function howToApplySteps() {
  const p = (await db.all('SELECT * FROM programmes WHERE is_active = 1 ORDER BY id'))[0];
  return {
    intent: 'how_to_apply',
    text: 'Here is how to apply:\n' +
      '1. Click **Apply Now** on the home page and create your account (full name, email, phone, national ID/passport, password).\n' +
      '2. Verify your email using the link sent to you.\n' +
      '3. Sign in and complete the multi-step application: Personal details → Contact details → Programme selection → Certificate/Qualification (e.g. EGCSE or IGCSE) → Academic history → Document uploads → Review.\n' +
      '4. Upload your **Registration Fee Receipt** (PDF/JPG/PNG, max 5MB — large photos are compressed automatically). Submission is blocked without it.\n' +
      '5. Track your status: Submitted → Under Review → Accepted/Rejected → Registered.\n' +
      'Browse programmes and their certificate-specific requirements on the home page before applying' +
      (p ? ` (e.g. ${p.name}).` : '.')
  };
}

async function studentNextModules(user) {
  const student = await db.one('SELECT * FROM students WHERE user_id = $1', [user.id]);
  if (!student?.programme_id) return { intent: 'next_modules', text: 'No programme is assigned to your profile yet. Please contact registry.' };
  const programme = await db.one('SELECT * FROM programmes WHERE id = $1', [student.programme_id]);
  const nextSem = student.current_semester + 1;
  const mods = await db.all(
    `SELECT code, title, credits, classification FROM modules
     WHERE programme_id = $1 AND semester_number = $2 AND is_active = 1
     ORDER BY classification, code`,
    [programme.id, nextSem]
  );
  if (!mods.length) return { intent: 'next_modules', text: `No modules are scheduled for semester ${nextSem} yet. The admin must publish the timetable.` };
  const list = mods.map(m => `- ${m.code} — ${m.title} (${m.credits} credits, ${m.classification})`).join('\n');
  const isInternship = nextSem === programme.internship_semester;
  return {
    intent: 'next_modules',
    text: `Your semester ${nextSem} preview${isInternship ? ' (final internship semester)' : ''}:\n${list}\n\n` +
      'Core modules are auto-selected; you choose minor/elective modules to reach the required credits. ' +
      'Go to **Re-Registration → Preview** to register.'
  };
}

async function studentStatus(user) {
  const student = await db.one('SELECT * FROM students WHERE user_id = $1', [user.id]);
  const app = await db.one('SELECT * FROM applications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [user.id]);
  const parts = [];
  parts.push(student?.student_number
    ? `Student number: **${student.student_number}** (semester ${student.current_semester}, status: ${student.status}).`
    : 'You do not have a student number yet.');
  if (app) {
    const cert = await db.one('SELECT name FROM certificates WHERE id = $1', [app.certificate_id]);
    parts.push(`Application status: **${app.status}** | Fee receipt: **${app.receipt_verification_status}** (certificate: ${cert?.name}).`);
  } else {
    parts.push('You have not submitted an application yet.');
  }
  const reg = await db.one(
    `SELECT * FROM semester_registrations WHERE student_id = $1 ORDER BY id DESC LIMIT 1`, [user.id]);
  if (reg) parts.push(`Latest semester registration (${reg.academic_term}): **${reg.status}**${reg.rejection_reason ? ` — ${reg.rejection_reason}` : ''}.`);
  return { intent: 'my_status', text: parts.join('\n') };
}

async function studentPendingModules(user) {
  const { pendingModules } = require('./reregistration');
  const pending = await pendingModules(user.id);
  if (!pending.length) {
    return { intent: 'pending_modules', text: 'You have **no pending modules** — you are on track for re-registration once the registry clears you.' };
  }
  const list = pending.map(p => `- ${p.code} — ${p.title}${p.grade ? ` (grade: ${p.grade})` : ' (no result yet)'}`).join('\n');
  return {
    intent: 'pending_modules',
    text: `You have **${pending.length} pending/failed module(s)**:\n${list}\n\n` +
      'You must pass these before re-registration is enabled. Contact registry@limkokwing.ac.sz if you believe this is wrong.'
  };
}

async function studentGrades(user) {
  const rows = await db.all(
    `SELECT r.grade, r.final_mark, m.code, m.title FROM semester_results r
     JOIN modules m ON m.id = r.module_id WHERE r.student_id = $1 ORDER BY m.code`,
    [user.id]
  );
  if (!rows.length) return { intent: 'grades', text: 'No grades have been recorded for you yet.' };
  const list = rows.map(r => `- ${r.code}: ${r.grade} (${r.final_mark})`).join('\n');
  return { intent: 'grades', text: `Your results:\n${list}` };
}

async function howToReregister(user) {
  const base = 'To register for the next semester:\n' +
    '1. Open **Re-Registration → Preview** in your portal.\n' +
    '2. Check the eligibility gate: the registry must have marked you as cleared and you must have no pending modules.\n' +
    '3. Review your **Next Semester Preview** (core modules are auto-selected; pick minor/elective modules to reach the exact credit load).\n' +
    '4. Ensure prerequisites are met (e.g. pass OOP 1 before AIOP3111).\n' +
    '5. Upload your **SRC Subscription Receipt** — submission is blocked without it.\n' +
    '6. In your final semester, upload your **internship placement documents** as well.\n' +
    '7. Wait for the registry to verify your SRC receipt and approve your registration.';
  if (!user) return { intent: 'how_to_reregister', text: base };
  return { intent: 'how_to_reregister', text: base };
}

async function adminCounts() {
  const q = async sql => Number((await db.one(sql))?.n || 0);
  const pendingApps = await q(`SELECT count(*) n FROM applications WHERE status IN ('submitted','under_review')`);
  const pendingReceipts = await q(`SELECT count(*) n FROM applications WHERE receipt_verification_status = 'pending' AND registration_fee_receipt_url IS NOT NULL`);
  const pendingSrc = await q(`SELECT count(*) n FROM src_receipts WHERE verification_status = 'pending'`);
  const pendingRegs = await q(`SELECT count(*) n FROM semester_registrations WHERE status = 'submitted'`);
  return {
    intent: 'admin_counts',
    text: `Current workload:\n- Applications pending review: **${pendingApps}**\n- Fee receipts awaiting verification: **${pendingReceipts}**\n- SRC receipts awaiting verification: **${pendingSrc}**\n- Semester registrations awaiting approval: **${pendingRegs}**`
  };
}

function gradingScaleAnswer() {
  return {
    intent: 'grading',
    text: 'Limkokwing grading scale: A+ (80–100), A (75–79), A− (70–74), B+ (65–69), B (60–64), B− (55–59), ' +
      'C+ (50–54), C (45–49), D (40–44), F (<40 fail). Also PX (exemption), X (absent), DNC (did not complete), DNS (did not sit). ' +
      'A final exam mark below 40 results in an F and flags the module as pending.'
  };
}

function fallback(role) {
  const map = {
    guest: `I could not find an answer to that. For admissions and programme requirements, email ${CONTACTS.admissions}. For general enquiries, email ${CONTACTS.helpdesk}.`,
    student: `I could not find an answer to that. Try asking about applying, your application status, pending modules, next semester modules, grades or re-registration. For anything else email ${CONTACTS.registry} (or ${CONTACTS.admissions} for application issues).`,
    admin: `I could not find an answer to that. Try asking about pending applications, receipts or registrations. For anything else email ${CONTACTS.registrar}.`
  };
  return { intent: 'fallback', text: map[role] || map.guest };
}

// ---------- Intent router ----------
async function respond(message, role, user) {
  const t = String(message || '').toLowerCase().trim();
  if (!t) return { intent: 'empty', text: 'Please type a question.' };

  // Requirements (guest + everyone)
  if (/(requirement|cut.?off|cutoff|points|subject|admission|entry|eligib)/.test(t)) {
    const fact = await findRequirements(t);
    if (fact) return fact;
    if (role === 'guest') {
      return {
        intent: 'requirements_help',
        text: 'I can tell you the cut-off points and required subjects for any programme and certificate combination — ' +
          `for example: *"What are the EGCSE requirements for the IT Degree?"* or *"What is the cut-off for a Bachelor's degree using IGCSE?"* ` +
          `You can also browse them on the home page. Questions: ${CONTACTS.admissions}.`
      };
    }
  }

  // Apply / application flow
  if (/(how do i apply|how to apply|apply now|application steps|create an account|sign up|register an account)/.test(t)) {
    return howToApplySteps();
  }
  if (/(fee receipt|registration fee|receipt)/.test(t) && /(upload|submit|missing|reject|where)/.test(t)) {
    return {
      intent: 'how_to_receipt',
      text: 'Upload your Registration Fee Receipt in your application: **Application → Registration Fee Receipt → Choose file → Upload**. ' +
        'Accepted formats: PDF, JPG, PNG up to 5MB (images over 2MB are compressed automatically). ' +
        'Submission is blocked server-side until the receipt is uploaded, and an Admissions Officer must approve it. ' +
        'If it was rejected, check the reason shown on your status page, fix it and re-upload.'
    };
  }

  // Student-specific
  if (role === 'student' && user) {
    if (/(next semester|upcoming modules|modules next|what modules do i have)/.test(t)) return studentNextModules(user);
    if (/(my status|registration status|application status|where is my application|am i accepted)/.test(t)) return studentStatus(user);
    if (/(pending module|failed module|backlog|do i have pending)/.test(t)) return studentPendingModules(user);
    if (/(my grade|my result|my marks|transcript)/.test(t)) return studentGrades(user);
    if (/(re-?registration|re register|register for the semester|semester registration|src receipt|internship registration)/.test(t)) {
      return howToReregister(user);
    }
    if (/(prerequisite|pre-requisite|before i take|oop)/.test(t)) {
      return {
        intent: 'prerequisites',
        text: 'Prerequisites are checked automatically when you select modules. Example: you must pass **OOP 1 (PROG1101)** before **AIOP3111 (Artificial Intelligence & Optimisation)**. ' +
          'The Re-Registration preview shows a ✓/✗ for each module. Missing prerequisites block submission.'
      };
    }
    if (/(profile|change my|update my|password)/.test(t)) {
      return {
        intent: 'profile',
        text: 'Go to **Profile** in your portal to update your name, phone number, national ID and password. Changes are saved immediately.'
      };
    }
  }

  // Admin-specific
  if (role === 'super_admin' || role === 'admissions_officer' || role === 'registry_officer' || role === 'registrar') {
    if (/(how many|pending|count|workload|unread)/.test(t)) return adminCounts();
    if (/(how do i add a module|add module|create module)/.test(t)) {
      return {
        intent: 'how_to_module',
        text: 'Super Admin → **Modules → Add Module**: enter the Module ID (code, e.g. AIOP3111), module name, credits, classification (core/minor/elective), semester and programme, then save. ' +
          'Edit or soft-delete existing modules from the same page — deletion never removes history.'
      };
    }
    if (/(how do i clear|clearance|cleared for)/.test(t)) {
      return {
        intent: 'how_to_clear',
        text: 'Registry Officer → **Clearance**: select the student and academic term, set *Cleared = yes*, enter a reason and save. ' +
          'The student\'s re-registration unlocks only after this AND they have no pending modules.'
      };
    }
    if (/(grade|enter marks|exam mark)/.test(t)) {
      return {
        intent: 'how_to_grade',
        text: 'Registry Officer → **Grades**: pick the student, module and term, enter CA and exam marks (0–100). ' +
          'Final = CA×40% + exam×60%. An exam below 40 records an F and flags the module as pending automatically.'
      };
    }
    if (/(override|manual)/.test(t)) {
      return {
        intent: 'how_to_override',
        text: 'Registrar → **Manual Overrides**: choose the action, target and a mandatory reason. Every override is permanently written to the Audit Log.'
      };
    }
  }

  // Shared knowledge
  if (/(grading|grade scale|marks|gpa)/.test(t)) return gradingScaleAnswer();
  if (/(programme|degree|course|associate|bachelor)/.test(t) && /(length|long|semester|duration|internship)/.test(t)) {
    const progs = await db.all('SELECT * FROM programmes WHERE is_active = 1');
    const list = progs.map(p => `- **${p.name}**: ${p.total_semesters} semesters (semesters 1–${p.internship_semester - 1} academic, semester ${p.internship_semester} internship)`).join('\n');
    return { intent: 'programme_length', text: `Programme lengths:\n${list}` };
  }
  if (/(contact|email|help|support|who do i email|department)/.test(t)) {
    return {
      intent: 'contact',
      text: `Department contacts:\n- Admissions (applications, receipts): ${CONTACTS.admissions}\n- Registry (grades, clearance, SRC): ${CONTACTS.registry}\n- Registrar (overrides, appeals): ${CONTACTS.registrar}\n- IT Helpdesk: ${CONTACTS.helpdesk}`
    };
  }

  if (role === 'guest' || role === 'student') {
    const fact = await findRequirements(t);
    if (fact) return fact;
  }

  return fallback(role);
}

// POST /api/chatbot — role-aware, rule-based assistant
router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const role = req.user ? req.user.role : 'guest';
    const message = String(req.body?.message || '');
    const result = await respond(message, role, req.user || null);

    // Security: chatbot only ever reads the requester's own student data
    await db.run(
      'INSERT INTO chatbot_logs (user_id, role, message, response, intent) VALUES ($1, $2, $3, $4, $5)',
      [req.user?.id || null, role, message.slice(0, 2000), result.text.slice(0, 4000), result.intent]
    );
    res.json({ reply: result.text, intent: result.intent, role });
  } catch (err) { next(err); }
});

module.exports = router;
