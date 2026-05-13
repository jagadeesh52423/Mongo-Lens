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

  it('matchesScope: path-only glob /* matches any path on that host', () => {
    const granted = [parseScope('network:fetch:https://api.acme.com/*')];
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://api.acme.com/datafleet' })).toBe(true);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://api.acme.com/v1/users' })).toBe(true);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://api.acme.com/' })).toBe(true);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://api.other.com/datafleet' })).toBe(false);
  });

  it('matchesScope: path-prefix glob /api/* matches that prefix only', () => {
    const granted = [parseScope('network:fetch:https://acme.com/api/*')];
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://acme.com/api/v1' })).toBe(true);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://acme.com/api/v1/x/y' })).toBe(true);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://acme.com/other' })).toBe(false);
  });

  it('matchesScope: combined host+path glob', () => {
    const granted = [parseScope('network:fetch:https://*.acme.com/api/*')];
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://x.acme.com/api/v1' })).toBe(true);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://x.acme.com/other' })).toBe(false);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://acme.com/api/v1' })).toBe(false);
  });

  it('matchesScope: path without star keeps prefix-match (backward compatible)', () => {
    const granted = [parseScope('network:fetch:https://acme.com/datafleet')];
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://acme.com/datafleet' })).toBe(true);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://acme.com/datafleet/extra' })).toBe(true);
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://acme.com/other' })).toBe(false);
  });

  it('matchesScope: trailing slash "/" still matches any path (backward compatible)', () => {
    const granted = [parseScope('network:fetch:https://acme.com/')];
    expect(matchesScope(granted, { kind: 'network:fetch', arg: 'https://acme.com/anything' })).toBe(true);
  });
});

describe('connections:write scope', () => {
  it('parses connections:write as a known scope', () => {
    expect(parseScope('connections:write')).toEqual({ kind: 'connections:write' });
  });

  it('rejects connections:read (not in known kinds yet)', () => {
    expect(() => parseScope('connections:read')).toThrow(/Unknown scope kind/);
  });

  it('matches granted connections:write against requested connections:write', () => {
    expect(matchesScope([{ kind: 'connections:write' }], { kind: 'connections:write' })).toBe(true);
  });

  it('does not match when not granted', () => {
    expect(matchesScope([{ kind: 'secrets:read' }], { kind: 'connections:write' })).toBe(false);
  });
});
