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
  icon?: string;
  location: 'sidebar' | 'panel';
  /**
   * If true, the host wraps the view in a vertically scrollable container.
   * The view should render natural-height content without imposing its own
   * height constraints or overflow rules. Defaults to false (the view owns
   * its layout and any scrolling within it).
   */
  scrollable?: boolean;
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

export interface ConnectionRef {
  id: string;
  name: string;
  host?: string;
  port?: number;
  username?: string;
}

export interface ConnectionsApi {
  list(): Promise<ConnectionRef[]>;
  updateCredentials(id: string, creds: { password: string }): Promise<void>;
}

export interface SecretsApi {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface WorkspaceApi {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
