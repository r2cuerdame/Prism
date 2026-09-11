import {
  signalPolarity,
  type PreferenceScope,
  type PreferenceSignal,
  type PreferenceTargetType
} from '@shared/domain/preference';
import { tokenize } from '@shared/planner/crossSource';

/**
 * A compact InterestProfile derived from PreferenceSignals.
 *
 * The profile is what the three preference stages (source selection, item
 * ranking, layout planning) read. It aggregates signals per target and keeps
 * two facts per target: a signed score and whether the user said it
 * EXPLICITLY. Explicit negatives are durable (no decay) and are the only thing
 * that can hard-exclude; implicit signals decay with a 14-day half-life and
 * only ever soft-rank. That asymmetry is the overfitting guard: a few
 * accidental removes never turn into a ban.
 */

export interface ProfileEntry {
  type: PreferenceTargetType;
  value: string;
  /** Signed strength after weighting; negative means "less of this". */
  score: number;
  /** At least one explicit signal backs this entry. */
  explicit: boolean;
  /** Explicit AND negative: the stages may exclude, not just downrank. */
  hard: boolean;
  /** Fingerprint terms for fuzzy topic/item matching. */
  terms: string[];
  signalIds: string[];
  /** Human-readable interpretations, newest first, at most 3. */
  interpretations: string[];
}

export interface InterestProfile {
  negative: {
    sources: ProfileEntry[];
    topics: ProfileEntry[];
    kinds: ProfileEntry[];
    components: ProfileEntry[];
    items: ProfileEntry[];
  };
  positive: {
    sources: ProfileEntry[];
    topics: ProfileEntry[];
    kinds: ProfileEntry[];
    components: ProfileEntry[];
  };
  builtAt: string;
  signalCount: number;
  /** Signals the profile ignored (out of scope, expired) — inspectable. */
  diagnostics: string[];
}

export interface ProfileOptions {
  now?: string;
  /** Session-scoped signals apply only inside this session. */
  sessionId?: string;
  /** Recipe-scoped signals apply only when this recipe is running. */
  recipeId?: string;
}

const HALF_LIFE_DAYS = 14;
const MIN_WEIGHT = 0.02;
const DAY_MS = 24 * 60 * 60 * 1000;

function implicitDecay(createdAt: string, now: number): number {
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return 1;
  const days = Math.max(0, (now - t) / DAY_MS);
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

function scopeApplies(signal: PreferenceSignal, opts: ProfileOptions): boolean {
  const scope: PreferenceScope = signal.scope;
  if (scope === 'global') return true;
  if (scope === 'one_time') return false;
  if (scope === 'session') {
    return opts.sessionId === undefined || signal.context.sessionId === opts.sessionId;
  }
  if (scope === 'recipe') {
    return opts.recipeId === undefined || signal.context.recipeId === opts.recipeId;
  }
  return false;
}

/** Weight of one signal at `now`: explicit is durable, implicit decays. */
export function signalWeight(signal: PreferenceSignal, now: number): number {
  if (signal.explicit) return Math.max(0.5, signal.confidence);
  if (signal.expiresAt !== undefined && Date.parse(signal.expiresAt) < now) return 0;
  return signal.confidence * implicitDecay(signal.createdAt, now);
}

/** Terms for fuzzy matching: stored fingerprint first, else tokens of the value. */
export function termsOf(signal: PreferenceSignal): string[] {
  if (signal.terms && signal.terms.length > 0) return signal.terms;
  if (signal.target.type === 'topic' || signal.target.type === 'item') {
    return [...tokenize(signal.target.value)];
  }
  return [];
}

export function emptyProfile(now = new Date().toISOString()): InterestProfile {
  return {
    negative: { sources: [], topics: [], kinds: [], components: [], items: [] },
    positive: { sources: [], topics: [], kinds: [], components: [] },
    builtAt: now,
    signalCount: 0,
    diagnostics: []
  };
}

export function buildInterestProfile(
  signals: PreferenceSignal[],
  opts: ProfileOptions = {}
): InterestProfile {
  const nowIso = opts.now ?? new Date().toISOString();
  const now = Date.parse(nowIso);
  const profile = emptyProfile(nowIso);
  const agg = new Map<string, ProfileEntry>();
  let skippedScope = 0;
  let skippedWeight = 0;

  const ordered = [...signals].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  for (const s of ordered) {
    if (s.target.type === 'block') continue;
    if (!scopeApplies(s, opts)) {
      skippedScope += 1;
      continue;
    }
    const weight = signalWeight(s, now);
    if (weight < MIN_WEIGHT) {
      skippedWeight += 1;
      continue;
    }
    const value = s.target.type === 'item' ? s.target.value : s.target.value.trim();
    const key = `${s.target.type}:${value.toLowerCase()}`;
    let entry = agg.get(key);
    if (!entry) {
      entry = {
        type: s.target.type,
        value,
        score: 0,
        explicit: false,
        hard: false,
        terms: [],
        signalIds: [],
        interpretations: []
      };
      agg.set(key, entry);
    }
    const sign = signalPolarity(s) === 'negative' ? -1 : 1;
    entry.score += sign * weight;
    entry.signalIds.push(s.id);
    if (entry.interpretations.length < 3) entry.interpretations.push(s.interpretation);
    if (s.explicit) {
      entry.explicit = true;
      if (sign < 0) entry.hard = true;
    }
    for (const t of termsOf(s)) if (!entry.terms.includes(t)) entry.terms.push(t);
    profile.signalCount += 1;
  }

  const byStrength = (a: ProfileEntry, b: ProfileEntry): number =>
    Math.abs(b.score) - Math.abs(a.score) || a.value.localeCompare(b.value);

  for (const entry of agg.values()) {
    // An explicit negative stays hard even when later implicit positives
    // nudged the score up: the user said it, and only deleting the signal
    // in the preferences panel takes it back.
    const negative = entry.hard || entry.score < 0;
    if (negative) {
      switch (entry.type) {
        case 'source':
          profile.negative.sources.push(entry);
          break;
        case 'topic':
          profile.negative.topics.push(entry);
          break;
        case 'kind':
          profile.negative.kinds.push(entry);
          break;
        case 'component':
          profile.negative.components.push(entry);
          break;
        case 'item':
          profile.negative.items.push(entry);
          break;
        default:
          break;
      }
    } else if (entry.score > 0) {
      switch (entry.type) {
        case 'source':
          profile.positive.sources.push(entry);
          break;
        case 'topic':
          profile.positive.topics.push(entry);
          break;
        case 'kind':
          profile.positive.kinds.push(entry);
          break;
        case 'component':
          profile.positive.components.push(entry);
          break;
        default:
          break;
      }
    }
  }
  for (const list of Object.values(profile.negative)) list.sort(byStrength);
  for (const list of Object.values(profile.positive)) list.sort(byStrength);

  if (skippedScope > 0) profile.diagnostics.push(`다른 세션·레시피에만 적용되는 신호 ${skippedScope}개는 건너뛰었어요.`);
  if (skippedWeight > 0) profile.diagnostics.push(`오래되어 약해진 신호 ${skippedWeight}개는 반영하지 않았어요.`);
  return profile;
}

const KIND_LABEL: Record<string, string> = {
  video: '영상',
  article: '기사',
  post: '커뮤니티 글',
  headline: '헤드라인'
};

function describe(entry: ProfileEntry): string {
  switch (entry.type) {
    case 'source':
      return `${entry.value} 출처`;
    case 'kind':
      return `${entry.value}(${KIND_LABEL[entry.value] ?? entry.value}) 형식`;
    case 'component':
      return `${entry.value} 컴포넌트`;
    case 'topic':
      return `"${entry.value}" 주제`;
    case 'item':
      return `항목 ${entry.terms.slice(0, 4).join(' ') || entry.value}`;
    default:
      return entry.value;
  }
}

/**
 * Concise Korean summary for the planner prompt. Explicit negatives come
 * first and are marked as rules the planner MUST follow; the rest are
 * cautious leanings. Bounded so it never crowds the item digest.
 */
export function summarizeProfile(profile: InterestProfile, maxLines = 12): string {
  const lines: string[] = [];
  const hard = [
    ...profile.negative.sources,
    ...profile.negative.topics,
    ...profile.negative.kinds,
    ...profile.negative.components,
    ...profile.negative.items
  ].filter((e) => e.hard);
  for (const e of hard) {
    if (lines.length >= maxLines) break;
    lines.push(`- [반드시 제외] ${describe(e)} 선호 낮음 — 사용자가 직접 거부했어요`);
  }
  const soft = [
    ...profile.negative.sources,
    ...profile.negative.topics,
    ...profile.negative.kinds,
    ...profile.negative.components
  ].filter((e) => !e.hard);
  for (const e of soft) {
    if (lines.length >= maxLines) break;
    lines.push(`- ${describe(e)} 선호 낮음 (추정 ${Math.abs(e.score).toFixed(2)})`);
  }
  const positive = [
    ...profile.positive.sources,
    ...profile.positive.topics,
    ...profile.positive.kinds,
    ...profile.positive.components
  ];
  for (const e of positive) {
    if (lines.length >= maxLines) break;
    lines.push(
      e.explicit
        ? `- ${describe(e)} 더 보기 — 사용자가 직접 요청했어요`
        : `- ${describe(e)} 선호 높음 (추정 ${e.score.toFixed(2)})`
    );
  }
  return lines.join('\n');
}
