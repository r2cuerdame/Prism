import { spawn } from 'node:child_process';

export interface AgyStatus {
  /** The CLI answered `--version`, so print-mode calls can be attempted. */
  ready: boolean;
  version: string;
  /** Korean one-liner for the settings panel. */
  detail: string;
}

const NOT_FOUND_RE =
  /not recognized|찾을 수 없|인식되지 않|아닙니다|command not found|not found|ENOENT/i;

function probe(timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('agy', ['--version'], { shell: false, windowsHide: true });
    } catch {
      resolve({ code: null, out: '' });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.stdout?.on('data', (d) => (out += String(d)));
    child.stderr?.on('data', (d) => (out += String(d)));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, out });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** Pure: pull "1.1.28" out of whatever `agy --version` prints. */
export function parseAgyVersion(raw: string): string {
  const m = raw.match(/\b(\d+\.\d+(?:\.\d+)?)\b/);
  return m ? m[1]! : '';
}

/**
 * Is the AGY CLI usable? Presence is the readiness signal: print mode owns
 * its own sign-in, and a missing account surfaces as a failed call that the
 * offline planner covers. Never throws.
 */
export async function detectAgy(): Promise<AgyStatus> {
  const r = await probe(8_000);
  const missing = r.code === null || r.code === 127 || r.code === 9009 || NOT_FOUND_RE.test(r.out);
  if (missing || r.code !== 0) {
    return {
      ready: false,
      version: '',
      detail: 'AGY CLI(agy)를 찾지 못해 오프라인 구성으로 동작 중이에요'
    };
  }
  const version = parseAgyVersion(r.out);
  return {
    ready: true,
    version,
    detail: version ? `AGY CLI v${version} 사용 가능` : 'AGY CLI 사용 가능'
  };
}
