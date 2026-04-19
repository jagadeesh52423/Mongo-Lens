import { useEffect, useState } from 'react';
import { listDatabases, listCollections } from '../../ipc';
import type { CollectionNode } from '../../types';

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
.t-col { color: var(--fg-dim); }
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

  useEffect(() => {
    listDatabases(connectionId)
      .then(setDbs)
      .catch((e) => setErr((e as Error).message ?? String(e)));
  }, [connectionId]);

  async function toggle(db: string) {
    const isOpen = expanded[db];
    setExpanded((s) => ({ ...s, [db]: !isOpen }));
    if (!isOpen && !collections[db]) {
      try {
        const list = await listCollections(connectionId, db);
        setCollections((s) => ({ ...s, [db]: list }));
      } catch (e) {
        setErr((e as Error).message ?? String(e));
      }
    }
  }

  return (
    <div style={{ padding: 4 }}>
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
                return (
                  <div
                    key={c.name}
                    className="t-row"
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
