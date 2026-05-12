import { Disposable } from './api/disposable';
import { Logger } from './api/logger';
import { SecretStorage } from './api/secretStorage';

export interface ExtensionContext {
  pluginId: string;
  storagePath: string;
  subscriptions: Disposable[];
  secrets: SecretStorage;
  logger: Logger;
}

export function createExtensionContext(params: {
  pluginId: string;
  storagePath: string;
  secrets: SecretStorage;
  logger: Logger;
}): ExtensionContext {
  return { ...params, subscriptions: [] };
}
