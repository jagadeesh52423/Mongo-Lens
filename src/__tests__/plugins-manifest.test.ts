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
