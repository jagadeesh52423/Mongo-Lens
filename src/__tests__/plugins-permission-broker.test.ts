import { PermissionBroker, PermissionDeniedError } from '../plugins/PermissionBroker';
import { parseScope } from '../plugins/permissions';

describe('PermissionBroker', () => {
  it('allows a call when matching scope is granted', () => {
    const broker = new PermissionBroker();
    broker.setGrants('p1', [parseScope('database:read')]);
    expect(() => broker.check('p1', { kind: 'database:read' })).not.toThrow();
  });

  it('throws PermissionDeniedError when scope is not granted', () => {
    const broker = new PermissionBroker();
    broker.setGrants('p1', []);
    expect(() => broker.check('p1', { kind: 'database:read' })).toThrow(PermissionDeniedError);
  });

  it('audits every check', () => {
    const broker = new PermissionBroker();
    const audit = vi.fn();
    broker.onAudit(audit);
    broker.setGrants('p1', [parseScope('database:read')]);
    broker.check('p1', { kind: 'database:read' });
    try { broker.check('p1', { kind: 'database:write' }); } catch { /* expected */ }
    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls[0][0]).toMatchObject({ pluginId: 'p1', scope: { kind: 'database:read' }, allowed: true });
    expect(audit.mock.calls[1][0]).toMatchObject({ pluginId: 'p1', scope: { kind: 'database:write' }, allowed: false });
  });
});
