import { useEffect, useRef, useState } from 'react';
import { listDatabases, listCollections } from '../../../ipc';
import { ListRow } from '../../ui';
import type { CollectionNode } from '../../../types';
import styles from './ConnectionTree.module.css';

const TYPE_TO_SEARCH_RESET_MS = 600;

interface Props {
  connectionId: string;
  onOpenCollection: (database: string, collection: string) => void;
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
      className={styles.wrap}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {err && <div className={styles.error}>{err}</div>}
      {dbs.map((db) => {
        const cols = collections[db];
        return (
          <div key={db}>
            <ListRow
              icon={<span className={styles.caret}>{expanded[db] ? '▼' : '▶'}</span>}
              indent={0}
              onClick={() => toggle(db)}
            >
              {db}
            </ListRow>
            {expanded[db] && cols && cols.map((c) => {
              const isSelected = selected?.db === db && selected?.col === c.name;
              return (
                <div
                  key={c.name}
                  ref={(el) => {
                    rowRefs.current.set(`${db}::${c.name}`, el);
                  }}
                >
                  <ListRow
                    indent={1}
                    selected={isSelected}
                    className={isSelected ? 'list-row-focused' : undefined}
                    onClick={() => {
                      setActiveDb(db);
                      setSelected({ db, col: c.name });
                      bufferRef.current = '';
                      wrapperRef.current?.focus();
                    }}
                    onDoubleClick={() => onOpenCollection(db, c.name)}
                  >
                    {c.name}
                  </ListRow>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
