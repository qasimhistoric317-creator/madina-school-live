# Madina Model School and College — LIVE Online System (Deployable Copy)

A standalone, deployable copy of the Madina school management system, built so
**everyone sees the same, always-current data**: the owner, admins, teachers
and parents each log in on their own phone/browser and instantly see all old +
new data (their own slice of it). It exists because the Muse artifact version
has **no public link** and the Android APK is **offline (one phone only)** —
this project is the same system as a normal Node service that any host can run.

**One Node.js service serves the front end and the API.** Storage is Postgres
when `DATABASE_URL` is set (one JSONB state row), otherwise a local file DB
(`data/db.json`) so it runs and smoke-tests anywhere with zero setup. The app
**starts EMPTY of people** — no demo students or teachers. The **owner
registers FIRST** through the one-time setup screen; that seeds only the 13
official classes (Play Group, Nursery, 1st–10th, FSc) and the default grading
scale.

## Run locally

```bash
node server.js            # http://localhost:10000  (file DB, no setup)
npm run smoke             # 52 automated end-to-end checks (then resets to EMPTY)
```

Last local run (2026-10-29): **all 52 smoke checks PASSED** — owner setup,
class seeding, teacher scope (own class+subject only, other-subject marks
rejected 403), weekly W1–W4 marks with subject **38/40**, live position swap
after a correction, midterm kept out of monthly results, out-of-range mark
(99/10) rejected, fee **Rs 2000 − 25% − 1000 = balance 500**, parent sees only
their own child, **password rules** (teacher resetting an admin password →
403; even a second Super Admin cannot reset the owner's password; own-password
change needs the current password), brand-new teacher/parent accounts seeing
existing data on first login, disable cutting access instantly, backup →
restore round-trip, and APK backup import (additive; second import skips all
duplicates; imported student's parent code works).

## Roles (all enforced server-side)

| Role | Can do |
|---|---|
| Super Admin / Owner | Everything: settings, user accounts, data backup/restore/import |
| Branch Admin | All school operations except settings + user accounts |
| Principal | View everything + announcements |
| Teacher | "My Classes" only: marks for **assigned class+subject only**, attendance for assigned classes |
| Examination Controller | Tests/exams, publish/lock, marks |
| Accountant | Fees only (+ view) |
| Parent | Login = child **Reg No + Parent Code**; read-only, **only their own child** |

**Password rules (standing owner rule):** an admin (Super Admin) password can
be changed/reset **only by that same admin**. The Super Admin may reset any
non-admin account's password. Every user can change **only their own**
password (🔑 Password button, current password required). Teachers can never
change or reset anyone else's password.

## Data safety

- Everything is saved on the **server** the moment it is entered — uninstall,
  a lost phone, or a staff member leaving cannot take the data.
- A leaving admin's account is **disabled/deleted by the owner** — access ends
  immediately (existing sessions are cut too); the data was never "theirs".
- Settings → Data: **Backup** (full JSON download), **Restore** (validated,
  replaces), and **APK Backup Import** — the offline phone app's
  `MadinaSchool-Backup-….json` / `MadinaSchool-AutoBackup.json` imports
  additively with duplicate protection, so APK data can be converted into the
  live system.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `PORT` | no (host sets it) | Listen port. Default 10000. |
| `DATABASE_URL` | for production | Postgres connection string (e.g. Neon). Unset = local file DB (fine for local testing only). |

## Deploy (free, no-card pattern — same as the Free Talk deploy)

1. Put this folder in a **public Git repository** in the owner's own GitHub
   account.
2. Create a free **Neon** Postgres database (neon.tech, Google sign-in, no
   card) and copy its connection string.
3. Create a web service on a free host that runs Node from a public Git repo
   (e.g. Render via "Public Git Repository", Leapcell, Koyeb, Zeabur):
   - Build command: `npm install`
   - Start command: `node server.js`
   - Environment: `DATABASE_URL` = the Neon string (paste it directly into
     the host's env field — never send it through chat).
   - Note: Render's free web service was card-gated for this owner in Oct
     2026; prefer a host that does not ask for a card.
4. Open the service URL: `/healthz` should return `{"ok":true,...,"setupDone":false}`.
5. **The owner opens the app and completes the one-time Owner Setup FIRST** —
   before anyone else. Then the owner creates teacher/admin accounts and
   imports the APK backup (Settings → Data) to bring the existing data in.
6. Everyone else just opens the same URL on their phone and logs in — no
   install needed. (An APK wrapper pointing at this URL can be built later.)

### Free-tier notes (known upfront)

- Free web services may sleep when idle; the first visitor waits for wake-up.
- Free Postgres tiers can expire/limit after a period — take a **Backup**
  download from Settings → Data regularly; restoring is one upload.

## What Stage A includes vs later phases

**Included:** roles + accounts, 13 classes with everything-inside-the-class
dashboards, students (auto Reg No + Parent Code), staff + teacher assignments,
subjects, timetable, attendance (Present-default, one save, monthly %),
tests (Weekly W1–W4 / Monthly / Midterm / Final), marks entry (whole class,
one save, range-checked), monthly result sheets (subject /40, grand total,
%, grade from the **configurable** grading scale, positions), term sheets,
per-test sheets, fees (discount %, auto balance, challan print, defaulters),
announcements, parent portal, one-click Print/PDF on documents, settings
(school profile + grading scale), backup/restore, APK import.

**Not yet (later phases):** QR-code attendance scanning, timetable clash
detection, staff leave records, homework, WhatsApp messaging, audit-log UI.
Formulas are never hardcoded — grading scale and weekly max marks are
settings; results are recomputed from marks on every view.
