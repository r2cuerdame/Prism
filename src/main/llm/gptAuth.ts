import { spawn } from 'node:child_process';
import type { AuthMethod } from '@shared/ipc';

interface RunResult {
  code: number | null;
  out: string;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { shell: true, windowsHide: true });
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

const NOT_FOUND_RE =
  /not recognized|찾을 수 없|인식되지 않|아닙니다|command not found|not found|ENOENT/i;

/** cmd.exe reports a missing executable as 9009, POSIX shells as 127. */
const isMissingCli = (r: RunResult): boolean =>
  r.code === null || r.code === 9009 || r.code === 127 || NOT_FOUND_RE.test(r.out);

/** `codex login status` prints this (and may still exit 0) when signed out. */
const SIGNED_OUT_RE = /not logged in/i;

const isSignedIn = (r: RunResult): boolean =>
  !isMissingCli(r) && r.code === 0 && !SIGNED_OUT_RE.test(r.out);

/**
 * Which GPT credential is active. The Codex CLI is the source of truth: the
 * app itself holds no key, it borrows the user's ChatGPT-account session.
 * An explicit key is still honoured for the advanced path.
 */
export async function detectAuth(
  storedKey: string | undefined
): Promise<{ method: AuthMethod; detail: string; derivedKey?: string }> {
  if (storedKey) return { method: 'api-key', detail: '앱에 저장된 키' };
  if (process.env.OPENAI_API_KEY) {
    return { method: 'env-key', detail: 'OPENAI_API_KEY 환경 변수' };
  }
  const status = await run('codex', ['login', 'status'], 15_000);
  if (isMissingCli(status)) {
    return { method: 'none', detail: 'Codex CLI가 없어 오프라인 구성으로 동작 중이에요' };
  }
  if (isSignedIn(status)) {
    return { method: 'oauth', detail: 'Codex(ChatGPT) 계정으로 로그인됨' };
  }
  return { method: 'none', detail: 'Codex에 로그인하면 여러 소스를 합성해 드려요' };
}

/**
 * Start the ChatGPT-account sign-in: the Codex CLI's OAuth flow opens the
 * system browser, so this can sit for a long time before it returns.
 */
export async function runOauthLogin(): Promise<{ ok: boolean; message: string }> {
  const probe = await run('codex', ['--version'], 8_000);
  if (isMissingCli(probe)) {
    return {
      ok: false,
      message:
        'ChatGPT 로그인에 필요한 Codex CLI를 찾지 못했어요. 터미널에서 `npm i -g @openai/codex` 로 설치한 뒤 다시 시도해 주세요.'
    };
  }
  const login = await run('codex', ['login'], 300_000);
  const after = await run('codex', ['login', 'status'], 15_000);
  if (isSignedIn(after)) {
    return { ok: true, message: 'Codex(ChatGPT) 계정이 연결됐어요. 이제 합성 플래너가 켜집니다.' };
  }
  const tail =
    login.out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? '';
  return {
    ok: false,
    message: `로그인이 완료되지 않았어요${tail ? ` — ${tail.slice(0, 120)}` : ''}`
  };
}
