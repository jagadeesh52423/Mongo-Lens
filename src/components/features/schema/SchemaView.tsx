import { useState } from 'react';
import type { SchemaField, SchemaResult, SchemaType } from '../../../types';
import styles from './SchemaView.module.css';

const SAMPLE_SIZES = [100, 1000, 10000];

// BSON type → local CSS custom property (defined in .root block of module CSS)
const TYPE_COLOR: Record<string, string> = {
  String:     'var(--schema-t-string)',
  Number:     'var(--schema-t-number)',
  Decimal128: 'var(--schema-t-decimal)',
  ObjectID:   'var(--schema-t-objectid)',
  ObjectId:   'var(--schema-t-objectid)',
  Date:       'var(--schema-t-date)',
  Boolean:    'var(--schema-t-bool)',
  Bool:       'var(--schema-t-bool)',
  Array:      'var(--schema-t-array)',
  Document:   'var(--schema-t-doc)',
  Null:       'var(--schema-t-null)',
  Undefined:  'var(--schema-t-null)',
};

function typeColor(name: string): string {
  return TYPE_COLOR[name] ?? 'var(--schema-t-fallback)';
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

// Render a BSON EJSON wrapper as a readable string; falls back to JSON.stringify.
function renderSampleValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  const obj = value as Record<string, unknown>;
  if ('$oid' in obj && typeof obj['$oid'] === 'string') return obj['$oid'];
  if ('$date' in obj) {
    const d = obj['$date'];
    if (typeof d === 'string') return d;
    if (typeof d === 'object' && d !== null) {
      const nl = (d as Record<string, unknown>)['$numberLong'];
      if (typeof nl === 'string') return new Date(Number(nl)).toISOString();
    }
    return String(d);
  }
  if ('$numberLong' in obj) return String(obj['$numberLong']);
  if ('$numberDecimal' in obj) return String(obj['$numberDecimal']);
  if ('$binary' in obj) return '<binary>';
  if ('$regex' in obj) return `/${obj['$regex']}/${(obj['$options'] as string) ?? ''}`;
  return JSON.stringify(value);
}

// Extract nested children: Document fields or Array<Document> element fields.
function getChildFields(field: SchemaField): SchemaField[] {
  const docType = field.types.find((t) => t.name === 'Document');
  const arrType = field.types.find((t) => t.name === 'Array');
  const arrDoc = arrType?.types?.find((t) => t.name === 'Document');
  return docType?.fields ?? arrDoc?.fields ?? [];
}

// True when the field is an Array<Document> — its flat-path segment uses [].
function isArrayOfDoc(field: SchemaField): boolean {
  const arrType = field.types.find((t) => t.name === 'Array');
  return !!arrType?.types?.find((t) => t.name === 'Document');
}

function TypeBadge({ type }: { type: SchemaType }) {
  return (
    <span className={styles.badge}>
      <span className={styles.typeDot} style={{ background: typeColor(type.name) }} />
      {type.name}
      {' '}
      <span className={styles.typePct}>{pct(type.probability)}</span>
    </span>
  );
}

function SampleChips({ types }: { types: SchemaType[] }) {
  const values = types.flatMap((t) => t.values ?? []).slice(0, 3);
  return (
    <>
      {values.map((v, i) => (
        <code key={i} className={styles.chip}>{renderSampleValue(v)}</code>
      ))}
    </>
  );
}

function PresenceCell({ probability }: { probability: number }) {
  return (
    <span className={styles.presence}>
      <span className={styles.pbar}>
        <span className={styles.pfill} style={{ width: pct(probability) }} />
      </span>
      <span className={styles.pct}>{pct(probability)}</span>
    </span>
  );
}

// A single table row in Tree mode, plus its (recursively-expanded) children.
function TreeRow({
  field,
  depth,
  collapsed,
  onToggle,
}: {
  field: SchemaField;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  const children = getChildFields(field);
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(field.path);

  return (
    <>
      <tr
        className={styles.tblRow}
        onClick={hasChildren ? () => onToggle(field.path) : undefined}
        style={hasChildren ? { cursor: 'pointer' } : undefined}
      >
        <td className={styles.fieldCell}>
          <span className={styles.fieldName}>
            {Array.from({ length: depth }).map((_, i) => (
              <span key={i} className={styles.indGuide} />
            ))}
            <span className={hasChildren ? styles.chev : styles.chevEmpty}>
              {hasChildren ? (isCollapsed ? '▸' : '▾') : ''}
            </span>
            <span className={`${styles.fname} ${hasChildren ? styles.fnameParent : ''}`}>
              {field.name}
            </span>
          </span>
        </td>
        <td className={styles.typesCell}>
          {field.types.map((type) => <TypeBadge key={type.name} type={type} />)}
        </td>
        <td className={styles.presenceCell}>
          <PresenceCell probability={field.probability} />
        </td>
        <td className={styles.sampleCell}>
          <SampleChips types={field.types} />
        </td>
      </tr>
      {hasChildren && !isCollapsed && children.map((child) => (
        <TreeRow
          key={child.path}
          field={child}
          depth={depth + 1}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

interface FlatRow {
  prefix: string;  // muted path prefix, e.g. "customer.address."
  leaf: string;    // leaf field name, e.g. "city"
  field: SchemaField;
}

// Recursively flatten a field tree to leaf rows with dotted path prefixes.
function buildFlatRows(fields: SchemaField[], prefix: string): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const field of fields) {
    const children = getChildFields(field);
    if (children.length > 0) {
      const segment = isArrayOfDoc(field) ? `${field.name}[]` : field.name;
      rows.push(...buildFlatRows(children, `${prefix}${segment}.`));
    } else {
      rows.push({ prefix, leaf: field.name, field });
    }
  }
  return rows;
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
  const [mode, setMode] = useState<'tree' | 'flat'>('tree');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const fields = result?.schema.fields ?? [];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.summary}>
          {result ? `sampled ${result.sampled} of ${result.schema.count} documents` : ''}
        </span>
        <span className={styles.modeToggle} role="group" aria-label="View mode">
          <button
            className={`${styles.modeBtn} ${mode === 'tree' ? styles.modeBtnActive : ''}`}
            onClick={() => setMode('tree')}
          >
            Tree
          </button>
          <button
            className={`${styles.modeBtn} ${mode === 'flat' ? styles.modeBtnActive : ''}`}
            onClick={() => setMode('flat')}
          >
            Flat
          </button>
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
        {!loading && !error && result && (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th className={styles.th}>{mode === 'tree' ? 'Field' : 'Field path'}</th>
                <th className={styles.th}>Types</th>
                <th className={styles.th}>Presence</th>
                <th className={styles.th}>Sample</th>
              </tr>
            </thead>
            <tbody>
              {mode === 'tree'
                ? fields.map((field) => (
                    <TreeRow
                      key={field.path}
                      field={field}
                      depth={0}
                      collapsed={collapsed}
                      onToggle={toggle}
                    />
                  ))
                : buildFlatRows(fields, '').map((row, i) => (
                    <tr key={i} className={styles.tblRow}>
                      <td className={styles.fieldCell}>
                        <span className={styles.flatPath}>
                          {row.prefix && <span className={styles.flatPrefix}>{row.prefix}</span>}
                          <span className={styles.flatLeaf}>{row.leaf}</span>
                        </span>
                      </td>
                      <td className={styles.typesCell}>
                        {row.field.types.map((type) => <TypeBadge key={type.name} type={type} />)}
                      </td>
                      <td className={styles.presenceCell}>
                        <PresenceCell probability={row.field.probability} />
                      </td>
                      <td className={styles.sampleCell}>
                        <SampleChips types={row.field.types} />
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
