import { matchesScope, Scope } from './permissions';
import { Disposable, toDisposable } from './api/disposable';

export class PermissionDeniedError extends Error {
  constructor(public readonly pluginId: string, public readonly scope: Scope) {
    super(`Plugin "${pluginId}" lacks scope ${scope.kind}${scope.arg ? `:${scope.arg}` : ''}`);
    this.name = 'PermissionDeniedError';
  }
}

export interface AuditEvent {
  pluginId: string;
  scope: Scope;
  allowed: boolean;
  timestamp: number;
}

export class PermissionBroker {
  private grants = new Map<string, Scope[]>();
  private auditListeners = new Set<(e: AuditEvent) => void>();

  setGrants(pluginId: string, scopes: Scope[]): void {
    this.grants.set(pluginId, scopes);
  }

  getGrants(pluginId: string): readonly Scope[] {
    return this.grants.get(pluginId) ?? [];
  }

  clearGrants(pluginId: string): void {
    this.grants.delete(pluginId);
  }

  check(pluginId: string, requested: Scope): void {
    const granted = this.grants.get(pluginId) ?? [];
    const allowed = matchesScope(granted, requested);
    this.fireAudit({ pluginId, scope: requested, allowed, timestamp: Date.now() });
    if (!allowed) throw new PermissionDeniedError(pluginId, requested);
  }

  onAudit(listener: (e: AuditEvent) => void): Disposable {
    this.auditListeners.add(listener);
    return toDisposable(() => { this.auditListeners.delete(listener); });
  }

  private fireAudit(e: AuditEvent): void {
    for (const l of this.auditListeners) { try { l(e); } catch { /* listeners must not throw */ } }
  }
}
