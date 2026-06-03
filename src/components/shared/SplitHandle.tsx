import { useState } from 'react';
import { PanelResizeHandle } from 'react-resizable-panels';

interface Props {
  direction: 'horizontal' | 'vertical';
}

export function SplitHandle({ direction }: Props) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const isHorizontal = direction === 'horizontal';
  const isActive = hover || dragging;

  const containerStyle: React.CSSProperties = isHorizontal
    ? {
        width: 4,
        height: '100%',
        cursor: 'col-resize',
        background: isActive ? 'var(--accent)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }
    : {
        width: '100%',
        height: 4,
        cursor: 'row-resize',
        background: isActive ? 'var(--accent)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      };

  const gripStyle: React.CSSProperties = isHorizontal
    ? {
        width: 2,
        height: 24,
        background: isActive ? 'var(--bg)' : 'var(--fg-dim)',
        borderRadius: 1,
      }
    : {
        width: 24,
        height: 2,
        background: isActive ? 'var(--bg)' : 'var(--fg-dim)',
        borderRadius: 1,
      };

  return (
    <PanelResizeHandle onDragging={setDragging}>
      <div
        style={containerStyle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div style={gripStyle} />
      </div>
    </PanelResizeHandle>
  );
}
