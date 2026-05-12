import { parseScope, matchesScope, KNOWN_SCOPE_KINDS } from '../plugins/permissions';

describe('permissions', () => {
  it('parses scopes with no argument', () => {
    expect(parseScope('database:read')).toEqual({ kind: 'database:read' });
    expect(parseScope('workspace:write')).toEqual({ kind: 'workspace:write' });
  });

  it('parses network:fetch with URL pattern arg', () => {
    expect(parseScope('network:fetch:https://*.acme.com')).toEqual({
      kind: 'network:fetch',
      arg: 'https://*.acme.com',
    });
  });

  it('rejects unknown scope kinds', () => {
    expect(() => parseScope('filesystem:read')).toThrow(/unknown scope/i);
  });

  it('KNOWN_SCOPE_KINDS includes every kind in v1 vocabulary', () => {
    expect(KNOWN_SCOPE_KINDS).toEqual(
      expect.arrayContaining([
        'database:read', 'database:write',
        'network:fetch',
        'secrets:read', 'secrets:write',
        'workspace:read', 'workspace:write',
      ]),
    );
  });

  it('matchesScope: exact-kind scopes match by kind', () => {
    const granted = [parseScope('database:read')];
    expect(matchesScope(granted, { kind: 'database:read' })).toBe(true);
    expect(matchesScope(granted, { kind: 'database:write' })).toBe(false);
  });

  it('matchesScope: network:fetch matches host glob with * only in host', () => {
    const granted = [parseScope('network:fetch:https://*.acme.com')];
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://api.acme.com/v1' })).toBe(true);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://evil.com/' })).toBe(false);
  });
});
