'use strict';
/* Madina Model School — LIVE front end. Talks to /api on the same origin. */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ME = null, D = null, PARENT = null;
let VIEW = { name: 'dashboard' };
const TILE_COLORS = ['c-blue', 'c-green', 'c-yellow', 'c-red', 'c-teal', 'c-purple'];

async function api(path, opts) {
  const r = await fetch('/api/' + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  let j = {}; try { j = await r.json(); } catch (e) { }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
const apiPost = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b || {}) });
const apiPut = (p, b) => api(p, { method: 'PUT', body: JSON.stringify(b || {}) });
const apiDel = p => api(p, { method: 'DELETE' });
function toast(msg, err) { const d = document.createElement('div'); if (err) d.className = 'err'; d.textContent = msg; $('#toast').appendChild(d); setTimeout(() => d.remove(), 3600); }
async function reload() { const j = await api('me'); ME = j.user; D = j.data; render(); }
function canDo(perm) { if (!ME) return false; if (ME.role === 'super') return true; return PERMS[ME.role] && PERMS[ME.role].includes(perm); }
const PERMS = { branch: ['students.write', 'staff.write', 'subjects.write', 'timetable.write', 'tests.write', 'marks.write', 'attendance.write', 'fees.write', 'announcements.write'], principal: ['announcements.write'], teacher: ['marks.write', 'attendance.write'], exam: ['tests.write', 'marks.write'], accountant: ['fees.write'] };
const studentsOf = cn => (D.students || []).filter(s => s.className === cn).sort((a, b) => { const ra = parseFloat(a.roll), rb = parseFloat(b.roll); const na = isNaN(ra) ? 1e9 : ra, nb = isNaN(rb) ? 1e9 : rb; if (na !== nb) return na - nb; if (a.reg !== b.reg) return a.reg < b.reg ? -1 : 1; return String(a.name).localeCompare(String(b.name)); });
const staffName = id => { const s = (D.staff || []).find(x => x.id === id); return s ? s.name : ''; };
const monthNow = () => new Date().toISOString().slice(0, 7);
function feeBal(f) { return Math.round(((+f.charged || 0) - (+f.charged || 0) * (+f.discountPct || 0) / 100 - (+f.paid || 0)) * 100) / 100; }

/* ---------- boot / auth ---------- */
async function boot() {
  const pub = await api('public');
  try { const j = await api('me'); ME = j.user; D = j.data; if (ME.role === 'teacher') VIEW = { name: 'myclasses' }; return render(); } catch (e) { }
  try { PARENT = await api('parent/me'); return renderParent(); } catch (e) { }
  renderAuth(pub);
}
function renderAuth(pub) {
  if (!pub.setupDone) {
    $('#app').innerHTML = `<div class="auth-wrap"><div class="auth-card">
      <img src="/logo.jpg" alt=""><h1>${esc(pub.schoolName)}</h1><div class="addr">${esc(pub.address)} — LIVE Online System</div>
      <h2 class="sec">Owner Setup — پہلا اکاؤنٹ</h2>
      <p class="muted small">Ye pehla account <b>Super Admin / Owner</b> hoga. Pehle owner banein, phir baqi accounts owner banayega.</p>
      <form id="setupForm"><label>Your name</label><input id="suName" required>
      <label>Username</label><input id="suUser" required autocomplete="username">
      <label>Password (min 4)</label><input id="suPass" type="password" required minlength="4" autocomplete="new-password">
      <button class="btn block">Create Owner Account</button></form></div></div>`;
    $('#setupForm').onsubmit = async e => { e.preventDefault(); try { await apiPost('setup', { name: $('#suName').value, username: $('#suUser').value, password: $('#suPass').value }); toast('Owner account ban gaya ✓'); await reload(); } catch (err) { toast(err.message, 1); } };
    return;
  }
  $('#app').innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <img src="/logo.jpg" alt=""><h1>${esc(pub.schoolName)}</h1><div class="addr">${esc(pub.address)} — LIVE Online System</div>
    <p class="muted small" style="margin-top:10px">Apna wala darwaza chunein — <b>choose your login:</b></p>
    <div style="display:grid;gap:10px;margin:14px 0">
      <button class="btn block" style="margin:0" onclick="loginPick('owner')">👑 Owner Login</button>
      <button class="btn green block" style="margin:0" onclick="loginPick('staff')">👩‍🏫 Teacher / Staff Login</button>
      <button class="btn yellow block" style="margin:0" onclick="loginPick('parent')">👨‍👩‍👧 Parents Login</button>
    </div>
    <form id="ownerForm" style="display:none"><h3 style="margin:6px 0">👑 Owner Login</h3>
    <p class="small muted">Sirf <b>Super Admin / Owner</b> ke liye — school ka main account.</p>
    <label>Username</label><input id="owUser" autocomplete="username">
    <label>Password</label><input id="owPass" type="password" autocomplete="current-password">
    <button class="btn block">Owner Login</button></form>
    <form id="loginForm" style="display:none"><h3 style="margin:6px 0">👩‍🏫 Teacher / Staff Login</h3>
    <p class="small muted">Teachers, Principal, Exam Controller, Accountant, Branch Admin — apne account se login karein. <b>Teacher seedha apni "My Classes" par jayega.</b></p>
    <label>Username</label><input id="liUser" autocomplete="username">
    <label>Password</label><input id="liPass" type="password" autocomplete="current-password">
    <button class="btn green block">Staff Login</button></form>
    <form id="parentForm" style="display:none"><h3 style="margin:6px 0">👨‍👩‍👧 Parents Login</h3>
    <p class="small muted">Waliden sirf <b>apne bache</b> ka record dekh sakte hain (result, haziri, fees).</p>
    <label>Child's Reg No (e.g. REG-0001)</label><input id="paReg">
    <label>Parent Code</label><input id="paCode">
    <button class="btn yellow block">Parents Login — اپنے بچے کا ریکارڈ دیکھیں</button></form>
  </div></div>`;
  window.loginPick = which => { $('#ownerForm').style.display = which === 'owner' ? '' : 'none'; $('#loginForm').style.display = which === 'staff' ? '' : 'none'; $('#parentForm').style.display = which === 'parent' ? '' : 'none'; };
  const doLogin = async (userEl, passEl) => { const j = await apiPost('login', { username: $(userEl).value, password: $(passEl).value }); if (j.user && j.user.role === 'teacher') VIEW = { name: 'myclasses' }; await reload(); };
  $('#ownerForm').onsubmit = async e => { e.preventDefault(); try { await doLogin('#owUser', '#owPass'); } catch (err) { toast(err.message, 1); } };
  $('#loginForm').onsubmit = async e => { e.preventDefault(); try { await doLogin('#liUser', '#liPass'); } catch (err) { toast(err.message, 1); } };
  $('#parentForm').onsubmit = async e => { e.preventDefault(); try { await apiPost('parent/login', { reg: $('#paReg').value, parentCode: $('#paCode').value }); PARENT = await api('parent/me'); renderParent(); } catch (err) { toast(err.message, 1); } };
}
async function logout() { await apiPost('logout'); ME = null; D = null; PARENT = null; VIEW = { name: 'dashboard' }; boot(); }
/* Change OWN password only (current password required). Admin (Super Admin)
   password koi aur change nahi kar sakta — teacher bhi nahi. */
function changePwOpen() {
  const bg = modal(`<h3 style="margin-bottom:6px">🔑 Apna Password Badlein</h3>
  <p class="small muted">Har user sirf <b>apna</b> password badal sakta hai — purana password lazmi hai. Kisi aur ka password aap nahi badal sakte.</p>
  <form id="pwForm"><label>Current password</label><input id="pwCur" type="password" required autocomplete="current-password">
  <label>New password (min 4)</label><input id="pwNew" type="password" required minlength="4" autocomplete="new-password">
  <button class="btn block">Change My Password</button>
  <button type="button" class="btn ghost block" onclick="closeModal()">Cancel</button></form>`);
  bg.querySelector('#pwForm').onsubmit = async e => { e.preventDefault(); try { await apiPost('me/password', { currentPassword: $('#pwCur').value, newPassword: $('#pwNew').value }); closeModal(); toast('Password change ho gaya ✓'); } catch (err) { toast(err.message, 1); } };
}

/* ---------- shell ---------- */
function shell(inner) {
  const nav = [['dashboard', '🏠 Dashboard']];
  if (ME.role === 'teacher') nav.push(['myclasses', '👩‍🏫 My Classes']);
  nav.push(['students', '🎓 Students'], ['staff', '👨‍🏫 Staff'], ['fees', '💰 Fees'], ['announcements', '📢 Announcements']);
  if (ME.role === 'super') nav.push(['users', '🔐 User Accounts'], ['settings', '⚙️ Settings'], ['data', '💾 Data']);
  else if (canDo('announcements.write') || ME.role === 'branch') nav.push(['settings-view', '⚙️ School']);
  $('#app').innerHTML = `
  <header class="top"><img src="/logo.jpg" alt=""><div class="t"><b>${esc(D.settings.schoolName)}</b><span>${esc(D.settings.address)} • LIVE</span></div>
  <div class="small" style="text-align:right"><b>${esc(ME.name)}</b><br><span>${esc(ME.roleLabel)}</span></div>
  <button onclick="changePwOpen()">🔑 Password</button>
  <button onclick="logout()">Logout</button></header>
  <nav class="main">${nav.map(n => `<button class="${VIEW.name === n[0] ? 'on' : ''}" onclick="go('${n[0]}')">${n[1]}</button>`).join('')}</nav>
  <main id="main">${inner}</main>`;
}
function go(name, extra) { VIEW = Object.assign({ name }, extra || {}); render(); window.scrollTo(0, 0); }
function render() {
  if (!ME) return;
  ({ dashboard: vDashboard, myclasses: vMyClasses, class: vClass, students: vStudents, staff: vStaff, fees: vFees, announcements: vAnnouncements, users: vUsers, settings: vSettings, 'settings-view': vSettings, data: vData, marks: vMarks, sheet: vSheet, challan: vChallan }[VIEW.name] || vDashboard)();
}
function modal(html, wide) { const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = `<div class="modal${wide ? ' wide' : ''}">${html}</div>`; bg.onclick = e => { if (e.target === bg) bg.remove(); }; document.body.appendChild(bg); return bg; }
function closeModal() { document.querySelectorAll('.modal-bg').forEach(m => m.remove()); }

/* ---------- dashboard ---------- */
function vDashboard() {
  const fees = D.fees || []; const collected = fees.reduce((a, f) => a + (+f.paid || 0), 0); const outstanding = fees.reduce((a, f) => a + Math.max(0, feeBal(f)), 0);
  const today = new Date().toISOString().slice(0, 10);
  const attToday = (D.attendance || []).filter(a => a.date === today).length;
  shell(`
  <div class="grid">
    <div class="tile c-blue"><span class="big">${D.students.length}</span><span>Total Students</span></div>
    <div class="tile c-green"><span class="big">${D.classes.length}</span><span>Classes</span></div>
    <div class="tile c-yellow"><span class="big">${(D.staff || []).length}</span><span>Teachers / Staff</span></div>
    <div class="tile c-teal"><span class="big">${attToday}</span><span>Attendance Marked Today</span></div>
    <div class="tile c-green"><span class="big">Rs ${collected.toLocaleString()}</span><span>Fees Collected</span></div>
    <div class="tile c-red"><span class="big">Rs ${outstanding.toLocaleString()}</span><span>Fees Outstanding</span></div>
  </div>
  <h2 class="sec">Classes — ہر کلاس کے اندر سب کچھ</h2>
  <div class="grid">${D.classes.map((c, i) => `<button class="tile ${TILE_COLORS[i % TILE_COLORS.length]}" onclick="go('class',{cls:'${esc(c.name)}'})"><b>${esc(c.name)}</b><span>${studentsOf(c.name).length} students • tap to open</span></button>`).join('')}</div>
  ${(D.announcements || []).filter(a => a.pin).length ? `<h2 class="sec">📌 Pinned Announcements</h2>` + D.announcements.filter(a => a.pin).map(annCard).join('') : ''}
  `);
}
function annCard(a) { return `<div class="card"><b>${esc(a.title)}</b> <span class="badge ${a.priority === 'Urgent' ? 'red' : a.priority === 'High' ? 'yellow' : ''}">${esc(a.priority || 'Normal')}</span> <span class="badge">${esc(a.audience || 'All')}</span><div class="muted small">${esc(a.date || '')}</div><div>${esc(a.body || '')}</div></div>`; }
function vMyClasses() {
  const asg = D.assignments || [];
  const myTests = (D.tests || []);
  shell(`<h2 class="sec">👩‍🏫 My Classes — میری کلاسز</h2>
  <p class="muted small">Assalam-o-Alaikum <b>${esc(ME.name)}</b> — ye sirf aap ki assigned classes aur subjects hain. Marks sirf apne subject ke lag sakte hain.</p>
  <div class="grid">${D.classes.map((c, i) => `<button class="tile ${TILE_COLORS[i % TILE_COLORS.length]}" onclick="go('class',{cls:'${esc(c.name)}'})"><b>${esc(c.name)}</b><span>${studentsOf(c.name).length} students • ${asg.filter(a => a.className === c.name).map(a => esc(a.subject)).join(', ')}</span></button>`).join('') || '<p class="muted">Abhi koi class assign nahi — admin se rabta karein.</p>'}</div>
  <h2 class="sec">📝 My Tests — marks lagayein</h2>
  <div class="card">${myTests.map(t => testRow(t.className, t)).join('') || '<p class="muted">Abhi koi test nahi — class khol kar Tests se banayein (agar aap ko test banane ki ijazat hai), ya Exam Controller se banwayein.</p>'}</div>`);
}

/* ---------- class view ---------- */
function vClass() {
  const cls = VIEW.cls, sec = VIEW.sec || 'home';
  const subs = {
    home: cvHome, students: cvStudents, teachers: cvTeachers, subjects: cvSubjects,
    attendance: cvAttendance, timetable: cvTimetable, tests: cvTests, month: cvMonth,
    midterm: () => cvTerm('Midterm'), final: () => cvTerm('Final'),
    fees: cvClassFees, announcements: cvClassAnn, reports: cvReports
  };
  (subs[sec] || cvHome)(cls);
}
function cvHead(cls, title) {
  return `<div class="crumb"><a href="#" onclick="go('dashboard');return false">Dashboard</a> › <b>${esc(cls)}</b>${title ? ' › ' + esc(title) : ''}</div>
  <h2 class="sec">${esc(cls)}${title ? ' — ' + esc(title) : ''}</h2>`;
}
function cvHome(cls) {
  const tiles = [
    ['students', '🎓', 'Students', studentsOf(cls).length + ' students'],
    ['teachers', '👩‍🏫', 'Teachers', 'Class + subject teachers'],
    ['subjects', '📚', 'Subjects', (D.subjects || []).filter(s => s.className === cls).length + ' subjects'],
    ['attendance', '✅', 'Attendance', 'Roz ki haziri'],
    ['timetable', '🗓', 'Timetable', 'Weekly periods'],
    ['tests', '📝', 'Tests', 'Months → Week 1–4'],
    ['midterm', '📗', 'Midterm Exams', 'Midterm tests + result'],
    ['final', '📕', 'Final Term Exams', 'Final tests + result'],
    ['fees', '💰', 'Fees', 'Is class ki fees'],
    ['announcements', '📢', 'Announcements', 'Class notices'],
    ['reports', '🖨', 'Reports / Print', 'Result sheets, print']
  ];
  shell(cvHead(cls) + `<div class="grid">${tiles.map((t, i) => `<button class="tile ${TILE_COLORS[i % TILE_COLORS.length]}" onclick="go('class',{cls:'${esc(cls)}',sec:'${t[0]}'})"><b>${t[1]} ${t[2]}</b><span>${t[3]}</span></button>`).join('')}</div>`);
}
function backToClass(cls) { return `<button class="btn ghost small" onclick="go('class',{cls:'${esc(cls)}'})">← Back to ${esc(cls)}</button>`; }

function cvStudents(cls) {
  const rows = studentsOf(cls);
  shell(cvHead(cls, 'Students') + backToClass(cls) + `
  ${canDo('students.write') ? `<div class="card"><b>Add Student</b><form id="addStu"><div class="row">
    <div><label>Name</label><input id="nsName" required></div>
    <div><label>Father / Guardian</label><input id="nsFather"></div>
    <div><label>Roll No</label><input id="nsRoll"></div>
    <div><label>Section</label><input id="nsSection"></div>
    <div><label>Phone (parent)</label><input id="nsPhone"></div>
    <div><label>Reg No (blank = auto)</label><input id="nsReg"></div>
    <div><label>DOB</label><input id="nsDob" type="date"></div>
    <div><label>Admission date</label><input id="nsAdm" type="date"></div>
    </div><label>Address</label><input id="nsAddr"><button class="btn block">Add Student</button></form></div>` : ''}
  <div class="card tbl-wrap"><table><tr><th>Roll</th><th>Reg No</th><th>Name</th><th>Father</th><th>Phone</th>${ME.role === 'super' || ME.role === 'branch' ? '<th>Parent Code</th>' : ''}<th></th></tr>
  ${rows.map(s => `<tr><td>${esc(s.roll || '')}</td><td><b>${esc(s.reg)}</b></td><td>${esc(s.name)}</td><td>${esc(s.father || '')}</td><td>${esc(s.phone || '')}</td>
    ${ME.role === 'super' || ME.role === 'branch' ? `<td><b>${esc(s.parentCode)}</b></td>` : ''}
    <td>${canDo('students.write') ? `<button class="btn ghost small" onclick="regenCode('${s.id}')">New Code</button> <button class="btn red small" onclick="delStudent('${s.id}','${esc(s.name)}')">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No students in this class yet.</td></tr>'}
  </table></div>`);
  const f = $('#addStu'); if (f) f.onsubmit = async e => { e.preventDefault(); try { const j = await apiPost('students', { name: $('#nsName').value, father: $('#nsFather').value, roll: $('#nsRoll').value, section: $('#nsSection').value, phone: $('#nsPhone').value, reg: $('#nsReg').value, dob: $('#nsDob').value, admissionDate: $('#nsAdm').value, address: $('#nsAddr').value, className: cls }); toast('Student added ✓ ' + j.student.reg + ' • Parent Code ' + j.student.parentCode); await reload(); } catch (err) { toast(err.message, 1); } };
}
async function regenCode(id) { try { const j = await apiPut('students/' + id + '/parent-code', {}); toast('New Parent Code: ' + j.parentCode); await reload(); } catch (e) { toast(e.message, 1); } }
async function delStudent(id, name) { if (!confirm('Delete student ' + name + '? Their marks, attendance and fees will also be removed.')) return; try { await apiDel('students/' + id); toast('Deleted'); await reload(); } catch (e) { toast(e.message, 1); } }

function cvTeachers(cls) {
  const asg = (D.assignments || []).filter(a => a.className === cls);
  shell(cvHead(cls, 'Teachers') + backToClass(cls) + `
  <div class="card"><table><tr><th>Teacher</th><th>Subject</th><th>Phone</th>${canDo('staff.write') ? '<th></th>' : ''}</tr>
  ${asg.map(a => `<tr><td><b>${esc(staffName(a.staffId))}</b></td><td>${esc(a.subject)}</td><td>${esc((D.staff.find(s => s.id === a.staffId) || {}).phone || '')}</td>${canDo('staff.write') ? `<td><button class="btn red small" onclick="delAsg('${a.id}')">Remove</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="4" class="muted">No teachers assigned yet.</td></tr>'}</table></div>
  ${canDo('staff.write') ? `<div class="card"><b>Assign Teacher to ${esc(cls)}</b><form id="asgForm"><div class="row">
    <div><label>Teacher (staff)</label><select id="asgStaff">${(D.staff || []).map(s => `<option value="${s.id}">${esc(s.name)}${s.subject ? ' — ' + esc(s.subject) : ''}</option>`).join('')}</select></div>
    <div><label>Subject</label><input id="asgSub" required placeholder="e.g. Urdu"></div></div>
    <button class="btn block">Assign</button></form><p class="small muted">Staff member nahi hai? Pehle <a href="#" onclick="go('staff');return false">Staff</a> page par add karein. Teacher ka login account User Accounts se banta hai (staff se link karke).</p></div>` : ''}`);
  const f = $('#asgForm'); if (f) f.onsubmit = async e => { e.preventDefault(); try { await apiPost('assignments', { staffId: $('#asgStaff').value, className: cls, subject: $('#asgSub').value }); toast('Assigned ✓'); await reload(); } catch (err) { toast(err.message, 1); } };
}
async function delAsg(id) { try { await apiDel('assignments/' + id); await reload(); } catch (e) { toast(e.message, 1); } }

function cvSubjects(cls) {
  const subs = (D.subjects || []).filter(s => s.className === cls);
  shell(cvHead(cls, 'Subjects') + backToClass(cls) + `
  <div class="card"><table><tr><th>Subject</th><th>Teacher</th>${canDo('subjects.write') ? '<th></th>' : ''}</tr>
  ${subs.map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(staffName(s.staffId))}</td>${canDo('subjects.write') ? `<td><button class="btn red small" onclick="delSubject('${s.id}')">Delete</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="3" class="muted">No subjects yet.</td></tr>'}</table></div>
  ${canDo('subjects.write') ? `<div class="card"><b>Add Subject</b><form id="subForm"><div class="row">
    <div><label>Subject name</label><input id="subName" required></div>
    <div><label>Teacher</label><select id="subStaff"><option value="">—</option>${(D.staff || []).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div></div>
    <button class="btn block">Add Subject</button></form></div>` : ''}`);
  const f = $('#subForm'); if (f) f.onsubmit = async e => { e.preventDefault(); try { await apiPost('subjects', { name: $('#subName').value, className: cls, staffId: $('#subStaff').value || null }); toast('Subject added ✓'); await reload(); } catch (err) { toast(err.message, 1); } };
}
async function delSubject(id) { try { await apiDel('subjects/' + id); await reload(); } catch (e) { toast(e.message, 1); } }

function cvAttendance(cls) {
  const date = VIEW.date || new Date().toISOString().slice(0, 10);
  const rows = studentsOf(cls);
  const rec = {}; (D.attendance || []).filter(a => a.className === cls && a.date === date).forEach(a => rec[a.studentId] = a.status);
  const month = date.slice(0, 7);
  const pct = {}; (D.attendance || []).filter(a => a.className === cls && a.date.startsWith(month)).forEach(a => { pct[a.studentId] = pct[a.studentId] || { p: 0, t: 0 }; pct[a.studentId].t++; if (a.status === 'Present' || a.status === 'Late') pct[a.studentId].p++; });
  shell(cvHead(cls, 'Attendance') + backToClass(cls) + `
  <div class="card"><div class="row"><div><label>Date</label><input type="date" id="attDate" value="${date}"></div>
  <div class="narrow"><button class="btn" onclick="go('class',{cls:'${esc(cls)}',sec:'attendance',date:document.getElementById('attDate').value})">Open</button></div></div>
  <p class="small muted">Sab pehle se <b>Present</b> hain — sirf Absent / Late / Leave ko tap karein, phir ek Save.</p>
  <div class="tbl-wrap"><table><tr><th>Roll</th><th>Name</th><th>Status</th><th>${esc(month)} %</th></tr>
  ${rows.map(s => { const st = rec[s.id] || 'Present'; const pc = pct[s.id] ? Math.round(pct[s.id].p / pct[s.id].t * 1000) / 10 : null; return `<tr><td>${esc(s.roll || '')}</td><td><b>${esc(s.name)}</b><br><span class="small muted">${esc(s.reg)}</span></td>
  <td>${['Present', 'Absent', 'Late', 'Leave'].map(x => `<button class="att-btn att-${s.id} ${st === x ? 'on-' + (x === 'Present' ? 'P' : x === 'Absent' ? 'A' : x === 'Late' ? 'L' : 'Le') : ''}" data-sid="${s.id}" data-st="${x}" onclick="attSet(this)">${x}</button>`).join('')}</td>
  <td>${pc == null ? '—' : pc + '%'}</td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">No students.</td></tr>'}</table></div>
  ${canDo('attendance.write') ? `<button class="btn green block" onclick="attSave('${esc(cls)}','${date}')">Save Attendance — ایک ہی Save</button>` : '<p class="muted small">Aap ke role se attendance change nahi hoti (view only).</p>'}
  </div>`);
  window._att = Object.assign({}, rec); rows.forEach(s => { if (!window._att[s.id]) window._att[s.id] = 'Present'; });
}
function attSet(btn) { const sid = btn.dataset.sid, st = btn.dataset.st; window._att[sid] = st; document.querySelectorAll('.att-' + sid).forEach(b => { b.className = 'att-btn att-' + sid + (b.dataset.st === st ? ' on-' + (st === 'Present' ? 'P' : st === 'Absent' ? 'A' : st === 'Late' ? 'L' : 'Le') : ''); }); }
async function attSave(cls, date) { try { const j = await apiPost('attendance', { className: cls, date, records: window._att }); toast('Attendance saved ✓ (' + j.saved + ')'); await reload(); } catch (e) { toast(e.message, 1); } }

function cvTimetable(cls) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const rows = (D.timetable || []).filter(t => t.className === cls);
  shell(cvHead(cls, 'Timetable') + backToClass(cls) + `
  <div class="card tbl-wrap"><table><tr><th>Day</th><th>Period</th><th>Time</th><th>Subject</th><th>Teacher</th>${canDo('timetable.write') ? '<th></th>' : ''}</tr>
  ${days.flatMap(d => rows.filter(r => r.day === d)).concat(rows.filter(r => !days.includes(r.day))).map(r => `<tr><td>${esc(r.day)}</td><td>${esc(r.period || '')}</td><td>${esc(r.time || '')}</td><td><b>${esc(r.subject)}</b></td><td>${esc(r.teacher || staffName(r.staffId))}</td>${canDo('timetable.write') ? `<td><button class="btn red small" onclick="delTt('${r.id}')">Delete</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="muted">No periods yet.</td></tr>'}</table></div>
  ${canDo('timetable.write') ? `<div class="card"><b>Add Period</b><form id="ttForm"><div class="row">
    <div><label>Day</label><select id="ttDay">${days.map(d => `<option>${d}</option>`).join('')}</select></div>
    <div><label>Period</label><input id="ttPer" placeholder="1"></div>
    <div><label>Time</label><input id="ttTime" placeholder="08:00–08:45"></div>
    <div><label>Subject</label><input id="ttSub" required></div>
    <div><label>Teacher</label><select id="ttStaff"><option value="">—</option>${(D.staff || []).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div></div>
    <button class="btn block">Add Period</button></form></div>` : ''}`);
  const f = $('#ttForm'); if (f) f.onsubmit = async e => { e.preventDefault(); try { const sid = $('#ttStaff').value; await apiPost('timetable', { className: cls, day: $('#ttDay').value, period: $('#ttPer').value, time: $('#ttTime').value, subject: $('#ttSub').value, staffId: sid || null, teacher: staffName(sid) }); toast('Period added ✓'); await reload(); } catch (err) { toast(err.message, 1); } };
}
async function delTt(id) { try { await apiDel('timetable/' + id); await reload(); } catch (e) { toast(e.message, 1); } }

/* ---------- tests tree: Tests → Months → Weeks → Marks / Month Result ---------- */
function classTests(cls, pred) { return (D.tests || []).filter(t => t.className === cls && pred(t)); }
function cvTests(cls) {
  const months = [...new Set(classTests(cls, t => t.type === 'Weekly' || t.type === 'Monthly').map(t => t.month))].sort();
  if (!months.includes(monthNow())) months.push(monthNow());
  shell(cvHead(cls, 'Tests') + backToClass(cls) + `
  <p class="muted small">Mahina chunein → andar Week 1–4 alag alag, har week ke marks, aur Month Result (har subject /40, grand total, %, grade, positions).</p>
  <div class="grid">${months.sort().map((m, i) => { const n = classTests(cls, t => t.month === m && (t.type === 'Weekly' || t.type === 'Monthly')).length; return `<button class="tile ${TILE_COLORS[i % TILE_COLORS.length]}" onclick="go('class',{cls:'${esc(cls)}',sec:'month',month:'${m}'})"><b>${esc(m)}</b><span>${n} tests</span></button>`; }).join('')}</div>
  ${canDo('tests.write') ? `<div class="card"><b>New Test (Weekly / Monthly)</b><form id="testForm"><div class="row">
    <div><label>Subject</label><input id="tfSub" required placeholder="e.g. Urdu"></div>
    <div><label>Type</label><select id="tfType"><option>Weekly</option><option>Monthly</option></select></div>
    <div><label>Week (Weekly only)</label><select id="tfWeek"><option>1</option><option>2</option><option>3</option><option>4</option></select></div>
    <div><label>Month</label><input id="tfMonth" type="month" value="${monthNow()}"></div>
    <div><label>Total marks</label><input id="tfTotal" type="number" value="${D.settings.weeklyMax}"></div>
    <div><label>Date</label><input id="tfDate" type="date"></div></div>
    <button class="btn block">Create Test</button></form></div>` : ''}`);
  const f = $('#testForm'); if (f) f.onsubmit = async e => { e.preventDefault(); try { await apiPost('tests', { className: cls, subject: $('#tfSub').value, type: $('#tfType').value, week: +$('#tfWeek').value, month: $('#tfMonth').value, total: +$('#tfTotal').value, date: $('#tfDate').value }); toast('Test ban gaya ✓'); await reload(); } catch (err) { toast(err.message, 1); } };
}
function cvMonth(cls) {
  const month = VIEW.month || monthNow();
  const wk = w => classTests(cls, t => t.month === month && t.type === 'Weekly' && t.week === w);
  const monthly = classTests(cls, t => t.month === month && t.type === 'Monthly');
  shell(cvHead(cls, 'Tests › ' + month) + `<button class="btn ghost small" onclick="go('class',{cls:'${esc(cls)}',sec:'tests'})">← Months</button>` + `
  <div class="grid" style="margin-top:10px">
  ${[1, 2, 3, 4].map((w, i) => `<button class="tile ${TILE_COLORS[i % TILE_COLORS.length]}" onclick="weekOpen('${esc(cls)}','${month}',${w})"><b>Week ${w}</b><span>${wk(w).length} tests • har test /${D.settings.weeklyMax} default</span></button>`).join('')}
  <button class="tile c-purple" onclick="openSheet('monthly','${esc(cls)}','${month}')"><b>📊 Month Result</b><span>Subject /40 • Grand Total • Positions</span></button>
  </div>
  <div id="weekArea"></div>
  ${monthly.length ? `<div class="card"><b>Monthly-type tests (${esc(month)})</b>${monthly.map(t => testRow(cls, t)).join('')}</div>` : ''}`);
}
function weekOpen(cls, month, w) {
  const tests = classTests(cls, t => t.month === month && t.type === 'Weekly' && t.week === w);
  $('#weekArea').innerHTML = `<div class="card"><b>${esc(cls)} › ${esc(month)} › Week ${w}</b>
  ${tests.map(t => testRow(cls, t)).join('') || '<p class="muted small">Is week ka koi test nahi — upar Tests page se banayein, ya neeche se:</p>'}
  ${canDo('tests.write') ? `<form id="wkForm"><div class="row"><div><label>Subject</label><input id="wkSub" required></div><div><label>Total marks</label><input id="wkTotal" type="number" value="${D.settings.weeklyMax}"></div></div><button class="btn block">+ Week ${w} Test banayein</button></form>` : ''}</div>`;
  const f = $('#wkForm'); if (f) f.onsubmit = async e => { e.preventDefault(); try { await apiPost('tests', { className: cls, subject: $('#wkSub').value, type: 'Weekly', week: w, month, total: +$('#wkTotal').value }); toast('Test ban gaya ✓'); await reload(); } catch (err) { toast(err.message, 1); } };
  window.scrollTo(0, document.body.scrollHeight);
}
function testRow(cls, t) {
  const mine = ME.role !== 'teacher' || (D.assignments || []).some(a => a.className === t.className && a.subject === t.subject);
  return `<div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
  <div style="flex:1;min-width:160px"><b>${esc(t.subject)}</b> <span class="badge">${esc(t.type)}${t.week ? ' • W' + t.week : ''}</span> <span class="badge ${t.status === 'Locked' ? 'red' : t.status === 'Published' ? 'green' : 'yellow'}">${esc(t.status)}</span><br><span class="small muted">Total ${t.total} • ${esc(t.month)}${t.date ? ' • ' + esc(t.date) : ''}</span></div>
  ${mine && canDo('marks.write') && t.status !== 'Locked' ? `<button class="btn small" onclick="go('marks',{testId:'${t.id}',cls:'${esc(cls)}'})">✏️ Marks</button>` : ''}
  <button class="btn ghost small" onclick="openSheet('test','${t.id}')">Sheet</button>
  ${canDo('tests.write') ? `<button class="btn ghost small" onclick="testStatus('${t.id}','${t.status === 'Published' ? 'Locked' : 'Published'}')">${t.status === 'Published' ? '🔒 Lock' : t.status === 'Locked' ? '🔓 Unlock' : 'Publish'}</button>
  <button class="btn red small" onclick="delTest('${t.id}')">Delete</button>` : ''}</div>`;
}
async function testStatus(id, st) { try { await apiPut('tests/' + id, { status: st }); toast('Status: ' + st); await reload(); } catch (e) { toast(e.message, 1); } }
async function delTest(id) { if (!confirm('Delete this test and its marks?')) return; try { await apiDel('tests/' + id); toast('Deleted'); await reload(); } catch (e) { toast(e.message, 1); } }

function cvTerm(type) {
  const cls = VIEW.cls;
  const tests = classTests(cls, t => t.type === type);
  shell(cvHead(cls, type + ' Exams') + backToClass(cls) + `
  <button class="btn c-purple" style="margin-bottom:10px" onclick="openSheet('term','${esc(cls)}','${type}')">📊 ${type} Result Sheet — Print / PDF</button>
  <div class="card">${tests.map(t => testRow(cls, t)).join('') || '<p class="muted">No ' + type + ' tests yet.</p>'}</div>
  ${canDo('tests.write') ? `<div class="card"><b>New ${type} Test</b><form id="termForm"><div class="row">
    <div><label>Subject</label><input id="tmSub" required></div>
    <div><label>Month</label><input id="tmMonth" type="month" value="${monthNow()}"></div>
    <div><label>Total marks</label><input id="tmTotal" type="number" value="100"></div>
    <div><label>Date</label><input id="tmDate" type="date"></div></div>
    <button class="btn block">Create ${type} Test</button></form></div>` : ''}`);
  const f = $('#termForm'); if (f) f.onsubmit = async e => { e.preventDefault(); try { await apiPost('tests', { className: cls, subject: $('#tmSub').value, type, month: $('#tmMonth').value, total: +$('#tmTotal').value, date: $('#tmDate').value }); toast('Test ban gaya ✓'); await reload(); } catch (err) { toast(err.message, 1); } };
}

/* ---------- marks entry ---------- */
function vMarks() {
  const t = (D.tests || []).find(x => x.id === VIEW.testId);
  if (!t) { shell('<p class="muted">Test not found.</p>'); return; }
  const rows = studentsOf(t.className);
  const mm = {}; (D.marks || []).filter(m => m.testId === t.id).forEach(m => mm[m.studentId] = m.obtained);
  shell(`<div class="crumb"><b>${esc(t.className)}</b> › ${esc(t.subject)} — ${esc(t.type)}${t.week ? ' Week ' + t.week : ''} (${esc(t.month)}) • Total ${t.total}</div>
  <h2 class="sec">✏️ Marks — ${esc(t.subject)}</h2>
  <p class="muted small">Poori class ek screen par — marks likhein, neeche total khud badlega (Excel ki tarah), phir <b>ek Save</b>. ${t.total} se zyada number save nahi hoga.</p>
  <div class="card tbl-wrap"><table><tr><th>Roll</th><th>Reg</th><th>Name</th><th>Marks / ${t.total}</th></tr>
  ${rows.map(s => `<tr><td>${esc(s.roll || '')}</td><td>${esc(s.reg)}</td><td><b>${esc(s.name)}</b></td><td><input class="mark" type="number" min="0" max="${t.total}" step="any" data-sid="${s.id}" value="${mm[s.id] != null ? mm[s.id] : ''}" oninput="markLive()"></td></tr>`).join('')}
  </table>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px"><span>Class total: <b id="liveTotal">0</b></span><span>Entered: <b id="liveCount">0</b>/${rows.length}</span><span>Average: <b id="liveAvg">—</b></span></div>
  <button class="btn green block" onclick="marksSave('${t.id}')">Save Marks — سب ایک ساتھ</button>
  <button class="btn ghost block" onclick="go('class',{cls:'${esc(t.className)}',sec:'tests'})">← Back to Tests</button></div>`);
  markLive();
}
function markLive() { let tot = 0, n = 0; document.querySelectorAll('input.mark').forEach(i => { if (i.value !== '') { tot += +i.value || 0; n++; } }); const lt = $('#liveTotal'); if (lt) { lt.textContent = tot; $('#liveCount').textContent = n; $('#liveAvg').textContent = n ? Math.round(tot / n * 10) / 10 : '—'; } }
async function marksSave(testId) {
  const marks = []; document.querySelectorAll('input.mark').forEach(i => marks.push({ studentId: i.dataset.sid, obtained: i.value === '' ? '' : +i.value }));
  try { const j = await apiPost('marks', { testId, marks }); toast('Marks saved ✓ (' + j.saved + ')'); await reload(); } catch (e) { toast(e.message, 1); }
}

/* ---------- result sheets + print ---------- */
async function openSheet(kind, a, b) { VIEW = { name: 'sheet', kind, a, b }; render(); }
function sheetHead(title) { return `<div class="sheet-head"><img src="/logo.jpg" alt=""><h2 style="margin:4px 0">${esc(D.settings.schoolName)}</h2><div class="muted">${esc(D.settings.address)}${D.settings.phone ? ' • ' + esc(D.settings.phone) : ''}</div><h3 style="margin-top:6px">${esc(title)}</h3></div>`; }
async function vSheet() {
  shell('<p class="muted">Loading sheet…</p>');
  try {
    let html = '', backCls = VIEW.a;
    if (VIEW.kind === 'monthly') {
      const sh = await api('results/monthly?className=' + encodeURIComponent(VIEW.a) + '&month=' + encodeURIComponent(VIEW.b));
      html = sheetHtml(sh, 'Class Monthly Result Sheet — ' + sh.className + ' — ' + sh.month, true);
    } else if (VIEW.kind === 'term') {
      const sh = await api('results/term?className=' + encodeURIComponent(VIEW.a) + '&type=' + encodeURIComponent(VIEW.b));
      html = sheetHtml(sh, sh.kind + ' Result Sheet — ' + sh.className, false);
    } else if (VIEW.kind === 'test') {
      const sh = await api('results/test?testId=' + encodeURIComponent(VIEW.a));
      const t = sh.test; backCls = t.className;
      html = sheetHead((t.type || '') + ' Test Sheet — ' + t.className + ' — ' + t.subject + (t.week ? ' Week ' + t.week : '') + ' (' + t.month + ')') +
        `<div class="tbl-wrap"><table><tr><th>Roll</th><th>Reg</th><th>Name</th><th>Marks / ${t.total}</th><th>%</th></tr>
        ${sh.rows.map(r => `<tr><td>${esc(r.roll || '')}</td><td>${esc(r.reg)}</td><td>${esc(r.name)}</td><td>${r.obtained == null ? '—' : r.obtained}</td><td>${r.obtained == null ? '—' : Math.round(r.obtained / t.total * 1000) / 10 + '%'}</td></tr>`).join('')}</table></div>` + sigRow();
    }
    $('#main').innerHTML = `<div class="no-print" style="margin-bottom:10px"><button class="btn" onclick="window.print()">🖨 Print / PDF</button>
    <button class="btn ghost" onclick="go('class',{cls:'${esc(backCls)}'})">← Back to class</button></div><div class="card print-area">${html}</div>`;
  } catch (e) { $('#main').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
}
function sigRow() { return `<div class="sig-row"><div class="sig">Class Teacher</div><div class="sig">Principal</div></div>`; }
function sheetHtml(sh, title, weeklyCols) {
  const avg = sh.rows.length ? Math.round(sh.rows.reduce((a, r) => a + r.pct, 0) / sh.rows.length * 10) / 10 : 0;
  const pass = sh.rows.filter(r => r.status === 'Pass').length;
  return sheetHead(title) + `<div class="tbl-wrap"><table><tr><th>Pos</th><th>Reg</th><th>Name</th>
  ${sh.subjects.map(sub => `<th>${esc(sub)}${weeklyCols ? '' : ''}</th>`).join('')}<th>Grand Total</th><th>%</th><th>Grade</th><th>GPA</th><th>Status</th></tr>
  ${sh.rows.map(r => `<tr><td><b>${r.position ? r.position + '' : '—'}</b></td><td>${esc(r.reg)}</td><td><b>${esc(r.name)}</b></td>
    ${sh.subjects.map(sub => { const c = r.subjects[sub]; if (!c) return '<td>—</td>'; const wk = weeklyCols && c.weekly && Object.keys(c.weekly).length ? `<br><span class="small muted">${[1, 2, 3, 4].map(w => 'W' + w + ': ' + (c.weekly[w] ? c.weekly[w].obtained : '—')).join(' • ')}</span>` : ''; return `<td><b>${c.obtained}/${c.total}</b>${wk}</td>`; }).join('')}
    <td><b>${r.obtained}/${r.total}</b></td><td>${r.pct}%</td><td><b>${esc(r.grade)}</b></td><td>${r.gpa}</td><td>${esc(r.status)}</td></tr>`).join('')}
  </table></div>
  <p class="small muted" style="margin-top:8px">Class average: <b>${avg}%</b> • Pass: <b>${pass}/${sh.rows.length}</b> • Grading scale: ${D.settings.grading.map(g => g.min + '+ = ' + g.grade).join(', ')}</p>` + sigRow();
}

/* ---------- class fees / announcements / reports ---------- */
function cvClassFees(cls) {
  const fees = (D.fees || []).filter(f => { const s = D.students.find(x => x.id === f.studentId); return s && s.className === cls; });
  const def = fees.filter(f => feeBal(f) > 0);
  shell(cvHead(cls, 'Fees') + backToClass(cls) + feeTable(fees) + `<h2 class="sec">Defaulters (${def.length})</h2>` + feeTable(def));
}
function feeTable(fees) {
  return `<div class="card tbl-wrap"><table><tr><th>Challan</th><th>Student</th><th>Month</th><th>Charged</th><th>Discount</th><th>Paid</th><th>Balance</th><th></th></tr>
  ${fees.map(f => { const s = D.students.find(x => x.id === f.studentId); const bal = feeBal(f); return `<tr><td>${esc(f.challanNo)}</td><td><b>${esc(s ? s.name : '?')}</b><br><span class="small muted">${esc(s ? s.reg : '')} • ${esc(s ? s.className : '')}</span></td><td>${esc(f.month)}</td><td>Rs ${(+f.charged).toLocaleString()}</td><td>${f.discountPct ? f.discountPct + '% (Rs ' + Math.round(f.charged * f.discountPct / 100).toLocaleString() + ')' : '—'}</td><td>Rs ${(+f.paid).toLocaleString()}</td><td><b style="color:${bal > 0 ? 'var(--red)' : 'var(--green)'}">Rs ${bal.toLocaleString()}</b></td>
  <td><button class="btn ghost small" onclick="go('challan',{feeId:'${f.id}'})">Challan</button>${canDo('fees.write') ? ` <button class="btn red small" onclick="delFee('${f.id}')">Delete</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">No fee records.</td></tr>'}</table></div>`;
}
async function delFee(id) { if (!confirm('Delete this fee record?')) return; try { await apiDel('fees/' + id); toast('Deleted'); await reload(); } catch (e) { toast(e.message, 1); } }
function vChallan() {
  const f = (D.fees || []).find(x => x.id === VIEW.feeId);
  if (!f) { shell('<p class="muted">Fee not found.</p>'); return; }
  const s = D.students.find(x => x.id === f.studentId); const bal = feeBal(f);
  shell(`<div class="no-print" style="margin-bottom:10px"><button class="btn" onclick="window.print()">🖨 Print / PDF — Challan</button> <button class="btn ghost" onclick="go('fees')">← Fees</button></div>
  <div class="card print-area">${sheetHead('FEE CHALLAN / RECEIPT')}
  <table><tr><td>Challan No</td><td><b>${esc(f.challanNo)}</b></td><td>Month</td><td>${esc(f.month)}</td></tr>
  <tr><td>Student</td><td><b>${esc(s ? s.name : '')}</b></td><td>Reg No</td><td>${esc(s ? s.reg : '')}</td></tr>
  <tr><td>Class</td><td>${esc(s ? s.className : '')}</td><td>Due Date</td><td>${esc(f.dueDate || '—')}</td></tr>
  <tr><th>Charged</th><td>Rs ${(+f.charged).toLocaleString()}</td><th>Discount</th><td>${f.discountPct ? f.discountPct + '%' : '—'}</td></tr>
  <tr><th>Paid</th><td>Rs ${(+f.paid).toLocaleString()}</td><th>Balance Due</th><td><b>Rs ${bal.toLocaleString()}</b> ${bal > 0 ? '<span class="badge red">UNPAID</span>' : '<span class="badge green">PAID</span>'}</td></tr></table>
  <div class="sig-row"><div class="sig">Parent Signature</div><div class="sig">School Accounts Office</div></div></div>`);
}
function cvClassAnn(cls) {
  const list = (D.announcements || []).filter(a => a.audience === 'All' || a.audience === cls);
  shell(cvHead(cls, 'Announcements') + backToClass(cls) + list.map(annCard).join('') + (canDo('announcements.write') ? annForm(cls) : ''));
  wireAnnForm();
}
function annForm(fixedAudience) {
  return `<div class="card"><b>New Announcement</b><form id="annForm"><label>Title</label><input id="anTitle" required>
  <label>Message</label><textarea id="anBody" rows="3"></textarea><div class="row">
  <div><label>Audience</label><select id="anAud">${fixedAudience ? `<option>${esc(fixedAudience)}</option><option>All</option>` : '<option>All</option>' + D.classes.map(c => `<option>${esc(c.name)}</option>`).join('')}</select></div>
  <div><label>Priority</label><select id="anPri"><option>Normal</option><option>High</option><option>Urgent</option></select></div>
  <div><label>Pin to dashboard</label><select id="anPin"><option value="">No</option><option value="1">Yes</option></select></div></div>
  <button class="btn block">Post Announcement</button></form></div>`;
}
function wireAnnForm() { const f = $('#annForm'); if (f) f.onsubmit = async e => { e.preventDefault(); try { await apiPost('announcements', { title: $('#anTitle').value, body: $('#anBody').value, audience: $('#anAud').value, priority: $('#anPri').value, pin: !!$('#anPin').value }); toast('Posted ✓'); await reload(); } catch (err) { toast(err.message, 1); } }; }
function cvReports(cls) {
  shell(cvHead(cls, 'Reports / Print') + backToClass(cls) + `
  <div class="grid">
    <button class="tile c-blue" onclick="openSheet('monthly','${esc(cls)}','${monthNow()}')"><b>📊 Monthly Result</b><span>${monthNow()} — print/PDF</span></button>
    <button class="tile c-green" onclick="openSheet('term','${esc(cls)}','Midterm')"><b>📗 Midterm Result</b><span>Print / PDF</span></button>
    <button class="tile c-red" onclick="openSheet('term','${esc(cls)}','Final')"><b>📕 Final Result</b><span>Print / PDF</span></button>
    <button class="tile c-yellow" onclick="go('class',{cls:'${esc(cls)}',sec:'students'})"><b>🎓 Student List</b><span>Roll order</span></button>
    <button class="tile c-teal" onclick="go('class',{cls:'${esc(cls)}',sec:'fees'})"><b>💰 Fee Statement</b><span>Class fees + defaulters</span></button>
    <button class="tile c-purple" onclick="go('class',{cls:'${esc(cls)}',sec:'attendance'})"><b>✅ Attendance</b><span>Monthly %</span></button>
  </div>
  <p class="small muted">Har sheet par ek hi bada <b>Print / PDF</b> button hai — print dialog se seedha print ya "Save as PDF".</p>`);
}

/* ---------- global pages ---------- */
function vStudents() {
  const q = (VIEW.q || '').toLowerCase();
  const rows = [...D.students].filter(s => !q || s.name.toLowerCase().includes(q) || s.reg.toLowerCase().includes(q)).sort((a, b) => (a.className + '').localeCompare(b.className + '') || (parseFloat(a.roll) || 1e9) - (parseFloat(b.roll) || 1e9));
  shell(`<h2 class="sec">🎓 Students (${rows.length})</h2>
  <div class="card"><div class="row"><div><label>Search (name / Reg)</label><input id="stuQ" value="${esc(VIEW.q || '')}"></div><div class="narrow"><button class="btn" onclick="go('students',{q:document.getElementById('stuQ').value})">Search</button></div></div></div>
  <div class="card tbl-wrap"><table><tr><th>Class</th><th>Roll</th><th>Reg</th><th>Name</th><th>Father</th><th>Phone</th>${ME.role === 'super' || ME.role === 'branch' ? '<th>Parent Code</th>' : ''}<th></th></tr>
  ${rows.map(s => `<tr><td>${esc(s.className)}</td><td>${esc(s.roll || '')}</td><td><b>${esc(s.reg)}</b></td><td>${esc(s.name)}</td><td>${esc(s.father || '')}</td><td>${esc(s.phone || '')}</td>${ME.role === 'super' || ME.role === 'branch' ? `<td><b>${esc(s.parentCode)}</b></td>` : ''}<td><button class="btn ghost small" onclick="go('class',{cls:'${esc(s.className)}',sec:'students'})">Open Class</button></td></tr>`).join('')}</table></div>
  <p class="small muted">Student add karna ho to us ki class khol kar Students tile se add karein.</p>`);
}
function vStaff() {
  shell(`<h2 class="sec">👨‍🏫 Teachers / Staff (${(D.staff || []).length})</h2>
  ${canDo('staff.write') ? `<div class="card"><b>Add Staff</b><form id="staffForm"><div class="row">
    <div><label>Name</label><input id="stName" required></div>
    <div><label>Designation</label><input id="stDesig" value="Teacher"></div>
    <div><label>Subject</label><input id="stSub"></div>
    <div><label>Phone</label><input id="stPhone"></div>
    <div><label>Email</label><input id="stEmail"></div>
    <div><label>Qualification</label><input id="stQual"></div>
    <div><label>Joining date</label><input id="stJoin" type="date"></div></div>
    <button class="btn block">Add Staff</button></form>
    <p class="small muted">Teacher ko class+subject dena: class khol kar <b>Teachers</b> tile. Teacher ka <b>login account</b> User Accounts (Super Admin) se staff record se link karke banta hai.</p></div>` : ''}
  <div class="card tbl-wrap"><table><tr><th>Name</th><th>Designation</th><th>Subject</th><th>Phone</th><th>Qualification</th><th>Assigned</th>${canDo('staff.write') ? '<th></th>' : ''}</tr>
  ${(D.staff || []).map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.designation || '')}</td><td>${esc(s.subject || '')}</td><td>${esc(s.phone || '')}</td><td>${esc(s.qualification || '')}</td>
  <td>${(D.assignments || []).filter(a => a.staffId === s.id).map(a => `<span class="badge">${esc(a.className)} • ${esc(a.subject)}</span>`).join(' ')}</td>
  ${canDo('staff.write') ? `<td><button class="btn red small" onclick="delStaff('${s.id}')">Delete</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="7" class="muted">No staff yet.</td></tr>'}</table></div>`);
  const f = $('#staffForm'); if (f) f.onsubmit = async e => { e.preventDefault(); try { await apiPost('staff', { name: $('#stName').value, designation: $('#stDesig').value, subject: $('#stSub').value, phone: $('#stPhone').value, email: $('#stEmail').value, qualification: $('#stQual').value, joiningDate: $('#stJoin').value }); toast('Staff added ✓'); await reload(); } catch (err) { toast(err.message, 1); } };
}
async function delStaff(id) { if (!confirm('Delete this staff member? Assignments will be removed.')) return; try { await apiDel('staff/' + id); toast('Deleted'); await reload(); } catch (e) { toast(e.message, 1); } }

function vFees() {
  const fees = [...(D.fees || [])].reverse();
  const def = fees.filter(f => feeBal(f) > 0);
  shell(`<h2 class="sec">💰 Fees</h2>
  ${canDo('fees.write') ? `<div class="card"><b>Add Fee Record</b><form id="feeForm"><div class="row">
    <div><label>Student</label><select id="feStu">${D.classes.flatMap(c => studentsOf(c.name)).map(s => `<option value="${s.id}">${esc(s.className)} — ${esc(s.name)} (${esc(s.reg)})</option>`).join('')}</select></div>
    <div><label>Month</label><input id="feMonth" type="month" value="${monthNow()}"></div>
    <div><label>Charged (Rs)</label><input id="feChg" type="number" required></div>
    <div><label>Discount %</label><input id="feDisc" type="number" value="0" min="0" max="100"></div>
    <div><label>Paid (Rs)</label><input id="fePaid" type="number" value="0"></div>
    <div><label>Due date</label><input id="feDue" type="date"></div></div>
    <p class="small muted">Balance khud banta hai: Charged − Discount − Paid (Excel ki tarah automatic).</p>
    <button class="btn block">Add Fee</button></form></div>` : ''}
  ${feeTable(fees)}
  <h2 class="sec">🔴 Defaulters — Fees Outstanding (${def.length})</h2>${feeTable(def)}`);
  const f = $('#feeForm'); if (f) f.onsubmit = async e => { e.preventDefault(); try { const j = await apiPost('fees', { studentId: $('#feStu').value, month: $('#feMonth').value, charged: +$('#feChg').value, discountPct: +$('#feDisc').value, paid: +$('#fePaid').value, dueDate: $('#feDue').value }); toast('Fee added ✓ ' + j.fee.challanNo + ' • Balance Rs ' + j.fee.balance); await reload(); } catch (err) { toast(err.message, 1); } };
}
function vAnnouncements() {
  shell(`<h2 class="sec">📢 Announcements</h2>` + (D.announcements || []).map(a => annCard(a) + (canDo('announcements.write') ? `<div style="margin:-6px 0 10px"><button class="btn red small" onclick="delAnn('${a.id}')">Delete</button></div>` : '')).join('') + (canDo('announcements.write') ? annForm(null) : ''));
  wireAnnForm();
}
async function delAnn(id) { try { await apiDel('announcements/' + id); await reload(); } catch (e) { toast(e.message, 1); } }

/* ---------- users / settings / data (Super Admin) ---------- */
function vUsers() {
  shell(`<h2 class="sec">🔐 User Accounts</h2>
  <div class="card"><b>Create Account</b><form id="usrForm"><div class="row">
    <div><label>Full name</label><input id="usName" required></div>
    <div><label>Username</label><input id="usUser" required></div>
    <div><label>Password</label><input id="usPass" required minlength="4"></div>
    <div><label>Role</label><select id="usRole"><option value="branch">Branch Admin</option><option value="principal">Principal</option><option value="teacher">Teacher</option><option value="exam">Examination Controller</option><option value="accountant">Accountant</option><option value="super">Super Admin</option></select></div>
    <div><label>Link staff record (Teacher)</label><select id="usStaff"><option value="">—</option>${(D.staff || []).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div></div>
    <button class="btn block">Create Account</button></form>
    <p class="small muted">Teacher account ko staff record se link karein — teacher ko sirf us ki assigned classes/subjects nazar ayenge. Jo admin chala jaye, us ka account <b>Disable</b> kar dein — login usi waqt band ho jata hai, data system mein mehfooz rehta hai.<br><b>Password rule:</b> kisi Super Admin (admin) ka password sirf wohi admin khud badal sakta hai — doosra koi nahi, teacher to bilkul nahi (teacher sirf apna login aur apna password, purana password de kar). Baqi har account ka password Super Admin reset kar sakta hai, aur har user 🔑 Password button se apna password khud badal sakta hai.</p></div>
  <div id="usrList"><p class="muted">Loading…</p></div>`);
  $('#usrForm').onsubmit = async e => { e.preventDefault(); try { await apiPost('users', { name: $('#usName').value, username: $('#usUser').value, password: $('#usPass').value, role: $('#usRole').value, staffId: $('#usStaff').value || null }); toast('Account ban gaya ✓'); render(); } catch (err) { toast(err.message, 1); } };
  api('users').then(j => {
    $('#usrList').innerHTML = `<div class="card tbl-wrap"><table><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr>
    ${j.users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}</td><td>${esc(u.roleLabel)}</td><td>${u.disabled ? '<span class="badge red">Disabled</span>' : '<span class="badge green">Active</span>'}</td>
    <td><button class="btn ghost small" onclick="userDisable('${u.id}',${!u.disabled})">${u.disabled ? 'Enable' : 'Disable'}</button>
    <button class="btn ghost small" onclick="userReset('${u.id}')">Reset Password</button>
    <button class="btn red small" onclick="userDelete('${u.id}','${esc(u.username)}')">Delete</button></td></tr>`).join('')}</table></div>`;
  }).catch(e => toast(e.message, 1));
}
async function userDisable(id, dis) { try { await apiPost('users/' + id + '/disable', { disabled: dis }); toast(dis ? 'Account disabled — login band' : 'Account enabled'); render(); } catch (e) { toast(e.message, 1); } }
async function userReset(id) { const pw = prompt('New password (min 4):'); if (!pw) return; try { await apiPost('users/' + id + '/reset-password', { password: pw }); toast('Password reset ✓'); } catch (e) { toast(e.message, 1); } }
async function userDelete(id, un) { if (!confirm('Delete account ' + un + '?')) return; try { await apiDel('users/' + id); toast('Deleted'); render(); } catch (e) { toast(e.message, 1); } }

function vSettings() {
  if (ME.role !== 'super') { shell(`<h2 class="sec">⚙️ School Profile</h2><div class="card"><b>${esc(D.settings.schoolName)}</b><br>${esc(D.settings.address)}<br>${esc(D.settings.phone || '')}<p class="small muted">Settings sirf Super Admin badal sakta hai.</p></div>`); return; }
  const S = D.settings;
  shell(`<h2 class="sec">⚙️ Settings</h2>
  <div class="card"><b>School Profile</b><form id="setForm"><label>School name</label><input id="seName" value="${esc(S.schoolName)}">
  <label>Address</label><input id="seAddr" value="${esc(S.address)}"><label>Phone</label><input id="sePhone" value="${esc(S.phone || '')}">
  <label>Weekly test default total marks</label><input id="seWeekly" type="number" value="${S.weeklyMax}">
  <button class="btn block">Save Profile</button></form></div>
  <div class="card"><b>Grading Scale (configurable — formula hardcoded nahi)</b>
  <div class="tbl-wrap"><table><tr><th>Min %</th><th>Grade</th><th>GPA</th><th></th></tr>
  ${S.grading.map((g, i) => `<tr><td><input type="number" id="grMin${i}" value="${g.min}"></td><td><input id="grG${i}" value="${esc(g.grade)}"></td><td><input type="number" step="0.1" id="grGpa${i}" value="${g.gpa}"></td><td></td></tr>`).join('')}
  </table></div><button class="btn block" onclick="saveGrading(${S.grading.length})">Save Grading Scale</button></div>
  <div class="card"><b>Classes</b><div class="row"><div><label>New class name</label><input id="newCls"></div><div class="narrow"><button class="btn" onclick="addClass()">Add Class</button></div></div>
  <p class="small muted">${D.classes.map(c => esc(c.name)).join(' • ')}</p></div>`);
  $('#setForm').onsubmit = async e => { e.preventDefault(); try { await apiPut('settings', { schoolName: $('#seName').value, address: $('#seAddr').value, phone: $('#sePhone').value, weeklyMax: +$('#seWeekly').value }); toast('Saved ✓'); await reload(); } catch (err) { toast(err.message, 1); } };
}
async function saveGrading(n) { const grading = []; for (let i = 0; i < n; i++) grading.push({ min: +$('#grMin' + i).value, grade: $('#grG' + i).value, gpa: +$('#grGpa' + i).value }); try { await apiPut('settings', { grading }); toast('Grading scale saved ✓ — results naye scale se banein ge'); await reload(); } catch (e) { toast(e.message, 1); } }
async function addClass() { try { await apiPost('classes', { name: $('#newCls').value }); toast('Class added ✓'); await reload(); } catch (e) { toast(e.message, 1); } }

function vData() {
  shell(`<h2 class="sec">💾 Data — Backup / Restore / APK Import</h2>
  <div class="card"><b>⬇ Backup — Save Data</b><p class="small muted">Poora data (students, teachers, tests, marks, fees, haziri, accounts ke baghair passwords) ek JSON file mein. File mehfooz rakhein — is mein students ka data hai.</p>
  <a class="btn block" style="text-align:center;text-decoration:none" href="/api/backup">Download Backup File</a></div>
  <div class="card"><b>⬆ Restore — Load Data</b><p class="small muted">Live backup file select karein. <b>KHABARDAR:</b> restore mojooda data ko us file se badal deta hai.</p>
  <input type="file" id="restoreFile" accept="*/*"><button class="btn red block" onclick="doRestore()">Restore karein</button><div id="restoreMsg" class="small" style="margin-top:8px"></div></div>
  <div class="card"><b>📥 APK Backup Import — Convert</b><p class="small muted">Phone app (APK) wali backup file — <b>MadinaSchool-Backup-….json</b> ya <b>MadinaSchool-AutoBackup.json</b> — select karein. Data <b>add</b> hoga, purana delete nahi hoga; jo cheez pehle se hai woh skip ho jayegi.</p>
  <input type="file" id="apkFile" accept="*/*"><button class="btn green block" onclick="doImport()">APK Data Import karein</button><div id="importMsg" class="small" style="margin-top:8px"></div></div>`);
}
function readFileText(input) { return new Promise((res, rej) => { const f = input.files[0]; if (!f) return rej(new Error('Pehle file select karein')); const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('File parhi nahi gayi')); r.readAsText(f); }); }
async function doRestore() {
  const box = $('#restoreMsg');
  try { const txt = await readFileText($('#restoreFile')); let j; try { j = JSON.parse(String(txt).replace(/^﻿/, '')); } catch (e) { throw new Error('File sahi JSON nahi hai'); }
    const data = j.data || j;
    if (!confirm('RESTORE karne se mojooda data is file se badal jayega. Pakka karein?')) return;
    const r = await apiPost('restore', data.app ? j : { data });
    box.innerHTML = 'Restore ho gaya ✓ — ' + JSON.stringify(r.counts);
    toast('Restore ho gaya ✓'); setTimeout(() => location.reload(), 900);
  } catch (e) { box.innerHTML = '<span style="color:var(--red)">' + esc(e.message) + '</span>'; }
}
async function doImport() {
  const box = $('#importMsg');
  try { const txt = await readFileText($('#apkFile')); let j; try { j = JSON.parse(String(txt).replace(/^﻿/, '')); } catch (e) { throw new Error('File sahi JSON nahi hai'); }
    const r = await apiPost('import-apk', j);
    box.innerHTML = '<b>Import report:</b><br>' + Object.entries(r.report).map(([k, v]) => esc(k) + ': imported ' + v.imported + ', skipped ' + v.skipped).join('<br>');
    toast('APK import ho gaya ✓'); await reload();
  } catch (e) { box.innerHTML = '<span style="color:var(--red)">' + esc(e.message) + '</span>'; }
}

/* ---------- parent portal ---------- */
function renderParent() {
  const P = PARENT, s = P.student;
  const months = Object.keys(P.monthly).sort();
  $('#app').innerHTML = `
  <header class="top"><img src="/logo.jpg" alt=""><div class="t"><b>Parent Portal</b><span>${esc(s.name)} • ${esc(s.className)} • ${esc(s.reg)}</span></div><button onclick="logout()">Exit</button></header>
  <main>
  <div class="card" style="text-align:center"><h2 style="margin:4px 0">${esc(s.name)}</h2><div class="muted">${esc(s.className)}${s.section ? ' (' + esc(s.section) + ')' : ''} • Roll ${esc(s.roll || '')} • Father: ${esc(s.father || '')}</div>
  <div style="display:flex;gap:10px;justify-content:center;margin-top:10px;flex-wrap:wrap"><span class="badge green">Attendance: ${P.attendancePct == null ? '—' : P.attendancePct + '%'}</span>
  <span class="badge ${P.fees.some(f => f.balance > 0) ? 'red' : 'green'}">Fees balance: Rs ${P.fees.reduce((a, f) => a + Math.max(0, f.balance), 0).toLocaleString()}</span></div></div>
  <h2 class="sec">📊 Results</h2>
  ${months.map(m => { const r = P.monthly[m]; return `<div class="card"><b>Monthly — ${esc(m)}</b><div class="tbl-wrap"><table><tr><th>Subject</th><th>Marks</th></tr>
    ${Object.entries(r.subjects).map(([sub, c]) => `<tr><td>${esc(sub)}</td><td><b>${c.obtained}/${c.total}</b></td></tr>`).join('')}
    <tr><th>Grand Total</th><th>${r.obtained}/${r.total} • ${r.pct}% • Grade ${esc(r.grade)} • ${r.position ? r.position + ' position' : ''}</th></tr></table></div></div>`; }).join('') || '<p class="muted">Abhi koi result nahi.</p>'}
  ${Object.entries(P.terms).map(([ty, r]) => `<div class="card"><b>${esc(ty)} Result</b><div class="tbl-wrap"><table><tr><th>Subject</th><th>Marks</th></tr>
    ${Object.entries(r.subjects).map(([sub, c]) => `<tr><td>${esc(sub)}</td><td><b>${c.obtained}/${c.total}</b></td></tr>`).join('')}
    <tr><th>Grand Total</th><th>${r.obtained}/${r.total} • ${r.pct}% • Grade ${esc(r.grade)}</th></tr></table></div></div>`).join('')}
  <h2 class="sec">💰 Fees</h2>
  <div class="card tbl-wrap"><table><tr><th>Challan</th><th>Month</th><th>Charged</th><th>Paid</th><th>Balance</th></tr>
  ${P.fees.map(f => `<tr><td>${esc(f.challanNo)}</td><td>${esc(f.month)}</td><td>Rs ${(+f.charged).toLocaleString()}</td><td>Rs ${(+f.paid).toLocaleString()}</td><td><b>Rs ${f.balance.toLocaleString()}</b></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No fee records.</td></tr>'}</table></div>
  <h2 class="sec">📢 Announcements</h2>${P.announcements.map(annCard).join('') || '<p class="muted">—</p>'}
  <h2 class="sec">🗓 Timetable — ${esc(s.className)}</h2>
  <div class="card tbl-wrap"><table><tr><th>Day</th><th>Time</th><th>Subject</th><th>Teacher</th></tr>
  ${P.timetable.map(t => `<tr><td>${esc(t.day)}</td><td>${esc(t.time || '')}</td><td>${esc(t.subject)}</td><td>${esc(t.teacher || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">—</td></tr>'}</table></div>
  </main>`;
}
boot();
