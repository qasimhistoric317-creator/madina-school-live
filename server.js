'use strict';
/*
 * Madina Model School and College — LIVE (online, multi-user) system.
 * One Node service serves the front end (public/) and the JSON API.
 * Storage: Postgres when DATABASE_URL is set (single JSONB state row via `pg`),
 * otherwise a local file DB (data/db.json) — the same code path either way,
 * mirroring the proven ~/workspace/free-talk-deploy pattern.
 * Starts EMPTY of people: the owner registers FIRST via the one-time setup
 * screen; that seeds only the 13 official classes + default grading scale.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 10000;
const DATA_DIR = path.join(__dirname, 'data');
const FILE_DB = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const OFFICIAL_CLASSES = ['Play Group', 'Nursery', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', 'FSc'];
const DEFAULT_GRADING = [
  { min: 90, grade: 'A+', gpa: 4.0 }, { min: 80, grade: 'A', gpa: 3.7 },
  { min: 70, grade: 'B', gpa: 3.0 }, { min: 60, grade: 'C', gpa: 2.5 },
  { min: 50, grade: 'D', gpa: 2.0 }, { min: 40, grade: 'E', gpa: 1.0 },
  { min: 0, grade: 'F', gpa: 0.0 }
];
const ROLES = ['super', 'branch', 'principal', 'teacher', 'exam', 'accountant'];
const ROLE_LABELS = { super: 'Super Admin / Owner', branch: 'Branch Admin', principal: 'Principal', teacher: 'Teacher', exam: 'Examination Controller', accountant: 'Accountant', parent: 'Parent' };
/* Server-side permission matrix. settings/users/data are Super-Admin-only
   (they appear in no list below; 'super' short-circuits via role check). */
const PERMS = {
  super: ['view', 'students.write', 'staff.write', 'subjects.write', 'timetable.write', 'tests.write', 'marks.write', 'attendance.write', 'fees.write', 'announcements.write'],
  branch: ['view', 'students.write', 'staff.write', 'subjects.write', 'timetable.write', 'tests.write', 'marks.write', 'attendance.write', 'fees.write', 'announcements.write'],
  principal: ['view', 'announcements.write'],
  teacher: ['view', 'marks.write', 'attendance.write'],
  exam: ['view', 'tests.write', 'marks.write'],
  accountant: ['view', 'fees.write'],
  parent: []
};

/* ---------------- state + persistence ---------------- */
function blankState() {
  return {
    setupDone: false,
    settings: {
      schoolName: 'Madina Model School and College',
      address: 'Dhoda Road, Kohat',
      phone: '',
      weeklyMax: 10,
      grading: JSON.parse(JSON.stringify(DEFAULT_GRADING))
    },
    users: [], classes: [], staff: [], assignments: [], subjects: [],
    students: [], tests: [], marks: [], attendance: [], fees: [],
    timetable: [], announcements: [], messages: [],
    counters: { reg: 0, challan: 0 }
  };
}
let state = blankState();
let dbMode = 'file';
let pgPool = null;
let saveChain = Promise.resolve();

async function loadState() {
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      await pgPool.query('CREATE TABLE IF NOT EXISTS ms_state (id int PRIMARY KEY, data jsonb NOT NULL)');
      const r = await pgPool.query('SELECT data FROM ms_state WHERE id=1');
      dbMode = 'postgres';
      if (r.rows.length) { state = Object.assign(blankState(), r.rows[0].data); return; }
      state = blankState();
      await pgPool.query('INSERT INTO ms_state (id, data) VALUES (1, $1)', [JSON.stringify(state)]);
      return;
    } catch (e) {
      console.error('[db] DATABASE_URL set but Postgres unavailable, falling back to file DB:', e.message);
      pgPool = null; dbMode = 'file';
    }
  }
  try {
    if (fs.existsSync(FILE_DB)) state = Object.assign(blankState(), JSON.parse(fs.readFileSync(FILE_DB, 'utf8')));
  } catch (e) { console.error('[db] file DB unreadable, starting blank:', e.message); state = blankState(); }
}
function persist() {
  const snapshot = JSON.stringify(state);
  saveChain = saveChain.then(async () => {
    if (dbMode === 'postgres' && pgPool) {
      await pgPool.query('INSERT INTO ms_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [snapshot]);
    } else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE_DB + '.tmp';
      fs.writeFileSync(tmp, snapshot);
      fs.renameSync(tmp, FILE_DB);
    }
  }).catch(e => console.error('[db] save failed:', e.message));
  return saveChain;
}

/* ---------------- helpers ---------------- */
const uid = p => p + '_' + crypto.randomBytes(6).toString('hex');
const todayStr = () => new Date().toISOString().slice(0, 10);
function hashPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
function verifyPw(pw, stored) {
  try {
    const [salt, h] = String(stored).split(':');
    const got = crypto.scryptSync(String(pw), salt, 64);
    const want = Buffer.from(h, 'hex');
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  } catch (e) { return false; }
}
function genParentCode() {
  const used = new Set(state.students.map(s => s.parentCode));
  let code, tries = 0;
  do { code = 'MMSC-' + (100000 + Math.floor(Math.random() * 900000)); tries++; } while (used.has(code) && tries < 90);
  if (used.has(code)) { let n = 100000; while (used.has('MMSC-' + n)) n++; code = 'MMSC-' + n; }
  return code;
}
function studentSort(a, b) {
  const ra = parseFloat(a.roll), rb = parseFloat(b.roll);
  const na = isNaN(ra) ? Infinity : ra, nb = isNaN(rb) ? Infinity : rb;
  if (na !== nb) return na - nb;
  const ga = String(a.reg || ''), gb = String(b.reg || '');
  if (ga !== gb) return ga < gb ? -1 : 1;
  return String(a.name || '').localeCompare(String(b.name || ''));
}
const studentsOfClass = cn => state.students.filter(s => s.className === cn).sort(studentSort);
function feeBalance(f) {
  const disc = f.discountPct != null ? (+f.charged || 0) * (+f.discountPct || 0) / 100 : (+f.discount || 0);
  return Math.round(((+f.charged || 0) - disc - (+f.paid || 0)) * 100) / 100;
}
function gradeFor(pct) {
  const scale = [...state.settings.grading].sort((a, b) => b.min - a.min);
  for (const g of scale) if (pct >= g.min) return g;
  return scale[scale.length - 1] || { grade: 'F', gpa: 0 };
}

/* ---------------- results (always recomputed from marks; nothing stored) ---------------- */
function marksOf(testId) { const m = {}; for (const r of state.marks) if (r.testId === testId) m[r.studentId] = r.obtained; return m; }
function buildSheet(className, tests) {
  const subjects = [];
  const byStudent = {};
  const students = studentsOfClass(className);
  for (const s of students) byStudent[s.id] = { student: s, per: {}, obtained: 0, total: 0 };
  for (const t of tests) {
    if (!subjects.includes(t.subject)) subjects.push(t.subject);
    const mm = marksOf(t.id);
    for (const s of students) {
      if (!byStudent[s.id].per[t.subject]) byStudent[s.id].per[t.subject] = { obtained: 0, total: 0, weekly: {} };
      const cell = byStudent[s.id].per[t.subject];
      cell.total += (+t.total || 0);
      if (mm[s.id] != null) {
        cell.obtained += (+mm[s.id] || 0);
        if (t.type === 'Weekly' && t.week) cell.weekly[t.week] = { obtained: +mm[s.id] || 0, total: +t.total || 0 };
      }
    }
  }
  const rows = students.map(s => {
    const b = byStudent[s.id];
    let obtained = 0, total = 0;
    for (const sub of subjects) { const c = b.per[sub]; if (c) { obtained += c.obtained; total += c.total; } }
    const pct = total > 0 ? Math.round(obtained / total * 1000) / 10 : 0;
    const g = gradeFor(pct);
    return { studentId: s.id, reg: s.reg, name: s.name, roll: s.roll, subjects: b.per, obtained, total, pct, grade: g.grade, gpa: g.gpa, status: total === 0 ? '—' : (pct >= 40 ? 'Pass' : 'Fail') };
  });
  const sorted = [...rows].sort((a, b) => b.obtained - a.obtained);
  for (const r of rows) r.position = r.total === 0 ? null : (1 + sorted.filter(x => x.obtained > r.obtained).length);
  return { className, subjects, rows };
}
function monthlyResult(className, month) {
  const tests = state.tests.filter(t => t.className === className && t.month === month && (t.type === 'Weekly' || t.type === 'Monthly'));
  const sheet = buildSheet(className, tests);
  sheet.month = month; sheet.kind = 'Monthly';
  return sheet;
}
function termResult(className, type) {
  const tests = state.tests.filter(t => t.className === className && t.type === type);
  const sheet = buildSheet(className, tests);
  sheet.kind = type;
  sheet.tests = tests.map(t => ({ id: t.id, subject: t.subject, month: t.month, total: t.total, date: t.date || '' }));
  return sheet;
}
function testSheet(testId) {
  const t = state.tests.find(x => x.id === testId);
  if (!t) return null;
  const mm = marksOf(testId);
  const rows = studentsOfClass(t.className).map(s => ({ studentId: s.id, reg: s.reg, name: s.name, roll: s.roll, obtained: mm[s.id] != null ? +mm[s.id] : null, total: +t.total || 0 }));
  return { test: t, rows };
}
function attendancePct(studentId) {
  const rows = state.attendance.filter(a => a.studentId === studentId);
  if (!rows.length) return null;
  const present = rows.filter(a => a.status === 'Present' || a.status === 'Late').length;
  return Math.round(present / rows.length * 1000) / 10;
}

/* ---------------- sessions + auth ---------------- */
const sessions = new Map(); // token -> {kind:'user'|'parent', userId, studentId, exp}
function newSession(data) { const tok = crypto.randomBytes(32).toString('hex'); sessions.set(tok, { ...data, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 }); return tok; }
function getSession(req) {
  const m = /(?:^|;\s*)ms_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s || s.exp < Date.now()) { if (s) sessions.delete(m[1]); return null; }
  return { token: m[1], ...s };
}
function currentUser(req) {
  const s = getSession(req);
  if (!s || s.kind !== 'user') return null;
  const u = state.users.find(x => x.id === s.userId);
  if (!u || u.disabled) return null;
  return u;
}
function can(u, perm) { if (!u) return false; if (u.role === 'super') return true; return (PERMS[u.role] || []).includes(perm); }
function teacherAssignments(u) { return u && u.role === 'teacher' && u.staffId ? state.assignments.filter(a => a.staffId === u.staffId) : []; }
function teacherClasses(u) { return [...new Set(teacherAssignments(u).map(a => a.className))]; }
function teacherCanMark(u, test) { return teacherAssignments(u).some(a => a.className === test.className && a.subject === test.subject); }
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, roleLabel: ROLE_LABELS[u.role], staffId: u.staffId || null, disabled: !!u.disabled });

/* ---------------- HTTP plumbing ---------------- */
function sendJson(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) }); res.end(b); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 15 * 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function requireUser(req, res) { const u = currentUser(req); if (!u) { sendJson(res, 401, { error: 'Login required' }); return null; } return u; }
function requirePerm(req, res, perm) { const u = requireUser(req, res); if (!u) return null; if (!can(u, perm)) { sendJson(res, 403, { error: 'Not allowed for your role (' + (ROLE_LABELS[u.role] || u.role) + ')' }); return null; } return u; }
function requireSuper(req, res) { const u = requireUser(req, res); if (!u) return null; if (u.role !== 'super') { sendJson(res, 403, { error: 'Super Admin only' }); return null; } return u; }

/* Role-filtered data bundle for the front end. */
function bootstrapFor(u) {
  const S = state.settings;
  const base = {
    settings: { schoolName: S.schoolName, address: S.address, phone: S.phone, weeklyMax: S.weeklyMax, grading: S.grading },
    classes: state.classes, announcements: state.announcements
  };
  if (u.role === 'teacher') {
    const tcs = teacherClasses(u);
    const myTests = state.tests.filter(t => teacherCanMark(u, t));
    const myTestIds = new Set(myTests.map(t => t.id));
    return {
      ...base,
      classes: state.classes.filter(c => tcs.includes(c.name)),
      staff: state.staff.map(s => ({ id: s.id, name: s.name, designation: s.designation, subject: s.subject })),
      assignments: teacherAssignments(u),
      subjects: state.subjects.filter(s => tcs.includes(s.className)),
      students: state.students.filter(s => tcs.includes(s.className)),
      tests: myTests,
      marks: state.marks.filter(m => myTestIds.has(m.testId)),
      attendance: state.attendance.filter(a => tcs.includes(a.className)),
      fees: [], timetable: state.timetable.filter(t => tcs.includes(t.className))
    };
  }
  return {
    ...base,
    staff: state.staff, assignments: state.assignments, subjects: state.subjects,
    students: state.students, tests: state.tests, marks: state.marks,
    attendance: state.attendance, fees: state.fees, timetable: state.timetable
  };
}
function parentBundle(studentId) {
  const s = state.students.find(x => x.id === studentId);
  if (!s) return null;
  const months = [...new Set(state.tests.filter(t => t.className === s.className).map(t => t.month))].sort();
  const monthly = {};
  for (const m of months) { const sh = monthlyResult(s.className, m); const row = sh.rows.find(r => r.studentId === s.id); if (row && row.total > 0) monthly[m] = row; }
  const terms = {};
  for (const ty of ['Midterm', 'Final']) { const sh = termResult(s.className, ty); const row = sh.rows.find(r => r.studentId === s.id); if (row && row.total > 0) terms[ty] = row; }
  return {
    student: { id: s.id, reg: s.reg, name: s.name, className: s.className, section: s.section, roll: s.roll, father: s.father },
    monthly, terms,
    attendancePct: attendancePct(s.id),
    attendance: state.attendance.filter(a => a.studentId === s.id).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 60),
    fees: state.fees.filter(f => f.studentId === s.id).map(f => ({ ...f, balance: feeBalance(f) })),
    announcements: state.announcements.filter(a => a.audience === 'All' || a.audience === s.className),
    timetable: state.timetable.filter(t => t.className === s.className)
  };
}

/* ---------------- API ---------------- */
async function api(req, res, url) {
  const p = url.pathname;
  const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};

  if (p === '/api/public') return sendJson(res, 200, { setupDone: state.setupDone, schoolName: state.settings.schoolName, address: state.settings.address });

  if (p === '/api/setup' && req.method === 'POST') {
    if (state.users.length) return sendJson(res, 409, { error: 'Setup already done — owner account exists' });
    const { name, username, password } = body;
    if (!name || !username || !password || String(password).length < 4) return sendJson(res, 400, { error: 'Name, username and a password (min 4 characters) are required' });
    if (!state.classes.length) OFFICIAL_CLASSES.forEach((n, i) => state.classes.push({ id: uid('cls'), name: n, ord: i }));
    const u = { id: uid('usr'), username: String(username).trim(), name: String(name).trim(), passHash: hashPw(password), role: 'super', staffId: null, disabled: false, createdAt: todayStr() };
    state.users.push(u); state.setupDone = true;
    await persist();
    const tok = newSession({ kind: 'user', userId: u.id });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'ms_session=' + tok + '; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax' });
    return res.end(JSON.stringify({ ok: true, user: publicUser(u) }));
  }

  if (p === '/api/login' && req.method === 'POST') {
    const u = state.users.find(x => x.username === String(body.username || '').trim());
    if (!u || !verifyPw(body.password || '', u.passHash)) return sendJson(res, 401, { error: 'Wrong username or password' });
    if (u.disabled) return sendJson(res, 403, { error: 'This account is disabled — contact the Super Admin' });
    const tok = newSession({ kind: 'user', userId: u.id });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'ms_session=' + tok + '; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax' });
    return res.end(JSON.stringify({ ok: true, user: publicUser(u) }));
  }

  if (p === '/api/parent/login' && req.method === 'POST') {
    const s = state.students.find(x => x.reg === String(body.reg || '').trim());
    if (!s || !body.parentCode || String(s.parentCode || '').toUpperCase() !== String(body.parentCode).trim().toUpperCase())
      return sendJson(res, 401, { error: 'Wrong Reg No or Parent Code' });
    const tok = newSession({ kind: 'parent', studentId: s.id });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'ms_session=' + tok + '; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (p === '/api/logout' && req.method === 'POST') {
    const s = getSession(req); if (s) sessions.delete(s.token);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'ms_session=; HttpOnly; Path=/; Max-Age=0' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (p === '/api/parent/me') {
    const s = getSession(req);
    if (!s || s.kind !== 'parent') return sendJson(res, 401, { error: 'Parent login required' });
    const b = parentBundle(s.studentId);
    if (!b) return sendJson(res, 404, { error: 'Student not found' });
    return sendJson(res, 200, b);
  }

  if (p === '/api/me') {
    const u = requireUser(req, res); if (!u) return;
    return sendJson(res, 200, { user: publicUser(u), data: bootstrapFor(u) });
  }

  /* Change OWN password — every logged-in user (incl. teachers), current
     password required. This endpoint can only ever touch the caller's own
     account: there is no way to name another user here. */
  if (p === '/api/me/password' && req.method === 'POST') {
    const u = requireUser(req, res); if (!u) return;
    if (!verifyPw(body.currentPassword || '', u.passHash)) return sendJson(res, 401, { error: 'Current password is wrong' });
    if (!body.newPassword || String(body.newPassword).length < 4) return sendJson(res, 400, { error: 'New password min 4 characters' });
    u.passHash = hashPw(body.newPassword);
    await persist();
    return sendJson(res, 200, { ok: true });
  }

  /* ----- user accounts (Super Admin) ----- */
  if (p === '/api/users' && req.method === 'GET') { if (!requireSuper(req, res)) return; return sendJson(res, 200, { users: state.users.map(publicUser) }); }
  if (p === '/api/users' && req.method === 'POST') {
    if (!requireSuper(req, res)) return;
    const { username, password, role, name, staffId } = body;
    if (!username || !password || String(password).length < 4) return sendJson(res, 400, { error: 'Username + password (min 4) required' });
    if (!ROLES.includes(role)) return sendJson(res, 400, { error: 'Invalid role' });
    if (state.users.some(x => x.username === String(username).trim())) return sendJson(res, 409, { error: 'Username already exists' });
    if (role === 'teacher' && staffId && !state.staff.some(s => s.id === staffId)) return sendJson(res, 400, { error: 'Linked staff record not found' });
    const u = { id: uid('usr'), username: String(username).trim(), name: String(name || username).trim(), passHash: hashPw(password), role, staffId: staffId || null, disabled: false, createdAt: todayStr() };
    state.users.push(u); await persist();
    return sendJson(res, 200, { ok: true, user: publicUser(u) });
  }
  const userIdMatch = p.match(/^\/api\/users\/([^/]+)(?:\/(disable|reset-password))?$/);
  if (userIdMatch && req.method === 'POST') {
    if (!requireSuper(req, res)) return;
    const target = state.users.find(x => x.id === userIdMatch[1]);
    if (!target) return sendJson(res, 404, { error: 'User not found' });
    const me = currentUser(req);
    if (userIdMatch[2] === 'disable') {
      if (target.id === me.id) return sendJson(res, 400, { error: 'You cannot disable your own account' });
      target.disabled = !!body.disabled;
      if (target.disabled) for (const [tok, s] of sessions) if (s.userId === target.id) sessions.delete(tok);
    } else if (userIdMatch[2] === 'reset-password') {
      /* PASSWORD RULE: a Super Admin (admin) password can be changed/reset
         ONLY by that same admin. Even another Super Admin cannot reset a
         different Super Admin's password. Non-super accounts: any Super
         Admin may reset them. Teachers never reach this route at all —
         requireSuper above rejects them (they can only log in / change
         their OWN password via /api/me/password). */
      if (target.role === 'super' && target.id !== me.id) return sendJson(res, 403, { error: 'Admin password sirf wohi admin khud change kar sakta hai — koi aur nahi' });
      if (!body.password || String(body.password).length < 4) return sendJson(res, 400, { error: 'Password min 4 characters' });
      target.passHash = hashPw(body.password);
    } else {
      return sendJson(res, 404, { error: 'Unknown action' });
    }
    await persist();
    return sendJson(res, 200, { ok: true, user: publicUser(target) });
  }
  if (userIdMatch && req.method === 'DELETE') {
    if (!requireSuper(req, res)) return;
    const target = state.users.find(x => x.id === userIdMatch[1]);
    if (!target) return sendJson(res, 404, { error: 'User not found' });
    if (target.id === currentUser(req).id) return sendJson(res, 400, { error: 'You cannot delete your own account' });
    state.users = state.users.filter(x => x.id !== target.id);
    for (const [tok, s] of sessions) if (s.userId === target.id) sessions.delete(tok);
    await persist();
    return sendJson(res, 200, { ok: true });
  }

  /* ----- settings (Super Admin) ----- */
  if (p === '/api/settings' && req.method === 'PUT') {
    if (!requireSuper(req, res)) return;
    const S = state.settings;
    if (body.schoolName) S.schoolName = String(body.schoolName).trim();
    if (body.address != null) S.address = String(body.address).trim();
    if (body.phone != null) S.phone = String(body.phone).trim();
    if (body.weeklyMax != null) { const w = +body.weeklyMax; if (!(w > 0)) return sendJson(res, 400, { error: 'Weekly max must be a positive number' }); S.weeklyMax = w; }
    if (Array.isArray(body.grading) && body.grading.length) {
      for (const g of body.grading) if (g.min == null || !g.grade) return sendJson(res, 400, { error: 'Each grading row needs min + grade' });
      S.grading = body.grading.map(g => ({ min: +g.min, grade: String(g.grade), gpa: +g.gpa || 0 }));
    }
    await persist();
    return sendJson(res, 200, { ok: true, settings: S });
  }

  /* ----- classes ----- */
  if (p === '/api/classes' && req.method === 'POST') {
    const u = requirePerm(req, res, 'students.write'); if (!u) return;
    const name = String(body.name || '').trim();
    if (!name) return sendJson(res, 400, { error: 'Class name required' });
    if (state.classes.some(c => c.name === name)) return sendJson(res, 409, { error: 'Class already exists' });
    const c = { id: uid('cls'), name, ord: state.classes.length };
    state.classes.push(c); await persist();
    return sendJson(res, 200, { ok: true, class: c });
  }
  const classMatch = p.match(/^\/api\/classes\/([^/]+)$/);
  if (classMatch && req.method === 'DELETE') {
    const u = requirePerm(req, res, 'students.write'); if (!u) return;
    const c = state.classes.find(x => x.id === classMatch[1]);
    if (!c) return sendJson(res, 404, { error: 'Class not found' });
    if (state.students.some(s => s.className === c.name)) return sendJson(res, 400, { error: 'Class has students — move them first' });
    state.classes = state.classes.filter(x => x.id !== c.id);
    await persist();
    return sendJson(res, 200, { ok: true });
  }

  /* ----- students ----- */
  if (p === '/api/students' && req.method === 'POST') {
    const u = requirePerm(req, res, 'students.write'); if (!u) return;
    let reg = String(body.reg || '').trim();
    if (!body.name || !body.className) return sendJson(res, 400, { error: 'Student name + class required' });
    if (!state.classes.some(c => c.name === body.className)) return sendJson(res, 400, { error: 'Unknown class' });
    if (!reg) { state.counters.reg++; reg = 'REG-' + String(state.counters.reg).padStart(4, '0'); }
    if (state.students.some(s => s.reg === reg)) return sendJson(res, 409, { error: 'Reg No already exists' });
    const s = { id: uid('stu'), reg, parentCode: genParentCode(), name: String(body.name).trim(), className: body.className, section: body.section || '', roll: body.roll || '', father: body.father || '', phone: body.phone || '', dob: body.dob || '', admissionDate: body.admissionDate || '', address: body.address || '' };
    state.students.push(s); await persist();
    return sendJson(res, 200, { ok: true, student: s });
  }
  const stuMatch = p.match(/^\/api\/students\/([^/]+)(\/parent-code)?$/);
  if (stuMatch && req.method === 'PUT') {
    const u = requirePerm(req, res, 'students.write'); if (!u) return;
    const s = state.students.find(x => x.id === stuMatch[1]);
    if (!s) return sendJson(res, 404, { error: 'Student not found' });
    if (stuMatch[2]) { s.parentCode = genParentCode(); await persist(); return sendJson(res, 200, { ok: true, parentCode: s.parentCode }); }
    for (const k of ['name', 'className', 'section', 'roll', 'father', 'phone', 'dob', 'admissionDate', 'address']) if (body[k] != null) s[k] = body[k];
    if (body.reg && body.reg !== s.reg) { if (state.students.some(x => x.reg === body.reg)) return sendJson(res, 409, { error: 'Reg No already exists' }); s.reg = String(body.reg).trim(); }
    await persist();
    return sendJson(res, 200, { ok: true, student: s });
  }
  if (stuMatch && req.method === 'DELETE') {
    const u = requirePerm(req, res, 'students.write'); if (!u) return;
    const s = state.students.find(x => x.id === stuMatch[1]);
    if (!s) return sendJson(res, 404, { error: 'Student not found' });
    state.students = state.students.filter(x => x.id !== s.id);
    state.marks = state.marks.filter(m => m.studentId !== s.id);
    state.attendance = state.attendance.filter(a => a.studentId !== s.id);
    state.fees = state.fees.filter(f => f.studentId !== s.id);
    await persist();
    return sendJson(res, 200, { ok: true });
  }

  /* ----- staff + assignments + subjects ----- */
  if (p === '/api/staff' && req.method === 'POST') {
    const u = requirePerm(req, res, 'staff.write'); if (!u) return;
    if (!body.name) return sendJson(res, 400, { error: 'Staff name required' });
    const s = { id: uid('stf'), name: String(body.name).trim(), designation: body.designation || 'Teacher', subject: body.subject || '', phone: body.phone || '', email: body.email || '', qualification: body.qualification || '', joiningDate: body.joiningDate || '' };
    state.staff.push(s); await persist();
    return sendJson(res, 200, { ok: true, staff: s });
  }
  const staffMatch = p.match(/^\/api\/staff\/([^/]+)$/);
  if (staffMatch && req.method === 'PUT') {
    const u = requirePerm(req, res, 'staff.write'); if (!u) return;
    const s = state.staff.find(x => x.id === staffMatch[1]);
    if (!s) return sendJson(res, 404, { error: 'Staff not found' });
    for (const k of ['name', 'designation', 'subject', 'phone', 'email', 'qualification', 'joiningDate']) if (body[k] != null) s[k] = body[k];
    await persist();
    return sendJson(res, 200, { ok: true, staff: s });
  }
  if (staffMatch && req.method === 'DELETE') {
    const u = requirePerm(req, res, 'staff.write'); if (!u) return;
    state.staff = state.staff.filter(x => x.id !== staffMatch[1]);
    state.assignments = state.assignments.filter(a => a.staffId !== staffMatch[1]);
    await persist();
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/assignments' && req.method === 'POST') {
    const u = requirePerm(req, res, 'staff.write'); if (!u) return;
    if (!state.staff.some(s => s.id === body.staffId)) return sendJson(res, 400, { error: 'Staff not found' });
    if (!body.className || !body.subject) return sendJson(res, 400, { error: 'Class + subject required' });
    if (state.assignments.some(a => a.staffId === body.staffId && a.className === body.className && a.subject === body.subject)) return sendJson(res, 409, { error: 'Assignment already exists' });
    const a = { id: uid('asg'), staffId: body.staffId, className: body.className, subject: body.subject };
    state.assignments.push(a); await persist();
    return sendJson(res, 200, { ok: true, assignment: a });
  }
  const asgMatch = p.match(/^\/api\/assignments\/([^/]+)$/);
  if (asgMatch && req.method === 'DELETE') { const u = requirePerm(req, res, 'staff.write'); if (!u) return; state.assignments = state.assignments.filter(a => a.id !== asgMatch[1]); await persist(); return sendJson(res, 200, { ok: true }); }

  if (p === '/api/subjects' && req.method === 'POST') {
    const u = requirePerm(req, res, 'subjects.write'); if (!u) return;
    if (!body.name || !body.className) return sendJson(res, 400, { error: 'Subject name + class required' });
    if (state.subjects.some(s => s.className === body.className && s.name === body.name)) return sendJson(res, 409, { error: 'Subject already exists in this class' });
    const s = { id: uid('sub'), name: String(body.name).trim(), className: body.className, staffId: body.staffId || null };
    state.subjects.push(s); await persist();
    return sendJson(res, 200, { ok: true, subject: s });
  }
  const subMatch = p.match(/^\/api\/subjects\/([^/]+)$/);
  if (subMatch && req.method === 'DELETE') { const u = requirePerm(req, res, 'subjects.write'); if (!u) return; state.subjects = state.subjects.filter(s => s.id !== subMatch[1]); await persist(); return sendJson(res, 200, { ok: true }); }

  /* ----- tests + marks ----- */
  if (p === '/api/tests' && req.method === 'POST') {
    const u = requirePerm(req, res, 'tests.write'); if (!u) return;
    const { className, subject, type } = body;
    if (!className || !subject || !['Weekly', 'Monthly', 'Midterm', 'Final'].includes(type)) return sendJson(res, 400, { error: 'Class, subject and a valid type (Weekly/Monthly/Midterm/Final) are required' });
    const total = +body.total || (type === 'Weekly' ? state.settings.weeklyMax : 100);
    if (!(total > 0)) return sendJson(res, 400, { error: 'Total marks must be positive' });
    const t = { id: uid('tst'), className, subject: String(subject).trim(), type, week: type === 'Weekly' ? (+body.week || 1) : null, month: body.month || todayStr().slice(0, 7), title: body.title || '', total, date: body.date || '', status: 'Draft' };
    if (t.type === 'Weekly' && !(t.week >= 1 && t.week <= 4)) return sendJson(res, 400, { error: 'Weekly tests use Week 1-4' });
    if (state.tests.some(x => x.className === t.className && x.subject === t.subject && x.type === t.type && x.week === t.week && x.month === t.month))
      return sendJson(res, 409, { error: 'A test with this class + subject + type + week + month already exists' });
    state.tests.push(t); await persist();
    return sendJson(res, 200, { ok: true, test: t });
  }
  const testMatch = p.match(/^\/api\/tests\/([^/]+)$/);
  if (testMatch && req.method === 'PUT') {
    const u = requirePerm(req, res, 'tests.write'); if (!u) return;
    const t = state.tests.find(x => x.id === testMatch[1]);
    if (!t) return sendJson(res, 404, { error: 'Test not found' });
    if (body.status && ['Draft', 'Published', 'Locked'].includes(body.status)) t.status = body.status;
    if (body.title != null) t.title = body.title;
    if (body.date != null) t.date = body.date;
    if (body.total != null) { const v = +body.total; if (!(v > 0)) return sendJson(res, 400, { error: 'Total must be positive' }); t.total = v; }
    await persist();
    return sendJson(res, 200, { ok: true, test: t });
  }
  if (testMatch && req.method === 'DELETE') {
    const u = requirePerm(req, res, 'tests.write'); if (!u) return;
    state.tests = state.tests.filter(x => x.id !== testMatch[1]);
    state.marks = state.marks.filter(m => m.testId !== testMatch[1]);
    await persist();
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/marks' && req.method === 'POST') {
    const u = requirePerm(req, res, 'marks.write'); if (!u) return;
    const t = state.tests.find(x => x.id === body.testId);
    if (!t) return sendJson(res, 404, { error: 'Test not found' });
    if (t.status === 'Locked') return sendJson(res, 423, { error: 'This test is Locked — marks cannot be changed' });
    if (u.role === 'teacher' && !teacherCanMark(u, t)) return sendJson(res, 403, { error: 'You can enter marks only for your assigned class + subject' });
    if (!Array.isArray(body.marks)) return sendJson(res, 400, { error: 'marks array required' });
    for (const m of body.marks) {
      if (m.obtained === '' || m.obtained == null) continue;
      const v = +m.obtained;
      if (isNaN(v) || v < 0 || v > t.total) return sendJson(res, 400, { error: 'Marks 0 se ' + t.total + ' ke darmiyan hone chahiyein (0 to ' + t.total + ')' });
    }
    let saved = 0;
    for (const m of body.marks) {
      const stu = state.students.find(s => s.id === m.studentId && s.className === t.className);
      if (!stu) continue;
      const ex = state.marks.find(x => x.testId === t.id && x.studentId === stu.id);
      if (m.obtained === '' || m.obtained == null) { if (ex) state.marks = state.marks.filter(x => x !== ex); continue; }
      if (ex) ex.obtained = +m.obtained; else state.marks.push({ id: uid('mrk'), testId: t.id, studentId: stu.id, obtained: +m.obtained });
      saved++;
    }
    await persist();
    return sendJson(res, 200, { ok: true, saved });
  }

  /* ----- attendance ----- */
  if (p === '/api/attendance' && req.method === 'POST') {
    const u = requirePerm(req, res, 'attendance.write'); if (!u) return;
    const { className, date, records } = body;
    if (!className || !date || !records || typeof records !== 'object') return sendJson(res, 400, { error: 'className, date and records required' });
    if (u.role === 'teacher' && !teacherClasses(u).includes(className)) return sendJson(res, 403, { error: 'You can mark attendance only for your assigned classes' });
    let saved = 0;
    for (const [studentId, status] of Object.entries(records)) {
      if (!['Present', 'Absent', 'Late', 'Leave'].includes(status)) continue;
      const stu = state.students.find(s => s.id === studentId && s.className === className);
      if (!stu) continue;
      const ex = state.attendance.find(a => a.studentId === studentId && a.date === date);
      if (ex) { ex.status = status; ex.className = className; } else state.attendance.push({ id: uid('att'), studentId, className, date, status });
      saved++;
    }
    await persist();
    return sendJson(res, 200, { ok: true, saved });
  }

  /* ----- fees ----- */
  if (p === '/api/fees' && req.method === 'POST') {
    const u = requirePerm(req, res, 'fees.write'); if (!u) return;
    const stu = state.students.find(s => s.id === body.studentId);
    if (!stu) return sendJson(res, 400, { error: 'Student not found' });
    state.counters.challan++;
    const f = { id: uid('fee'), challanNo: 'CH-' + String(state.counters.challan).padStart(4, '0'), studentId: stu.id, month: body.month || todayStr().slice(0, 7), charged: +body.charged || 0, discountPct: body.discountPct != null ? +body.discountPct : 0, paid: +body.paid || 0, dueDate: body.dueDate || '', date: todayStr() };
    if (f.discountPct < 0 || f.discountPct > 100) return sendJson(res, 400, { error: 'Discount % must be 0-100' });
    state.fees.push(f); await persist();
    return sendJson(res, 200, { ok: true, fee: { ...f, balance: feeBalance(f) } });
  }
  const feeMatch = p.match(/^\/api\/fees\/([^/]+)$/);
  if (feeMatch && req.method === 'PUT') {
    const u = requirePerm(req, res, 'fees.write'); if (!u) return;
    const f = state.fees.find(x => x.id === feeMatch[1]);
    if (!f) return sendJson(res, 404, { error: 'Fee not found' });
    for (const k of ['month', 'dueDate']) if (body[k] != null) f[k] = body[k];
    for (const k of ['charged', 'discountPct', 'paid']) if (body[k] != null) f[k] = +body[k] || 0;
    await persist();
    return sendJson(res, 200, { ok: true, fee: { ...f, balance: feeBalance(f) } });
  }
  if (feeMatch && req.method === 'DELETE') { const u = requirePerm(req, res, 'fees.write'); if (!u) return; state.fees = state.fees.filter(f => f.id !== feeMatch[1]); await persist(); return sendJson(res, 200, { ok: true }); }

  /* ----- timetable + announcements ----- */
  if (p === '/api/timetable' && req.method === 'POST') {
    const u = requirePerm(req, res, 'timetable.write'); if (!u) return;
    if (!body.className || !body.day || !body.subject) return sendJson(res, 400, { error: 'Class, day and subject required' });
    const t = { id: uid('tt'), className: body.className, day: body.day, period: body.period || '', time: body.time || '', subject: body.subject, staffId: body.staffId || null, teacher: body.teacher || '' };
    state.timetable.push(t); await persist();
    return sendJson(res, 200, { ok: true, period: t });
  }
  const ttMatch = p.match(/^\/api\/timetable\/([^/]+)$/);
  if (ttMatch && req.method === 'DELETE') { const u = requirePerm(req, res, 'timetable.write'); if (!u) return; state.timetable = state.timetable.filter(t => t.id !== ttMatch[1]); await persist(); return sendJson(res, 200, { ok: true }); }

  if (p === '/api/announcements' && req.method === 'POST') {
    const u = requirePerm(req, res, 'announcements.write'); if (!u) return;
    if (!body.title) return sendJson(res, 400, { error: 'Title required' });
    const a = { id: uid('ann'), title: String(body.title).trim(), body: body.body || '', audience: body.audience || 'All', priority: body.priority || 'Normal', pin: !!body.pin, date: todayStr() };
    state.announcements.unshift(a); await persist();
    return sendJson(res, 200, { ok: true, announcement: a });
  }
  const annMatch = p.match(/^\/api\/announcements\/([^/]+)$/);
  if (annMatch && req.method === 'DELETE') { const u = requirePerm(req, res, 'announcements.write'); if (!u) return; state.announcements = state.announcements.filter(a => a.id !== annMatch[1]); await persist(); return sendJson(res, 200, { ok: true }); }

  /* ----- results ----- */
  if (p === '/api/results/monthly') {
    const u = requireUser(req, res); if (!u) return;
    const className = url.searchParams.get('className'), month = url.searchParams.get('month');
    if (u.role === 'teacher' && !teacherClasses(u).includes(className)) return sendJson(res, 403, { error: 'Not your class' });
    return sendJson(res, 200, monthlyResult(className, month));
  }
  if (p === '/api/results/term') {
    const u = requireUser(req, res); if (!u) return;
    const className = url.searchParams.get('className'), type = url.searchParams.get('type');
    if (!['Midterm', 'Final'].includes(type)) return sendJson(res, 400, { error: 'type must be Midterm or Final' });
    if (u.role === 'teacher' && !teacherClasses(u).includes(className)) return sendJson(res, 403, { error: 'Not your class' });
    return sendJson(res, 200, termResult(className, type));
  }
  if (p === '/api/results/test') {
    const u = requireUser(req, res); if (!u) return;
    const sh = testSheet(url.searchParams.get('testId'));
    if (!sh) return sendJson(res, 404, { error: 'Test not found' });
    if (u.role === 'teacher' && !teacherCanMark(u, sh.test)) return sendJson(res, 403, { error: 'Not your test' });
    return sendJson(res, 200, sh);
  }

  /* ----- data: backup / restore / APK import (Super Admin) ----- */
  if (p === '/api/backup' && req.method === 'GET') {
    if (!requireSuper(req, res)) return;
    const payload = JSON.stringify({ app: 'madina-school-live', kind: 'backup', version: 1, exportedAt: new Date().toISOString(), data: state }, null, 1);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="MadinaSchool-Live-Backup-' + todayStr() + '.json"' });
    return res.end(payload);
  }
  if (p === '/api/restore' && req.method === 'POST') {
    if (!requireSuper(req, res)) return;
    const data = body.data || body;
    if (!data || !data.settings || !Array.isArray(data.users) || !Array.isArray(data.students) || !Array.isArray(data.classes))
      return sendJson(res, 400, { error: 'Invalid backup file — this does not look like a Madina School backup' });
    const keepSessions = new Map(sessions);
    state = Object.assign(blankState(), data);
    sessions.clear(); for (const [k, v] of keepSessions) if (v.kind === 'user' && state.users.some(x => x.id === v.userId && !x.disabled)) sessions.set(k, v);
    await persist();
    return sendJson(res, 200, { ok: true, counts: countsOf(state) });
  }
  if (p === '/api/import-apk' && req.method === 'POST') {
    if (!requireSuper(req, res)) return;
    const rep = importApk(body);
    if (rep.error) return sendJson(res, 400, { error: rep.error });
    await persist();
    return sendJson(res, 200, { ok: true, report: rep });
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}
function countsOf(s) { const o = {}; for (const k of ['users', 'classes', 'staff', 'students', 'tests', 'marks', 'attendance', 'fees', 'announcements']) o[k] = (s[k] || []).length; return o; }

/* APK backup import — additive, deduped; mirrors the Muse web app semantics. */
function importApk(backup) {
  const b = backup && backup.data ? backup : (backup && backup.app ? backup : null);
  if (!b || b.app !== 'madina-model-school' || b.kind !== 'backup' || !b.data) return { error: 'Ye APK ki backup file nahi lagti (app/kind check fail)' };
  const d = b.data;
  const rep = {}; const bump = (k, f) => { rep[k] = rep[k] || { imported: 0, skipped: 0 }; rep[k][f]++; };
  const arr = k => Array.isArray(d[k]) ? d[k] : [];

  const classByName = {}; for (const c of state.classes) classByName[c.name] = c;
  for (const c of arr('classes')) {
    if (!c.name) { bump('classes', 'skipped'); continue; }
    if (classByName[c.name]) { bump('classes', 'skipped'); continue; }
    const nc = { id: uid('cls'), name: c.name, ord: state.classes.length };
    state.classes.push(nc); classByName[c.name] = nc; bump('classes', 'imported');
  }
  const staffByNamePhone = {}; for (const s of state.staff) staffByNamePhone[s.name + '|' + (s.phone || '')] = s;
  const staffByName = {}; for (const s of state.staff) staffByName[s.name] = s;
  const staffIdMap = {};
  for (const s of arr('staff')) {
    const key = s.name + '|' + (s.phone || '');
    if (staffByNamePhone[key]) { staffIdMap[s.id] = staffByNamePhone[key].id; bump('staff', 'skipped'); continue; }
    const ns = { id: uid('stf'), name: s.name || 'Staff', designation: s.desig || 'Teacher', subject: s.subject || '', phone: s.phone || '', email: '', qualification: s.qual || '', joiningDate: '' };
    state.staff.push(ns); staffByNamePhone[key] = ns; staffByName[ns.name] = ns; staffIdMap[s.id] = ns.id; bump('staff', 'imported');
    if (s.classAssigned && s.subject && !state.assignments.some(a => a.staffId === ns.id && a.className === s.classAssigned && a.subject === s.subject))
      state.assignments.push({ id: uid('asg'), staffId: ns.id, className: s.classAssigned, subject: s.subject });
  }
  for (const s of arr('subjects')) {
    if (!s.name || !s.className) { bump('subjects', 'skipped'); continue; }
    if (state.subjects.some(x => x.className === s.className && x.name === s.name)) { bump('subjects', 'skipped'); continue; }
    state.subjects.push({ id: uid('sub'), name: s.name, className: s.className, staffId: (s.teacher && staffByName[s.teacher]) ? staffByName[s.teacher].id : null });
    bump('subjects', 'imported');
  }
  const stuByReg = {}; for (const s of state.students) stuByReg[s.reg] = s;
  const stuIdMap = {};
  for (const s of arr('students')) {
    if (!s.reg) { bump('students', 'skipped'); continue; }
    if (stuByReg[s.reg]) { stuIdMap[s.id] = stuByReg[s.reg].id; bump('students', 'skipped'); continue; }
    let pc = s.parentCode;
    if (!pc || state.students.some(x => x.parentCode === pc)) pc = genParentCode();
    const ns = { id: uid('stu'), reg: s.reg, parentCode: pc, name: s.name || '', className: s.className || '', section: s.section || '', roll: s.roll || '', father: s.father || '', phone: s.phone || '', dob: s.dob || '', admissionDate: s.adm || '', address: s.address || '' };
    state.students.push(ns); stuByReg[ns.reg] = ns; stuIdMap[s.id] = ns.id; bump('students', 'imported');
    const m = /^REG-(\d+)$/.exec(ns.reg); if (m) state.counters.reg = Math.max(state.counters.reg, +m[1]);
  }
  const testKey = t => [t.className, t.subject, t.type, t.week == null ? '' : t.week, t.month].join('|');
  const testByKey = {}; for (const t of state.tests) testByKey[testKey(t)] = t;
  const testIdMap = {};
  for (const t of arr('tests')) {
    const nt = { className: t.className, subject: t.subject, type: t.type || 'Monthly', week: t.type === 'Weekly' ? (t.week || null) : null, month: t.month || '' };
    const k = testKey(nt);
    if (testByKey[k]) { testIdMap[t.id] = testByKey[k].id; bump('tests', 'skipped'); continue; }
    const created = { id: uid('tst'), ...nt, title: t.title || '', total: +t.total || 100, date: t.date || '', status: 'Published' };
    state.tests.push(created); testByKey[k] = created; testIdMap[t.id] = created.id; bump('tests', 'imported');
  }
  for (const m of arr('marks')) {
    const testId = testIdMap[m.testId], studentId = stuIdMap[m.studentId];
    if (!testId || !studentId) { bump('marks', 'skipped'); continue; }
    if (state.marks.some(x => x.testId === testId && x.studentId === studentId)) { bump('marks', 'skipped'); continue; }
    state.marks.push({ id: uid('mrk'), testId, studentId, obtained: +m.obtained || 0 });
    bump('marks', 'imported');
  }
  for (const f of arr('fees')) {
    const studentId = stuIdMap[f.studentId];
    if (!studentId) { bump('fees', 'skipped'); continue; }
    if (state.fees.some(x => x.studentId === studentId && x.month === f.month && +x.charged === +f.charged)) { bump('fees', 'skipped'); continue; }
    const charged = +f.charged || 0, discRs = +f.discount || 0;
    const discountPct = charged > 0 ? Math.round(discRs / charged * 10000) / 100 : 0;
    let challanNo = f.challanNo;
    if (!challanNo || state.fees.some(x => x.challanNo === challanNo)) { state.counters.challan++; challanNo = 'CH-' + String(state.counters.challan).padStart(4, '0'); }
    else { const m = /^CH-(\d+)$/.exec(challanNo); if (m) state.counters.challan = Math.max(state.counters.challan, +m[1]); }
    state.fees.push({ id: uid('fee'), challanNo, studentId, month: f.month || '', charged, discountPct, paid: +f.paid || 0, dueDate: f.dueDate || '', date: todayStr() });
    bump('fees', 'imported');
  }
  for (const a of arr('attendance')) {
    const marks = a.marks || {};
    for (const [apkSid, status] of Object.entries(marks)) {
      const studentId = stuIdMap[apkSid];
      if (!studentId || !['Present', 'Absent', 'Late', 'Leave'].includes(status)) { bump('attendance', 'skipped'); continue; }
      if (state.attendance.some(x => x.studentId === studentId && x.date === a.date)) { bump('attendance', 'skipped'); continue; }
      state.attendance.push({ id: uid('att'), studentId, className: a.className || '', date: a.date, status });
      bump('attendance', 'imported');
    }
  }
  for (const t of arr('timetable')) {
    if (state.timetable.some(x => x.className === t.className && x.day === t.day && x.time === (t.time || '') && x.subject === t.subject)) { bump('timetable', 'skipped'); continue; }
    state.timetable.push({ id: uid('tt'), className: t.className || '', day: t.day || '', period: '', time: t.time || '', subject: t.subject || '', staffId: (t.teacher && staffByName[t.teacher]) ? staffByName[t.teacher].id : null, teacher: t.teacher || '' });
    bump('timetable', 'imported');
  }
  for (const a of arr('announcements')) {
    if (state.announcements.some(x => x.title === a.title && x.date === a.date)) { bump('announcements', 'skipped'); continue; }
    state.announcements.push({ id: uid('ann'), title: a.title || '', body: a.body || '', audience: a.audience || 'All', priority: a.priority || 'Normal', pin: !!a.pin, date: a.date || todayStr() });
    bump('announcements', 'imported');
  }
  for (const m of arr('messages')) {
    if (state.messages.some(x => x.studentName === m.studentName && x.when === m.when && x.text === m.text)) { bump('messages', 'skipped'); continue; }
    state.messages.push({ id: uid('msg'), type: m.type || '', studentId: stuIdMap[m.studentId] || null, studentName: m.studentName || '', channel: m.channel || '', when: m.when || '', text: m.text || '' });
    bump('messages', 'imported');
  }
  return rep;
}

/* ---------------- static + server ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, users: state.users.length, students: state.students.length, db: dbMode, setupDone: state.setupDone });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let fp = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fp.startsWith(PUBLIC_DIR) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(PUBLIC_DIR, 'index.html');
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(fs.readFileSync(fp));
  } catch (e) {
    console.error('[http]', e.message);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error: ' + e.message });
  }
});
loadState().then(() => {
  server.listen(PORT, () => console.log('Madina School LIVE listening on :' + PORT + ' (db=' + dbMode + ', setupDone=' + state.setupDone + ')'));
});
