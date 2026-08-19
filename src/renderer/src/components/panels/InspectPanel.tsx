import type { ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';
import { getCatalogEntry } from '@shared/catalog/catalog';

/**
 * Provenance surface: why a block exists, where every item came from,
 * and the path to the Original (GOAL.md §5).
 */
export default function InspectPanel(): ReactElement | null {
  const state = useAppState();
  const act = state.activeId ? state.sessions[state.activeId] : undefined;
  const session = act?.history.present;
  const block = session?.plan?.blocks.find((b) => b.id === state.inspectBlockId);
  if (!session || !block) {
    return <p className="panel-note">블록을 선택하면 출처와 근거가 여기에 표시돼요.</p>;
  }
  const entry = getCatalogEntry(block.componentType);
  const items = block.sourceItemRefs
    .map((id) => session.items[id])
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const meta = session.plan?.plannerMetadata;

  return (
    <div className="inspect-panel">
      <h3>{entry?.title ?? block.componentType}</h3>
      {block.rationale && (
        <p className="inspect-rationale">
          <strong>이 블록이 나온 이유</strong> — {block.rationale}
        </p>
      )}
      <dl className="inspect-meta">
        <dt>컴포넌트</dt>
        <dd>
          {block.componentType} v{block.componentVersion}
        </dd>
        <dt>플래너</dt>
        <dd>
          {meta?.planner === 'llm' ? `LLM (${meta.model ?? '?'})` : '휴리스틱 (오프라인)'}
          {meta ? ` · ${new Date(meta.generatedAt).toLocaleString('ko-KR')}` : ''}
        </dd>
      </dl>
      <h4>콘텐츠 출처 ({items.length})</h4>
      <ul className="inspect-items">
        {items.map((item) => (
          <li key={item.id}>
            <div className="inspect-item-title">{item.title}</div>
            <div className="inspect-item-meta">
              <span className="gv-src-chip-static">{item.sourceName}</span>
              <span>{item.kind}</span>
              <span>어댑터 {item.adapterId}</span>
              {item.publishedAt && (
                <span>{new Date(item.publishedAt).toLocaleString('ko-KR')}</span>
              )}
              <span>수집 {new Date(item.retrievedAt).toLocaleTimeString('ko-KR')}</span>
            </div>
            {(() => {
              const record = session.provenance[item.provenanceRef];
              if (!record || record.transformations.length === 0) return null;
              return (
                <div className="inspect-transforms">
                  적용된 변환: {record.transformations.join(' · ')}
                </div>
              );
            })()}
            <button className="inspect-original" onClick={() => appStore.openOriginal(item.originalUrl)}>
              원본 열기 ↗
            </button>
            <div className="inspect-url">{item.originalUrl}</div>
          </li>
        ))}
      </ul>
      {act && act.issues.length > 0 && (
        <>
          <h4>구성 진단</h4>
          <ul className="inspect-issues">
            {act.issues.map((iss, i) => (
              <li key={i}>{iss}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
