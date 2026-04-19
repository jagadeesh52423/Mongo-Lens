import type { CSSProperties } from 'react';
import { getSections } from './registry';
import { useSettingsStore } from '../store/settings';
import './sections/ShortcutsSection';
import './sections/ThemeSection';

interface Props {
  onClose: () => void;
}

export function SettingsView({ onClose }: Props) {
  const activeSection = useSettingsStore((s) => s.activeSection);
  const setActiveSection = useSettingsStore((s) => s.setActiveSection);

  const sections = getSections();
  const active =
    sections.find((s) => s.id === activeSection) ?? sections[0];
  const ActiveComponent = active?.component;

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <button onClick={onClose} style={backButtonStyle} aria-label="Back">
          ← Back
        </button>
        <div style={titleStyle}>SETTINGS</div>
      </div>
      <div style={bodyStyle}>
        <nav style={navStyle}>
          {sections.map((section) => {
            const isActive = active?.id === section.id;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                style={navItemStyle(isActive)}
              >
                <span style={navIconStyle}>{section.icon}</span>
                <span>{section.label}</span>
              </button>
            );
          })}
        </nav>
        <div style={contentStyle}>
          {ActiveComponent && <ActiveComponent />}
        </div>
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  height: '100%',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: 36,
  padding: '0 12px',
  background: 'var(--bg-panel)',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
  gap: 16,
};

const backButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 3,
  color: 'var(--fg)',
  fontSize: 12,
  padding: '3px 10px',
  cursor: 'pointer',
};

const titleStyle: CSSProperties = {
  color: 'var(--accent)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 1,
  textTransform: 'uppercase',
};

const bodyStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const navStyle: CSSProperties = {
  width: 200,
  background: 'var(--bg)',
  borderRight: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  padding: '8px 0',
  flexShrink: 0,
  overflowY: 'auto',
};

function navItemStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    height: 32,
    padding: '0 14px',
    background: active ? 'var(--bg-hover)' : 'transparent',
    border: 'none',
    borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
    color: active ? 'var(--fg)' : 'var(--fg-dim)',
    fontSize: 13,
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: 0,
  };
}

const navIconStyle: CSSProperties = {
  fontSize: 14,
  width: 18,
  display: 'inline-flex',
  justifyContent: 'center',
};

const contentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'auto',
  background: 'var(--bg)',
};
