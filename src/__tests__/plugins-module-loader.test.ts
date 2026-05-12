import { wrapPluginSource } from '../plugins/sandbox/moduleLoader';

describe('moduleLoader.wrapPluginSource', () => {
  it('wraps source in an IIFE that shadows window/fetch/__TAURI__/localStorage', () => {
    const out = wrapPluginSource('export const x = 1;');
    expect(out).toMatch(/let window =/);
    expect(out).toMatch(/let fetch =/);
    expect(out).toMatch(/let __TAURI__ =/);
    expect(out).toMatch(/let localStorage =/);
    expect(out).toMatch(/let XMLHttpRequest =/);
  });

  it('preserves the original source between the markers', () => {
    const out = wrapPluginSource('export const x = 1;');
    expect(out).toContain('export const x = 1;');
  });
});
