import { forwardRef, type CSSProperties, type ReactNode } from 'react';

interface Props {
  scope: string;
  children: ReactNode;
  style?: CSSProperties;
  tabIndex?: number;
}

export const KeyboardScopeZone = forwardRef<HTMLDivElement, Props>(
  function KeyboardScopeZone({ scope, children, style, tabIndex }, ref) {
    return (
      <div ref={ref} style={style} data-keyboard-scope={scope} tabIndex={tabIndex}>
        {children}
      </div>
    );
  },
);
