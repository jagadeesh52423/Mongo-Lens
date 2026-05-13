import { validateManifest } from '../plugins/manifest';

const valid = {
  id: 'acme.foo',
  name: 'Foo',
  version: '1.0.0',
  engines: { mongolens: '^1.0.0' },
  main: 'dist/main.js',
  permissions: ['database:read'],
  activationEvents: ['onCommand:foo.run'],
  contributes: {
    commands: [{ id: 'foo.run', title: 'Run Foo' }],
  },
};

const baseValid = {
  id: 'p.test',
  name: 'Test',
  version: '0.0.1',
  engines: { mongolens: '^1.0.0' },
  main: 'index.js',
};

describe('manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    const r = validateManifest(valid);
    expect(r.ok).toBe(true);
  });

  it('rejects missing id', () => {
    const m = { ...valid }; delete (m as Record<string, unknown>).id;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors?.join(' ')).toMatch(/id/);
  });

  it('rejects id not matching <publisher>.<name>', () => {
    const r = validateManifest({ ...valid, id: 'no-dot' });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown permission scope', () => {
    const r = validateManifest({ ...valid, permissions: ['filesystem:read'] });
    expect(r.ok).toBe(false);
    expect(r.errors?.join(' ')).toMatch(/scope/i);
  });

  it('rejects unknown activation event prefix', () => {
    const r = validateManifest({ ...valid, activationEvents: ['onWhenever:foo'] });
    expect(r.ok).toBe(false);
  });
});

describe('manifest view icon', () => {
  it('accepts a view with no icon', () => {
    const r = validateManifest({
      ...baseValid,
      contributes: { views: [{ id: 'v', title: 'V', location: 'sidebar' }] },
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a view with a 1-4 char icon', () => {
    for (const icon of ['🚀', 'D', 'DF', 'MGOX']) {
      const r = validateManifest({
        ...baseValid,
        contributes: { views: [{ id: 'v', title: 'V', icon, location: 'sidebar' }] },
      });
      expect(r.ok).toBe(true);
    }
  });

  it('rejects icons longer than 4 chars', () => {
    const r = validateManifest({
      ...baseValid,
      contributes: { views: [{ id: 'v', title: 'V', icon: 'TOOLONG', location: 'sidebar' }] },
    });
    expect(r.ok).toBe(false);
  });
});
