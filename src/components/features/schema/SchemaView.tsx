import type { SchemaField, SchemaResult, SchemaType } from '../../../types';
import styles from './SchemaView.module.css';

const SAMPLE_SIZES = [100, 1000, 10000];

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function TypeBadges({ types }: { types: SchemaType[] }) {
  return (
    <span className={styles.badges}>
      {types.map((t) => (
        <span key={t.name} className={styles.badge}>{t.name}</span>
      ))}
    </span>
  );
}

function SampleValues({ types }: { types: SchemaType[] }) {
  const values = types.flatMap((t) => t.values ?? []).slice(0, 5);
  if (values.length === 0) return null;
  return (
    <div className={styles.samples}>
      {values.map((v, i) => (
        <code key={i} className={styles.sample}>{JSON.stringify(v)}</code>
      ))}
    </div>
  );
}

function FieldRow({ field, depth }: { field: SchemaField; depth: number }) {
  // Nested children: Document fields + Array element types that are Documents.
  const docType = field.types.find((t) => t.name === 'Document');
  const arrType = field.types.find((t) => t.name === 'Array');
  const arrDoc = arrType?.types?.find((t) => t.name === 'Document');
  const childFields = docType?.fields ?? arrDoc?.fields ?? [];

  return (
    <div className={styles.field} style={{ marginLeft: depth * 16 }}>
      <div className={styles.row}>
        <span className={styles.name}>{field.name}</span>
        <span className={styles.presenceBar} aria-hidden>
          <span className={styles.presenceFill} style={{ width: pct(field.probability) }} />
        </span>
        <span className={styles.presence}>{pct(field.probability)}</span>
        <TypeBadges types={field.types} />
      </div>
      <SampleValues types={field.types} />
      {childFields.map((c) => (
        <FieldRow key={c.path} field={c} depth={depth + 1} />
      ))}
    </div>
  );
}

interface Props {
  result: SchemaResult | null;
  loading: boolean;
  error: string | null;
  sampleSize: number;
  onSampleSizeChange: (n: number) => void;
  onReanalyze: () => void;
}

export function SchemaView({ result, loading, error, sampleSize, onSampleSizeChange, onReanalyze }: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.summary}>
          {result ? `sampled ${result.sampled} of ${result.schema.count} documents` : ''}
        </span>
        <select
          className={styles.select}
          value={sampleSize}
          onChange={(e) => onSampleSizeChange(Number(e.target.value))}
          aria-label="Sample size"
        >
          {SAMPLE_SIZES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button className={styles.button} onClick={onReanalyze} disabled={loading}>
          {loading ? 'Analyzing…' : 'Re-analyze'}
        </button>
      </div>
      <div className={styles.body}>
        {loading && <div className={styles.state}>Sampling documents…</div>}
        {error && (
          <div className={styles.state}>
            {error}
            <button className={styles.button} onClick={onReanalyze}>Retry</button>
          </div>
        )}
        {!loading && !error && result && result.schema.count === 0 && (
          <div className={styles.state}>No documents to sample.</div>
        )}
        {!loading && !error && result && result.schema.fields.map((f) => (
          <FieldRow key={f.path} field={f} depth={0} />
        ))}
      </div>
    </div>
  );
}
