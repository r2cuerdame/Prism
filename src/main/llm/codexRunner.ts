import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Optional legacy provider. The planner talks to the model through the
 * user's Codex CLI session, so the app never holds an API key: `codex exec`
 * runs the ChatGPT-account login non-interactively and writes its final
 * message to a file we read back. AGY (agyRunner) is the default.
 */
/**
 * Reasoning effort for one call. The user's CLI config may pin an interactive
 * default like "xhigh" (measured: a page plan takes ~101s there vs ~50s on
 * "low"), so app calls state how much thinking they actually need.
 */
import type { LlmEffort, LlmRunner } from './llmRunner';

export type CodexEffort = LlmEffort;
export type CodexRunner = LlmRunner;

const DEFAULT_TIMEOUT_MS = 120_000;

/** JSON Schema keywords whose value is a map of NAME -> schema. */
const SCHEMA_MAP_KEYS = ['properties', 'patternProperties', '$defs', 'definitions'];
/** Keywords whose value is an array of schemas. */
const SCHEMA_LIST_KEYS = ['anyOf', 'oneOf', 'allOf', 'prefixItems'];
/** Keywords whose value is a single schema (`items` may also be a legacy tuple). */
const SCHEMA_KEYS = [
  'items',
  'additionalItems',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'propertyNames',
  'additionalProperties',
  'unevaluatedProperties'
];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Structured output is strict: every object must close itself with
 * `additionalProperties: false` and list ALL of its properties as required.
 * Our schemas model "not applicable" as nullable rather than optional, so
 * nothing legitimately optional is lost by requiring everything.
 *
 * Pure — the input is never mutated.
 */
export function strictJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((s) => strictJsonSchema(s));
  if (!isPlainObject(schema)) return schema;

  const out: Record<string, unknown> = { ...schema };

  for (const key of SCHEMA_MAP_KEYS) {
    const value = out[key];
    if (!isPlainObject(value)) continue;
    const mapped: Record<string, unknown> = {};
    for (const [name, sub] of Object.entries(value)) mapped[name] = strictJsonSchema(sub);
    out[key] = mapped;
  }

  for (const key of SCHEMA_LIST_KEYS) {
    const value = out[key];
    if (Array.isArray(value)) out[key] = value.map((s) => strictJsonSchema(s));
  }

  for (const key of SCHEMA_KEYS) {
    const value = out[key];
    if (isPlainObject(value)) out[key] = strictJsonSchema(value);
    else if (Array.isArray(value)) out[key] = value.map((s) => strictJsonSchema(s));
  }

  const props = out.properties;
  if (isPlainObject(props)) {
    out.additionalProperties = false;
    out.required = Object.keys(props);
  }
  return out;
}

/** cmd.exe gets the argv joined by spaces, so anything with a space needs quoting. */
const quote = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;

/** The model sometimes wraps its JSON answer in a markdown fence. */
function unfence(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith('```')) return text;
  return text
    .replace(/^```[A-Za-z0-9_-]*[ \t]*\r?\n?/, '')
    .replace(/```[ \t]*$/, '')
    .trim();
}

function parseAnswer(raw: string): unknown {
  const candidates = [unfence(raw), raw.trim()];
  const braced = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (braced) candidates.push(braced);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next shape */
    }
  }
  return undefined;
}

/** Resolves the exit code, or null when the child never ran / timed out. */
function spawnCodex(args: string[], stdinText: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('codex', args, { shell: true, windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    const settle = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      settle(null);
    }, timeoutMs);

    // Drain the pipes so a chatty run can never block on a full buffer.
    child.stdout?.resume();
    child.stderr?.resume();
    child.on('error', () => settle(null));
    child.on('close', (code) => settle(code));

    // The prompt goes through stdin (argv `-`): no Windows quoting to get wrong.
    const stdin = child.stdin;
    if (stdin) {
      stdin.on('error', () => {
        /* the child may exit before we finish writing */
      });
      try {
        stdin.end(Buffer.from(stdinText, 'utf8'));
      } catch {
        /* handled by the close/error listeners */
      }
    }
  });
}

/** `model` empty/undefined means "whatever Codex is configured to use". */
export function createCodexRunner(opts: { ready: boolean; model?: string }): CodexRunner {
  const model = opts.model?.trim();
  return {
    ready: opts.ready,
    provider: 'codex',
    model: model ?? '',
    async run<T>(
      schema: z.ZodType<T>,
      prompt: string,
      runOpts?: { timeoutMs?: number; effort?: CodexEffort }
    ): Promise<T | null> {
      if (!opts.ready) return null;
      const dir = tmpdir();
      const id = randomUUID();
      const schemaFile = join(dir, `prism-schema-${id}.json`);
      const answerFile = join(dir, `prism-answer-${id}.txt`);
      try {
        const base = z.toJSONSchema(schema) as Record<string, unknown>;
        // `$schema` is not part of the structured-output subset.
        delete base.$schema;
        await writeFile(schemaFile, JSON.stringify(strictJsonSchema(base)), 'utf8');

        const args = [
          'exec',
          '--ephemeral',
          '--skip-git-repo-check',
          '-s',
          'read-only',
          '--color',
          'never',
          // These calls never use agent tools, and the user's config may list
          // heavyweight MCP servers that would otherwise boot on every spawn.
          '-c',
          'mcp_servers={}',
          ...(runOpts?.effort ? ['-c', `model_reasoning_effort="${runOpts.effort}"`] : []),
          '--output-schema',
          quote(schemaFile),
          '-o',
          quote(answerFile),
          '-C',
          quote(dir),
          ...(model ? ['-m', quote(model)] : []),
          '-'
        ];

        const code = await spawnCodex(args, prompt, runOpts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        if (code !== 0) return null;

        const answer = parseAnswer(await readFile(answerFile, 'utf8'));
        if (answer === undefined) return null;
        const parsed = schema.safeParse(answer);
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      } finally {
        await rm(schemaFile, { force: true }).catch(() => undefined);
        await rm(answerFile, { force: true }).catch(() => undefined);
      }
    }
  };
}
