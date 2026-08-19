import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { createCodexRunner, strictJsonSchema } from './codexRunner';

// A not-ready runner must never reach the CLI, so the real spawn is replaced
// by a spy we can assert was left untouched.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

describe('strictJsonSchema', () => {
  it('closes an object and requires every property', () => {
    const out = strictJsonSchema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } }
    }) as Record<string, unknown>;

    expect(out.additionalProperties).toBe(false);
    expect(out.required).toEqual(['a', 'b']);
  });

  it('requires properties that the source marked optional', () => {
    const out = strictJsonSchema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a']
    }) as Record<string, unknown>;

    expect(out.required).toEqual(['a', 'b']);
  });

  it('descends into nested objects', () => {
    const out = strictJsonSchema({
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: {
            inner: { type: 'object', properties: { deep: { type: 'string' } } }
          }
        }
      }
    }) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;

    const outer = out.properties.outer;
    expect(outer.additionalProperties).toBe(false);
    expect(outer.required).toEqual(['inner']);
    const inner = outer.properties.inner as unknown as Record<string, unknown>;
    expect(inner.additionalProperties).toBe(false);
    expect(inner.required).toEqual(['deep']);
  });

  it('descends into arrays of objects', () => {
    const out = strictJsonSchema({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: { type: 'object', properties: { text: { type: 'string' }, n: { type: 'number' } } }
        }
      }
    }) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;

    const items = out.properties.rows.items;
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(['text', 'n']);
  });

  it('descends into anyOf/oneOf/allOf branches', () => {
    const out = strictJsonSchema({
      anyOf: [{ type: 'object', properties: { a: { type: 'string' } } }, { type: 'null' }]
    }) as Record<string, Record<string, unknown>[]>;

    expect(out.anyOf[0].additionalProperties).toBe(false);
    expect(out.anyOf[0].required).toEqual(['a']);
    expect(out.anyOf[1]).toEqual({ type: 'null' });
  });

  it('descends into $defs', () => {
    const out = strictJsonSchema({
      $defs: { Row: { type: 'object', properties: { a: { type: 'string' } } } },
      type: 'object',
      properties: { row: { $ref: '#/$defs/Row' } }
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect(out.$defs.Row.additionalProperties).toBe(false);
    expect(out.$defs.Row.required).toEqual(['a']);
  });

  it('treats a property literally named "properties" as a property, not a schema map', () => {
    const out = strictJsonSchema({
      type: 'object',
      properties: { properties: { type: 'string' } }
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect((out as unknown as Record<string, unknown>).required).toEqual(['properties']);
    // The leaf is a plain string schema and must not gain object keywords.
    expect(out.properties.properties).toEqual({ type: 'string' });
  });

  it('does not mutate its input', () => {
    const input = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        rows: { type: 'array', items: { type: 'object', properties: { b: { type: 'number' } } } }
      }
    };
    const before = structuredClone(input);

    strictJsonSchema(input);

    expect(input).toEqual(before);
  });

  it('tolerates non-object input', () => {
    expect(strictJsonSchema(null)).toBeNull();
    expect(strictJsonSchema(undefined)).toBeUndefined();
    expect(strictJsonSchema(42)).toBe(42);
    expect(strictJsonSchema('nope')).toBe('nope');
    expect(strictJsonSchema(true)).toBe(true);
    expect(strictJsonSchema([1, 'two'])).toEqual([1, 'two']);
    expect(strictJsonSchema({})).toEqual({});
  });

  it('handles a real zod schema end to end', () => {
    const schema = z.object({
      goal: z.string(),
      query: z.string().nullable(),
      points: z.array(z.object({ text: z.string(), cites: z.array(z.number()) }))
    });
    const base = z.toJSONSchema(schema) as Record<string, unknown>;
    delete base.$schema;

    const out = strictJsonSchema(base) as Record<string, unknown>;

    expect(out.additionalProperties).toBe(false);
    expect(out.required).toEqual(['goal', 'query', 'points']);
    const props = out.properties as Record<string, Record<string, unknown>>;
    const item = props.points.items as Record<string, unknown>;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(['text', 'cites']);
  });
});

describe('createCodexRunner', () => {
  it('reports the readiness it was built with', () => {
    expect(createCodexRunner({ ready: false }).ready).toBe(false);
    expect(createCodexRunner({ ready: true, model: 'gpt-5.5' }).ready).toBe(true);
  });

  it('resolves null without spawning when not ready', async () => {
    const runner = createCodexRunner({ ready: false });

    await expect(runner.run(z.object({ a: z.string() }), 'hello')).resolves.toBeNull();

    expect(spawn).not.toHaveBeenCalled();
  });
});
