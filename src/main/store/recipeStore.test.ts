import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Recipe } from '@shared/domain/recipe';
import { createRecipeStore } from './recipeStore';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gptb-'));
}

function makeRecipe(id: string, name: string, at: string): Recipe {
  return {
    id,
    name,
    intentTemplate: '저녁에 볼만한 영상',
    sourcePreferences: { include: [], exclude: [] },
    compositionPreferences: { balance: {}, density: 'comfortable' },
    layoutTemplate: [],
    compositionHints: { mix: {}, notes: [] },
    preferenceScope: 'recipe',
    createdAt: at,
    updatedAt: at
  };
}

describe('recipeStore', () => {
  it('starts empty', async () => {
    const store = createRecipeStore(await tmpDir());
    expect(await store.list()).toEqual([]);
  });

  it('saves, upserts by id and bumps updatedAt', async () => {
    const store = createRecipeStore(await tmpDir());
    const old = '2020-01-01T00:00:00.000Z';
    await store.save(makeRecipe('r1', '아침 뉴스', old));
    const after = await store.save(makeRecipe('r1', '아침 뉴스 v2', old));
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('아침 뉴스 v2');
    expect(after[0].updatedAt > old).toBe(true);
  });

  it('lists sorted by updatedAt desc', async () => {
    const store = createRecipeStore(await tmpDir());
    await store.save(makeRecipe('r1', '첫째', '2020-01-01T00:00:00.000Z'));
    await new Promise((r) => setTimeout(r, 5));
    await store.save(makeRecipe('r2', '둘째', '2020-01-01T00:00:00.000Z'));
    const list = await store.list();
    expect(list.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('still loads a recipes.json written by the older schema', async () => {
    const dir = await tmpDir();
    // Exactly what the previous version wrote: bare slots, no compositionHints.
    const legacy = [
      {
        id: 'r_old',
        name: '예전 레시피',
        intentTemplate: '아침 뉴스',
        sourcePreferences: { include: [], exclude: [] },
        compositionPreferences: { balance: {}, density: 'comfortable' },
        layoutTemplate: [
          { componentType: 'article_list', span: 6 },
          { componentType: 'source_list', span: 12 }
        ],
        preferenceScope: 'recipe',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z'
      }
    ];
    await fs.writeFile(path.join(dir, 'recipes.json'), JSON.stringify(legacy), 'utf8');
    const list = await createRecipeStore(dir).list();
    expect(list).toHaveLength(1);
    expect(list[0].layoutTemplate.map((s) => s.componentType)).toEqual([
      'article_list',
      'source_list'
    ]);
    expect(list[0].compositionHints).toEqual({ mix: {}, notes: [] });
  });

  it('round-trips a fully shaped recipe', async () => {
    const dir = await tmpDir();
    const rich: Recipe = {
      ...makeRecipe('r_rich', '저녁 믹스', '2020-01-01T00:00:00.000Z'),
      layoutTemplate: [
        {
          componentType: 'community_posts',
          span: 12,
          title: '오늘의 토론',
          docked: true,
          locked: true,
          props: { maxItems: 4, showMeta: false }
        },
        { componentType: 'article_list', span: 6, props: { density: 'compact' } }
      ],
      compositionPreferences: { balance: { video: 0.2 }, density: 'compact' },
      compositionHints: { mix: { video: 'less' }, notes: ['영상 줄여', '더 짧게'] }
    };
    await createRecipeStore(dir).save(rich);
    const [loaded] = await createRecipeStore(dir).list();
    expect(loaded.layoutTemplate).toEqual(rich.layoutTemplate);
    expect(loaded.compositionHints).toEqual(rich.compositionHints);
    expect(loaded.compositionPreferences.density).toBe('compact');
  });

  it('removes by id', async () => {
    const store = createRecipeStore(await tmpDir());
    await store.save(makeRecipe('r1', 'a', '2020-01-01T00:00:00.000Z'));
    await store.save(makeRecipe('r2', 'b', '2020-01-01T00:00:00.000Z'));
    const after = await store.remove('r1');
    expect(after.map((r) => r.id)).toEqual(['r2']);
    expect((await store.list()).map((r) => r.id)).toEqual(['r2']);
  });
});
