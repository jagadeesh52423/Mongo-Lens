import { useState, useMemo, KeyboardEvent } from 'react';
import { TagList } from './TagList';
import styles from './EditTagsPopover.module.css';

interface Props {
  initial: string[];
  allTags: string[];
  onSave: (tags: string[]) => Promise<void>;
  onCancel: () => void;
}

export function EditTagsPopover({ initial, allTags, onSave, onCancel }: Props) {
  const [tags, setTags] = useState<string[]>(initial);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    const have = new Set(tags.map((t) => t.toLowerCase()));
    return allTags
      .filter((t) => !have.has(t.toLowerCase()))
      .filter((t) => !q || t.toLowerCase().includes(q))
      .slice(0, 6);
  }, [input, allTags, tags]);

  function add(tag: string) {
    const t = tag.trim();
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    setTags([...tags, t]);
    setInput('');
  }

  function remove(tag: string) {
    setTags(tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(input);
    } else if (e.key === 'Backspace' && !input && tags.length) {
      setTags(tags.slice(0, -1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      void save();
    }
  }

  async function save() {
    // Flush any in-progress text in the input so users who click Save without
    // first pressing Enter don't silently lose their typed tag.
    const pending = input.trim();
    const final =
      pending && !tags.some((t) => t.toLowerCase() === pending.toLowerCase())
        ? [...tags, pending]
        : tags;
    setBusy(true);
    try {
      await onSave(final);
    } finally {
      setBusy(false);
    }
  }

  const hasKnownTags = allTags.length > 0;
  const allKnownAlreadyAdded = hasKnownTags && suggestions.length === 0 && !input.trim();

  return (
    <div className={styles.popover} role="dialog" aria-label="Edit tags">
      <TagList tags={tags} onRemove={remove} />
      <input
        autoFocus
        className={styles.input}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        placeholder="Add tag — Enter to add, Esc to save"
      />
      {hasKnownTags && (
        <div className={styles.suggestWrap}>
          <div className={styles.suggestLabel}>Suggestions</div>
          {suggestions.length > 0 ? (
            <ul className={styles.suggest}>
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button" className={styles.suggestBtn} onClick={() => add(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.suggestEmpty}>
              {allKnownAlreadyAdded
                ? 'All known tags are already on this script.'
                : 'No matches.'}
            </div>
          )}
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
