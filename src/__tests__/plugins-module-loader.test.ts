import { wrapPluginSource } from '../plugins/sandbox/moduleLoader';

describe('moduleLoader.wrapPluginSource', () => {
  it('wraps source so fetch/__TAURI__/localStorage are shadowed', () => {
    const out = wrapPluginSource('export const x = 1;');
    expect(out).toMatch(/let fetch =/);
    expect(out).toMatch(/let __TAURI__ =/);
    expect(out).toMatch(/let localStorage =/);
    expect(out).toMatch(/let XMLHttpRequest =/);
  });

  it('does NOT shadow window/self/globalThis (bundled libs need them)', () => {
    const out = wrapPluginSource('export const x = 1;');
    expect(out).not.toMatch(/let window =/);
    expect(out).not.toMatch(/let self =/);
    expect(out).not.toMatch(/let globalThis =/);
  });

  it('preserves the original source between the markers', () => {
    const out = wrapPluginSource('export const x = 1;');
    expect(out).toContain('export const x = 1;');
  });
});
