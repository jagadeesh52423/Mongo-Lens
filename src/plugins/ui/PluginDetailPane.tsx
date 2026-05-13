import { ReactElement, useEffect, useState } from 'react';
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
    return <section className="plugin-detail empty">Select a plugin to view details.</section>;
  }

  const blocked = hasBlockingFindings(record);
  const active  = record.state === 'active';

  return (
    <section className="plugin-detail" aria-label="Plugin detail">
      <header>
        <h3>{record.manifest?.name ?? record.id}</h3>
        {record.manifest && <span> v{record.manifest.version}</span>}
        <span> — {record.state}</span>
        <span>
          {active
            ? <button onClick={() => p.onDisable(record.id)}>Disable</button>
            : <button disabled={blocked} title={blocked ? 'Fix blocking findings before enabling' : undefined}
                      onClick={() => p.onEnable(record.id)}>Enable</button>}
          <button onClick={() => p.onUninstall(record.id)}>Uninstall</button>
        </span>
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
      <h4>Settings</h4>
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
