import { useState } from 'react';
import { PanelResizeHandle } from 'react-resizable-panels';

interface Props {
  direction: 'horizontal' | 'vertical';
}

export function SplitHandle({ direction }: Props) {
  const [hover, setHover] = useState(false);
  const isHorizontal = direction === 'horizontal';

  const containerStyle: React.CSSProperties = isHorizontal
    ? {
        width: 4,
        cursor: 'col-resize',
        background: hover ? 'var(--accent)' : 'var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 120ms ease',
      }
    : {
        height: 4,
        cursor: 'row-resize',
        background: hover ? 'var(--accent)' : 'var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 120ms ease',
      };

  const gripStyle: React.CSSProperties = isHorizontal
    ? {
        width: 2,
        height: 24,
        background: hover ? 'var(--bg)' : 'var(--fg-dim)',
        borderRadius: 1,
      }
    : {
        width: 24,
        height: 2,
        background: hover ? 'var(--bg)' : 'var(--fg-dim)',
        borderRadius: 1,
      };

  return (
    <PanelResizeHandle>
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
