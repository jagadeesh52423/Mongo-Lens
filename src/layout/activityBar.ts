import { Disposable } from '../plugins/api/disposable';

export interface ActivityItem {
  id: string;
  title: string;
  icon: string;              // 1–4 char string (emoji or label)
  render(container: HTMLElement): { dispose(): void };
}

export interface ActivityRegistry {
  list(): ActivityItem[];
  onDidChange(cb: () => void): Disposable;
}
