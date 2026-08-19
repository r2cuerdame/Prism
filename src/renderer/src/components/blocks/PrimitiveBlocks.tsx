import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import './contentBlocks.css';

export function HeadingBlock({ block }: BlockRenderProps): ReactElement | null {
  const text = typeof block.props.text === 'string' ? block.props.text : null;
  if (!text) return null;
  const rawLevel = block.props.level;
  const level =
    typeof rawLevel === 'number' && rawLevel >= 1 && rawLevel <= 3
      ? Math.floor(rawLevel)
      : 2;
  const className = `gv-heading-l${level}`;
  if (level === 1) return <h2 className={className}>{text}</h2>;
  if (level === 3) return <h4 className={className}>{text}</h4>;
  return <h3 className={className}>{text}</h3>;
}

export function TextBlock({ block }: BlockRenderProps): ReactElement | null {
  const text = typeof block.props.text === 'string' ? block.props.text : null;
  if (!text) return null;
  return <p className="gv-text-note">{text}</p>;
}

export function DividerBlock(_props: BlockRenderProps): ReactElement {
  return <hr className="gv-divider" />;
}
