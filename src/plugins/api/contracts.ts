import { Disposable } from './disposable';

export interface Command {
  id: string;
  handler: (...args: unknown[]) => unknown | Promise<unknown>;
}

export interface Keybinding {
  id: string;          // synthetic, "<command>@<keys>"
  command: string;
  mac: string;
  when?: string;
}

export interface ResultContext {
  result: unknown;
  connectionId?: string;
  database?: string;
}

export interface ResultViewer {
  id: string;
  title: string;
  match(result: unknown): boolean;
  render(container: HTMLElement, ctx: ResultContext): Disposable;
}

export interface ViewContext { container: HTMLElement; }
export interface ViewProvider {
  id: string;
  title: string;
  location: 'sidebar' | 'panel';
  render(container: HTMLElement, ctx: ViewContext): Disposable;
}

export interface ExecCtx {
  connectionId?: string;
  database?: string;
}
export type ExecEvent =
  | { kind: 'row'; row: unknown }
  | { kind: 'log'; message: string }
  | { kind: 'done'; stats?: Record<string, unknown> };

export interface ExecutionModeContract {
  id: string;
  title: string;
  run(script: string, ctx: ExecCtx): AsyncIterable<ExecEvent>;
}

export interface AITool {
  id: string;
  schema: unknown; // JSON Schema describing inputs
  invoke(args: unknown, ctx: { signal: AbortSignal }): Promise<unknown>;
}

export interface ConnectionConfig { [k: string]: unknown }
export interface DriverHandle { id: string; close(): Promise<void> }

export interface ConnectionProvider {
  id: string;
  title: string;
  createConfig(ui: { prompt: (spec: unknown) => Promise<unknown> }): Promise<ConnectionConfig>;
  connect(cfg: ConnectionConfig): Promise<DriverHandle>;
}

export interface ThemeContract {
  id: string;
  json: Record<string, unknown>; // theme JSON
}

export interface ExportTargetContract {
  id: string;
  title: string;
  formats: string[];
  export(rows: unknown[], format: string, ctx: { connectionId?: string }): Promise<void>;
}
