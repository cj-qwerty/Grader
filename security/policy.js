// /security/policy.js
// Policy ครอบคลุม C++ + Python + Sandbox (เวอร์ชันสมบูรณ์ ปลอดภัย)

// ------------------------------------------------------------------
// Compatibility — ป้องกัน grader_cpp.js เก่าเรียก cppForbiddenDefines แล้วพัง
export const cppForbiddenDefines = [];

// ------------------------------------------------------------------
// Regex สำหรับตรวจโค้ด C++
export const cppForbiddenRegex = [
  /\bsystem\s*\(/,
  /\bpopen\s*\(/,
  /\bpclose\s*\(/,
  /\bfork\s*\(/,
  /\bexec(v|le|lp|ve|vp|vpe)?\s*\(/,
  /\bsocket\s*\(/,
  /\bconnect\s*\(/,
  /\baccept\s*\(/,
  /\bbind\s*\(/,
  /\blisten\s*\(/,
  /\bgetaddrinfo\s*\(/,
  /#\s*include\s*<sys\//,
  /#\s*include\s*<arpa\//,
  /#\s*include\s*<netinet\//,
  /#\s*include\s*<unistd\.h>/,
  /\bopen\s*\(\s*["']\/(?:proc|etc|dev)/i,
  /\bfopen\s*\(\s*["']\/(?:proc|etc|dev)/i,
  /\bfreopen\s*\(/,
  /\bptrace\s*\(/,
];

// ฟังก์ชันตรวจโค้ด C++
export function scanCppCode(src = '') {
  const hits = [];
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    cppForbiddenRegex.forEach(rx => {
      if (rx.test(line)) hits.push({ line: i + 1, pattern: rx.toString(), code: line.trim() });
    });
  });
  return { ok: hits.length === 0, hits };
}

// ------------------------------------------------------------------
// Regex สำหรับตรวจโค้ด Python
export const pyForbiddenRegex = [
  /\bimport\s+os\b/,
  /\bfrom\s+os\b/,
  /\bos\.system\s*\(/,
  /\bos\.popen\s*\(/,
  /\bimport\s+subprocess\b/,
  /\bfrom\s+subprocess\b/,
  /\bsubprocess\./,
  /\bimport\s+socket\b/,
  /\bfrom\s+socket\b/,
  /open\s*\(\s*['"]\/(?:proc|etc|dev)/i,
  /\bctypes\b/,
  /\bcffi\b/,
  /\bimport\s+resource\b/,
  /\bimport\s+fcntl\b/,
];

// ฟังก์ชันตรวจโค้ด Python
export function scanPythonCode(src = '') {
  const hits = [];
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    pyForbiddenRegex.forEach(rx => {
      if (rx.test(line)) hits.push({ line: i + 1, pattern: rx.toString(), code: line.trim() });
    });
  });
  return { ok: hits.length === 0, hits };
}

// ------------------------------------------------------------------
// Sandbox settings
export function runtimeShellPrefix() {
  // จำกัด CPU, RAM, fd, file size, no core dump
  return `ulimit -t 2; ulimit -v 262144; ulimit -n 64; ulimit -f 10240; ulimit -c 0; `;
}

export function maybeSandbox(cmd) {
  // ใช้ firejail ถ้ามี (ตัด network + private FS + drop caps)
  return `if command -v firejail >/dev/null 2>&1; then \
firejail --quiet --net=none --private --nosound --caps.drop=all -- ${cmd}; \
else ${cmd}; fi`;
}
