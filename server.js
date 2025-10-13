// server.js
import express from 'express';
import session from 'express-session';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import multer from 'multer';
import sanitize from 'sanitize-filename';
import { v4 as uuid } from 'uuid';
import rateLimit from 'express-rate-limit';
import fs from 'fs/promises';
import fssync from 'fs';
import os from 'os';

import { readJSON, writeJSON, ensureFile } from './utils/storage.js';
import { gradeCPP } from './graders/grader_cpp.js';
import { gradePY } from './graders/grader_py.js';
import { scanPythonCode } from './security/policy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA = path.join(__dirname, 'data');
const UP_PDF = path.join(__dirname, 'uploads', 'pdfs');
await fs.mkdir(UP_PDF, { recursive: true });

const USERS = path.join(DATA, 'users.json');
const PROJECTS = path.join(DATA, 'projects.json');
const PROBLEMS = path.join(DATA, 'problems.json');
const SUBMISSIONS = path.join(DATA, 'submissions.json');

await ensureFile(USERS, '[]');
await ensureFile(PROJECTS, '[]');
await ensureFile(PROBLEMS, '[]');
await ensureFile(SUBMISSIONS, '[]');

const app = express();

/* Security + DoS */
app.use(helmet({ contentSecurityPolicy: false }));
const limiter = rateLimit({
  windowMs: 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

/* Body & Session (เพิ่มลิมิตเป็น 5MB) */
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));
app.use(session({
  secret: 'CHANGE_ME_RANDOM_LONG_SECRET',
  resave: false,
  saveUninitialized: false,
}));

/* Static */
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/pdf', express.static(UP_PDF));

/* Multer PDF */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UP_PDF),
  filename: (req, file, cb) => {
    const safe = sanitize(file.originalname).replace(/\s+/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => (/\.pdf$/i.test(file.originalname) ? cb(null, true) : cb(new Error('PDF only')))
});

/* Helpers */
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user?.isAdmin) return res.status(403).json({ ok: false, error: 'forbidden' });
  next();
}
async function maybePromoteFirstUser() {
  const users = await readJSON(USERS, []);
  if (users.length === 1 && users[0].isAdmin !== true) {
    users[0].isAdmin = true;
    await writeJSON(USERS, users);
  }
}

/* Queue (จำกัดงานพร้อมกันเพื่อความลื่น) */
const jobQ = [];
let running = 0;
const MAX_CONCURRENCY = Math.max(1, Math.min(2, (os.cpus()?.length) || 1));
function enqueue(fn) {
  return new Promise((resolve, reject) => {
    jobQ.push({ fn, resolve, reject });
    pump();
  });
}
async function pump() {
  if (running >= MAX_CONCURRENCY) return;
  const job = jobQ.shift();
  if (!job) return;
  running++;
  try {
    const val = await job.fn();
    job.resolve(val);
  } catch (e) {
    job.reject(e);
  } finally {
    running--;
    setImmediate(pump);
  }
}

/* Auth */
app.post('/api/register', async (req, res) => {
  const { username, password, confirm } = req.body || {};
  if (!username || !password || !confirm) return res.json({ ok: false, error: 'missing_fields' });
  if (password !== confirm) return res.json({ ok: false, error: 'password_mismatch' });
  if (!/\d/.test(password)) return res.json({ ok: false, error: 'password_need_digit' });

  const users = await readJSON(USERS, []);
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.json({ ok: false, error: 'username_taken' });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = { id: uuid(), username, passhash: hash, isAdmin: users.length === 0 };
  users.push(user);
  await writeJSON(USERS, users);
  await maybePromoteFirstUser();
  req.session.user = { id: user.id, username: user.username, isAdmin: user.isAdmin };
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const users = await readJSON(USERS, []);
  const u = users.find(x => x.username.toLowerCase() === (username || '').toLowerCase());
  if (!u) return res.json({ ok: false, error: 'invalid_login' });
  const ok = await bcrypt.compare(password || '', u.passhash);
  if (!ok) return res.json({ ok: false, error: 'invalid_login' });
  req.session.user = { id: u.id, username: u.username, isAdmin: !!u.isAdmin };
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: req.session.user || null });
});

/* Admin: Users */
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await readJSON(USERS, []);
  res.json({ ok: true, users: users.map(({ passhash, ...u }) => u) });
});
app.post('/api/admin/users/grant', requireAuth, requireAdmin, async (req, res) => {
  const { userId, isAdmin } = req.body || {};
  const users = await readJSON(USERS, []);
  const u = users.find(x => x.id === userId);
  if (!u) return res.json({ ok: false, error: 'not_found' });
  u.isAdmin = !!isAdmin;
  await writeJSON(USERS, users);
  res.json({ ok: true });
});
app.post('/api/admin/users/delete', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.body || {};
  let users = await readJSON(USERS, []);
  users = users.filter(u => u.id !== userId);
  await writeJSON(USERS, users);
  res.json({ ok: true });
});

/* Projects */
app.get('/api/projects', requireAuth, async (req, res) => {
  const projects = await readJSON(PROJECTS, []);
  res.json({ ok: true, projects });
});
app.post('/api/admin/projects/create', requireAuth, requireAdmin, async (req, res) => {
  const { name, slug, enabled } = req.body || {};
  if (!name || !slug) return res.json({ ok: false, error: 'missing' });
  const projects = await readJSON(PROJECTS, []);
  if (projects.find(p => p.slug === slug)) return res.json({ ok: false, error: 'slug_taken' });
  const p = { id: uuid(), name, slug, enabled: !!enabled };
  projects.push(p);
  await writeJSON(PROJECTS, projects);
  res.json({ ok: true, project: p });
});
app.post('/api/admin/projects/toggle', requireAuth, requireAdmin, async (req, res) => {
  const { id, enabled } = req.body || {};
  const projects = await readJSON(PROJECTS, []);
  const p = projects.find(x => x.id === id);
  if (!p) return res.json({ ok: false, error: 'not_found' });
  p.enabled = !!enabled;
  await writeJSON(PROJECTS, projects);
  res.json({ ok: true });
});

/* Admin: list problems (all, including disabled projects) */
app.get('/api/admin/problems', requireAuth, requireAdmin, async (req, res) => {
  const problems = await readJSON(PROBLEMS, []);
  const projects = await readJSON(PROJECTS, []);
  const mapProj = new Map(projects.map(p => [p.id, p]));
  const withNames = problems.map(pb => ({
    ...pb,
    projectName: mapProj.get(pb.projectId)?.name || '(unknown)',
    projectEnabled: !!mapProj.get(pb.projectId)?.enabled
  }));
  res.json({ ok: true, problems: withNames.sort((a,b)=>b.createdAt-a.createdAt) });
});

/* Admin: delete ONE problem (also remove its PDF and related submissions) */
app.post('/api/admin/problems/delete', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.json({ ok:false, error:'missing_id' });

  const problems = await readJSON(PROBLEMS, []);
  const idx = problems.findIndex(p => p.id === id);
  if (idx < 0) return res.json({ ok:false, error:'not_found' });

  const pb = problems[idx];

  // delete PDF on disk
  try {
    const base = path.basename(pb.pdfUrl || '');
    const filePath = path.join(UP_PDF, base);
    if (base && fssync.existsSync(filePath)) await fs.unlink(filePath);
  } catch {}

  // remove submissions of this problem
  let subs = await readJSON(SUBMISSIONS, []);
  const before = subs.length;
  subs = subs.filter(s => s.problemId !== id);
  const removedSubs = before - subs.length;
  await writeJSON(SUBMISSIONS, subs);

  // remove problem
  problems.splice(idx, 1);
  await writeJSON(PROBLEMS, problems);

  res.json({ ok:true, removedSubs });
});

/* Admin: delete ONE project (also remove its problems, PDFs, and related submissions) */
app.post('/api/admin/projects/delete', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.json({ ok:false, error:'missing_id' });

  // remove project
  let projects = await readJSON(PROJECTS, []);
  const p = projects.find(x => x.id === id);
  if (!p) return res.json({ ok:false, error:'not_found' });
  projects = projects.filter(x => x.id !== id);
  await writeJSON(PROJECTS, projects);

  // remove problems under this project + PDFs
  let problems = await readJSON(PROBLEMS, []);
  const toRemove = problems.filter(pb => pb.projectId === id);
  for (const pb of toRemove) {
    try {
      const base = path.basename(pb.pdfUrl || '');
      const filePath = path.join(UP_PDF, base);
      if (base && fssync.existsSync(filePath)) await fs.unlink(filePath);
    } catch {}
  }
  problems = problems.filter(pb => pb.projectId !== id);
  await writeJSON(PROBLEMS, problems);

  // remove submissions of those problems
  let subs = await readJSON(SUBMISSIONS, []);
  const pbIds = new Set(toRemove.map(pb => pb.id));
  const before = subs.length;
  subs = subs.filter(s => !pbIds.has(s.problemId));
  const removedSubs = before - subs.length;
  await writeJSON(SUBMISSIONS, subs);

  res.json({ ok:true, removedProblems: toRemove.length, removedSubs });
});

/* Problems */
app.get('/api/problems', requireAuth, async (req, res) => {
  const problems = await readJSON(PROBLEMS, []);
  const projects = await readJSON(PROJECTS, []);
  const mapProj = new Map(projects.map(p => [p.id, p]));
  const visible = problems.filter(pb => mapProj.get(pb.projectId)?.enabled);
  res.json({ ok: true, problems: visible });
});
app.get('/api/problems/byProject', requireAuth, async (req, res) => {
  const { projectId } = req.query || {};
  if (!projectId) return res.json({ ok: false, error: 'missing_project' });
  const problems = await readJSON(PROBLEMS, []);
  const projects = await readJSON(PROJECTS, []);
  const proj = projects.find(p => p.id === projectId && p.enabled);
  if (!proj) return res.json({ ok: true, problems: [] });
  const filtered = problems.filter(pb => pb.projectId === projectId);
  res.json({ ok: true, problems: filtered });
});
app.post('/api/admin/problems/create', requireAuth, requireAdmin, upload.single('pdf'), async (req, res) => {
  const { title, projectId, testsText } = req.body || {};
  if (!title || !projectId || !req.file) return res.json({ ok: false, error: 'missing_fields_or_pdf' });

  const tests = [];
  const lines = (testsText || '').split(/\r?\n/);
  let lineNo = 0;
  for (const line of lines) {
    lineNo++;
    const t = line.trim();
    if (!t) continue;
    const m = t.split(/\s*=>\s*/);
    if (m.length < 2) {
      return res.json({ ok: false, error: `bad_test_line_${lineNo}` });
    }
    tests.push({ input: m[0], expected: m[1], line: lineNo });
  }

  const problems = await readJSON(PROBLEMS, []);
  const pdfUrl = `/pdf/${path.basename(req.file.path)}`;
  const pb = { id: uuid(), title, projectId, pdfUrl, tests, createdAt: Date.now() };
  problems.push(pb);
  await writeJSON(PROBLEMS, problems);
  res.json({ ok: true, problem: pb });
});

/* Submit */
app.post('/api/submit', requireAuth, async (req, res) => {
  const { problemId, language, code } = req.body || {};
  if (!problemId || !language) return res.json({ ok: false, error: 'missing' });

  const problems = await readJSON(PROBLEMS, []);
  const pb = problems.find(p => p.id === problemId);
  if (!pb) return res.json({ ok: false, error: 'problem_not_found' });

  const runBase = fssync.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
  const runDir = path.join(runBase, `grader-${uuid()}`);
  await fs.mkdir(runDir, { recursive: true });

  const OVERALL_MS = 15000;

  let result;
  try {
    const jobPromise = enqueue(async () => {
      if (language === 'cpp') return await gradeCPP(code || '', pb.tests, runDir);
      if (language === 'py')  {
        // API-level scan to reject forbidden Python APIs early
        const sc = scanPythonCode(code || '');
        if (!sc.ok) throw new Error('forbidden_python_api:' + sc.hits.join(','));
        return await gradePY(code || '', pb.tests, runDir);
      }
      throw new Error('lang_not_supported');
    });
    result = await Promise.race([
      jobPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('overall_timeout')), OVERALL_MS))
    ]);
  } catch (e) {
    return res.json({ ok:false, error:'runner_error', detail: String(e.message||e).slice(0,300) });
  }

  const total = pb.tests.length;
  const pass = result.results.filter(r => r.pass).length;
  let status = 'yellow';
  if (!result.compileOk) status = 'gray';
  else if (pass === 0) status = 'red';
  else if (pass === total) status = 'green';

  const submissions = await readJSON(SUBMISSIONS, []);
  const sub = {
    id: uuid(),
    userId: req.session.user.id,
    username: req.session.user.username,
    problemId,
    language,
    code: (code || '').slice(0, 200_000),
    compileLog: result.compileLog || '',
    compileMs: result.compileMs ?? null,
    results: result.results,
    pass, total, status,
    createdAt: Date.now()
  };
  submissions.push(sub);
  await writeJSON(SUBMISSIONS, submissions);

  res.json({ ok: true, submission: sub });
});

/* Submissions (mine/admin) */
app.get('/api/my/submissions', requireAuth, async (req, res) => {
  const submissions = await readJSON(SUBMISSIONS, []);
  const mine = submissions.filter(s => s.userId === req.session.user.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ ok: true, submissions: mine });
});
app.get('/api/admin/submissions', requireAuth, requireAdmin, async (req, res) => {
  const submissions = await readJSON(SUBMISSIONS, []);
  res.json({ ok: true, submissions: submissions.sort((a, b) => b.createdAt - a.createdAt) });
});

/* Web page */
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // listen on all interfaces for LAN access
app.listen(PORT, HOST, () => console.log(`Grader running on http://${HOST}:${PORT}`));
