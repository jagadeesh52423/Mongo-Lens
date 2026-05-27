import { Children, type ReactNode } from 'react';
import { useResizable } from '../hooks/useResizable';
import styles from './ResizableSplit.module.css';

interface Props {
  direction: 'horizontal' | 'vertical';
  initial: number; min: number; max: number;
  storageKey?: string;
  children: [ReactNode, ReactNode]; // exactly two children
}

export function ResizableSplit({ direction, initial, min, max, storageKey, children }: Props) {
  const { size, handlers } = useResizable({ initial, min, max, direction, storageKey });
  const [a, b] = Children.toArray(children);
  const aStyle = direction === 'horizontal'
    ? { width: size, flex: '0 0 auto' as const }
    : { height: size, flex: '0 0 auto' as const };
  return (
    <div className={direction === 'horizontal' ? styles.h : styles.v}>
      <div className={styles.pane} style={aStyle}>{a}</div>
      <div
        className={direction === 'horizontal' ? styles.handleH : styles.handleV}
        {...handlers}
      />
      <div className={styles.paneFlex}>{b}</div>
    </div>
  );
}
