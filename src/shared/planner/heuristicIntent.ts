import type { ContentBalance, InterpretedIntent } from '@shared/domain/intent';

const HANGUL_RE = /[가-힣]/;
const LATIN_RE = /[a-z]/i;

type Kind = 'video' | 'article' | 'post' | 'headline';
const KINDS: readonly Kind[] = ['video', 'article', 'post', 'headline'];

type Mood = 'browse' | 'calm';

interface MoodRule {
  pattern: RegExp;
  mood: Mood;
}

const MOOD_RULES: readonly MoodRule[] = [
  { pattern: /심심|지루|\bbored\b/i, mood: 'browse' },
  { pattern: /편안|조용|잔잔|\bcalm\b|\brelax(?:ing|ed)?\b|\bchill\b/i, mood: 'calm' },
  { pattern: /밥|먹으면서|while\s+eating/i, mood: 'calm' }
];

interface TopicRule {
  pattern: RegExp;
  topic: string;
}

const TOPIC_RULES: readonly TopicRule[] = [
  { pattern: /\bai\b|인공지능|\bllm\b|모델|머신러닝/i, topic: 'ai' },
  { pattern: /게임|게이밍|\bgaming\b|\bgames?\b/i, topic: 'gaming' },
  { pattern: /뉴스|소식|\bnews\b|헤드라인/i, topic: 'news' },
  { pattern: /개발|코딩|프로그래밍|\bdev\b|\bcoding\b|\bprogramming\b/i, topic: 'dev' },
  { pattern: /세계|국제|\bworld\b/i, topic: 'world' },
  { pattern: /기술|테크|\btech\b/i, topic: 'tech' },
  { pattern: /과학|\bscience\b/i, topic: 'science' }
];

const VIDEO_RE = /영상|비디오|유튜브|\bvideos?\b|\bwatch\b|봐|볼래|볼거리/i;
const ARTICLE_RE = /기사|읽을|\bread\b|\barticles?\b/i;
const POST_RE = /커뮤니티|커뮤|토론|\breddit\b|\bcommunity\b|\bdiscussions?\b/i;
const NEWS_RE = /뉴스|헤드라인|\bnews\b|\bheadlines?\b/i;

const BROWSE_BALANCE: ContentBalance = { video: 0.5, article: 0.4, post: 0.4, headline: 0.3 };
const CALM_BALANCE: ContentBalance = { video: 0.7, article: 0.3 };

const STRIP_RES: readonly RegExp[] = [
  // filler / request phrasing
  /보여\s*줘|보여\s*주세요|알려\s*줘|알려\s*주세요|틀어\s*줘|해\s*줘|주세요|줄래|싶어|싶다|좀|그냥/g,
  /\bshow\s+me\b|\bgive\s+me\b|\bfind\s+me\b|\bi\s+want(?:\s+to)?\b|\bplease\b|\bsome\b|\blet'?s\b/gi,
  // mood words
  /심심(?:해|하다|함|한데)?|지루(?:해|하다|함)?|\bbored\b|편안한?|조용한?|잔잔한?|\bcalm\b|\brelax(?:ing|ed)?\b|\bchill\b|먹으면서|밥|while\s+eating/gi,
  // content-kind words (not the subject itself)
  /영상|비디오|유튜브|\bvideos?\b|\bwatch\b|볼래|볼거리|볼만한|기사|읽을(?:거리)?|\bread\b|\barticles?\b|커뮤니티|커뮤|토론|\breddit\b|\bcommunity\b|\bdiscussions?\b|뉴스|헤드라인|\bnews\b|\bheadlines?\b/gi
];

function stripNoise(raw: string): string {
  let out = raw;
  for (const re of STRIP_RES) out = out.replace(re, ' ');
  return out
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.!?~]+|[\s,.!?~]+$/g, '')
    .trim();
}

function detectBalance(input: string): ContentBalance {
  const b: ContentBalance = {};
  const bump = (k: Kind, v: number): void => {
    const cur = b[k];
    b[k] = cur === undefined ? v : Math.max(cur, v);
  };
  if (VIDEO_RE.test(input)) bump('video', 0.8);
  if (ARTICLE_RE.test(input)) bump('article', 0.8);
  if (POST_RE.test(input)) bump('post', 0.8);
  if (NEWS_RE.test(input)) {
    bump('article', 0.7);
    bump('headline', 0.6);
  }
  return b;
}

function union(a: readonly string[], b: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of [...a, ...b]) if (!out.includes(v)) out.push(v);
  return out;
}

/**
 * Rule-based ko/en intent interpreter — the offline fallback for the LLM
 * interpreter. Deterministic, never throws.
 */
export function interpretIntentRules(
  rawInput: string,
  prior?: InterpretedIntent | null
): InterpretedIntent {
  const raw = typeof rawInput === 'string' ? rawInput.trim() : '';
  const followUp = prior != null;

  const locale: 'ko' | 'en' = HANGUL_RE.test(raw)
    ? 'ko'
    : LATIN_RE.test(raw)
      ? 'en'
      : (prior?.locale ?? 'ko');

  const detectedMoods: Mood[] = [];
  for (const rule of MOOD_RULES) {
    if (rule.pattern.test(raw) && !detectedMoods.includes(rule.mood)) detectedMoods.push(rule.mood);
  }

  const detectedTopics: string[] = [];
  for (const rule of TOPIC_RULES) {
    if (rule.pattern.test(raw) && !detectedTopics.includes(rule.topic))
      detectedTopics.push(rule.topic);
  }

  const moods: string[] =
    followUp && prior
      ? detectedMoods.length > 0
        ? union(prior.moods, detectedMoods)
        : [...prior.moods]
      : detectedMoods.length > 0
        ? detectedMoods
        : ['browse'];

  const topics: string[] =
    followUp && prior ? union(prior.topics, detectedTopics) : detectedTopics;

  const detectedBalance = detectBalance(raw);
  const base: ContentBalance =
    followUp && prior
      ? { ...prior.contentBalance }
      : moods.includes('calm') && !moods.includes('browse')
        ? { ...CALM_BALANCE }
        : { ...BROWSE_BALANCE };
  const contentBalance: ContentBalance = { ...base };
  for (const k of KINDS) {
    const v = detectedBalance[k];
    if (v !== undefined) contentBalance[k] = v;
  }

  let query: string | undefined;
  if (topics.length === 0 && raw.length > 0 && raw.length < 60) {
    const cleaned = stripNoise(raw);
    if (cleaned.length > 0) query = cleaned;
  }
  if (query === undefined && followUp && prior?.query) query = prior.query;

  const vague = raw.length === 0 || (detectedTopics.length === 0 && !query);
  const goal = vague
    ? locale === 'ko'
      ? '가벼운 웹 둘러보기'
      : 'casual browsing'
    : raw;

  const sourceHints =
    followUp && prior
      ? { include: [...prior.sourceHints.include], exclude: [...prior.sourceHints.exclude] }
      : { include: [], exclude: [] };

  return {
    goal,
    topics,
    moods,
    contentBalance,
    query,
    sourceHints,
    locale,
    followUp
  };
}
