export const KNOWN_SCOPE_KINDS = [
  'database:read', 'database:write',
  'network:fetch',
  'secrets:read', 'secrets:write',
  'workspace:read', 'workspace:write',
  'connections:write',
] as const;

export type ScopeKind = (typeof KNOWN_SCOPE_KINDS)[number];

export interface Scope {
  kind: ScopeKind;
  arg?: string;
}

const ARG_REQUIRED: ReadonlySet<ScopeKind> = new Set(['network:fetch']);

export function parseScope(raw: string): Scope {
  // Split into at most three parts; kind keeps the first two segments ("a:b"), arg is the rest joined.
  const parts = raw.split(':');
  if (parts.length < 2) throw new Error(`Invalid scope "${raw}"`);
  const kind = `${parts[0]}:${parts[1]}` as ScopeKind;
  if (!(KNOWN_SCOPE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unknown scope kind "${kind}"`);
  }
  const arg = parts.length > 2 ? parts.slice(2).join(':') : undefined;
  if (ARG_REQUIRED.has(kind) && !arg) {
    throw new Error(`Scope "${kind}" requires an argument`);
  }
  return arg !== undefined ? { kind, arg } : { kind };
}

export function matchesScope(granted: readonly Scope[], requested: Scope): boolean {
  for (const g of granted) {
    if (g.kind !== requested.kind) continue;
    if (g.arg === undefined && requested.arg === undefined) return true;
    if (g.kind === 'network:fetch' && g.arg && requested.arg) {
      if (matchUrlGlob(g.arg, requested.arg)) return true;
    }
  }
  return false;
}

const GLOB_PLACEHOLDER = 'xwildcardx';

function matchUrlGlob(pattern: string, url: string): boolean {
  // Only host glob is supported; * may appear in host only. Path/query checked as a prefix.
  // Use a lowercase placeholder so URL's hostname lowercasing doesn't break the replacement.
  try {
    const pu = new URL(pattern.replace('*', GLOB_PLACEHOLDER));
    const uu = new URL(url);
    if (pu.protocol !== uu.protocol) return false;
    const hostPattern = pu.hostname.replace(GLOB_PLACEHOLDER, '*');
    const hostRe = new RegExp('^' + hostPattern.split('*').map(escapeRe).join('[^.]+') + '$');
    if (!hostRe.test(uu.hostname)) return false;
    if (pu.pathname !== '/' && !uu.pathname.startsWith(pu.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
