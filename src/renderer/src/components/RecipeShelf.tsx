import { useState, type ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

/**
 * Recipes: living bookmarks. Opening one regenerates the experience with
 * current content (GOAL.md § Recipe).
 */
export default function RecipeShelf(): ReactElement {
  const state = useAppState();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const active = state.activeId ? state.sessions[state.activeId] : undefined;
  const hasPlan = Boolean(active?.history.present.plan);

  const save = async (): Promise<void> => {
    const n = name.trim();
    if (n === '') return;
    setNaming(false);
    setName('');
    await appStore.saveCurrentAsRecipe(n);
  };

  return (
    <div className="recipe-shelf">
      <span className="recipe-label">레시피</span>
      {state.recipes.length === 0 && !naming && (
        <span className="recipe-empty">아직 없어요 — 마음에 드는 페이지를 저장해 보세요</span>
      )}
      {state.recipes.map((r) => (
        <span key={r.id} className="recipe-chip">
          <button
            className="recipe-run"
            title={`"${r.intentTemplate}" — 열면 새 콘텐츠로 재생성돼요`}
            onClick={() => void appStore.runRecipe(r)}
          >
            {r.name}
          </button>
          <button
            className="recipe-del"
            aria-label={`레시피 ${r.name} 삭제`}
            onClick={() => void appStore.removeRecipe(r.id)}
          >
            ×
          </button>
        </span>
      ))}
      {naming ? (
        <span className="recipe-naming">
          <input
            autoFocus
            value={name}
            placeholder="레시피 이름 (예: 저녁 믹스)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save();
              if (e.key === 'Escape') setNaming(false);
            }}
          />
          <button onClick={() => void save()}>저장</button>
        </span>
      ) : (
        <button
          className="recipe-add"
          disabled={!hasPlan}
          title="현재 페이지의 의도·구성·모양을 레시피로 저장"
          onClick={() => setNaming(true)}
        >
          ＋ 현재 페이지 저장
        </button>
      )}
    </div>
  );
}
