import { CSSProperties, ReactElement, useEffect, useState } from 'react';
import type { PluginRecord } from '../PluginManager';
import { hasBlockingFindings } from '../PluginManager';
import type { PluginFs } from '../io';
import { renderReadme } from './renderReadme';
import type { ConfigService } from '../config/ConfigService';
import type { ConfigurationContribution } from '../manifest';
import { PluginConfigForm } from './PluginConfigForm';

interface Props {
  record: PluginRecord | null;
  fs: PluginFs;
  configService?: ConfigService;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
  onUninstall: (id: string) => void;
  /** Called when the user clicks "Configure…" in the Settings section header. */
  onOpenConfig?: (pluginId: string) => void;
}

export function PluginDetailPane(p: Props): ReactElement {
  const { record, fs } = p;
  const [readmeHtml, setReadmeHtml] = useState<string | null>(null);
  const [readmeMissing, setReadmeMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReadmeHtml(null);
    setReadmeMissing(false);
    if (!record) return;
    (async () => {
      const md = fs.readPluginFile
        ? await fs.readPluginFile(record.dir, 'README.md')
        : null;
      if (cancelled) return;
      if (md === null) setReadmeMissing(true);
      else setReadmeHtml(renderReadme(md));
    })();
    return () => { cancelled = true; };
  }, [record?.id, fs]);

  if (!record) {
    return (
      <section className="plugin-detail empty" style={emptyStyle}>
        Select a plugin to view details.
      </section>
    );
  }

  const blocked = hasBlockingFindings(record);
  const active  = record.state === 'active';

  return (
    <section className="plugin-detail" aria-label="Plugin detail" style={paneStyle}>
      <header style={detailHeaderStyle}>
        <div style={titleRowStyle}>
          <h3 style={nameStyle}>{record.manifest?.name ?? record.id}</h3>
          {record.manifest && <span style={metaStyle}>v{record.manifest.version}</span>}
          <span style={stateBadgeStyle(record.state)}>{record.state}</span>
        </div>
        <div style={actionsStyle}>
          {active
            ? <button onClick={() => p.onDisable(record.id)} style={btnStyle}>Disable</button>
            : <button disabled={blocked}
                      title={blocked ? 'Fix blocking findings before enabling' : undefined}
                      onClick={() => p.onEnable(record.id)} style={primaryBtnStyle(blocked)}>Enable</button>}
          <button onClick={() => p.onUninstall(record.id)} style={btnStyle}>Uninstall</button>
        </div>
      </header>

      {record.findings.length > 0 && (
        <section role="region" aria-label="Findings" className="findings">
          {record.findings.map((f, i) => (
            <div key={i} data-severity={f.severity} className={`finding finding-${f.severity}`}>
              <strong>{f.severity === 'error' ? '⛔' : '⚠'} {f.message}</strong>
              {f.fixHint && <div className="fix-hint">{f.fixHint}</div>}
            </div>
          ))}
        </section>
      )}

      {record.manifest?.contributes?.configuration && p.configService && (
        <SettingsSection
          schema={record.manifest.contributes.configuration}
          configService={p.configService}
          onOpenConfig={p.onOpenConfig ? () => p.onOpenConfig!(record.id) : undefined}
        />
      )}

      <section className="readme-section">
        <h4>README</h4>
        {readmeHtml === null && !readmeMissing && <p>Loading…</p>}
        {readmeMissing && <p>No README provided by this plugin.</p>}
        {readmeHtml !== null && (
          <div className="readme" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
        )}
      </section>
    </section>
  );
}

function SettingsSection(p: {
  schema: ConfigurationContribution;
  configService: ConfigService;
  /** When provided, renders a "Configure…" button that opens the dedicated route. */
  onOpenConfig?: () => void;
}): ReactElement {
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let cancelled = false;
    p.configService.getAll().then(v => { if (!cancelled) setInitial(v); });
    return () => { cancelled = true; };
  }, [p.configService]);
  if (!initial) return <section className="settings-section"><h4>Settings</h4><p>Loading…</p></section>;
  return (
    <section className="settings-section">
      <header className="settings-section-header">
        <h4>Settings</h4>
        {p.onOpenConfig && (
          <button type="button" onClick={p.onOpenConfig}>Configure…</button>
        )}
      </header>
      <PluginConfigForm
        compact
        schema={p.schema}
        initialValues={initial}
        onSave={async (values) => {
          await p.configService.save(values);
          setInitial(values);
        }}
        onCancel={() => {}}
      />
    </section>
  );
}

const paneStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg)',
  overflowY: 'auto',
};

const emptyStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--fg-dim)',
  fontSize: 13,
  background: 'var(--bg)',
};

const detailHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 16px',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
};

const titleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  flex: 1,
  minWidth: 0,
};

const nameStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  margin: 0,
  color: 'var(--fg)',
};

const metaStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-dim)',
};

function stateBadgeStyle(state: string): CSSProperties {
  const palette: Record<string, { bg: string; fg: string }> = {
    active:       { bg: 'rgba(80,160,80,0.18)',  fg: '#4caf50' },
    discovered:   { bg: 'rgba(120,140,180,0.18)', fg: 'var(--fg-dim)' },
    failed:       { bg: 'rgba(200,80,80,0.18)',  fg: '#e57373' },
    broken:       { bg: 'rgba(200,80,80,0.18)',  fg: '#e57373' },
    incompatible: { bg: 'rgba(200,140,80,0.18)', fg: '#ffb74d' },
    disabled:     { bg: 'rgba(120,120,120,0.18)', fg: 'var(--fg-dim)' },
  };
  const c = palette[state] ?? palette.discovered;
  return {
    fontSize: 11,
    fontWeight: 500,
    padding: '2px 8px',
    borderRadius: 10,
    background: c.bg,
    color: c.fg,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };
}

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexShrink: 0,
};

const btnStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 3,
  color: 'var(--fg)',
  fontSize: 12,
  padding: '4px 10px',
  cursor: 'pointer',
};

function primaryBtnStyle(disabled: boolean): CSSProperties {
  return {
    ...btnStyle,
    borderColor: disabled ? 'var(--border)' : 'var(--accent)',
    color: disabled ? 'var(--fg-dim)' : 'var(--accent)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}
