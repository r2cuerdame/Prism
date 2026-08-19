import type { ReactElement } from 'react';
import type { ComponentBlock } from '@shared/domain/layoutPlan';
import type { SourceItem } from '@shared/domain/sourceItem';
import type { SessionCommand } from '@shared/domain/commands';

/**
 * Contract every trusted block component implements. Blocks receive already
 * validated props and resolved items; they dispatch the SAME SessionCommand
 * bus that drag/resize/NL edits use. Blocks render normalized data only —
 * never source HTML (GOAL.md §2, §5).
 */
export interface BlockRenderProps {
  block: ComponentBlock;
  /** Items resolved from block.sourceItemRefs, in ref order. */
  items: SourceItem[];
  dispatch: (cmd: SessionCommand) => void;
  onOpenOriginal: (url: string) => void;
  /** Open the provenance/inspection panel for this block. */
  onInspect: (blockId: string) => void;
}

export type BlockComponent = (props: BlockRenderProps) => ReactElement | null;
