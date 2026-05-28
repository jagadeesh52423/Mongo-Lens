import { useMemo, useState } from 'react';
import { Button, Dialog } from '../../ui';
import { renameTag, deleteTag } from '../../../ipc';
import type { SavedScript } from '../../../types';
import styles from './ManageTagsDialog.module.css';

interface Props {
  scripts: SavedScript[];
  onClose: () => void;
  /** Called after a successful rename/delete so the parent can reload. */
  onMutated: () => void;
}

interface TagCount {
  display: string;
  count: number;
}

export function ManageTagsDialog({ scripts, onClose, onMutated }: Props) {
  const tagCounts = useMemo<TagCount[]>(() => {
    const map = new Map<string, TagCount>();
    for (const script of scripts) {
      for (const tag of script.tags) {
        const key = tag.toLowerCase();
        const prev = map.get(key);
        if (prev) prev.count += 1;
        else map.set(key, { display: tag, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => a.display.localeCompare(b.display));
  }, [scripts]);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function commitRename(old: string) {
    const next = draft.trim();
    if (!next || next.toLowerCase() === old.toLowerCase()) {
      setEditing(null);
      return;
    }
    try {
      await renameTag(old, next);
      setEditing(null);
      onMutated();
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    }
  }

  async function commitDelete(tag: string) {
    try {
      await deleteTag(tag);
      setConfirmingDelete(null);
      onMutated();
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    }
  }

  return (
    <Dialog open onClose={onClose} ariaLabel="Manage tags" width={420}>
      <Dialog.Header title="Manage tags" onClose={onClose} />
      <Dialog.Body>
        {tagCounts.length === 0 ? (
          <p className={styles.empty}>No tags yet.</p>
        ) : (
          <ul className={styles.list}>
            {tagCounts.map(({ display, count }) => (
              <li key={display.toLowerCase()} className={styles.row}>
                {editing === display ? (
                  <>
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(display);
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                    <Button onClick={() => commitRename(display)}>Save</Button>
                    <Button onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <span className={styles.name}>{display}</span>
                    <span className={styles.count}>{count}</span>
                    <button
                      type="button"
                      aria-label={`Rename tag ${display}`}
                      onClick={() => {
                        setEditing(display);
                        setDraft(display);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete tag ${display}`}
                      onClick={() => setConfirmingDelete(display)}
                    >
                      Delete
                    </button>
                  </>
                )}
                {confirmingDelete === display && (
                  <div className={styles.confirm}>
                    <span>
                      Delete "{display}" from {count} script{count === 1 ? '' : 's'}?
                    </span>
                    <Button onClick={() => setConfirmingDelete(null)}>Cancel</Button>
                    <Button variant="primary" onClick={() => commitDelete(display)}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {err && <p className={styles.err}>{err}</p>}
      </Dialog.Body>
      <Dialog.Footer>
        <Button onClick={onClose}>Close</Button>
      </Dialog.Footer>
    </Dialog>
  );
}
