import * as path from 'path';
import { z } from 'zod';
import { RecipeSchema, type Recipe } from '@shared/domain/recipe';
import { nowIso } from '@shared/domain/ids';
import { JsonStore } from './jsonStore';

const RecipesFileSchema = z.array(RecipeSchema);

export interface RecipeStore {
  list(): Promise<Recipe[]>;
  save(recipe: Recipe): Promise<Recipe[]>;
  remove(id: string): Promise<Recipe[]>;
}

function sortByUpdatedDesc(recipes: Recipe[]): Recipe[] {
  return [...recipes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createRecipeStore(dir: string): RecipeStore {
  const store = new JsonStore<Recipe[]>(
    path.join(dir, 'recipes.json'),
    RecipesFileSchema,
    () => []
  );

  return {
    async list() {
      return sortByUpdatedDesc(await store.load());
    },
    async save(recipe) {
      const all = await store.load();
      const next: Recipe = { ...recipe, updatedAt: nowIso() };
      const idx = all.findIndex((r) => r.id === recipe.id);
      if (idx >= 0) all[idx] = next;
      else all.push(next);
      await store.save(all);
      return sortByUpdatedDesc(all);
    },
    async remove(id) {
      const all = (await store.load()).filter((r) => r.id !== id);
      await store.save(all);
      return sortByUpdatedDesc(all);
    }
  };
}
