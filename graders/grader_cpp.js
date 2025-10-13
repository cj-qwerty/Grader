// graders/grader_cpp.js
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { cppForbiddenDefines, runtimeShellPrefix, maybeSandbox } from '../security/policy.js';

const pexec = promisify(exec);

export async function gradeCPP(sourceCode, tests, workdir) {
  const src = path.join(workdir, 'main.cpp');
  const bin = path.join(workdir, 'a.out');
  await fs.writeFile(src, sourceCode, 'utf-8');

  const compileFlags = [
    '-O2','-pipe','-std=c++17','-s',
    ...cppForbiddenDefines
  ].join(' ');

  const t0 = Date.now();
  try {
    await pexec(`g++ ${compileFlags} -o "${bin}" "${src}"`, {
      timeout: 20000, cwd: workdir, maxBuffer: 5 * 1024 * 1024
    });
  } catch (e) {
    return {
      compileOk: false,
      compileMs: Date.now() - t0,
      compileLog: (e.stderr || e.stdout || '').slice(0, 8000),
      results: []
    };
  }
  const compileMs = Date.now() - t0;

  const results = [];
  for (let i = 0; i < tests.length; i++) {
    const { input, expected } = tests[i];
    try {
      const inFile = path.join(workdir, `in_${i}.txt`);
      await fs.writeFile(inFile, input ?? '', 'utf-8');

      const r0 = Date.now();
      const shell = runtimeShellPrefix() + maybeSandbox(`timeout 2s "${bin}" < "${inFile}"`);
      const { stdout } = await pexec(`bash -lc '${shell}'`, {
        timeout: 5000, cwd: workdir, maxBuffer: 5 * 1024 * 1024
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
  return { compileOk: true, compileMs, compileLog: '', results };
}
