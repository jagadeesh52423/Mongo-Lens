import type { ConfigurationContribution, JSONSchemaProperty } from '../manifest';

export type { ConfigurationContribution, JSONSchemaProperty };

export interface ConfigValueError {
  key: string;
  message: string;
}

export interface ConfigChangeEvent {
  keys: string[];
  values: Record<string, unknown>;
}

export interface Disposable { dispose(): void }
