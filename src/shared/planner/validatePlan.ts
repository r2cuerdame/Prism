import {
  ComponentBlockSchema,
  LayoutPlanSchema,
  PlannerMetadataSchema,
  type ComponentBlock,
  type LayoutPlan,
  type PlannerMetadata
} from '@shared/domain/layoutPlan';
import type { SourceItem } from '@shared/domain/sourceItem';
import { getCatalogEntry } from '@shared/catalog/catalog';
import { newId, nowIso } from '@shared/domain/ids';
import type { PlanResult } from './plannerTypes';

const FALLBACK_TEXT = '페이지 구성을 만들지 못했어요. 다시 시도해 주세요.';

function fallbackTextBlock(): ComponentBlock {
  return {
    id: newId('blk'),
    componentType: 'text',
    componentVersion: 1,
    sourceItemRefs: [],
    props: { text: FALLBACK_TEXT },
    layout: { span: 12 },
    locked: false,
    docked: false,
    state: {}
  };
}

function defaultMetadata(): PlannerMetadata {
  return { planner: 'llm', generatedAt: nowIso(), diagnostics: [] };
}

function fallbackPlan(sessionId: string): LayoutPlan {
  return {
    id: newId('plan'),
    version: 1,
    sessionId,
    blocks: [fallbackTextBlock()],
    generationScope: 'full',
    preservedEdits: { dockedBlockIds: [] },
    plannerMetadata: defaultMetadata()
  };
}

function salvagePlan(raw: unknown, sessionId: string, issues: string[]): LayoutPlan | null {
  if (raw === null || typeof raw !== 'object') return null;
  const rawObj = raw as Record<string, unknown>;
  if (!Array.isArray(rawObj.blocks)) return null;

  const blocks: ComponentBlock[] = [];
  rawObj.blocks.forEach((b: unknown, i: number) => {
    const parsed = ComponentBlockSchema.safeParse(b);
    if (parsed.success) {
      blocks.push(parsed.data);
    } else {
      issues.push(
        `블록 ${i} 복구 실패: ${parsed.error.issues.map((iss) => `${iss.path.join('.')} ${iss.message}`).join('; ')}`
      );
    }
  });
  issues.push('구조 검증 실패: 블록 단위로 복구했습니다.');

  const meta = PlannerMetadataSchema.safeParse(rawObj.plannerMetadata);
  let dockedBlockIds: string[] = [];
  const pe = rawObj.preservedEdits;
  if (pe !== null && typeof pe === 'object' && Array.isArray((pe as Record<string, unknown>).dockedBlockIds)) {
    dockedBlockIds = ((pe as Record<string, unknown>).dockedBlockIds as unknown[]).filter(
      (x): x is string => typeof x === 'string'
    );
  }

  return {
    id: typeof rawObj.id === 'string' && rawObj.id.length > 0 ? rawObj.id : newId('plan'),
    version: 1,
    sessionId,
    blocks,
    generationScope: rawObj.generationScope === 'region' ? 'region' : 'full',
    preservedEdits: { dockedBlockIds },
    plannerMetadata: meta.success ? meta.data : defaultMetadata()
  };
}

function repairBlock(
  block: ComponentBlock,
  itemById: Map<string, SourceItem>,
  seenIds: Set<string>,
  issues: string[]
): ComponentBlock | null {
  const entry = getCatalogEntry(block.componentType);
  if (!entry) {
    issues.push(`알 수 없는 컴포넌트를 제거했습니다: ${block.componentType}`);
    return null;
  }
  const b: ComponentBlock = { ...block, layout: { ...block.layout } };

  const parsedProps = entry.propsSchema.safeParse(b.props);
  if (parsedProps.success) {
    b.props = { ...entry.defaultProps, ...(parsedProps.data as Record<string, unknown>) };
  } else {
    b.props = { ...entry.defaultProps };
    issues.push(`잘못된 props를 기본값으로 대체했습니다: ${b.componentType}`);
  }

  if (entry.acceptsKinds !== null && entry.acceptsKinds.length === 0) {
    if (b.sourceItemRefs.length > 0) {
      b.sourceItemRefs = [];
      issues.push(`항목을 받지 않는 컴포넌트의 참조를 제거했습니다: ${b.componentType}`);
    }
  } else {
    const before = b.sourceItemRefs.length;
    let refs = b.sourceItemRefs.filter((ref) => {
      const item = itemById.get(ref);
      if (!item) return false;
      return entry.acceptsKinds === null || entry.acceptsKinds.includes(item.kind);
    });
    if (refs.length < before) {
      issues.push(`유효하지 않은 항목 참조를 제거했습니다: ${b.componentType}`);
    }
    if (refs.length > entry.maxItems) {
      refs = refs.slice(0, entry.maxItems);
      issues.push(`항목 수를 최대치(${entry.maxItems})로 줄였습니다: ${b.componentType}`);
    }
    b.sourceItemRefs = refs;
    if (refs.length < entry.minItems) {
      if (entry.fallback === 'hide') {
        issues.push(`항목 부족으로 블록을 제거했습니다: ${b.componentType}`);
        return null;
      }
      issues.push(`항목 부족: 자리표시자로 유지합니다: ${b.componentType}`);
    }
  }

  const span = Math.min(entry.maxSpan, Math.max(entry.minSpan, b.layout.span));
  if (span !== b.layout.span) {
    issues.push(`span을 보정했습니다(${b.layout.span} → ${span}): ${b.componentType}`);
    b.layout.span = span;
  }

  if (seenIds.has(b.id)) {
    const old = b.id;
    b.id = newId('blk');
    issues.push(`중복 블록 id를 재생성했습니다: ${old}`);
  }
  seenIds.add(b.id);
  return b;
}

function doValidate(raw: unknown, items: SourceItem[], sessionId: string): PlanResult {
  const issues: string[] = [];

  let plan: LayoutPlan | null = null;
  const parsed = LayoutPlanSchema.safeParse(raw);
  if (parsed.success) {
    plan = parsed.data;
  } else {
    plan = salvagePlan(raw, sessionId, issues);
  }
  if (!plan) {
    issues.push('복구할 수 없는 계획: 기본 페이지로 대체합니다.');
    return { plan: fallbackPlan(sessionId), issues };
  }

  const itemById = new Map(items.map((i) => [i.id, i]));
  const seenIds = new Set<string>();
  const repaired: ComponentBlock[] = [];
  for (const block of plan.blocks) {
    const fixed = repairBlock(block, itemById, seenIds, issues);
    if (fixed) repaired.push(fixed);
  }

  if (repaired.length === 0) {
    repaired.push(fallbackTextBlock());
    issues.push('남은 블록이 없어 기본 텍스트 블록을 추가했습니다.');
  }

  return { plan: { ...plan, sessionId, blocks: repaired }, issues };
}

/** Renderer-side final gate for planner output. Repairs what it can, never throws. */
export function validateAndRepairPlan(raw: unknown, items: SourceItem[], sessionId: string): PlanResult {
  try {
    return doValidate(raw, items, sessionId);
  } catch (err) {
    return {
      plan: fallbackPlan(sessionId),
      issues: [`검증기 내부 오류: ${err instanceof Error ? err.message : String(err)}`]
    };
  }
}
