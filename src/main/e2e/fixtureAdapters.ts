import { newId } from '@shared/domain/ids';
import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import type { AdapterResult, SourceAdapter, SourceRequest } from '../sources/types';

/**
 * Three deterministic, network-free sources for the E2E run and for
 * integration tests: a newspaper, a community and a video channel that all
 * cover the SAME three topics, so a correctly composed page must show topic
 * clusters that mix them. The item order and titles never change between
 * runs; only ids and timestamps are minted per gather (like every adapter).
 */

interface FixtureRow {
  title: string;
  summary: string;
  path: string;
}

interface FixtureSpec {
  id: string;
  name: string;
  host: string;
  kind: SourceItemKind;
  classes: SourceAdapter['classes'];
  rows: FixtureRow[];
}

const TOPICS = ['반도체 수출', '전기차 보조금', '우주 발사체'];

function rowsFor(kind: SourceItemKind, host: string): FixtureRow[] {
  const suffix: Record<SourceItemKind, string[]> = {
    article: ['두 달 연속 증가', '개편안 발표', '재사용 성공', '전망은 엇갈려'],
    post: ['커뮤니티 반응은?', '개편 토론', '실험 후기', '이게 맞나요'],
    video: ['현장 영상', '브이로그', '라이브 다시보기', '요약 영상'],
    headline: ['속보', '단독', '분석', '해설']
  };
  const out: FixtureRow[] = [];
  TOPICS.forEach((topic, i) => {
    suffix[kind].slice(0, 2).forEach((s, j) => {
      out.push({
        title: `${topic} ${s}`,
        summary: `${host}에서 다룬 ${topic} 이야기 ${i + 1}-${j + 1}.`,
        path: `/${kind}/${i + 1}-${j + 1}`
      });
    });
  });
  return out;
}

const SPECS: FixtureSpec[] = [
  {
    id: 'fixture-news',
    name: '픽스처 뉴스',
    host: 'news.fixture.local',
    kind: 'article',
    classes: ['news'],
    rows: rowsFor('article', '픽스처 뉴스')
  },
  {
    id: 'fixture-community',
    name: '픽스처 커뮤니티',
    host: 'talk.fixture.local',
    kind: 'post',
    classes: ['community'],
    rows: rowsFor('post', '픽스처 커뮤니티')
  },
  {
    id: 'fixture-video',
    name: '픽스처 영상',
    host: 'tube.fixture.local',
    kind: 'video',
    classes: ['video'],
    rows: rowsFor('video', '픽스처 영상')
  }
];

function toAdapter(spec: FixtureSpec): SourceAdapter {
  return {
    id: spec.id,
    name: spec.name,
    classes: spec.classes,
    matches(_req: SourceRequest): number {
      return 1;
    },
    async fetchItems(req, ctx): Promise<AdapterResult> {
      const retrievedAt = ctx.now().toISOString();
      const items: SourceItem[] = [];
      const provenance: Provenance[] = [];
      for (const row of spec.rows.slice(0, Math.max(2, req.limit))) {
        const originalUrl = `https://${spec.host}${row.path}`;
        const prov: Provenance = {
          id: newId('prov'),
          sourceUrl: originalUrl,
          sourceName: spec.name,
          adapterId: spec.id,
          retrievedAt,
          transformations: ['deterministic local fixture']
        };
        const payload: Record<string, unknown> =
          spec.kind === 'post'
            ? { community: spec.name, points: 42, commentCount: 7 }
            : spec.kind === 'video'
              ? { videoId: `fx${row.path.replace(/\W/g, '')}`, channel: spec.name }
              : { source: spec.name, excerpt: row.summary };
        items.push({
          id: newId('item'),
          adapterId: spec.id,
          sourceId: spec.host,
          sourceName: spec.name,
          kind: spec.kind,
          title: row.title,
          summary: row.summary,
          payload,
          originalUrl,
          publishedAt: '2026-09-01T09:00:00.000Z',
          retrievedAt,
          provenanceRef: prov.id,
          lang: 'ko'
        });
        provenance.push(prov);
      }
      return { items, provenance, errors: [] };
    }
  };
}

export const FIXTURE_ADAPTERS: SourceAdapter[] = SPECS.map(toAdapter);

/** `PRISM_E2E_FIXTURES=1` switches main to the local fixture world. */
export function isFixtureMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env['PRISM_E2E_FIXTURES'];
  return v === '1' || v === 'true';
}
