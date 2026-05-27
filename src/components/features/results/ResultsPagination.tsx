import { useEffect, useState } from 'react';
import { Button } from '../../ui';
import styles from './ResultsPagination.module.css';

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100, 200] as const;

interface Props {
  page: number;
  pageSize: number;
  total: number; // total docs; -1 = unknown
  busy: boolean;
  onPageChange: (page: number, pageSize: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function ResultsPagination({
  page,
  pageSize,
  total,
  busy,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const totalPages = total >= 0 ? Math.max(1, Math.ceil(total / pageSize)) : -1;
  // 1-indexed input synced to page (which is 0-indexed).
  const [inputPage, setInputPage] = useState(page + 1);
  useEffect(() => { setInputPage(page + 1); }, [page]);

  function handlePageInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const parsed = parseInt(String(inputPage), 10);
    if (isNaN(parsed)) return;
    const clamped = Math.max(1, totalPages > 0 ? Math.min(parsed, totalPages) : parsed);
    setInputPage(clamped);
    onPageChange(clamped - 1, pageSize);
  }

  return (
    <div className={styles.bar}>
      <Button
        size="sm"
        aria-label="Prev page"
        onClick={() => onPageChange(page - 1, pageSize)}
        disabled={page === 0 || busy}
      >
        ← Prev
      </Button>
      <span>Page</span>
      <input
        type="number"
        value={inputPage}
        min={1}
        max={totalPages > 0 ? totalPages : undefined}
        onChange={(e) => setInputPage(Number(e.target.value))}
        onKeyDown={handlePageInputKey}
        className={styles.pageInput}
      />
      <span>of {totalPages > 0 ? totalPages : '?'}</span>
      <Button
        size="sm"
        aria-label="Next page"
        onClick={() => onPageChange(page + 1, pageSize)}
        disabled={(totalPages > 0 && page >= totalPages - 1) || busy}
      >
        Next →
      </Button>
      <select
        value={pageSize}
        onChange={(e) => {
          const next = Number(e.target.value);
          onPageSizeChange(next);
          onPageChange(0, next);
        }}
        disabled={busy}
        className={styles.sizeSelect}
      >
        {PAGE_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <span>per page</span>
    </div>
  );
}
