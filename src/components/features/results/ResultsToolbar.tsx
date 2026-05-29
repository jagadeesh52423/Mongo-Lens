import { Button } from '../../ui';
import { viewModeRegistry } from './viewModes';
import styles from './ResultsToolbar.module.css';

interface Props {
  view: string;
  onChangeView: (id: string) => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  exportDisabled: boolean;
  statusText: string;
}

/**
 * Top toolbar: view-mode selector (driven entirely by viewModeRegistry.list())
 * as a segmented control + export buttons + right-aligned status text.
 */
export function ResultsToolbar({
  view,
  onChangeView,
  onExportCsv,
  onExportJson,
  exportDisabled,
  statusText,
}: Props) {
  const modes = viewModeRegistry.list();
  return (
    <div className={styles.toolbar}>
      <div className={styles.segmented} role="group" aria-label="View mode">
        {modes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => onChangeView(mode.id)}
            aria-pressed={view === mode.id}
            className={`${styles.segment} ${view === mode.id ? styles.segmentActive : ''}`}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <Button size="sm" onClick={onExportCsv} disabled={exportDisabled}>Export CSV</Button>
      <Button size="sm" onClick={onExportJson} disabled={exportDisabled}>Export JSON</Button>
      <span className={styles.status}>{statusText}</span>
    </div>
  );
}
