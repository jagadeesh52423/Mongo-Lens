import { ReactElement } from 'react';
import type { PluginRecord } from '../PluginManager';

interface Props {
  records: PluginRecord[];
  onInstall:   () => void;
  onEnable:    (id: string) => void;
  onDisable:   (id: string) => void;
  onUninstall: (id: string) => void;
}

export function PluginsSettingsPane(p: Props): ReactElement {
  return (
    <section aria-label="Plugins">
      <header>
        <h2>Plugins</h2>
        <button onClick={p.onInstall}>Install from folder…</button>
      </header>
      <ul>
        {p.records.map((rec) => (
          <li key={rec.id}>
            <strong>{rec.manifest?.name ?? rec.id}</strong>
            {rec.manifest && <> v{rec.manifest.version}</>}
            <span> — {rec.state}</span>
            {rec.errors && <small> ({rec.errors.join('; ')})</small>}
            <span>
              {rec.state === 'active'
                ? <button onClick={() => p.onDisable(rec.id)}>Disable</button>
                : <button onClick={() => p.onEnable(rec.id)}>Enable</button>}
              <button onClick={() => p.onUninstall(rec.id)}>Uninstall</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
