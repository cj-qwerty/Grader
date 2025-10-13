// graders/grader_py.js
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { scanPythonCode, runtimeShellPrefix, maybeSandbox } from '../security/policy.js';

const pexec = promisify(exec);

export async function gradePY(sourceCode, tests, workdir) {
  // สแกนคำสั่งต้องห้าม
  const scan = scanPythonCode(sourceCode || '');
  if (!scan.ok) {
    return {
      compileOk: false,
      compileLog: `Forbidden APIs in Python: ${scan.hits.join(', ').slice(0, 500)}`,
      compileMs: 0,
      results: []
    };
  }

  const src = path.join(workdir, 'main.py');
  await fs.writeFile(src, sourceCode, 'utf-8');

  const results = [];
  for (let i = 0; i < tests.length; i++) {
    const { input, expected } = tests[i];
    try {
      const inFile = path.join(path.dirname(src), `in_${i}.txt`);
      await fs.writeFile(inFile, input ?? '', 'utf-8');

      // -I: isolated mode (ไม่อ่าน user site), -B: ไม่เขียน .pyc, -S: ไม่โหลด site
      const cmd = `python3 -I -B -S "${src}" < "${inFile}"`;
      const shell = runtimeShellPrefix() + maybeSandbox(`timeout 2s ${cmd}`);

      const r0 = Date.now();
      const { stdout } = await pexec(`bash -lc '${shell}'`, {
        timeout: 5000, maxBuffer: 5 * 1024 * 1024
      });
      const runMs = Date.now() - r0;

      const out = (stdout ?? '').replace(/\r\n/g, '\n').trim();
      const exp = (expected ?? '').replace(/\r\n/g, '\n').trim();
      results.push({ idx: i + 1, input, expected, got: out, pass: out === exp, runMs, exitCode: 0, signal: null, timedOut: false });
    } catch (e) {
      results.push({
        idx: i + 1, input, expected,
        got: (e.stdout || '').toString().trim(),
        pass: false,
        error: (e.stderr || e.message || '').slice(0, 1000),
        runMs: 0,
        exitCode: e.code ?? null,
        signal: e.signal ?? null,
        timedOut: !!e.killed
      });
    }
  }
  return { compileOk: true, compileLog: '', results, compileMs: null };
}
