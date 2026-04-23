import { type CSSProperties, type ReactNode } from 'react';

interface Props {
  scope: string;
  children: ReactNode;
  style?: CSSProperties;
}

export function KeyboardScopeZone({ scope, children, style }: Props) {
  return (
    <div style={style} data-keyboard-scope={scope}>
      {children}
    </div>
  );
}
