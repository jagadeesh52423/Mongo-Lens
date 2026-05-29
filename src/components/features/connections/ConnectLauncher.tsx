import { useEffect, useRef, useState } from 'react';
import type { Connection } from '../../../connection/model';
import { connectionSummary } from './connectionSummary';
import styles from './ConnectLauncher.module.css';

interface Props {
  /** Connections not currently connected — the menu's pickable items. */
  available: Connection[];
  /** Distinguishes "no saved connections" from "all connections are active". */
  hasAnySaved: boolean;
  onConnect: (c: Connection) => void;
  onNewConnection: () => void;
  /** Right-click on an item → panel renders its ContextMenu (Edit/Duplicate/Delete). */
  onItemContextMenu: (c: Connection, x: number, y: number) => void;
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7.5 1 L3 7.6 H6.4 L6 13 L11 5.8 H7.2 Z" fill="currentColor" />
    </svg>
  );
}

export function ConnectLauncher({
  available, hasAnySaved, onConnect, onNewConnection, onItemContextMenu,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // keyboard-highlighted item index
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on Escape / outside mousedown; return focus to the trigger on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    }
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // Reset the highlight each time the menu opens.
  useEffect(() => { if (open) setActive(0); }, [open]);

  function choose(c: Connection) { setOpen(false); onConnect(c); }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (available.length === 0) return;
    if (e.key === 'ArrowDown') { setActive((i) => Math.min(available.length - 1, i + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive((i) => Math.max(0, i - 1)); e.preventDefault(); }
    else if (e.key === 'Enter') { const c = available[active]; if (c) choose(c); e.preventDefault(); }
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        aria-label="Connect"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.bolt}><BoltIcon /></span>
        <span className={styles.lab}>Connect</span>
        <span className={styles.chev} aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className={styles.menu} role="menu" onKeyDown={onMenuKeyDown}>
          {available.length > 0 && <div className={styles.groupLabel}>Connect to</div>}
          {available.map((c, i) => (
            <div
              key={c.id}
              role="menuitem"
              tabIndex={-1}
              className={`${styles.item} ${i === active ? styles.itemActive : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(c)}
              onContextMenu={(e) => {
                e.preventDefault();
                setOpen(false);
                onItemContextMenu(c, e.clientX, e.clientY);
              }}
            >
              <span
                className={styles.env}
                style={{ background: c.color || 'var(--fg-dim)' }}
                aria-hidden="true"
              />
              <span className={styles.meta}>
                <span className={styles.name}>{c.name}</span>
                <span className={styles.sub}>{connectionSummary(c.target)}</span>
              </span>
              {c.ssh && <span className={styles.ssh} aria-label="SSH tunnel">SSH</span>}
            </div>
          ))}
          {available.length === 0 && (
            <div className={styles.emptyNote}>
              {hasAnySaved ? 'All connections are active' : 'No saved connections yet'}
            </div>
          )}
          <div className={styles.sep} />
          <div
            role="menuitem"
            tabIndex={-1}
            className={styles.newConn}
            onClick={() => { setOpen(false); onNewConnection(); }}
          >
            <span className={styles.plus} aria-hidden="true">+</span> New connection…
          </div>
        </div>
      )}
    </div>
  );
}
