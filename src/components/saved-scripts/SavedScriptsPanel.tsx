import { CSSProperties, MouseEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { listScripts, deleteScript, createScript } from '../../ipc';
import { useEditorStore } from '../../store/editor';
import type { SavedScript, EditorTab } from '../../types';

const iconBtnBase: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 4,
  width: 22,
  height: 22,
  cursor: 'pointer',
  color: 'var(--fg-dim)',
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  flexShrink: 0,
};

interface IconBtnProps {
  title: string;
  hoverStyle: CSSProperties;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}

function IconBtn({ title, hoverStyle, onClick, children }: IconBtnProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...iconBtnBase, ...(hover ? hoverStyle : null) }}
    >
      {children}
    </button>
  );
}

function nextDuplicateName(existingNames: string[], base: string): string {
  const match = base.match(/^(.*?)\((\d+)\)$/);
  const stem = match ? match[1] : base;
  const start = match ? parseInt(match[2], 10) + 1 : 1;
  for (let n = start; ; n++) {
    const candidate = `${stem}(${n})`;
    if (!existingNames.includes(candidate)) return candidate;
  }
}

export function SavedScriptsPanel() {
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const [query, setQuery] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { openTab, savedScriptsVersion } = useEditorStore();

  async function reload() {
    setScripts(await listScripts());
  }

  useEffect(() => {
    reload();
  }, [savedScriptsVersion]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scripts;
    return scripts.filter(
      (s) => s.name.toLowerCase().includes(q) || s.tags.toLowerCase().includes(q),
    );
  }, [scripts, query]);

  function open(s: SavedScript) {
    const tab: EditorTab = {
      id: `script:${s.id}`,
      title: s.name,
      content: s.content,
      isDirty: false,
      type: 'script',
      savedScriptId: s.id,
      savedScriptTags: s.tags,
    };
    openTab(tab);
  }

  async function handleDuplicate(s: SavedScript) {
    const newName = nextDuplicateName(
      scripts.map((x) => x.name),
      s.name,
    );
    await createScript(newName, s.content, s.tags, s.connectionId);
    reload();
  }

  async function confirmDelete(s: SavedScript) {
    await deleteScript(s.id);
    setConfirmingId(null);
    reload();
  }

  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
        <input
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {filtered.map((s) => (
          <li
            key={s.id}
            onMouseEnter={() => setHoveredId(s.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              padding: '6px 10px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
              <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => open(s)}>
                {s.name}
                {s.tags && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--fg-dim)' }}>
                    {s.tags}
                  </span>
                )}
              </span>
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  opacity: hoveredId === s.id ? 1 : 0,
                  transition: 'opacity 0.15s',
                }}
              >
                <IconBtn
                  title="Duplicate"
                  hoverStyle={{ background: '#2d4a6e', color: '#7cb8f0', borderColor: '#2d4a6e' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDuplicate(s);
                  }}
                >
                  ⧉
                </IconBtn>
                <IconBtn
                  title="Delete"
                  hoverStyle={{ background: '#5c1f1f', color: '#f07070', borderColor: '#5c1f1f' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmingId(s.id);
                  }}
                >
                  🗑
                </IconBtn>
              </div>
            </div>
            {confirmingId === s.id && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  marginTop: 4,
                  fontSize: 12,
                  gap: 8,
                  width: '100%',
                }}
              >
                <span style={{ color: 'var(--fg-dim)' }}>
                  Delete "{s.name}"? This cannot be undone.
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => setConfirmingId(null)}
                    style={{ padding: '3px 10px', fontSize: 12 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => confirmDelete(s)}
                    style={{
                      padding: '3px 10px',
                      fontSize: 12,
                      background: '#7a1f1f',
                      border: 'none',
                      borderRadius: 4,
                      color: '#ffaaaa',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
