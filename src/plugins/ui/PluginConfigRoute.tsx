import { ReactElement, useEffect, useState } from 'react';
import type { ConfigurationContribution } from '../manifest';
import type { ConfigService } from '../config/ConfigService';
import { PluginConfigForm } from './PluginConfigForm';

interface Props {
  pluginName: string;
  schema: ConfigurationContribution | null;
  configService: ConfigService | undefined;
  onBack: () => void;
}

export function PluginConfigRoute(p: Props): ReactElement {
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!p.configService) return;
    p.configService.getAll().then(v => { if (!cancelled) setInitial(v); });
    return () => { cancelled = true; };
  }, [p.configService]);

  if (!p.schema || !p.configService) {
    return (
      <section className="plugin-config-route">
        <button type="button" onClick={p.onBack}>← Back</button>
        <p>This plugin has no configurable settings.</p>
      </section>
    );
  }

  return (
    <section className="plugin-config-route">
      <nav className="breadcrumb">
        <button type="button" onClick={p.onBack}>← Back</button>
        <span>Plugins / {p.pluginName} / Settings</span>
      </nav>
      {initial === null
        ? <p>Loading…</p>
        : <PluginConfigForm
            schema={p.schema}
            initialValues={initial}
            onSave={async (values) => {
              await p.configService!.save(values);
              setInitial(values);
            }}
            onCancel={p.onBack}
          />}
    </section>
  );
}
