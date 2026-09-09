import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { z } from 'zod';
import { toJSONSchema } from 'zod';
import type { LlmEffort, LlmRunner } from './llmRunner';
import { strictJsonSchema } from './codexRunner';

/**
 * Default provider: the AGY CLI in print mode. `agy --print <prompt>
 * --output-format json --json-schema <file>` runs one headless turn and
 * prints a machine-readable envelope whose final result is constrained to
 * our schema. The app never holds a key; the CLI owns the account.
 */
export const DEFAULT_AGY_MODEL = 'gemini-3.8-flash-medium';

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Windows hands the whole argv to CreateProcess as one string capped near
 * 32K characters; the prompt travels as an argument, so anything past this
 * budget cannot be sent and the offline planner should answer instead.
 */
export const MAX_PROMPT_CHARS = 30_000;

export interface AgyArgOptions {
  prompt: string;
  schemaFile: string;
  model: string;
  effort?: LlmEffort;
  timeoutMs?: number;
}

export function buildAgyArgs(o: AgyArgOptions): string[] {
  const seconds = Math.max(5, Math.ceil((o.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000));
  return [
    '--print',
    o.prompt,
    '--output-format',
    'json',
    '--json-schema',
    o.schemaFile,
    '--model',
    o.model,
    // A prompt that happens to start with "/" must never expand a skill.
    '--disable-slash-commands',
    '--print-timeout',
    `${seconds}s`,
    ...(o.effort && o.effort !== 'none' ? ['--effort', o.effort] : [])
  ];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The model sometimes wraps its JSON answer in a markdown fence. */
function unfence(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith('```')) return text;
  return text
    .replace(/^```[A-Za-z0-9_-]*[ \t]*\r?\n?/, '')
    .replace(/```[ \t]*$/, '')
    .trim();
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Envelope keys, in the order print mode is likely to nest the answer. */
const RESULT_KEYS = [
  'structured_output',
  'structuredOutput',
  'result',
  'response',
  'output',
  'content',
  'text',
  'message',
  'final',
  'data'
];

/**
 * Walk an envelope looking for a value the schema accepts: the value itself,
 * a JSON string holding it, or one of the well-known result fields (depth
 * bounded so a pathological payload cannot recurse forever).
 */
function extract<T>(value: unknown, schema: z.ZodType<T>, depth: number): T | null {
  if (depth > 5) return null;
  const direct = schema.safeParse(value);
  if (direct.success) return direct.data;
  if (typeof value === 'string') {
    const inner = tryJson(unfence(value));
    if (inner !== undefined && inner !== value) return extract(inner, schema, depth + 1);
    return null;
  }
  if (Array.isArray(value)) {
    // Stream shape: last event that yields an answer wins.
    for (let i = value.length - 1; i >= 0; i--) {
      const found = extract(value[i], schema, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const key of RESULT_KEYS) {
      if (!(key in value)) continue;
      const found = extract(value[key], schema, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Pure: turn whatever the CLI printed into a schema-valid object, or null. */
export function parseAgyOutput<T>(raw: string, schema: z.ZodType<T>): T | null {
  const text = raw.trim();
  if (text === '') return null;

  const whole = tryJson(unfence(text));
  if (whole !== undefined) {
    const found = extract(whole, schema, 0);
    if (found !== null) return found;
  }

  // NDJSON: one event per line, the answer usually on the last parseable one.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const events: unknown[] = [];
    for (const line of lines) {
      const ev = tryJson(line);
      if (ev !== undefined) events.push(ev);
    }
    if (events.length > 0) {
      const found = extract(events, schema, 0);
      if (found !== null) return found;
    }
  }

  // Last resort: the outermost braces.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const braced = tryJson(text.slice(start, end + 1));
    if (braced !== undefined) return extract(braced, schema, 0);
  }
  return null;
}

interface SpawnResult {
  code: number | null;
  stdout: string;
}

function spawnAgy(args: string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      // No shell: the prompt is passed verbatim, so cmd.exe metacharacters
      // and quoting never bite. libuv resolves `agy` → agy.exe via PATH.
      child = spawn('agy', args, { shell: false, windowsHide: true });
    } catch {
      resolve({ code: null, stdout: '' });
      return;
    }
    let stdout = '';
    let settled = false;
    const settle = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    // The CLI honours --print-timeout itself; this is the hard stop above it.
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      settle(null);
    }, timeoutMs + 15_000);
    child.stdout?.on('data', (d: Buffer | string) => {
      stdout += String(d);
    });
    child.stderr?.on('data', () => {
      /* diagnostics only; never part of the answer */
    });
    child.on('error', () => settle(null));
    child.on('close', (code) => settle(code));
    const stdin = child.stdin;
    if (stdin) {
      stdin.on('error', () => undefined);
      try {
        stdin.end();
      } catch {
        /* nothing to send */
      }
    }
  });
}

export function createAgyRunner(opts: { ready: boolean; model?: string }): LlmRunner {
  const model = opts.model?.trim() || DEFAULT_AGY_MODEL;
  return {
    ready: opts.ready,
    provider: 'agy',
    model,
    async run<T>(
      schema: z.ZodType<T>,
      prompt: string,
      runOpts?: { timeoutMs?: number; effort?: LlmEffort }
    ): Promise<T | null> {
      if (!opts.ready) return null;
      if (prompt.length > MAX_PROMPT_CHARS) return null;
      const schemaFile = join(tmpdir(), `prism-agy-schema-${randomUUID()}.json`);
      try {
        const base = toJSONSchema(schema) as Record<string, unknown>;
        delete base.$schema;
        await writeFile(schemaFile, JSON.stringify(strictJsonSchema(base)), 'utf8');
        const timeoutMs = runOpts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const args = buildAgyArgs({
          prompt,
          schemaFile,
          model,
          effort: runOpts?.effort,
          timeoutMs
        });
        const res = await spawnAgy(args, timeoutMs);
        if (res.code !== 0) return null;
        return parseAgyOutput(res.stdout, schema);
      } catch {
        return null;
      } finally {
        await rm(schemaFile, { force: true }).catch(() => undefined);
      }
    }
  };
}
