import { describe, expect, it } from 'vitest';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import { SourceItemSchema } from '@shared/domain/sourceItem';
import {
  buildSynthesisPoints,
  clusterByTopic,
  interleaveBySource,
  tokenize
} from './crossSource';

function item(
  id: string,
  kind: SourceItemKind,
  sourceName: string,
  title: string,
  extra: Partial<SourceItem> = {}
): SourceItem {
  return {
    id,
    adapterId: 'test-adapter',
    sourceId: sourceName,
    sourceName,
    kind,
    title,
    payload: {},
    originalUrl: `https://example.com/${id}`,
    retrievedAt: '2026-08-19T00:00:00.000Z',
    provenanceRef: 'prov_1',
    ...extra
  };
}

/** Three sources talking about the same topic + unrelated noise. */
function topicItems(): SourceItem[] {
  return [
    item('a1', 'article', '매일경제', '삼성전자 반도체 실적 발표'),
    item('p1', 'post', 'Hacker News', '삼성전자 3나노 수율 공개', {
      payload: { community: 'hn', commentCount: 250 }
    }),
    item('v1', 'video', 'IT유튜브', '삼성전자 반도체 전망 분석'),
    item('a2', 'article', '조선일보', '전기차 배터리 수출 급증'),
    item('p2', 'post', 'Lobsters', '러스트 컴파일러 성능 개선', {
      payload: { community: 'lobsters', commentCount: 12 }
    })
  ];
}

describe('crossSource fixtures', () => {
  it('are valid SourceItems', () => {
    for (const it2 of topicItems()) {
      expect(SourceItemSchema.safeParse(it2).success).toBe(true);
    }
  });
});

describe('tokenize', () => {
  it('lowercases, strips punctuation and drops stopwords in both languages', () => {
    expect([...tokenize('The New AI Report!')]).toEqual(['ai', 'report']);
    expect([...tokenize('오늘 삼성전자 그리고 시장 봄')]).toEqual(['삼성전자', '시장']);
  });

  it('keeps Korean 2-char tokens and topical acronyms, drops other short fragments', () => {
    const tokens = tokenize('시장 ai ok 반도체');
    expect(tokens.has('시장')).toBe(true);
    expect(tokens.has('반도체')).toBe(true);
    // 'ai' is exactly the kind of token that should cluster across sources.
    expect(tokens.has('ai')).toBe(true);
    expect(tokens.has('ok')).toBe(false);
  });

  it('caps at 20 tokens and never throws on empty input', () => {
    const long = Array.from({ length: 30 }, (_, i) => `token${i}word`).join(' ');
    expect(tokenize(long).size).toBe(20);
    expect(tokenize('').size).toBe(0);
    expect(tokenize('!!! ??? ...').size).toBe(0);
  });
});

describe('clusterByTopic', () => {
  it('groups items sharing a topic across distinct sources', () => {
    const clusters = clusterByTopic(topicItems());
    expect(clusters).toHaveLength(1);
    const c = clusters[0]!;
    expect(c.items.map((i) => i.id).sort()).toEqual(['a1', 'p1', 'v1']);
    expect(c.sources).toHaveLength(3);
    expect(c.topic.length).toBeGreaterThan(0);
    expect(c.topic.length).toBeLessThanOrEqual(60);
  });

  it('drops clusters that live inside a single source', () => {
    const single = [
      item('x1', 'article', '매일경제', '삼성전자 반도체 실적 발표'),
      item('x2', 'article', '매일경제', '삼성전자 반도체 투자 확대')
    ];
    expect(clusterByTopic(single)).toEqual([]);
  });

  it('returns nothing when no titles overlap', () => {
    const distinct = [
      item('x1', 'article', '매일경제', '부동산 시장 금리 동향'),
      item('x2', 'post', 'Hacker News', '러스트 컴파일러 성능 개선')
    ];
    expect(clusterByTopic(distinct)).toEqual([]);
  });

  it('honors minSources and maxClusters options', () => {
    const single = [
      item('x1', 'article', '매일경제', '삼성전자 반도체 실적 발표'),
      item('x2', 'article', '매일경제', '삼성전자 반도체 투자 확대')
    ];
    const loose = clusterByTopic(single, { minSources: 1 });
    expect(loose.length).toBeGreaterThanOrEqual(1);
    expect(clusterByTopic(topicItems(), { maxClusters: 0 })).toEqual([]);
  });

  it('trims long topics to about 60 chars', () => {
    const long = '삼성전자 반도체 실적 발표와 함께 살펴보는 아주 길고 긴 제목이 계속 이어지는 경우의 헤드라인 테스트 문장입니다';
    const clusters = clusterByTopic([
      item('x1', 'article', '매일경제', long),
      item('x2', 'post', 'Hacker News', `${long} 추가`)
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.topic.length).toBeLessThanOrEqual(60);
  });

  it('is deterministic: same input twice yields identical output', () => {
    const items = topicItems();
    expect(clusterByTopic(items)).toEqual(clusterByTopic(items));
  });
});

describe('interleaveBySource', () => {
  it('round-robins across sources preserving per-source order', () => {
    const items = [
      item('a1', 'article', 'A', '하나'),
      item('a2', 'article', 'A', '둘'),
      item('a3', 'article', 'A', '셋'),
      item('b1', 'article', 'B', '넷'),
      item('b2', 'article', 'B', '다섯')
    ];
    expect(interleaveBySource(items).map((i) => i.id)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3']);
  });

  it('keeps a single-source list unchanged and handles empty input', () => {
    const items = [item('a1', 'article', 'A', '하나'), item('a2', 'article', 'A', '둘')];
    expect(interleaveBySource(items).map((i) => i.id)).toEqual(['a1', 'a2']);
    expect(interleaveBySource([])).toEqual([]);
  });

  it('is deterministic', () => {
    const items = [
      item('a1', 'article', 'A', '하나'),
      item('b1', 'article', 'B', '둘'),
      item('c1', 'article', 'C', '셋'),
      item('b2', 'article', 'B', '넷')
    ];
    expect(interleaveBySource(items)).toEqual(interleaveBySource(items));
  });
});

describe('buildSynthesisPoints', () => {
  it('returns empty result for empty input without throwing', () => {
    expect(buildSynthesisPoints([], [])).toEqual({ points: [], citedItems: [] });
  });

  it('builds cluster, coverage and community points with resolvable cites', () => {
    const items = topicItems();
    const { points, citedItems } = buildSynthesisPoints(items, clusterByTopic(items));
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.length).toBeLessThanOrEqual(4);
    expect(citedItems.length).toBeGreaterThanOrEqual(2);
    expect(citedItems.length).toBeLessThanOrEqual(20);
    for (const p of points) {
      expect(p.text.length).toBeGreaterThan(0);
      expect(p.text.length).toBeLessThanOrEqual(400);
      for (const c of p.cites) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(citedItems.length);
      }
    }
    expect(points[0]!.text).toContain('여러 소스가');
    expect(points.some((p) => p.text.includes('댓글 250개'))).toBe(true);
    // cited items are deduped
    const ids = citedItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cites items from different sources in the cluster point', () => {
    const items = topicItems();
    const { points, citedItems } = buildSynthesisPoints(items, clusterByTopic(items));
    const clusterPoint = points[0]!;
    const citedSources = new Set(clusterPoint.cites.map((c) => citedItems[c]!.sourceName));
    expect(citedSources.size).toBeGreaterThanOrEqual(2);
  });

  it('skips the community point when no discussion is busy enough', () => {
    const quiet = topicItems().map((i) =>
      i.kind === 'post' ? { ...i, payload: { ...i.payload, commentCount: 3 } } : i
    );
    const { points } = buildSynthesisPoints(quiet, clusterByTopic(quiet));
    expect(points.some((p) => p.text.includes('가장 활발해요'))).toBe(false);
  });

  it('is deterministic', () => {
    const items = topicItems();
    const clusters = clusterByTopic(items);
    expect(buildSynthesisPoints(items, clusters)).toEqual(buildSynthesisPoints(items, clusters));
  });
});
