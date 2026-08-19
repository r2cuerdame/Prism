import { z } from 'zod';

/** MVP vertical slice: video, articles/news, community posts (GOAL.md MVP §). */
export const SourceItemKindSchema = z.enum(['video', 'article', 'post', 'headline']);
export type SourceItemKind = z.infer<typeof SourceItemKindSchema>;

export const SOURCE_ITEM_KINDS: SourceItemKind[] = ['video', 'article', 'post', 'headline'];

export const SourceItemSchema = z.object({
  id: z.string(),
  adapterId: z.string(),
  /** Stable id of the concrete source (e.g. feed url host, subreddit). */
  sourceId: z.string(),
  /** Human-readable source name shown on provenance chips. */
  sourceName: z.string(),
  kind: SourceItemKindSchema,
  title: z.string(),
  summary: z.string().optional(),
  media: z
    .object({
      thumbnailUrl: z.string().optional(),
      /** For kind 'video': YouTube video id used by the trusted embed player. */
      embedId: z.string().optional()
    })
    .optional(),
  /** Kind-specific structured data — access through the typed getters below. */
  payload: z.record(z.string(), z.unknown()).default({}),
  originalUrl: z.url(),
  publishedAt: z.string().optional(),
  retrievedAt: z.string(),
  provenanceRef: z.string(),
  lang: z.enum(['ko', 'en', 'other']).optional()
});

export type SourceItem = z.infer<typeof SourceItemSchema>;

export interface VideoPayload {
  videoId: string;
  channel: string;
  durationText?: string;
}

export interface PostPayload {
  community: string;
  points?: number;
  commentCount?: number;
  commentsUrl?: string;
}

export interface ArticlePayload {
  source: string;
  excerpt?: string;
}

export function getVideoPayload(item: SourceItem): VideoPayload | null {
  if (item.kind !== 'video') return null;
  const p = item.payload;
  if (typeof p.videoId !== 'string' || typeof p.channel !== 'string') return null;
  return {
    videoId: p.videoId,
    channel: p.channel,
    durationText: typeof p.durationText === 'string' ? p.durationText : undefined
  };
}

export function getPostPayload(item: SourceItem): PostPayload | null {
  if (item.kind !== 'post') return null;
  const p = item.payload;
  if (typeof p.community !== 'string') return null;
  return {
    community: p.community,
    points: typeof p.points === 'number' ? p.points : undefined,
    commentCount: typeof p.commentCount === 'number' ? p.commentCount : undefined,
    commentsUrl: typeof p.commentsUrl === 'string' ? p.commentsUrl : undefined
  };
}

export function getArticlePayload(item: SourceItem): ArticlePayload | null {
  if (item.kind !== 'article' && item.kind !== 'headline') return null;
  const p = item.payload;
  return {
    source: typeof p.source === 'string' ? p.source : item.sourceName,
    excerpt: typeof p.excerpt === 'string' ? p.excerpt : undefined
  };
}
