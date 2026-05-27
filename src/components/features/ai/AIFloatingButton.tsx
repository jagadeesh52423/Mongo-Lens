import { useState, type CSSProperties } from 'react';
import { useAIStore } from '../../../store/ai';

export function AIFloatingButton() {
  const setPanelOpen = useAIStore((s) => s.setPanelOpen);
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      aria-label="Open AI Assistant"
      title="Open AI Assistant"
      onClick={() => setPanelOpen(true)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={buttonStyle(hover)}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>✨</span>
    </button>
  );
}

function buttonStyle(hover: boolean): CSSProperties {
  return {
    position: 'fixed',
    bottom: 24,
    right: 24,
    zIndex: 1000,
    width: 48,
    height: 48,
    borderRadius: '50%',
    border: 'none',
    background: 'linear-gradient(135deg, #4ec9b0, #3ea88f)',
    color: '#fff',
    cursor: 'pointer',
    boxShadow: hover
      ? '0 6px 18px rgba(0, 0, 0, 0.35)'
      : '0 4px 12px rgba(0, 0, 0, 0.25)',
    transform: hover ? 'scale(1.06)' : 'scale(1)',
    transition: 'transform 140ms ease, box-shadow 140ms ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };
}
