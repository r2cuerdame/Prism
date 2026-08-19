/** Stable id helpers usable in both main and renderer. */

function randomSuffix(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomSuffix()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
