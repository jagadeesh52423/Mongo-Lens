import { MouseEvent } from 'react';
import styles from './TagList.module.css';

interface Props {
  tags: string[];
  onClick?: (tag: string) => void;
  onRemove?: (tag: string) => void;
  selectedTag?: string;
}

export function TagList({ tags, onClick, onRemove, selectedTag }: Props) {
  if (!tags.length) return null;
  return (
    <span className={styles.list}>
      {tags.map((tag) => {
        const isSelected =
          selectedTag != null && tag.toLowerCase() === selectedTag.toLowerCase();
        const interactive = !!onClick;
        return (
          <span
            key={tag}
            className={`${styles.chip} ${isSelected ? styles.selected : ''} ${
              interactive ? styles.interactive : ''
            }`}
            onClick={
              interactive
                ? (e: MouseEvent) => {
                    e.stopPropagation();
                    onClick!(tag);
                  }
                : undefined
            }
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
          >
            {tag}
            {onRemove && (
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                className={styles.remove}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(tag);
                }}
              >
                ✕
              </button>
            )}
          </span>
        );
      })}
    </span>
  );
}
