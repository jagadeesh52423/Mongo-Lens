import { Button, Text } from '../../ui';
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
 * + export buttons + right-aligned status text.
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
      {modes.map((mode) => (
        <Button
          key={mode.id}
          size="sm"
          onClick={() => onChangeView(mode.id)}
          disabled={view === mode.id}
        >
          {mode.label}
        </Button>
      ))}
      <Button size="sm" onClick={onExportCsv} disabled={exportDisabled}>Export CSV</Button>
      <Button size="sm" onClick={onExportJson} disabled={exportDisabled}>Export JSON</Button>
      <span className={styles.status}>
        <Text variant="dim">{statusText}</Text>
      </span>
    </div>
  );
}
