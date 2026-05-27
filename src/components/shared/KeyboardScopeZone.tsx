import { forwardRef, type CSSProperties, type ReactNode } from 'react';

interface Props {
  scope: string;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  tabIndex?: number;
}

export const KeyboardScopeZone = forwardRef<HTMLDivElement, Props>(
  function KeyboardScopeZone({ scope, children, style, className, tabIndex }, ref) {
    return (
      <div
        ref={ref}
        style={style}
        className={className}
        data-keyboard-scope={scope}
        tabIndex={tabIndex}
      >
        {children}
      </div>
    );
  },
);
