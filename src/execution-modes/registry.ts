import { Registry } from '../plugins/Registry';
import { ExecutionMode } from './types';

const _registry = new Registry<ExecutionMode>('builtinExecutionModes');

export function registerExecutionMode(mode: ExecutionMode): void {
  _registry.register(mode, '__builtin__');
}

export function getExecutionModes(): readonly ExecutionMode[] {
  return _registry.list();
}

export function getExecutionMode(id: string): ExecutionMode | undefined {
  return _registry.get(id);
}
