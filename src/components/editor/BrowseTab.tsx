import { useEffect, useState } from 'react';
import { browseCollection } from '../../ipc';
import type { BrowsePage } from '../../types';

interface Props {
  connectionId: string;
  database: string;
  collection: string;
}

const PAGE_SIZE = 20;

export function BrowseTab({ connectionId, database, collection }: Props) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<BrowsePage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    browseCollection(connectionId, database, collection, page, PAGE_SIZE)
      .then(setData)
      .catch((e) => setErr((e as Error).message ?? String(e)));
  }, [connectionId, database, collection, page]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <strong>{database}.{collection}</strong>
        <span style={{ color: 'var(--fg-dim)' }}>
          {data ? `${data.total} documents` : 'loading…'}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ← Prev
          </button>
          <span style={{ margin: '0 8px' }}>Page {page + 1}</span>
          <button
            disabled={!data || (page + 1) * PAGE_SIZE >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', fontFamily: 'var(--font-mono)', padding: 10 }}>
        {err && <div style={{ color: 'var(--accent-red)' }}>{err}</div>}
        {data?.docs.map((d, i) => (
          <pre key={i} style={{ margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(d, null, 2)}
          </pre>
        ))}
      </div>
    </div>
  );
}
