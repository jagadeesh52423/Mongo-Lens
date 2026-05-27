import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Stack.module.css';

type Gap = 'none' | 'sm' | 'md' | 'lg';
type Align = 'start' | 'center' | 'end' | 'stretch';
type Justify = 'start' | 'center' | 'end' | 'space-between';

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  children: ReactNode;
}

function makeStack(direction: 'row' | 'column') {
  return function Stack({ gap = 'md', align, justify, className, ...rest }: StackProps) {
    const cls = [
      styles.stack, styles[direction], styles[`gap-${gap}`],
      align && styles[`align-${align}`], justify && styles[`justify-${justify}`],
      className,
    ].filter(Boolean).join(' ');
    return <div {...rest} className={cls} />;
  };
}

export const HStack = makeStack('row');
export const VStack = makeStack('column');
