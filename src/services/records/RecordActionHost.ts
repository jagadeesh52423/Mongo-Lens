import type { ReactNode } from 'react';

export interface OpenModalOptions {
  // Return false to cancel close (e.g., to prompt about unsaved edits).
  beforeClose?: () => boolean | Promise<boolean>;
}

export interface RecordActionHost {
  openModal(title: string, body: ReactNode, footer: ReactNode, options?: OpenModalOptions): void;
  close(): void;
  triggerDocUpdate(): void;
  executeAction(id: string): void;
}
