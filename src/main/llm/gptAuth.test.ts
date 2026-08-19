import { describe, expect, it } from 'vitest';
import { parseDeviceLogin } from './gptAuth';

const ESC = '';

/** Verbatim from `codex login --device-auth` on Windows, colour codes and all. */
const REAL_OUTPUT = [
  `Welcome to Codex [v${ESC}[90m0.147.0${ESC}[0m]`,
  `${ESC}[90mOpenAI's command-line coding agent${ESC}[0m`,
  '',
  'Follow these steps to sign in with ChatGPT using device code authorization:',
  '',
  '1. Open this link in your browser and sign in to your account',
  `   ${ESC}[94mhttps://auth.openai.com/codex/device${ESC}[0m`,
  '',
  `2. Enter this one-time code ${ESC}[90m(expires in 15 minutes)${ESC}[0m`,
  `   ${ESC}[94m0EYV-1XY86${ESC}[0m`,
  ''
].join('\n');

describe('parseDeviceLogin', () => {
  it('extracts the URL without the trailing colour reset', () => {
    // A stray escape sequence would make shell.openExternal open nothing.
    expect(parseDeviceLogin(REAL_OUTPUT).url).toBe('https://auth.openai.com/codex/device');
  });

  it('extracts the one-time code the CLI asks the user to type', () => {
    expect(parseDeviceLogin(REAL_OUTPUT).code).toBe('0EYV-1XY86');
  });

  it('handles uncoloured output and reports nothing when there is nothing', () => {
    const plain = parseDeviceLogin('Open https://auth.openai.com/codex/device and enter AB12-CD34');
    expect(plain.url).toBe('https://auth.openai.com/codex/device');
    expect(plain.code).toBe('AB12-CD34');

    const empty = parseDeviceLogin('Not logged in');
    expect(empty.url).toBeUndefined();
    expect(empty.code).toBeUndefined();
  });
});
