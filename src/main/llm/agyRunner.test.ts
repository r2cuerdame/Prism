import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { buildAgyArgs, createAgyRunner, DEFAULT_AGY_MODEL, parseAgyOutput } from './agyRunner';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const Answer = z.object({ goal: z.string(), n: z.number() });

describe('parseAgyOutput', () => {
  it('accepts a bare structured object', () => {
    expect(parseAgyOutput('{"goal":"a","n":1}', Answer)).toEqual({ goal: 'a', n: 1 });
  });

  it('accepts a print-mode JSON envelope whose result is a JSON string', () => {
    const out = JSON.stringify({ type: 'result', result: '{"goal":"b","n":2}', usage: {} });
    expect(parseAgyOutput(out, Answer)).toEqual({ goal: 'b', n: 2 });
  });

  it('accepts an envelope whose structured output is nested as an object', () => {
    const out = JSON.stringify({
      status: 'ok',
      response: { structured_output: { goal: 'c', n: 3 } }
    });
    expect(parseAgyOutput(out, Answer)).toEqual({ goal: 'c', n: 3 });
  });

  it('accepts an NDJSON stream and takes the final result event', () => {
    const out = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: 'thinking' } }),
      JSON.stringify({ type: 'result', result: { goal: 'd', n: 4 } })
    ].join('\n');
    expect(parseAgyOutput(out, Answer)).toEqual({ goal: 'd', n: 4 });
  });

  it('accepts a markdown-fenced answer', () => {
    expect(parseAgyOutput('```json\n{"goal":"e","n":5}\n```', Answer)).toEqual({ goal: 'e', n: 5 });
  });

  it('returns null for text that never matches the schema', () => {
    expect(parseAgyOutput('sorry, I could not do that', Answer)).toBeNull();
    expect(parseAgyOutput('{"goal":"x"}', Answer)).toBeNull();
    expect(parseAgyOutput('', Answer)).toBeNull();
  });
});

describe('buildAgyArgs', () => {
  it('runs print mode with structured JSON output, the model and the effort', () => {
    const args = buildAgyArgs({
      prompt: 'hello',
      schemaFile: 'C:\\tmp\\schema.json',
      model: 'gemini-3.8-flash-medium',
      effort: 'low',
      timeoutMs: 90_000
    });
    expect(args).toContain('--print');
    expect(args[args.indexOf('--print') + 1]).toBe('hello');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args[args.indexOf('--json-schema') + 1]).toBe('C:\\tmp\\schema.json');
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-3.8-flash-medium');
    expect(args[args.indexOf('--effort') + 1]).toBe('low');
    expect(args).toContain('--disable-slash-commands');
    expect(args[args.indexOf('--print-timeout') + 1]).toBe('90s');
  });

  it('omits effort when none is requested and never passes "none" to the CLI', () => {
    expect(buildAgyArgs({ prompt: 'p', schemaFile: 's', model: 'm' })).not.toContain('--effort');
    expect(
      buildAgyArgs({ prompt: 'p', schemaFile: 's', model: 'm', effort: 'none' })
    ).not.toContain('--effort');
  });
});

describe('createAgyRunner', () => {
  it('is the agy provider with the default Gemini model', () => {
    const runner = createAgyRunner({ ready: true });
    expect(runner.provider).toBe('agy');
    expect(runner.model).toBe(DEFAULT_AGY_MODEL);
    expect(DEFAULT_AGY_MODEL).toBe('gemini-3.8-flash-medium');
  });

  it('resolves null without spawning when not ready', async () => {
    const runner = createAgyRunner({ ready: false });
    await expect(runner.run(Answer, 'hello')).resolves.toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  function fakeChild(stdout: string, code = 0): ReturnType<typeof spawn> {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    const child = {
      stdout: {
        on(event: string, cb: (d: Buffer) => void) {
          if (event === 'data') setImmediate(() => cb(Buffer.from(stdout, 'utf8')));
        }
      },
      stderr: { on: vi.fn() },
      stdin: { on: vi.fn(), end: vi.fn() },
      kill: vi.fn(),
      on(event: string, cb: (...a: unknown[]) => void) {
        (handlers[event] ??= []).push(cb);
        if (event === 'close') setImmediate(() => setImmediate(() => cb(code)));
        return child;
      }
    };
    return child as unknown as ReturnType<typeof spawn>;
  }

  it('parses the CLI answer through the schema', async () => {
    vi.mocked(spawn).mockReturnValue(
      fakeChild(JSON.stringify({ type: 'result', result: '{"goal":"z","n":9}' }))
    );
    const runner = createAgyRunner({ ready: true });
    const out = await runner.run(Answer, 'prompt', { effort: 'low' });
    expect(out).toEqual({ goal: 'z', n: 9 });
    const [cmd, args] = vi.mocked(spawn).mock.calls.at(-1)!;
    expect(cmd).toBe('agy');
    expect(args).toContain('--print');
    expect(args[args.indexOf('--model') + 1]).toBe(DEFAULT_AGY_MODEL);
  });

  it('resolves null on a non-zero exit', async () => {
    vi.mocked(spawn).mockReturnValue(fakeChild('error: quota', 1));
    const runner = createAgyRunner({ ready: true });
    await expect(runner.run(Answer, 'prompt')).resolves.toBeNull();
  });
});
