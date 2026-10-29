/* Smoke test for Madina School LIVE (file-DB mode).
 * Boots the server on a test port with a FRESH db, runs end-to-end checks,
 * then deletes the test db so the project ships EMPTY again. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'data', 'db.json');
const PORT = 18741, BASE = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗', name, detail || ''); } }

class Client {
  constructor() { this.cookie = ''; }
  async req(method, p, body) {
    const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let j = {}; try { j = await r.json(); } catch (e) { }
    return { status: r.status, j };
  }
  get(p) { return this.req('GET', p); } post(p, b) { return this.req('POST', p, b); } put(p, b) { return this.req('PUT', p, b); } del(p) { return this.req('DELETE', p); }
}

async function waitHealth(tries = 40) { for (let i = 0; i < tries; i++) { try { const r = await fetch(BASE + '/healthz'); if (r.ok) return await r.json(); } catch (e) { } await new Promise(r => setTimeout(r, 250)); } throw new Error('server did not start'); }

const backupDb = fs.existsSync(DB) ? fs.readFileSync(DB) : null;
if (fs.existsSync(DB)) fs.unlinkSync(DB);
const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
let srvLog = ''; srv.stdout.on('data', d => srvLog += d); srv.stderr.on('data', d => srvLog += d);

try {
  const h = await waitHealth();
  check('healthz: starts EMPTY (users 0, setupDone false)', h.ok && h.users === 0 && h.setupDone === false && h.db === 'file', JSON.stringify(h));
  const appJs = await (await fetch(BASE + '/app.js')).text();
  check('login screen has THREE separate entries: Owner Login / Teacher-Staff Login / Parents Login', appJs.includes('Owner Login') && appJs.includes('Teacher / Staff Login') && appJs.includes('Parents Login'));

  const owner = new Client();
  let r = await owner.post('/api/setup', { name: 'School Owner', username: 'owner', password: 'owner123' });
  check('owner setup (first account = Super Admin)', r.status === 200 && r.j.user.role === 'super', JSON.stringify(r.j));
  r = await owner.get('/api/me');
  const classNames = r.j.data.classes.map(c => c.name);
  check('13 official classes seeded in exact order', JSON.stringify(classNames) === JSON.stringify(['Play Group', 'Nursery', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', 'FSc']), classNames.join(','));
  const ownerId = r.j.user.id;

  r = await owner.post('/api/staff', { name: 'Ustad Ahmed', designation: 'Teacher', subject: 'Urdu', phone: '03001112222', qualification: 'MA Urdu' });
  const staffId = r.j.staff.id; check('staff record created', r.status === 200 && !!staffId);
  r = await owner.post('/api/assignments', { staffId, className: '6th', subject: 'Urdu' });
  check('teacher assignment 6th/Urdu', r.status === 200);
  await owner.post('/api/subjects', { name: 'Urdu', className: '6th', staffId });
  r = await owner.post('/api/users', { name: 'Ustad Ahmed', username: 'ahmed', password: 'teach123', role: 'teacher', staffId });
  const teacherId = r.j.user.id; check('teacher account linked to staff', r.status === 200 && !!teacherId);
  r = await owner.post('/api/users', { name: 'Munshi Sahib', username: 'munshi', password: 'acct123', role: 'accountant' });
  const acctId = r.j.user.id; check('accountant account created', r.status === 200 && !!acctId);

  r = await owner.post('/api/students', { name: 'Student A', className: '6th', roll: '1', father: 'Father A', phone: '03010000001' });
  const stuA = r.j.student; check('student A added (auto Reg + Parent Code)', r.status === 200 && /^REG-\d{4}$/.test(stuA.reg) && /^MMSC-\d{6}$/.test(stuA.parentCode), JSON.stringify(stuA));
  r = await owner.post('/api/students', { name: 'Student B', className: '6th', roll: '2', father: 'Father B', phone: '03010000002' });
  const stuB = r.j.student; check('student B added', r.status === 200 && !!stuB.id);

  const weeks = {};
  for (const w of [1, 2, 3, 4]) { r = await owner.post('/api/tests', { className: '6th', subject: 'Urdu', type: 'Weekly', week: w, month: '2026-10', total: 10 }); weeks[w] = r.j.test.id; }
  check('W1–W4 weekly Urdu tests created (total 10)', Object.keys(weeks).length === 4 && !!weeks[1]);
  r = await owner.post('/api/tests', { className: '6th', subject: 'English', type: 'Weekly', week: 1, month: '2026-10', total: 10 });
  const engTest = r.j.test.id;

  const teacher = new Client();
  r = await teacher.post('/api/login', { username: 'ahmed', password: 'teach123' });
  check('teacher login', r.status === 200 && r.j.user.role === 'teacher');
  r = await teacher.get('/api/me');
  check('teacher sees ONLY own class (6th) + own tests (Urdu×4)', r.j.data.classes.length === 1 && r.j.data.classes[0].name === '6th' && r.j.data.tests.length === 4 && r.j.data.tests.every(t => t.subject === 'Urdu'), 'tests=' + r.j.data.tests.length);
  check('teacher first login already sees existing students', r.j.data.students.length === 2);

  r = await teacher.post('/api/marks', { testId: engTest, marks: [{ studentId: stuA.id, obtained: 5 }] });
  check('teacher marks for NON-assigned subject rejected (403)', r.status === 403, 'status=' + r.status);

  const A = [9, 10, 9, 10], B = [8, 8, 8, 8];
  for (const w of [1, 2, 3, 4]) { r = await teacher.post('/api/marks', { testId: weeks[w], marks: [{ studentId: stuA.id, obtained: A[w - 1] }, { studentId: stuB.id, obtained: B[w - 1] }] }); if (r.status !== 200) break; }
  check('teacher one-save marks entry W1–W4', r.status === 200 && r.j.saved === 2, JSON.stringify(r.j));

  r = await owner.get('/api/results/monthly?className=6th&month=2026-10');
  const rowA = r.j.rows.find(x => x.studentId === stuA.id), rowB = r.j.rows.find(x => x.studentId === stuB.id);
  check('monthly: A Urdu subject 38/40 (9+10+9+10); grand 38/50 incl. English W1 test, 76%, position 1', rowA.subjects.Urdu.obtained === 38 && rowA.subjects.Urdu.total === 40 && rowA.obtained === 38 && rowA.total === 50 && rowA.pct === 76 && rowA.position === 1, JSON.stringify(rowA));
  check('monthly: B 32/40, position 2', rowB.obtained === 32 && rowB.position === 2, JSON.stringify(rowB));

  r = await teacher.post('/api/marks', { testId: weeks[1], marks: [{ studentId: stuB.id, obtained: 99 }] });
  check('out-of-range mark 99 rejected with plain message', r.status === 400 && /0 se 10/.test(r.j.error || ''), JSON.stringify(r.j));
  r = await owner.get('/api/results/monthly?className=6th&month=2026-10');
  check('rejected mark did NOT change stored value (B still 32)', r.j.rows.find(x => x.studentId === stuB.id).obtained === 32);

  for (const w of [1, 2, 3, 4]) await teacher.post('/api/marks', { testId: weeks[w], marks: [{ studentId: stuB.id, obtained: 10 }] });
  r = await owner.get('/api/results/monthly?className=6th&month=2026-10');
  const rowA2 = r.j.rows.find(x => x.studentId === stuA.id), rowB2 = r.j.rows.find(x => x.studentId === stuB.id);
  check('position swap after correction: B 40/40 → 1st, A → 2nd', rowB2.obtained === 40 && rowB2.position === 1 && rowA2.position === 2, JSON.stringify({ a: rowA2.position, b: rowB2.position }));

  r = await owner.post('/api/tests', { className: '6th', subject: 'Urdu', type: 'Midterm', month: '2026-10', total: 50 });
  const midTest = r.j.test.id;
  await owner.post('/api/marks', { testId: midTest, marks: [{ studentId: stuA.id, obtained: 40 }] });
  r = await owner.get('/api/results/monthly?className=6th&month=2026-10');
  check('midterm does NOT leak into monthly (A still 38/40)', r.j.rows.find(x => x.studentId === stuA.id).obtained === 38);
  r = await owner.get('/api/results/term?className=6th&type=Midterm');
  const termA = r.j.rows.find(x => x.studentId === stuA.id);
  check('midterm sheet: A 40/50 separate', termA && termA.obtained === 40 && termA.total === 50, JSON.stringify(termA));

  r = await teacher.post('/api/attendance', { className: '6th', date: '2026-10-05', records: { [stuA.id]: 'Present', [stuB.id]: 'Absent' } });
  check('attendance one-save (teacher, own class)', r.status === 200 && r.j.saved === 2, JSON.stringify(r.j));

  const acct = new Client();
  await acct.post('/api/login', { username: 'munshi', password: 'acct123' });
  r = await acct.post('/api/fees', { studentId: stuA.id, month: '2026-10', charged: 2000, discountPct: 25, paid: 1000 });
  check('fee: 2000 − 25% − 1000 = balance 500 exact', r.status === 200 && r.j.fee.balance === 500, JSON.stringify(r.j));
  r = await acct.post('/api/students', { name: 'Nope', className: '6th' });
  check('accountant cannot add students (403)', r.status === 403, 'status=' + r.status);

  /* --- PASSWORD RULES (user's standing rule) --- */
  r = await teacher.post('/api/users/' + ownerId + '/reset-password', { password: 'hack1234' });
  check('PASSWORD RULE: teacher resetting ADMIN password rejected (403)', r.status === 403, 'status=' + r.status);
  r = await teacher.post('/api/users/' + acctId + '/reset-password', { password: 'hack1234' });
  check('PASSWORD RULE: teacher resetting ANY user password rejected (403)', r.status === 403, 'status=' + r.status);
  r = await teacher.post('/api/users', { name: 'X', username: 'x1', password: 'xxxx1234', role: 'teacher' });
  check('PASSWORD RULE: teacher cannot create accounts (403)', r.status === 403, 'status=' + r.status);
  r = await teacher.post('/api/me/password', { currentPassword: 'wrong', newPassword: 'teach456' });
  check('own-password change with WRONG current rejected (401)', r.status === 401, 'status=' + r.status);
  r = await teacher.post('/api/me/password', { currentPassword: 'teach123', newPassword: 'teach456' });
  check('teacher changes ONLY own password (current pw required) → OK', r.status === 200, JSON.stringify(r.j));
  const tOld = new Client(); r = await tOld.post('/api/login', { username: 'ahmed', password: 'teach123' });
  check('old teacher password no longer works', r.status === 401);
  const tNew = new Client(); r = await tNew.post('/api/login', { username: 'ahmed', password: 'teach456' });
  check('new teacher password works', r.status === 200);

  r = await owner.post('/api/users', { name: 'Second Admin', username: 'admin2', password: 'admin2pass', role: 'super' });
  const super2Id = r.j.user.id; check('second super account created', r.status === 200 && !!super2Id);
  const super2 = new Client(); await super2.post('/api/login', { username: 'admin2', password: 'admin2pass' });
  r = await super2.post('/api/users/' + ownerId + '/reset-password', { password: 'takeover1' });
  check("PASSWORD RULE: another Super Admin CANNOT reset the owner's admin password (403)", r.status === 403, 'status=' + r.status);
  r = await owner.post('/api/users/' + teacherId + '/reset-password', { password: 'teach123' });
  check('Super Admin MAY reset a non-super (teacher) password', r.status === 200, JSON.stringify(r.j));
  r = await owner.post('/api/users/' + ownerId + '/reset-password', { password: 'owner123' });
  check('Super Admin may reset OWN admin password (same value re-set)', r.status === 200, JSON.stringify(r.j));

  /* --- RULE 3: brand-new accounts see existing data instantly on first login --- */
  r = await owner.post('/api/staff', { name: 'Ustad Bilal', designation: 'Teacher', subject: 'Urdu', phone: '03003334444' });
  const staff2Id = r.j.staff.id;
  await owner.post('/api/assignments', { staffId: staff2Id, className: '6th', subject: 'Urdu' });
  r = await owner.post('/api/users', { name: 'Ustad Bilal', username: 'bilal', password: 'bilal123', role: 'teacher', staffId: staff2Id });
  const teacher2 = new Client();
  await teacher2.post('/api/login', { username: 'bilal', password: 'bilal123' });
  r = await teacher2.get('/api/me');
  check('RULE 3: brand-new teacher FIRST login sees existing data (2 students, Urdu tests, marks present)', r.j.data.students.length === 2 && r.j.data.tests.length >= 4 && r.j.data.marks.length >= 8, 'students=' + r.j.data.students.length + ' tests=' + r.j.data.tests.length + ' marks=' + r.j.data.marks.length);

  const parentB = new Client();
  r = await parentB.post('/api/parent/login', { reg: stuB.reg, parentCode: stuB.parentCode });
  check('parent B first login works (Reg + Parent Code)', r.status === 200, JSON.stringify(r.j));
  r = await parentB.get('/api/parent/me');
  check('RULE 3: parent B instantly sees UPDATED result (40/40, position 1)', r.j.monthly['2026-10'] && r.j.monthly['2026-10'].obtained === 40 && r.j.monthly['2026-10'].position === 1, JSON.stringify(r.j.monthly));

  const parentA = new Client();
  await parentA.post('/api/parent/login', { reg: stuA.reg, parentCode: stuA.parentCode });
  r = await parentA.get('/api/parent/me');
  check('parent A sees ONLY own child: result 38/40 + fee balance 500 + attendance 100%', r.j.student.id === stuA.id && r.j.monthly['2026-10'].obtained === 38 && r.j.fees.length === 1 && r.j.fees[0].balance === 500 && r.j.attendancePct === 100, JSON.stringify({ att: r.j.attendancePct, fees: r.j.fees.length }));
  check('parent A payload contains NO trace of student B', !JSON.stringify(r.j).includes(stuB.reg) && !JSON.stringify(r.j).includes('Student B'));

  /* --- disable cuts access immediately --- */
  r = await owner.post('/api/users/' + teacherId + '/disable', { disabled: true });
  check('owner disables teacher account', r.status === 200 && r.j.user.disabled === true);
  const tDis = new Client(); r = await tDis.post('/api/login', { username: 'ahmed', password: 'teach123' });
  check('disabled teacher can NO longer login (403)', r.status === 403, 'status=' + r.status);
  r = await tNew.get('/api/me');
  check('disabled teacher existing session also cut (401)', r.status === 401, 'status=' + r.status);

  /* --- backup / restore round-trip --- */
  const br = await fetch(BASE + '/api/backup', { headers: { Cookie: owner.cookie } });
  const backup = await br.json();
  check('backup download (live format)', br.status === 200 && backup.app === 'madina-school-live' && backup.data.students.length === 2);
  const before = {}; for (const k of ['users', 'classes', 'staff', 'students', 'tests', 'marks', 'attendance', 'fees']) before[k] = backup.data[k].length;
  r = await owner.post('/api/restore', backup);
  check('restore round-trip: counts equal', r.status === 200 && Object.entries(before).every(([k, v]) => r.j.counts[k] === v), JSON.stringify({ before, got: r.j.counts }));

  /* --- APK import (additive + dedupe) --- */
  const apkSample = { app: 'madina-model-school', kind: 'backup', version: 1, exportedAt: new Date().toISOString(), data: {
    students: [{ id: 's900', reg: 'REG-9001', parentCode: 'MMSC-900001', name: 'Imported Kid', className: '6th', section: '', roll: '3', father: 'Imp Father', phone: '03001234567', dob: '', adm: '', address: '' }],
    classes: [{ id: 'c1', name: '6th', section: '', teacher: '', room: '', ord: 5 }],
    staff: [], subjects: [], timetable: [],
    tests: [{ id: 't900', month: '2026-11', className: '6th', subject: 'Urdu', total: 10, type: 'Weekly', week: 1 }],
    marks: [{ id: 'm900', testId: 't900', studentId: 's900', obtained: 9 }],
    attendance: [{ id: 'a900', date: '2026-11-02', className: '6th', marks: { s900: 'Present' }, times: {} }],
    fees: [{ id: 'f900', challanNo: 'CH-9001', studentId: 's900', month: '2026-11', charged: 2000, discount: 500, paid: 1000, dueDate: '' }],
    announcements: [], messages: [], regCounter: 9001, challanCounter: 9001, parentCounter: 1, schemaV: 4,
    settings: { name: 'Madina Model School and College', address: 'Dhoda Road, Kohat', phone: '', year: '' } } };
  r = await owner.post('/api/import-apk', apkSample);
  check('APK import #1: student+test+mark+fee+attendance imported, class skipped', r.status === 200 && r.j.report.students.imported === 1 && r.j.report.classes.skipped === 1 && r.j.report.tests.imported === 1 && r.j.report.marks.imported === 1 && r.j.report.fees.imported === 1 && r.j.report.attendance.imported === 1, JSON.stringify(r.j.report));
  r = await owner.post('/api/import-apk', apkSample);
  check('APK import #2 (same file): all skipped, NO duplicates', r.status === 200 && r.j.report.students.imported === 0 && r.j.report.students.skipped === 1 && r.j.report.tests.imported === 0 && r.j.report.marks.imported === 0, JSON.stringify(r.j.report));
  r = await owner.post('/api/import-apk', { app: 'something-else', kind: 'backup' });
  check('APK import rejects a non-APK file (400)', r.status === 400, 'status=' + r.status);
  const parentImp = new Client();
  r = await parentImp.post('/api/parent/login', { reg: 'REG-9001', parentCode: 'MMSC-900001' });
  check('imported student parent login with APK code works', r.status === 200, JSON.stringify(r.j));
  r = await parentImp.get('/api/parent/me');
  check('imported data visible: Nov result 9/10 + fee balance 500 (Rs discount converted)', r.j.monthly['2026-11'] && r.j.monthly['2026-11'].obtained === 9 && r.j.fees.length === 1 && r.j.fees[0].balance === 500, JSON.stringify({ m: r.j.monthly['2026-11'], f: r.j.fees }));

  const h2 = await (await fetch(BASE + '/healthz')).json();
  check('healthz after all work (db=file)', h2.ok && h2.students === 3 && h2.users === 5, JSON.stringify(h2));
} catch (e) {
  fail++; failures.push('EXCEPTION: ' + e.message); console.error(e);
} finally {
  srv.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 400));
  if (fs.existsSync(DB)) fs.unlinkSync(DB);
  if (backupDb) fs.writeFileSync(DB, backupDb);
  console.log('\nSMOKE RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); }
  console.log('Test database removed — project ships EMPTY.');
  process.exit(fail ? 1 : 0);
}
