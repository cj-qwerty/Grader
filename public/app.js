// public/app.js
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* sections */
const nav = $('#nav');

window.addEventListener('error', (e) => {
  const m = 'ข้อผิดพลาด JS: ' + (e?.error?.message || e.message || e.toString());
  console.error(m, e?.error || e);
  const el = document.getElementById('submitMsg');
  if (el) el.textContent = m;
});
const who = $('#who');
const navAdmin = $('#navAdmin');
const logoutBtn = $('#logoutBtn');

const loginSection = $('#loginSection');
const registerSection = $('#registerSection');
const projectsPage = $('#projectsPage');
const problemPage = $('#problemPage');
const subsPage = $('#subsPage');
const adminPage = $('#adminPage');

/* login/register */
const loginForm = $('#loginForm');
const loginMsg = $('#loginMsg');
const gotoRegister = $('#gotoRegister');

const regForm = $('#regForm');
const regMsg = $('#regMsg');
const backToLogin = $('#backToLogin');

/* projects */
const projSelect = $('#projSelect');
const problemsWrap = $('#problemsWrap');

/* problem */
const backToProjects = $('#backToProjects');
const pbHeader = $('#pbHeader');
const pdfFrame = $('#pdfFrame');
const langSel = $('#langSel');
const codeFile = $('#codeFile');
const useFile = $('#useFile');
const editorMount = $('#editorMount');
const submitBtn = $('#submitBtn');
const submitMsg = $('#submitMsg');
let editor = null;
let editorLang = 'cpp';
let currentProblem = null;
let me = null;

/* subs */
const subsWrap = $('#subsWrap');

/* admin */
const projName = $('#projName');
const projSlug = $('#projSlug');
const projEnabled = $('#projEnabled');
const createProj = $('#createProj');
const projList = $('#projList');
const pbList = $('#pbList');

const pbTitle = $('#pbTitle');
const pbProject = $('#pbProject');
const pbTests = $('#pbTests');
const pbPdf = $('#pbPdf');
const createPb = $('#createPb');

const userList = $('#userList');
const allSubs = $('#allSubs');

function showOnly(sectionId) {
  [loginSection, registerSection, projectsPage, problemPage, subsPage, adminPage].forEach(x => x.classList.add('hidden'));
  if (sectionId) $(sectionId).classList.remove('hidden');
}
function showNav(on) { nav.classList.toggle('hidden', !on); }
function pill(status){
  const map = { green:'d-green', yellow:'d-yellow', red:'d-red', gray:'d-gray' };
  return `<span class="dot ${map[status]||'d-gray'}"></span>${status.toUpperCase()}`;
}
async function api(path, opt){ const r = await fetch(path, { credentials:'same-origin', headers:{'Content-Type':'application/json'}, ...opt}); return r.json(); }
function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function init() {
  const r = await api('/api/me');
  me = r.user || null;
  if (!me) {
    showNav(false);
    showOnly('#loginSection');
    return;
  }
  who.textContent = `${me.username} ${me.isAdmin ? '(admin)' : ''}`;
  navAdmin.classList.toggle('hidden', !me.isAdmin);
  showNav(true);
  await loadProjectsForSelect();
  await loadProblemsBySelectedProject();
  await loadPbProjectForAdmin();
  showOnly('#projectsPage');
  setupEditor();
}
init();

/* login/register nav */
gotoRegister.addEventListener('click', () => { showOnly('#registerSection'); });
backToLogin.addEventListener('click', () => { showOnly('#loginSection'); });

/* login/register submit */
loginForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  loginMsg.textContent = '';
  const fd = new FormData(loginForm);
  const r = await api('/api/login', { method:'POST', body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }) });
  if(!r.ok){ loginMsg.textContent = 'เข้าสู่ระบบไม่สำเร็จ'; return; }
  init();
});
regForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  regMsg.textContent='';
  const fd = new FormData(regForm);
  const r = await api('/api/register', { method:'POST', body: JSON.stringify({ username: fd.get('username'), password: fd.get('password'), confirm: fd.get('confirm') }) });
  if(!r.ok){
    regMsg.textContent = r.error === 'password_need_digit' ? 'รหัสต้องมีตัวเลข' : 'สมัครไม่สำเร็จ';
    return;
  }
  init();
});
logoutBtn.addEventListener('click', async ()=>{
  await api('/api/logout', { method:'POST' });
  location.reload();
});

/* nav buttons */
$$('nav [data-goto]').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    const to = btn.getAttribute('data-goto');
    if(to === 'projects'){ await loadProjectsForSelect(); await loadProblemsBySelectedProject(); showOnly('#projectsPage'); }
    if(to === 'subs'){ await loadMySubs(); showOnly('#subsPage'); }
  });
});
navAdmin.addEventListener('click', async ()=>{
  await renderAdmin();
  showOnly('#adminPage');
});

/* projects load */
async function loadProjectsForSelect(){
  const r = await api('/api/projects');
  projSelect.innerHTML = '';
  if(r.ok){
    const opened = r.projects.filter(p=>p.enabled);
    opened.forEach(p=>{
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = `${p.name} (${p.slug})`;
      projSelect.appendChild(opt);
    });
  }
}
projSelect.addEventListener('change', loadProblemsBySelectedProject);

async function loadProblemsBySelectedProject(){
  problemsWrap.innerHTML = '';
  const pid = projSelect.value;
  if(!pid) return;
  const r = await api(`/api/problems/byProject?projectId=${encodeURIComponent(pid)}`);
  if(!r.ok) return;
  r.problems.forEach(pb=>{
    const card = document.createElement('div');
    card.className = 'card p-3';
    card.innerHTML = `
      <div class="font-semibold">${pb.title}</div>
      <div class="text-sm mt-1"><a class="link" href="${pb.pdfUrl}" target="_blank">เปิด PDF</a></div>
      <button class="mt-2 px-3 py-1 rounded-lg bg-slate-900 text-white">เข้าไปทำ</button>
    `;
    card.querySelector('button').addEventListener('click',()=> openProblem(pb));
    problemsWrap.appendChild(card);
  });
}

/* open problem */
function setupEditor(lang='cpp'){
  editorLang = lang;
  // buildEditor คืนค่า EditorView ทันที (ไม่ใช่ Promise)
  editor = window.buildEditor(editorMount, editorLang);
}
async function openProblem(pb){
  currentProblem = pb;
  pbHeader.textContent = pb.title;
  pdfFrame.src = pb.pdfUrl;
  const pdfOpenNew = document.getElementById('pdfOpenNew');
  if (pdfOpenNew) pdfOpenNew.href = pb.pdfUrl;
  submitMsg.textContent = '';
  showOnly('#problemPage');
  setupEditor(editorLang);   // <-- เรียกตรง ๆ ได้เลย
}
backToProjects.addEventListener('click', ()=> showOnly('#projectsPage'));
langSel.addEventListener('change', ()=>{
  editorLang = langSel.value;
  if(editor) window.switchLanguage(editor, editorLang);
});
useFile.addEventListener('click', async ()=>{
  const f = codeFile.files?.[0];
  if(!f || !editor) return;
  const text = await f.text();
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
});

/* submit — แสดง error/detail ชัดเจน */
submitBtn.addEventListener('click', async ()=>{
  if(!currentProblem || !editor) return;
  submitBtn.disabled = true; submitMsg.textContent = 'กำลังตรวจ...';
  const code = editor.state.doc.toString();

  let res;
  try {
    const r = await fetch('/api/submit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemId: currentProblem.id, language: editorLang, code })
    });
    res = await r.json().catch(()=>({ ok:false, error:'bad_json' }));
  } catch (e) {
    submitBtn.disabled = false;
    submitMsg.textContent = 'เครือข่ายล้มเหลว: ' + (e.message||e);
    return;
  }

  submitBtn.disabled = false;

  if(!res || !res.ok){
    const msg = [
      'ส่งไม่สำเร็จ',
      res?.error ? `error: ${res.error}` : '',
      res?.detail ? `detail: ${res.detail}` : ''
    ].filter(Boolean).join(' • ');
    submitMsg.textContent = msg || 'ส่งไม่สำเร็จ (ไม่ทราบสาเหตุ)';
    return;
  }

  const st = res.submission.status;
  const color = st==='green'?'#10b981':st==='yellow'?'#f59e0b':st==='red'?'#ef4444':'#9ca3af';
  const compileMs = res.submission.compileMs!=null?` compile ${res.submission.compileMs}ms`:'';
  const sumRun = (res.submission.results||[]).reduce((a,b)=>a+(b.runMs||0),0);
  submitMsg.innerHTML = `<span style="color:${color};font-weight:600">${st.toUpperCase()}</span> • ${res.submission.pass}/${res.submission.total}${compileMs}, run Σ ${sumRun}ms`;
});

/* subs page — แบบเดิม แต่ไม่เฉลย */
async function loadMySubs(){
  const r = await api('/api/my/submissions');
  subsWrap.innerHTML = '';
  if(!r.ok) return;

  r.submissions.forEach(s=>{
    const when = new Date(s.createdAt).toLocaleString();
    const el = document.createElement('div');
    el.className = 'card p-3';

    // แถบหัว: สถานะรวม + ภาษา + สัดส่วนผ่าน/ทั้งหมด + เวลา
    el.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <span class="dot ${
            s.status==='green'?'d-green':s.status==='yellow'?'d-yellow':s.status==='red'?'d-red':'d-gray'
          }"></span>
          <b>${s.language.toUpperCase()}</b> • ${s.pass}/${s.total} • ${when}
          ${s.status==='gray' ? '<span class="ml-2 text-sm opacity-70">(compile error)</span>' : ''}
        </div>
      </div>

      <!-- แถบผลเคสแบบจุดสี (ไม่เฉลยเนื้อหา) -->
      <div class="mt-2 flex flex-wrap items-center gap-1" id="caseStrip"></div>

      <!-- สรุปเวลาแบบย่อ -->
      <div class="mt-2 text-xs opacity-70" id="timeSum"></div>
    `;

    // จุดสีต่อเคส: PASS=เขียว, FAIL=แดง, ถ้าไม่มี results เพราะคอมไพล์พังจะไม่โชว์เคส
    const strip = el.querySelector('#caseStrip');
    if (Array.isArray(s.results) && s.results.length) {
      s.results.forEach(t=>{
        const span = document.createElement('span');
        span.className = `dot ${t.pass ? 'd-green' : 'd-red'}`;
        span.title = `Test #${t.idx}: ${t.pass ? 'PASS' : 'FAIL'}`;
        strip.appendChild(span);
      });
    }

    // เวลา compile/run รวม (ไม่มีรายละเอียดต่อเคส)
    const sumRun = (s.results||[]).reduce((a,b)=>a+(b.runMs||0),0);
    el.querySelector('#timeSum').textContent =
      `compile ${s.compileMs!=null ? s.compileMs+'ms' : '-'} • run Σ ${sumRun}ms`;

    subsWrap.appendChild(el);
  });
}

/* admin */
async function renderAdmin(){
  // projects
  const r = await api('/api/projects');
  projList.innerHTML = '';
  pbProject.innerHTML = '';
  if(r.ok){
    r.projects.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between py-1 border-b';
      row.innerHTML = `
        <div>${p.name} <span class="opacity-60">(${p.slug})</span></div>
        <div class="flex items-center gap-2">
          <label class="text-sm opacity-80 flex items-center gap-2">
            เปิด <input type="checkbox" ${p.enabled?'checked':''}>
          </label>
          <button class="px-2 py-1 rounded-lg border delP">ลบ</button>
        </div>`;
      const chk = row.querySelector('input[type="checkbox"]');
      chk.addEventListener('change', async ()=>{
        await api('/api/admin/projects/toggle', { method:'POST', body: JSON.stringify({ id:p.id, enabled: chk.checked }) });
      });
      const delP = row.querySelector('.delP');
      delP.addEventListener('click', async ()=>{
        if(!confirm('ยืนยันลบโปรเจกต์นี้? โจทย์และซับมิทใต้โปรเจกต์นี้จะถูกลบด้วย')) return;
        await api('/api/admin/projects/delete', { method:'POST', body: JSON.stringify({ id: p.id }) });
        renderAdmin();
        await loadProjectsForSelect();
      });
      projList.appendChild(row);

      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = `${p.name} (${p.slug})`;
      pbProject.appendChild(opt);
    });
  }

  // users
  const u = await api('/api/admin/users');
  userList.innerHTML = '';
  if(u.ok){
    u.users.forEach(us=>{
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between py-1 border-b';
      row.innerHTML = `
        <div>${us.username} <span class="opacity-60">(${us.id.slice(0,8)})</span> ${us.isAdmin?'<b class="text-emerald-600 ml-1">admin</b>':''}</div>
        <div class="flex items-center gap-2">
          <button class="px-2 py-1 rounded-lg border toggle">${us.isAdmin?'ถอน admin':'ให้ admin'}</button>
          <button class="px-2 py-1 rounded-lg border del">ลบ</button>
        </div>`;
      row.querySelector('.toggle').addEventListener('click', async ()=>{
        await api('/api/admin/users/grant', { method:'POST', body: JSON.stringify({ userId: us.id, isAdmin: !us.isAdmin }) });
        renderAdmin();
      });
      row.querySelector('.del').addEventListener('click', async ()=>{
        if(!confirm('ยืนยันลบผู้ใช้?')) return;
        await api('/api/admin/users/delete', { method:'POST', body: JSON.stringify({ userId: us.id }) });
        renderAdmin();
      });
      userList.appendChild(row);
    });
  }

  // all submissions
  const s = await api('/api/admin/submissions');
  allSubs.innerHTML = '';
  if(s.ok){
    s.submissions.forEach(sub=>{
      const when = new Date(sub.createdAt).toLocaleString();
      const el = document.createElement('div');
      el.className = 'card p-2 mb-2';
      el.innerHTML = `
        <div><span>${pill(sub.status)}</span> ${sub.username} • ${sub.language.toUpperCase()} • ${sub.pass}/${sub.total} • ${when}</div>
        <details class="mt-1 text-sm">
          <summary>ดู log/โค้ด</summary>
          ${sub.compileLog ? `<pre class="mt-1 whitespace-pre-wrap">${escapeHtml(sub.compileLog)}</pre>`:''}
          ${sub.results.map(r=>`
            <div class="mt-1 border-t pt-1">
              <b>Test #${r.idx}</b> (run ${r.runMs??0} ms${r.timedOut? ', timeout':''})
              <br>input: <code>${escapeHtml(r.input)}</code>
              <br>expected: <code>${escapeHtml(r.expected)}</code>
              <br>got: <code>${escapeHtml(r.got||'')}</code>
              ${r.error? `<br>error: <code>${escapeHtml(r.error)}</code>`:''}
              <br>pass: ${r.pass}
            </div>
          `).join('')}
          <details class="mt-1"><summary>ดูโค้ดที่ส่ง</summary><pre class="mt-1 whitespace-pre-wrap">${escapeHtml(sub.code||'')}</pre></details>
        </details>
      `;
      allSubs.appendChild(el);
    });
  }
  // problems (all)
  const pr = await api('/api/admin/problems');
  if (typeof pbList !== 'undefined') pbList.innerHTML = '';
  if (pr.ok) {
    if (!pr.problems || pr.problems.length === 0) {
      if (pbList) pbList.textContent = 'ยังไม่มีโจทย์';
    } else {
      pr.problems.forEach(pb => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between py-1 border-b';
        row.innerHTML = `
          <div>
            <b>${pb.title}</b> <span class="opacity-60">(${pb.projectName}${pb.projectEnabled?'':', ปิดอยู่'})</span>
            <a class="link ml-2" href="${pb.pdfUrl}" target="_blank">PDF</a>
          </div>
          <div class="flex items-center gap-2">
            <button class="px-2 py-1 rounded-lg border delPb">ลบ</button>
          </div>
        `;
        row.querySelector('.delPb').addEventListener('click', async ()=>{
          if(!confirm('ยืนยันลบโจทย์นี้? ซับมิทที่เกี่ยวข้องจะถูกลบด้วย')) return;
          await api('/api/admin/problems/delete', { method:'POST', body: JSON.stringify({ id: pb.id }) });
          renderAdmin();
        });
        if (pbList) pbList.appendChild(row);
      });
    }
  }
}
createProj.addEventListener('click', async ()=>{
  const r = await api('/api/admin/projects/create', {
    method:'POST',
    body: JSON.stringify({ name: projName.value.trim(), slug: projSlug.value.trim(), enabled: projEnabled.checked })
  });
  if(r.ok){ projName.value=''; projSlug.value=''; projEnabled.checked=false; renderAdmin(); } else alert('สร้างโปรเจกต์ไม่สำเร็จ');
});
createPb.addEventListener('click', async ()=>{
  const fd = new FormData();
  fd.append('title', pbTitle.value.trim());
  fd.append('projectId', pbProject.value);
  fd.append('testsText', pbTests.value);
  if(pbPdf.files[0]) fd.append('pdf', pbPdf.files[0]);
  const res = await fetch('/api/admin/problems/create', { method:'POST', body: fd });
  const r = await res.json();
  if(r.ok){ pbTitle.value=''; pbTests.value=''; pbPdf.value=''; alert('สร้างโจทย์สำเร็จ'); } else alert('สร้างโจทย์ไม่สำเร็จ: '+(r.error||''));
});

/* helper for admin init */
async function loadPbProjectForAdmin(){
  const r = await api('/api/projects');
  if(!r.ok) return;
  // จะ populate ตอน renderAdmin อีกครั้ง
}
