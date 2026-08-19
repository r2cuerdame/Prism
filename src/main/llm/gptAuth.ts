import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
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

const NOT_FOUND_RE = /not recognized|찾을 수 없|없습니다|command not found|ENOENT/i;

/** Path the Codex CLI writes its ChatGPT-account session to. */
const CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json');

async function readCodexAuth(): Promise<{ signedIn: boolean; apiKey?: string }> {
  try {
    const raw = await readFile(CODEX_AUTH_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return { signedIn: false };
    const obj = parsed as Record<string, unknown>;
    // The file holds either an API key or ChatGPT-account OAuth tokens.
    const apiKey = typeof obj.OPENAI_API_KEY === 'string' ? obj.OPENAI_API_KEY : undefined;
    const hasTokens = obj.tokens !== undefined && obj.tokens !== null;
    return { signedIn: Boolean(apiKey) || hasTokens, apiKey };
  } catch {
    return { signedIn: false };
  }
}

/**
 * Which GPT credential is active. An explicit key always wins; otherwise we
 * look for a ChatGPT-account session written by the Codex CLI.
 */
export async function detectAuth(
  storedKey: string | undefined
): Promise<{ method: AuthMethod; detail: string; derivedKey?: string }> {
  if (storedKey) return { method: 'api-key', detail: '앱에 저장된 키' };
  if (process.env.OPENAI_API_KEY) {
    return { method: 'env-key', detail: 'OPENAI_API_KEY 환경 변수' };
  }
  const codex = await readCodexAuth();
  if (codex.signedIn && codex.apiKey) {
    return { method: 'oauth', detail: 'ChatGPT 계정 로그인', derivedKey: codex.apiKey };
  }
  if (codex.signedIn) {
    // Session tokens exist but carry no API key, so they cannot drive API
    // calls. Say so instead of showing a green light over the offline planner.
    return {
      method: 'none',
      detail: 'ChatGPT 로그인은 있지만 API 키가 없어 오프라인 구성으로 동작 중이에요'
    };
  }
  return { method: 'none', detail: '' };
}

/**
 * Start the ChatGPT-account sign-in. This is the Codex CLI's OAuth flow: it
 * opens the system browser and writes a session to ~/.codex/auth.json.
 */
export async function runOauthLogin(): Promise<{ ok: boolean; message: string }> {
  const probe = await run('codex', ['--version'], 8000);
  if (probe.code === null || NOT_FOUND_RE.test(probe.out)) {
    return {
      ok: false,
      message:
        'ChatGPT 로그인에 필요한 Codex CLI를 찾지 못했어요. `npm i -g @openai/codex` 로 설치한 뒤 다시 시도하거나, 설정의 고급 항목에서 API 키를 넣어 주세요.'
    };
  }
  const r = await run('codex', ['login'], 300_000);
  if (r.code === 0) {
    const after = await readCodexAuth();
    if (after.signedIn) {
      return { ok: true, message: 'ChatGPT 계정이 연결됐어요. 이제 합성 플래너가 켜집니다.' };
    }
  }
  const tail =
    r.out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? '';
  return {
    ok: false,
    message: `로그인이 완료되지 않았어요${tail ? ` — ${tail.slice(0, 120)}` : ''}`
  };
}
