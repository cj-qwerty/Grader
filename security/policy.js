// security/policy.js
export const cppForbiddenDefines = [
  'system','popen','pclose','fork','execve','execl','execlp','execv','execvp','execvpe',
  'socket','connect','accept','bind','listen','setsockopt','getsockopt','getaddrinfo'
].map(name => `-D${name}=__KAK_FORBIDDEN_${name.toUpperCase()}__`);

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
  /\bctypes\b|\bcffi\b/
];

export function scanPythonCode(src){
  const hits = pyForbiddenRegex.filter(rx => rx.test(src));
  return { ok: hits.length === 0, hits: hits.map(rx => rx.toString()).slice(0,10) };
}

export function runtimeShellPrefix() {
  // ulimit: cpu=2s, as(memory)=256MB, nproc=128, nfile=64, filesize=10MB, no core
  return `ulimit -t 2; ulimit -v 262144; ulimit -m 262144; ulimit -n 64; ulimit -f 10240; ulimit -c 0; `;
}

export function maybeSandbox(cmd) {
  // ถ้ามี firejail จะห่อด้วยคำสั่งเพื่อตัดเน็ตและจำกัดการเข้าถึง
  return `if command -v firejail >/dev/null 2>&1; then firejail --quiet --net=none --private --nosound --caps.drop=all -- seccomp -- ${cmd}; else ${cmd}; fi`;
}
