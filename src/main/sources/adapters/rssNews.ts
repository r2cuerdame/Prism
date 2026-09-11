import { XMLParser } from 'fast-xml-parser';
import { newId } from '@shared/domain/ids';
import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem } from '@shared/domain/sourceItem';
import type {
  AdapterContext,
  AdapterResult,
  SourceAdapter,
  SourceRequest
} from '../types';
import { fetchTargetsInterleaved } from './fanOut';

export interface FeedMeta {
  url: string;
  name: string;
  lang: 'ko' | 'en';
}

export interface FeedRegistryEntry extends FeedMeta {
  topics: string[];
}

export const FEED_REGISTRY: FeedRegistryEntry[] = [
  {
    url: 'https://www.theverge.com/rss/index.xml',
    name: 'The Verge',
    lang: 'en',
    topics: ['tech', 'general']
  },
  {
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    name: 'Ars Technica',
    lang: 'en',
    topics: ['tech', 'science']
  },
  {
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    name: 'BBC World',
    lang: 'en',
    topics: ['world', 'news']
  },
  {
    url: 'https://techcrunch.com/feed/',
    name: 'TechCrunch',
    lang: 'en',
    topics: ['tech', 'ai']
  },
  {
    url: 'https://www.polygon.com/rss/index.xml',
    name: 'Polygon',
    lang: 'en',
    topics: ['gaming']
  },
  {
    url: 'https://www.technologyreview.com/feed/',
    name: 'MIT Technology Review',
    lang: 'en',
    topics: ['ai', 'tech']
  },
  {
    url: 'https://www.mk.co.kr/rss/30000001/',
    name: '매일경제',
    lang: 'ko',
    topics: ['news', 'general']
  },
  {
    url: 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01',
    name: 'SBS 뉴스',
    lang: 'ko',
    topics: ['news', 'world']
  }
];

export function createXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    cdataPropName: '#cdata',
    isArray: (name) =>
      ['item', 'entry', 'link', 'media:thumbnail', 'category'].includes(name)
  });
}

/** string | number | {'#text'} | {'#cdata'} | array -> plain, decoded text. */
export function xmlText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return xmlText(v[0]);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('#cdata' in o) return xmlText(o['#cdata']);
    if ('#text' in o) return xmlText(o['#text']);
    return '';
  }
  return String(v)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function xmlAttr(node: unknown, name: string): string | undefined {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const v = (node as Record<string, unknown>)[`@_${name}`];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

export function xmlDate(v: unknown): string | undefined {
  const s = xmlText(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function isHttpUrl(s: string | undefined): s is string {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

function feedHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function pickAtomLink(link: unknown): string | undefined {
  if (!Array.isArray(link)) {
    const single = xmlAttr(link, 'href');
    if (single) return single;
    const asText = xmlText(link);
    return isHttpUrl(asText) ? asText : undefined;
  }
  let fallback: string | undefined;
  for (const l of link) {
    const href = xmlAttr(l, 'href');
    if (!href) continue;
    const rel = xmlAttr(l, 'rel');
    if (rel === undefined || rel === 'alternate') return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

function rssThumbnail(entry: Record<string, unknown>): string | undefined {
  const mediaThumb = entry['media:thumbnail'];
  if (Array.isArray(mediaThumb)) {
    const url = xmlAttr(mediaThumb[0], 'url');
    if (isHttpUrl(url)) return url;
  }
  const enclosure = entry['enclosure'];
  const encUrl = xmlAttr(enclosure, 'url');
  const encType = xmlAttr(enclosure, 'type');
  if (isHttpUrl(encUrl) && encType?.startsWith('image/')) return encUrl;
  return undefined;
}

interface RawEntry {
  title: string;
  link: string | undefined;
  summary: string;
  publishedAt: string | undefined;
  thumbnailUrl: string | undefined;
}

function extractEntries(parsed: unknown): { entries: RawEntry[]; recognized: boolean } {
  if (!parsed || typeof parsed !== 'object') return { entries: [], recognized: false };
  const root = parsed as Record<string, unknown>;

  const rss = root['rss'];
  if (rss && typeof rss === 'object') {
    const channel = (rss as Record<string, unknown>)['channel'];
    const rawItems =
      channel && typeof channel === 'object'
        ? (channel as Record<string, unknown>)['item']
        : undefined;
    const items = Array.isArray(rawItems) ? rawItems : [];
    const entries = items.map((it): RawEntry => {
      const e = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
      const linkText = xmlText(e['link']);
      return {
        title: xmlText(e['title']),
        link: isHttpUrl(linkText) ? linkText : undefined,
        summary: xmlText(e['description']),
        publishedAt: xmlDate(e['pubDate']),
        thumbnailUrl: rssThumbnail(e)
      };
    });
    return { entries, recognized: true };
  }

  const feed = root['feed'];
  if (feed && typeof feed === 'object') {
    const rawEntries = (feed as Record<string, unknown>)['entry'];
    const items = Array.isArray(rawEntries) ? rawEntries : [];
    const entries = items.map((it): RawEntry => {
      const e = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
      const link = pickAtomLink(e['link']);
      return {
        title: xmlText(e['title']),
        link: isHttpUrl(link) ? link : undefined,
        summary: xmlText(e['summary']) || xmlText(e['content']),
        publishedAt: xmlDate(e['published']) ?? xmlDate(e['updated']),
        thumbnailUrl: rssThumbnail(e)
      };
    });
    return { entries, recognized: true };
  }

  return { entries: [], recognized: false };
}

export function parseRssFeed(
  xml: string,
  meta: FeedMeta,
  now: Date
): AdapterResult {
  const items: SourceItem[] = [];
  const provenance: Provenance[] = [];
  const errors: string[] = [];
  const retrievedAt = now.toISOString();
  const sourceId = feedHost(meta.url);

  let parsed: unknown;
  try {
    parsed = createXmlParser().parse(xml);
  } catch (e) {
    errors.push(`${meta.name}: XML 파싱 실패 (${e instanceof Error ? e.message : String(e)})`);
    return { items, provenance, errors };
  }

  try {
    const { entries, recognized } = extractEntries(parsed);
    if (!recognized) {
      errors.push(`${meta.name}: RSS/Atom 형식이 아닙니다`);
      return { items, provenance, errors };
    }
    for (const entry of entries) {
      if (!entry.title || !entry.link) {
        errors.push(`${meta.name}: 제목 또는 링크가 없는 항목을 건너뜀`);
        continue;
      }
      const provId = newId('prov');
      provenance.push({
        id: provId,
        sourceUrl: entry.link,
        sourceName: meta.name,
        adapterId: 'rss-news',
        retrievedAt,
        transformations: ['RSS/Atom 항목 정규화 (텍스트 추출)']
      });
      items.push({
        id: newId('item'),
        adapterId: 'rss-news',
        sourceId,
        sourceName: meta.name,
        kind: 'article',
        title: entry.title,
        summary: entry.summary || undefined,
        media: entry.thumbnailUrl ? { thumbnailUrl: entry.thumbnailUrl } : undefined,
        payload: {
          source: meta.name,
          ...(entry.summary ? { excerpt: entry.summary } : {})
        },
        originalUrl: entry.link,
        publishedAt: entry.publishedAt,
        retrievedAt,
        provenanceRef: provId,
        lang: meta.lang
      });
    }
  } catch (e) {
    errors.push(`${meta.name}: 피드 처리 오류 (${e instanceof Error ? e.message : String(e)})`);
  }
  return { items, provenance, errors };
}

function selectFeeds(req: SourceRequest): FeedRegistryEntry[] {
  const topics = new Set(req.topics.map((t) => t.toLowerCase()));
  let candidates = FEED_REGISTRY.filter((f) => f.topics.some((t) => topics.has(t)));
  if (candidates.length === 0) {
    candidates = FEED_REGISTRY.filter(
      (f) => f.topics.includes('general') || f.topics.includes('news')
    );
  }
  return [...candidates]
    .sort(
      (a, b) =>
        (b.lang === req.locale ? 1 : 0) - (a.lang === req.locale ? 1 : 0)
    )
    .slice(0, 3);
}

export const rssNewsAdapter: SourceAdapter = {
  id: 'rss-news',
  name: '뉴스 피드',
  classes: ['news'],
  matches(req: SourceRequest): number {
    const topics = new Set(req.topics.map((t) => t.toLowerCase()));
    const registryTopics = new Set(FEED_REGISTRY.flatMap((f) => f.topics));
    let score = 0.5;
    if (topics.has('news') || [...topics].some((t) => registryTopics.has(t))) {
      score += 0.3;
    }
    if (FEED_REGISTRY.some((f) => f.lang === req.locale)) score += 0.2;
    return Math.min(1, score);
  },
  fetchItems(req: SourceRequest, ctx: AdapterContext): Promise<AdapterResult> {
    return fetchTargetsInterleaved(
      selectFeeds(req),
      async (feed) => parseRssFeed(await ctx.http.getText(feed.url), feed, ctx.now()),
      (feed, e) =>
        `${feed.name}: 피드 요청 실패 (${e instanceof Error ? e.message : String(e)})`,
      req.limit
    );
  }
};
