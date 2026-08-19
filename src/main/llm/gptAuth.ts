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
      // Strip colour here so every caller's matching works on plain text.
      resolve({ code, out: stripAnsi(out) });
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

/** The CLI colours its output, so every match must run on stripped text. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/;
/** Device-code shape as the CLI prints it, e.g. 0EYV-1XY86. */
const DEVICE_CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4,8})\b/;

/**
 * Pull the sign-in URL and one-time code out of `codex login --device-auth`
 * output. Exported so the real CLI's (coloured) wording is covered by a test.
 */
export function parseDeviceLogin(raw: string): { url?: string; code?: string } {
  const plain = stripAnsi(raw);
  return {
    url: plain.match(URL_RE)?.[0],
    code: plain.match(DEVICE_CODE_RE)?.[1]
  };
}

export interface LoginOptions {
  /**
   * Called with the sign-in URL as soon as the CLI prints it. Spawned from a
   * GUI process the CLI's own browser launch often does nothing visible, so
   * the caller opens it — otherwise the user just sees silence.
   */
  onUrl?: (url: string) => void;
}

export interface LoginResult {
  ok: boolean;
  message: string;
  /** Present when a sign-in URL was seen, so the UI can show it verbatim. */
  url?: string;
}

/**
 * Start the ChatGPT-account sign-in. Device auth is used because it prints a
 * URL and a code instead of depending on a local callback the CLI opened
 * itself, which is the mode that survives being spawned from Electron.
 */
export async function runOauthLogin(opts: LoginOptions = {}): Promise<LoginResult> {
  const probe = await run('codex', ['--version'], 8_000);
  if (isMissingCli(probe)) {
    return {
      ok: false,
      message:
        'Codex CLI를 찾지 못했어요. 터미널에서 `npm i -g @openai/codex` 로 설치한 뒤 다시 시도해 주세요.'
    };
  }

  const login = await runStreaming('codex', ['login', '--device-auth'], 300_000, (all, seen) => {
    if (seen.url !== undefined) return;
    // Rescan everything received so far: a chunk boundary can split the URL.
    const found = parseDeviceLogin(all).url;
    if (found !== undefined) {
      seen.url = found;
      opts.onUrl?.(found);
    }
  });

  const after = await run('codex', ['login', 'status'], 15_000);
  if (isSignedIn(after)) {
    return { ok: true, message: 'Codex 계정이 연결됐어요. 이제 합성 플래너가 켜집니다.' };
  }

  // A code is what device auth asks the user to type — surface it verbatim.
  const plain = stripAnsi(login.out);
  const code = parseDeviceLogin(login.out).code;
  if (login.url !== undefined) {
    return {
      ok: false,
      url: login.url,
      message: code
        ? `브라우저에서 코드 ${code} 를 입력해 로그인을 마친 뒤 "상태 새로고침"을 눌러 주세요.`
        : '브라우저에서 로그인을 마친 뒤 "상태 새로고침"을 눌러 주세요.'
    };
  }
  const tail =
    plain
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? '';
  return {
    ok: false,
    message: `로그인이 완료되지 않았어요${tail ? ` — ${tail.slice(0, 160)}` : ''}`
  };
}

/**
 * Like `run`, but reports the accumulated output as it arrives so a sign-in
 * URL can be opened the moment the CLI prints it.
 */
function runStreaming(
  cmd: string,
  args: string[],
  timeoutMs: number,
  onOutput: (accumulated: string, seen: { url?: string }) => void
): Promise<RunResult & { url?: string }> {
  return new Promise((resolve) => {
    const seen: { url?: string } = {};
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
    const take = (d: unknown): void => {
      out += String(d);
      onOutput(out, seen);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, out, url: seen.url });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, url: seen.url });
    });
  });
}
