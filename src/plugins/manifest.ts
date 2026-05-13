import Ajv, { ErrorObject } from 'ajv';
import schema from './schema/manifest.schema.json';

export interface CommandContribution      { id: string; title: string; category?: string }
export interface KeybindingContribution   { command: string; mac: string; when?: string }
export interface ViewContribution         { id: string; title: string; icon?: string; location: 'sidebar' | 'panel' }
export interface ResultViewerContribution { id: string; title: string; when?: string }
export interface ExecutionModeContrib     { id: string; title: string }
export interface AIToolContribution       { id: string; schema: string }
export interface ConnectionProviderContrib{ id: string; title: string }
export interface ThemeContribution        { id: string; path: string }
export interface ExportTargetContribution { id: string; title: string; formats: string[] }

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  engines: { mongolens: string };
  main: string;
  permissions?: string[];
  activationEvents?: string[];
  contributes?: {
    commands?: CommandContribution[];
    keybindings?: KeybindingContribution[];
    views?: ViewContribution[];
    resultViewers?: ResultViewerContribution[];
    executionModes?: ExecutionModeContrib[];
    aiTools?: AIToolContribution[];
    connectionProviders?: ConnectionProviderContrib[];
    themes?: ThemeContribution[];
    exportTargets?: ExportTargetContribution[];
  };
}

const ajv = new Ajv({ allErrors: true });
const compiled = ajv.compile<PluginManifest>(schema);

export interface ValidateResult {
  ok: boolean;
  manifest?: PluginManifest;
  errors?: string[];
}

export function validateManifest(raw: unknown): ValidateResult {
  if (compiled(raw)) {
    return { ok: true, manifest: raw };
  }
  const errors = (compiled.errors ?? []).map(formatError);
  return { ok: false, errors };
}

function formatError(e: ErrorObject): string {
  const path = e.instancePath || '/';
  if (e.keyword === 'pattern' && path.startsWith('/permissions')) {
    return `${path}: invalid permission scope (${e.params.pattern}) — value did not match v1 scope vocabulary`;
  }
  return `${path}: ${e.message ?? 'invalid'}`;
}
