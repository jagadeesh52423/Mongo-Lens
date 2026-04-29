import { useEffect, useRef, useState } from 'react';
import { listDatabases, listCollections } from '../../ipc';
import type { CollectionNode } from '../../types';

const TYPE_TO_SEARCH_RESET_MS = 600;

interface Props {
  connectionId: string;
  onOpenCollection: (database: string, collection: string) => void;
}

type GuideKind = 'line' | 'branch' | 'last' | 'empty';

const GUIDE_STYLE = `
.t-row {
  display: flex;
  align-items: stretch;
  min-height: 22px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
}
.t-row:hover { background: rgba(255,255,255,0.06); }
.t-row.t-selected { background: rgba(80,140,220,0.28); }
.t-wrap:focus { outline: none; }
.t-wrap:focus .t-row.t-selected { background: rgba(80,140,220,0.45); }
.t-guide {
  width: 16px;
  flex-shrink: 0;
  position: relative;
  align-self: stretch;
}
.t-guide-line::before,
.t-guide-branch::before,
.t-guide-last::before {
  content: '';
  position: absolute;
  left: 7px;
  width: 1px;
  background: #2a3f52;
}
.t-guide-line::before   { top: 0; bottom: 0; }
.t-guide-branch::before { top: 0; bottom: 0; }
.t-guide-last::before   { top: 0; height: 50%; }
.t-guide-branch::after,
.t-guide-last::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 7px;
  width: 8px;
  height: 1px;
  background: #2a3f52;
}
.t-label {
  display: flex;
  align-items: center;
  padding: 3px 6px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t-caret {
  display: flex;
  align-items: center;
  width: 14px;
  font-size: 10px;
  color: var(--fg-dim);
}
`;

function Guide({ kind }: { kind: GuideKind }) {
  const cls =
    kind === 'line'
      ? 't-guide t-guide-line'
      : kind === 'branch'
      ? 't-guide t-guide-branch'
      : kind === 'last'
      ? 't-guide t-guide-last'
      : 't-guide';
  return <div className={cls} />;
}

export function ConnectionTree({ connectionId, onOpenCollection }: Props) {
  const [dbs, setDbs] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collections, setCollections] = useState<Record<string, CollectionNode[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const [activeDb, setActiveDb] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ db: string; col: string } | null>(null);

  const bufferRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listDatabases(connectionId)
      .then(setDbs)
      .catch((e) => setErr((e as Error).message ?? String(e)));
  }, [connectionId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function toggle(db: string) {
    const isOpen = expanded[db];
    setExpanded((s) => ({ ...s, [db]: !isOpen }));
    setActiveDb(db);
    bufferRef.current = '';
    if (!isOpen && !collections[db]) {
      try {
        const list = await listCollections(connectionId, db);
        setCollections((s) => ({ ...s, [db]: list }));
      } catch (e) {
        setErr((e as Error).message ?? String(e));
      }
    }
    wrapperRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const db = activeDb;
    if (!db || !expanded[db]) return;
    const cols = collections[db];
    if (!cols || cols.length === 0) return;

    if (e.key === 'Enter') {
      if (selected && selected.db === db) {
        onOpenCollection(selected.db, selected.col);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape') {
      bufferRef.current = '';
      if (timerRef.current) window.clearTimeout(timerRef.current);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const curIdx = selected && selected.db === db
        ? cols.findIndex((c) => c.name === selected.col)
        : -1;
      const nextIdx =
        e.key === 'ArrowDown'
          ? Math.min(cols.length - 1, curIdx + 1)
          : Math.max(0, curIdx <= 0 ? 0 : curIdx - 1);
      const next = cols[nextIdx];
      if (next) {
        setSelected({ db, col: next.name });
        rowRefs.current.get(`${db}::${next.name}`)?.scrollIntoView({ block: 'nearest' });
      }
      bufferRef.current = '';
      e.preventDefault();
      return;
    }

    if (e.key.length !== 1 || !/^[A-Za-z0-9_.\-$]$/.test(e.key)) return;

    if (timerRef.current) window.clearTimeout(timerRef.current);
    bufferRef.current += e.key.toLowerCase();
    const prefix = bufferRef.current;
    const match = cols.find((c) => c.name.toLowerCase().startsWith(prefix));
    if (match) {
      setSelected({ db, col: match.name });
      rowRefs.current.get(`${db}::${match.name}`)?.scrollIntoView({ block: 'nearest' });
    }
    timerRef.current = window.setTimeout(() => {
      bufferRef.current = '';
    }, TYPE_TO_SEARCH_RESET_MS);
    e.preventDefault();
  }

  return (
    <div
      ref={wrapperRef}
      className="t-wrap"
      style={{ padding: 4, outline: 'none' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <style>{GUIDE_STYLE}</style>
      {err && <div style={{ color: 'var(--accent-red)', padding: 6 }}>{err}</div>}
      {dbs.map((db, dbIdx) => {
        const isLastDb = dbIdx === dbs.length - 1;
        const dbGuide: GuideKind = isLastDb ? 'last' : 'branch';
        const cols = collections[db];
        return (
          <div key={db}>
            <div className="t-row" onClick={() => toggle(db)}>
              <Guide kind={dbGuide} />
              <span className="t-caret">{expanded[db] ? '▼' : '▶'}</span>
              <span className="t-label">{db}</span>
            </div>
            {expanded[db] && cols &&
              cols.map((c, cIdx) => {
                const isLastCol = cIdx === cols.length - 1;
                const connGuide: GuideKind = isLastDb ? 'empty' : 'line';
                const colGuide: GuideKind = isLastCol ? 'last' : 'branch';
                const isSelected =
                  selected?.db === db && selected?.col === c.name;
                return (
                  <div
                    key={c.name}
                    ref={(el) => {
                      rowRefs.current.set(`${db}::${c.name}`, el);
                    }}
                    className={`t-row${isSelected ? ' t-selected' : ''}`}
                    onClick={() => {
                      setActiveDb(db);
                      setSelected({ db, col: c.name });
                      bufferRef.current = '';
                      wrapperRef.current?.focus();
                    }}
                    onDoubleClick={() => onOpenCollection(db, c.name)}
                  >
                    <Guide kind={connGuide} />
                    <Guide kind={colGuide} />
                    <span className="t-label t-col">{c.name}</span>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
