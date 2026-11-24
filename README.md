# Limkokwing Eswatini Registration Portal

Role-based admissions and semester registration portal built with Node.js, Express, PostgreSQL, JWT, and a responsive HTML/CSS/JavaScript frontend. It uses the Neon Postgres connection supplied in `DATABASE_URL`.

## Run locally

Requirements: Node.js 20+ and a Neon Postgres project (or another PostgreSQL database).

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, and `BOOTSTRAP_SUPER_ADMIN_PASSWORD` (at least 12 characters).
3. Run `npm run seed` to create the schema and the initial administrator.
4. Start the server with `npm start` and open `http://localhost:4000`.

`npm run seed` clears and recreates the seed data. Use `node server/seed.js --no-reset` to add seed rows without truncating existing tables; unique rows may need to be removed first if they already exist.

## Initial accounts

The only seeded account is the Super Admin `bonganithabiso84@gmail.com` (Thabiso Makhanya). Its password comes from `BOOTSTRAP_SUPER_ADMIN_PASSWORD`. There are no demo staff or student accounts. The Super Admin creates Admissions, Registry, and Registrar accounts in Admin → Accounts.

| Role | Email |
| --- | --- |
| Super Admin | `bonganithabiso84@gmail.com` |
No other accounts are created by the seed. The login page does not display staff credentials.

## Neon setup and deployment

Create a Neon project and set `DATABASE_URL` to its pooled connection string for application traffic. Keep the connection string, JWT secret, and bootstrap passwords in the deployment platform’s secret environment variables; do not commit `.env`. Run `npm run seed` once against the target database, then deploy the Node service with `npm start` and set `PORT` if the host assigns one.

The Express process serves the frontend and API together. Configure HTTPS and a persistent upload volume for `uploads/`; local disk uploads are not durable on most ephemeral hosting platforms. Email verification and decision messages are written to `logs/emails.log` in this build, so configure an SMTP provider before production use.

## Functional areas

- Public programme list and certificate-specific requirements.
- Student email verification, application steps, document and fee receipt uploads, status tracking, re-registration, results, and internship placement submission.
- Super Admin management of programmes, certificates, per-certificate requirements, modules, and staff accounts. Module IDs/codes and names are entered by the Super Admin; module deletion is soft deletion.
- Admissions Officer receipt review and application decisions; Registry Officer grade entry, clearance, SRC receipt verification, registration approval, and internship grades; Registrar overrides and CSV exports.
- Server-side role checks and validation for uploads, prerequisites, progression, and mandatory receipts.
- Rule-based chatbot for system how-to questions, student-specific status questions, and admission requirement lookups.

## Upload and fee rules

Uploads accept PDF, JPG, PNG, and WEBP up to 5 MB. Images larger than 2 MB are resized/compressed with `sharp`. Uploaded files are served through an authenticated route that checks student ownership and staff role before returning a document. The first-time registration fee is shown in Emalangeni as `E 200.00`; the fee receipt and semester SRC receipt are mandatory at submission.

The seed catalogue includes the Limkokwing Eswatini programmes published by the Eswatini Higher Education Council in August 2026, alongside the existing IT admission requirement examples. The catalogue names are also cross-checked against the Government of Eswatini priority programme list. The published programme lists do not supply certificate cut-offs or subject rules for each programme, so admissions staff must add verified requirements in the Admin portal before publishing them. The module catalogue starts empty: Super Admins add each module ID/code, name, credits, classification, semester, and prerequisites through Module Management.

Sources: [Eswatini Higher Education Council, Higher Education Institutions list (August 2026)](https://eshec.org.sz/wp-content/uploads/2026/08/ESHEC-HEI-List-Aug-2026_Final_V8.pdf); [Government of Eswatini, Priority Programmes of Study 2023-2027](https://www.gov.sz/images/MinistryOfLabour/PRIORITY%20LIST%202023-%202027%20MARCH%202%202_250312_154639.pdf).

To add the researched programme list to an existing database without resetting user or student records, run:

```bash
node server/migrations/2026-11-22-eswatini-programmes.js
```

This migration uses the direct Neon connection derived from `DATABASE_URL`, inserts missing programmes only, and preserves existing module, account, and registration data.

## Tests

Run `npm test` only against a disposable Neon branch: the API suite creates users and records while exercising authentication, role restrictions, admissions, receipts, registration, grading, overrides, export, and chatbot responses.
