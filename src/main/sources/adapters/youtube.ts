import { newId } from '@shared/domain/ids';
import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem } from '@shared/domain/sourceItem';
import type {
  AdapterContext,
  AdapterResult,
  SourceAdapter,
  SourceRequest
} from '../types';
import { createXmlParser, xmlAttr, xmlDate, xmlText } from './rssNews';

export interface ChannelMeta {
  channelId: string;
  name: string;
}

export interface ChannelRegistryEntry extends ChannelMeta {
  topics: string[];
  lang: 'ko' | 'en';
}

export const CHANNEL_REGISTRY: ChannelRegistryEntry[] = [
  {
    channelId: 'UCsBjURrPoezykLs9EqgamOA',
    name: 'Fireship',
    topics: ['dev', 'ai', 'tech'],
    lang: 'en'
  },
  {
    channelId: 'UCbfYPyITQ-7l4upoX8nvctg',
    name: 'Two Minute Papers',
    topics: ['ai', 'science'],
    lang: 'en'
  },
  {
    channelId: 'UCHnyfMqiRRG1u-2MsSQLbXA',
    name: 'Veritasium',
    topics: ['science', 'general'],
    lang: 'en'
  },
  {
    channelId: 'UCsXVk37bltHxD1rDPwtNM8Q',
    name: 'Kurzgesagt',
    topics: ['science', 'general', 'calm'],
    lang: 'en'
  },
  {
    channelId: 'UCsJ6RuBiTVWRX156FVbeaGg',
    name: '슈카월드',
    topics: ['news', 'economy'],
    lang: 'ko'
  }
];

export function channelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export function parseYoutubeFeed(
  xml: string,
  meta: ChannelMeta,
  now: Date
): AdapterResult {
  const items: SourceItem[] = [];
  const provenance: Provenance[] = [];
  const errors: string[] = [];
  const retrievedAt = now.toISOString();

  let parsed: unknown;
  try {
    parsed = createXmlParser().parse(xml);
  } catch (e) {
    errors.push(
      `${meta.name}: XML 파싱 실패 (${e instanceof Error ? e.message : String(e)})`
    );
    return { items, provenance, errors };
  }

  try {
    const root =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    const feed = root['feed'];
    if (!feed || typeof feed !== 'object') {
      errors.push(`${meta.name}: YouTube 피드 형식이 아닙니다`);
      return { items, provenance, errors };
    }
    const rawEntries = (feed as Record<string, unknown>)['entry'];
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    for (const raw of entries) {
      const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const videoId = xmlText(e['yt:videoId']);
      const title = xmlText(e['title']);
      if (!videoId || !title) {
        errors.push(`${meta.name}: videoId 또는 제목이 없는 항목을 건너뜀`);
        continue;
      }
      const group =
        e['media:group'] && typeof e['media:group'] === 'object'
          ? (e['media:group'] as Record<string, unknown>)
          : {};
      const thumbs = group['media:thumbnail'];
      const thumbnailUrl = Array.isArray(thumbs)
        ? xmlAttr(thumbs[0], 'url')
        : undefined;
      const description = xmlText(group['media:description']);
      const originalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const provId = newId('prov');
      provenance.push({
        id: provId,
        sourceUrl: originalUrl,
        sourceName: meta.name,
        adapterId: 'youtube',
        retrievedAt,
        transformations: ['YouTube RSS 항목 정규화']
      });
      items.push({
        id: newId('item'),
        adapterId: 'youtube',
        sourceId: meta.channelId,
        sourceName: meta.name,
        kind: 'video',
        title,
        summary: description || undefined,
        media: {
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
          embedId: videoId
        },
        payload: { videoId, channel: meta.name },
        originalUrl,
        publishedAt: xmlDate(e['published']),
        retrievedAt,
        provenanceRef: provId
      });
    }
  } catch (e) {
    errors.push(
      `${meta.name}: 피드 처리 오류 (${e instanceof Error ? e.message : String(e)})`
    );
  }
  return { items, provenance, errors };
}

function selectChannels(req: SourceRequest): ChannelRegistryEntry[] {
  const topics = new Set(req.topics.map((t) => t.toLowerCase()));
  let candidates = CHANNEL_REGISTRY.filter((c) =>
    c.topics.some((t) => topics.has(t))
  );
  if (candidates.length === 0) {
    candidates = CHANNEL_REGISTRY.filter(
      (c) => c.topics.includes('general') || c.topics.includes('science')
    );
  }
  return [...candidates]
    .sort(
      (a, b) =>
        (b.lang === req.locale ? 1 : 0) - (a.lang === req.locale ? 1 : 0)
    )
    .slice(0, 3);
}

export const youtubeAdapter: SourceAdapter = {
  id: 'youtube',
  name: 'YouTube',
  classes: ['video'],
  matches(req: SourceRequest): number {
    const topics = new Set(req.topics.map((t) => t.toLowerCase()));
    const registryTopics = new Set(CHANNEL_REGISTRY.flatMap((c) => c.topics));
    let score = 0.6;
    if ([...topics].some((t) => registryTopics.has(t))) score += 0.2;
    return Math.max(0.4, Math.min(1, score));
  },
  async fetchItems(req: SourceRequest, ctx: AdapterContext): Promise<AdapterResult> {
    const items: SourceItem[] = [];
    const provenance: Provenance[] = [];
    const errors: string[] = [];
    for (const ch of selectChannels(req)) {
      try {
        const xml = await ctx.http.getText(channelFeedUrl(ch.channelId));
        const r = parseYoutubeFeed(xml, ch, ctx.now());
        items.push(...r.items.map((it) => ({ ...it, lang: ch.lang })));
        provenance.push(...r.provenance);
        errors.push(...r.errors);
      } catch (e) {
        errors.push(
          `${ch.name}: 피드 요청 실패 (${e instanceof Error ? e.message : String(e)})`
        );
      }
    }
    const kept = items.slice(0, req.limit);
    const refs = new Set(kept.map((i) => i.provenanceRef));
    return {
      items: kept,
      provenance: provenance.filter((p) => refs.has(p.id)),
      errors
    };
  }
};
