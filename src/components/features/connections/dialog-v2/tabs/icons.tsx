// Inline line-icons matching ConnectionTree.tsx (currentColor, ~1.2 stroke).
import type { ReactNode } from 'react';

const svg = (paths: ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);

export const TAB_ICONS = {
  server: svg(<><rect x="2" y="2" width="10" height="4" rx="1" /><rect x="2" y="8" width="10" height="4" rx="1" /><path d="M4 4h.01M4 10h.01" /></>),
  auth: svg(<><circle cx="5" cy="6" r="2.2" /><path d="M5 8.2V12M3.6 10.4h2.8" /><path d="M8 5l3.5-.0M9.5 5v2" /></>),
  tls: svg(<><rect x="3" y="6" width="8" height="6" rx="1" /><path d="M5 6V4.5a2 2 0 0 1 4 0V6" /></>),
  ssh: svg(<><rect x="2" y="3" width="10" height="8" rx="1" /><path d="M4 6l2 1.5L4 9M7.5 9H10" /></>),
  proxy: svg(<><circle cx="7" cy="7" r="5" /><path d="M2 7h10M7 2c1.6 1.5 1.6 8.5 0 10M7 2c-1.6 1.5-1.6 8.5 0 10" /></>),
  intelliShell: svg(<path d="M7.5 1.5 3 7.6h3.4l-.4 4.9 4.6-6.8H7.3z" />),
  tools: svg(<path d="M9.5 2.5a2.5 2.5 0 0 0-3 3.2L2.6 9.6a1 1 0 1 0 1.4 1.4l3.9-3.9a2.5 2.5 0 0 0 3.2-3l-1.6 1.6-1.2-1.2z" />),
  advanced: svg(<><circle cx="7" cy="7" r="2" /><path d="M7 1v2M7 11v2M1 7h2M11 7h2M3 3l1.5 1.5M9.5 9.5 11 11M11 3 9.5 4.5M4.5 9.5 3 11" /></>),
} as const;
