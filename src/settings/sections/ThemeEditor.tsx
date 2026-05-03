import { useEffect, useReducer } from 'react';
import { getTheme } from '../../themes/registry';
import { getOverrides, setVariable, resetVariable, resetTheme, subscribe } from '../../themes/overrides';
import { VARIABLE_SCHEMA, VARIABLE_GROUP_ORDER, type VariableSpec } from '../../themes/variableSchema';
import { applyTheme, applyMonacoTheme } from '../../themes/applyTheme';
import { useSettingsStore } from '../../store/settings';

interface ThemeEditorProps {
  themeId: string;
  onBack: () => void;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function toColorInputValue(raw: string): string {
  return HEX_RE.test(raw) ? raw : '#000000';
}

export function ThemeEditor({ themeId, onBack }: ThemeEditorProps) {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const isActive = useSettingsStore((s) => s.themeId) === themeId;

  useEffect(() => subscribe(forceUpdate), [themeId]);

  const baseTheme = getTheme(themeId);

  if (!baseTheme) {
    return (
      <div style={{ padding: 24, color: 'var(--fg)' }}>
        <button
          aria-label="Back to themes"
          onClick={onBack}
          style={backBtnStyle}
        >
          ← Back
        </button>
        <p style={{ marginTop: 16, color: 'var(--fg-dim)', fontSize: 13 }}>Theme not found.</p>
      </div>
    );
  }

  const overrides = getOverrides(themeId);
  const hasOverrides = Object.keys(overrides).length > 0;

  const handleChange = (varName: string, value: string) => {
    const baseValue = baseTheme.variables[varName];
    if (value === baseValue) {
      resetVariable(themeId, varName);
    } else {
      setVariable(themeId, varName, value);
    }
    if (isActive) {
      applyTheme(themeId);
      applyMonacoTheme(themeId);
    }
  };

  const handleReset = (varName: string) => {
    resetVariable(themeId, varName);
    if (isActive) {
      applyTheme(themeId);
      applyMonacoTheme(themeId);
    }
  };

  const handleResetAll = () => {
    resetTheme(themeId);
    if (isActive) {
      applyTheme(themeId);
      applyMonacoTheme(themeId);
    }
  };

  return (
    <div style={{ padding: 24, color: 'var(--fg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            aria-label="Back to themes"
            onClick={onBack}
            style={backBtnStyle}
          >
            ← Back
          </button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{baseTheme.name}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 2 }}>
              Customizing — changes save automatically
            </div>
          </div>
        </div>
        <button
          onClick={handleResetAll}
          disabled={!hasOverrides}
          aria-disabled={!hasOverrides}
          style={{
            ...actionBtnStyle,
            opacity: hasOverrides ? 1 : 0.4,
            cursor: hasOverrides ? 'pointer' : 'default',
          }}
        >
          Reset all
        </button>
      </div>

      {VARIABLE_GROUP_ORDER.map((group) => {
        const specs = VARIABLE_SCHEMA.filter((s) => s.group === group);
        return (
          <section key={group} style={{ marginBottom: 24 }}>
            <div style={groupHeaderStyle}>{group}</div>
            {specs.map((spec) => (
              <VariableRow
                key={spec.name}
                spec={spec}
                baseValue={baseTheme.variables[spec.name] ?? ''}
                override={overrides[spec.name]}
                onChange={handleChange}
                onReset={handleReset}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

interface VariableRowProps {
  spec: VariableSpec;
  baseValue: string;
  override: string | undefined;
  onChange: (varName: string, value: string) => void;
  onReset: (varName: string) => void;
}

function VariableRow({ spec, baseValue, override, onChange, onReset }: VariableRowProps) {
  const currentValue = override ?? baseValue;
  const inputId = `theme-var-${spec.name}`;
  const hasOverride = override !== undefined;

  return (
    <div style={rowStyle}>
      <label htmlFor={inputId} style={labelStyle}>
        {spec.label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {renderInput(spec, inputId, currentValue, onChange)}
        {hasOverride ? (
          <button
            aria-label={`Reset ${spec.label}`}
            onClick={() => onReset(spec.name)}
            style={resetLinkStyle}
          >
            Reset
          </button>
        ) : (
          // Reserve space so the row doesn't shift when Reset appears/disappears
          <span style={{ width: 38 }} />
        )}
      </div>
    </div>
  );
}

function renderInput(
  spec: VariableSpec,
  inputId: string,
  currentValue: string,
  onChange: (varName: string, value: string) => void,
): React.ReactNode {
  switch (spec.kind) {
    case 'color':
      return (
        <input
          id={inputId}
          type="color"
          value={toColorInputValue(currentValue)}
          onChange={(e) => onChange(spec.name, e.target.value)}
          style={colorInputStyle}
        />
      );
    case 'font':
      return (
        <input
          id={inputId}
          type="text"
          value={currentValue}
          onChange={(e) => onChange(spec.name, e.target.value)}
          style={textInputStyle}
          spellCheck={false}
        />
      );
  }
}

const backBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-panel)',
  color: 'var(--fg)',
  fontSize: 13,
  cursor: 'pointer',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-panel)',
  color: 'var(--fg)',
  fontSize: 13,
  cursor: 'pointer',
};

const groupHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--fg-dim)',
  marginBottom: 6,
  paddingBottom: 4,
  borderBottom: '1px solid var(--border)',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 0',
  borderBottom: '1px solid var(--border)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--fg)',
  flex: 1,
};

const colorInputStyle: React.CSSProperties = {
  width: 32,
  height: 28,
  padding: 2,
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-panel)',
  cursor: 'pointer',
};

const textInputStyle: React.CSSProperties = {
  width: 220,
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-panel)',
  color: 'var(--fg)',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
};

const resetLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '0 2px',
  color: 'var(--accent)',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline',
  width: 38,
  textAlign: 'right',
};
