import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  shortcutHint?: string;
  action: () => void;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        background: 'var(--bg-elev-3)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-3)',
        minWidth: 200,
        zIndex: 1000,
        padding: '4px 0',
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          role="menuitem"
          aria-disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.action();
            onClose();
          }}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 12px',
            cursor: item.disabled ? 'default' : 'pointer',
            color: item.disabled ? 'var(--fg-dim)' : 'inherit',
            fontSize: 12,
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = '';
          }}
        >
          <span>{item.label}</span>
          {item.shortcutHint && (
            <span style={{ color: 'var(--fg-dim)', marginLeft: 24, fontFamily: 'var(--font-mono)' }}>
              {item.shortcutHint}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
