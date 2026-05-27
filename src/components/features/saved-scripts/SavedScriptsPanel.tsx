import { MouseEvent, useEffect, useMemo, useState } from 'react';
import { listScripts, deleteScript, createScript } from '../../../ipc';
import { useEditorStore } from '../../../store/editor';
import { IconButton, ListRow, Panel } from '../../ui';
import type { SavedScript, EditorTab } from '../../../types';
import styles from './SavedScriptsPanel.module.css';

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

  function open(script: SavedScript) {
    const tab: EditorTab = {
      id: `script:${script.id}`,
      title: script.name,
      content: script.content,
      isDirty: false,
      type: 'script',
      savedScriptId: script.id,
      savedScriptTags: script.tags,
    };
    openTab(tab);
  }

  async function handleDuplicate(script: SavedScript) {
    const newName = nextDuplicateName(scripts.map((x) => x.name), script.name);
    await createScript(newName, script.content, script.tags, script.connectionId);
    reload();
  }

  async function confirmDelete(script: SavedScript) {
    await deleteScript(script.id);
    setConfirmingId(null);
    reload();
  }

  function stop(e: MouseEvent<HTMLButtonElement>) { e.stopPropagation(); }

  return (
    <Panel>
      <Panel.Header title="Saved Scripts" />
      <Panel.Body>
        <div className={styles.searchBar}>
          <input
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        <ul className={styles.list}>
          {filtered.map((script) => (
            <li key={script.id} className={styles.rowWrap}>
              <ListRow
                onClick={() => open(script)}
                trailing={
                  <div className={styles.actions}>
                    <IconButton
                      aria-label={`Duplicate script ${script.name}`}
                      tooltip="Duplicate"
                      size="sm"
                      icon="⧉"
                      className={styles.duplicate}
                      onClick={(e) => { stop(e); handleDuplicate(script); }}
                    />
                    <IconButton
                      aria-label={`Delete script ${script.name}`}
                      tooltip="Delete"
                      size="sm"
                      icon="🗑"
                      className={styles.delete}
                      onClick={(e) => { stop(e); setConfirmingId(script.id); }}
                    />
                  </div>
                }
              >
                {script.name}
                {script.tags && <span className={styles.tags}>{script.tags}</span>}
              </ListRow>
              {confirmingId === script.id && (
                <div className={styles.confirm}>
                  <span>Delete "{script.name}"? This cannot be undone.</span>
                  <div className={styles.confirmButtons}>
                    <button onClick={() => setConfirmingId(null)} className={styles.confirmCancel}>
                      Cancel
                    </button>
                    <button onClick={() => confirmDelete(script)} className={styles.confirmDelete}>
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel.Body>
    </Panel>
  );
}
