import type { TabFormProps } from './types';
import type { ToolsOverrides } from '../../../../../connection/model';
import { Button } from '../../../../ui/Button';
import { FilePicker } from './shared/FilePicker';
import styles from './ToolsTab.module.css';

interface ToolPathRowProps {
  id: string;
  label: string;
  globalValue: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}

function ToolPathRow({ id, label, globalValue, value, onChange }: ToolPathRowProps) {
  const overridden = value !== undefined;
  return (
    <>
      <div className={styles.row}>
        <div className={styles.picker}>
          <FilePicker
            id={id}
            label={label}
            value={value}
            onChange={onChange}
          />
        </div>
        {overridden && (
          <Button type="button" onClick={() => onChange(undefined)}>Reset</Button>
        )}
      </div>
      {!overridden && (
        <p className={styles.hint}>Use global: {globalValue}</p>
      )}
    </>
  );
}

export function ToolsTab({ value, onChange, globals }: TabFormProps) {
  const ovr: ToolsOverrides = value.overrides?.tools ?? {};

  function patch<K extends keyof ToolsOverrides>(field: K, next: ToolsOverrides[K]) {
    onChange({
      ...value,
      overrides: {
        ...value.overrides,
        tools: { ...ovr, [field]: next },
      },
    });
  }

  return (
    <>
      <ToolPathRow
        id="tools-mongodump"
        label="mongodump path"
        globalValue={globals.tools.mongodumpPath}
        value={ovr.mongodumpPath}
        onChange={(next) => patch('mongodumpPath', next)}
      />
      <ToolPathRow
        id="tools-mongorestore"
        label="mongorestore path"
        globalValue={globals.tools.mongorestorePath}
        value={ovr.mongorestorePath}
        onChange={(next) => patch('mongorestorePath', next)}
      />
      <ToolPathRow
        id="tools-mongoexport"
        label="mongoexport path"
        globalValue={globals.tools.mongoexportPath}
        value={ovr.mongoexportPath}
        onChange={(next) => patch('mongoexportPath', next)}
      />
      <ToolPathRow
        id="tools-mongoimport"
        label="mongoimport path"
        globalValue={globals.tools.mongoimportPath}
        value={ovr.mongoimportPath}
        onChange={(next) => patch('mongoimportPath', next)}
      />
    </>
  );
}

export function hasToolsOverrides(c: { overrides?: { tools?: ToolsOverrides } }) {
  const ovr = c.overrides?.tools;
  return !!ovr && Object.values(ovr).some((v) => v !== undefined);
}
