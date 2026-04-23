import type { ReactNode } from 'react';

export interface RecordActionHost {
  openModal(title: string, body: ReactNode, footer: ReactNode): void;
  close(): void;
  triggerDocUpdate(): void;
  executeAction(id: string): void;
}
