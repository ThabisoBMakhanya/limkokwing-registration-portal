# Limkokwing Eswatini Registration Portal

A responsive student admissions and semester registration portal for Limkokwing University of Creative Technology, Eswatini. It includes a public programme catalogue, student applications and re-registration, role-based staff tools, and a context-aware help assistant.

## Live website

[Open the Limkokwing Registration Portal](https://limkokwing-registration.vercel.app)

[API health check](https://limkokwing-registration.vercel.app/api/health)

## Features

- Public programme catalogue and certificate-specific admission requirements.
- Student email verification, application tracking, supporting document uploads, and registration fee receipt submission.
- Semester previews, module selection, progression checks, SRC receipt submission, results, and internship registration.
- Server-side role access for Super Admin, Admissions Officer, Registry Officer, Registrar, and Student.
- Admin management for programmes, admission requirements, certificates, modules, staff accounts, grades, clearances, and manual overrides.
- Automatic image compression for uploads larger than 2 MB. Upload limit is 5 MB.
- Rule-based assistant for programme, admissions, and portal questions.

## Run locally

Requirements: Node.js 20+ and a PostgreSQL database. Neon Postgres is supported.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, and `BOOTSTRAP_SUPER_ADMIN_PASSWORD`. Use a unique bootstrap password of at least 12 characters.

3. Initialize the database and create the initial Super Admin:

   ```bash
   npm run seed
   ```

   **Warning:** `npm run seed` resets existing database records before inserting the initial programme catalogue and administrator. Run it only when initializing a new database. For an existing database, use the programme migration below as needed.

4. Start the server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:4000](http://localhost:4000).

## Initial administrator

The seed creates one Super Admin account:

- Email: `bonganithabiso84@gmail.com`
- Password: the value of `BOOTSTRAP_SUPER_ADMIN_PASSWORD` used when running the seed

No demo student or staff accounts are seeded. The Super Admin can create other staff accounts from **Admin > Accounts**.

## Deploy to Vercel

The project serves the frontend and API from the same Express application. The production site is [limkokwing-registration.vercel.app](https://limkokwing-registration.vercel.app).

1. Configure these Vercel **Production** environment variables:
   - `DATABASE_URL`: Neon Postgres connection string.
   - `JWT_SECRET`: long, random secret used to sign authentication tokens.
   - `BOOTSTRAP_SUPER_ADMIN_PASSWORD`: unique password for initial database seeding.
2. Initialize the production database once from a trusted local environment using the production `DATABASE_URL` and `BOOTSTRAP_SUPER_ADMIN_PASSWORD`:

   ```bash
   npm install
   npm run seed
   ```

   Do not run the reset seed against a production database that already contains records.
3. Deploy from the project directory:

   ```bash
   npx vercel --prod --yes
   ```
4. Check the deployment:

   ```bash
   npx vercel curl https://limkokwing-registration.vercel.app/api/health
   npx vercel curl https://limkokwing-registration.vercel.app/api/public/programmes
   ```

Vercel functions use temporary storage. For durable student document uploads, configure persistent object storage before using uploads in production. Email verification and decision notifications are currently written to `logs/emails.log` locally (or function logs on Vercel); configure an email provider before relying on outbound email.

## Programme catalogue and admission requirements

The seed catalogue includes Limkokwing Eswatini programme listings published by the Eswatini Higher Education Council in August 2026, alongside the IT programme examples. The published programme sources do not provide certificate cut-offs and subject rules, so Admissions/Super Admin staff should enter verified criteria before publishing them.

The module catalogue starts empty. Super Admins add module ID/code, name, credits, classification, semester, and prerequisites in Module Management. Module deletion is soft deletion.

To add the researched programme list to an existing database without resetting student or user records, run:

```bash
node server/migrations/2026-11-22-eswatini-programmes.js
```

This migration inserts missing programme rows and preserves existing accounts, modules, and registration records.

Sources: [Eswatini Higher Education Council, Higher Education Institutions list (August 2026)](https://eshec.org.sz/wp-content/uploads/2026/08/ESHEC-HEI-List-Aug-2026_Final_V8.pdf); [Government of Eswatini, Priority Programmes of Study 2023-2027](https://www.gov.sz/images/MinistryOfLabour/PRIORITY%20LIST%202023-%202027%20MARCH%202%202_250312_154639.pdf).

## Upload and fee rules

Uploads accept PDF, JPG, PNG, and WEBP files up to 5 MB. Images larger than 2 MB are resized and compressed with `sharp`. The first-time registration fee is **E 200.00**. A registration fee receipt is required for first-time applications, and an SRC receipt is required for semester re-registration.

## Tests

Run `npm test` only against a disposable Neon branch. The API suite creates and modifies records while exercising authentication, role restrictions, admissions, receipts, registration, grading, overrides, exports, and assistant responses.
