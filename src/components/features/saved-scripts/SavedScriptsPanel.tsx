import { MouseEvent, useEffect, useMemo, useState } from 'react';
import { listScripts, deleteScript, createScript, updateScript } from '../../../ipc';
import { useEditorStore } from '../../../store/editor';
import { IconButton, ListRow, Panel } from '../../ui';
import type { SavedScript, EditorTab } from '../../../types';
import { TagList } from './TagList';
import { EditTagsPopover } from './EditTagsPopover';
import { ManageTagsDialog } from './ManageTagsDialog';
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
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const { openTab, savedScriptsVersion } = useEditorStore();

  async function reload() {
    setScripts(await listScripts());
  }

  useEffect(() => {
    reload();
  }, [savedScriptsVersion]);

  /** Canonical set of all tags currently in use across scripts (first-seen casing). */
  const allTags = useMemo(
    () =>
      Array.from(
        new Map(scripts.flatMap((s) => s.tags).map((t) => [t.toLowerCase(), t])).values(),
      ),
    [scripts],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = activeFilter?.toLowerCase() ?? null;
    return scripts.filter((s) => {
      if (f && !s.tags.some((t) => t.toLowerCase() === f)) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [scripts, query, activeFilter]);

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

  async function handleEditTagsSave(script: SavedScript, tags: string[]) {
    await updateScript(script.id, script.name, script.content, tags, script.connectionId);
    setEditingTagsId(null);
    reload();
  }

  function stop(e: MouseEvent<HTMLButtonElement>) { e.stopPropagation(); }

  return (
    <Panel>
      <Panel.Header
        title="Saved Scripts"
        right={
          <button type="button" onClick={() => setManageTagsOpen(true)}>
            Manage tags
          </button>
        }
      />
      <Panel.Body>
        <div className={styles.searchBar}>
          <input
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        {activeFilter && (
          <div className={styles.filterStrip}>
            <span>Filter:</span>
            <TagList
              tags={[activeFilter]}
              onRemove={() => setActiveFilter(null)}
            />
          </div>
        )}
        <ul className={styles.list}>
          {filtered.map((script) => (
            <li key={script.id} className={styles.rowWrap}>
              <ListRow
                onClick={() => open(script)}
                trailing={
                  <div className={styles.actions}>
                    <IconButton
                      aria-label={`Edit tags for ${script.name}`}
                      tooltip="Edit tags"
                      size="sm"
                      icon="📝"
                      onClick={(e) => { stop(e); setEditingTagsId(script.id); }}
                    />
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
                {script.tags.length > 0 && (
                  <span className={styles.tagsWrap}>
                    <TagList
                      tags={script.tags}
                      onClick={(tag) => setActiveFilter(tag)}
                      selectedTag={activeFilter ?? undefined}
                    />
                  </span>
                )}
              </ListRow>
              {editingTagsId === script.id && (
                <EditTagsPopover
                  initial={script.tags}
                  allTags={allTags}
                  onSave={(tags) => handleEditTagsSave(script, tags)}
                  onCancel={() => setEditingTagsId(null)}
                />
              )}
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
      {manageTagsOpen && (
        <ManageTagsDialog
          scripts={scripts}
          onClose={() => setManageTagsOpen(false)}
          onMutated={reload}
        />
      )}
    </Panel>
  );
}
