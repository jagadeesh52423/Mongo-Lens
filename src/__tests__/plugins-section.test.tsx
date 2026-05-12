/**
 * PluginsSection wiring smoke test.
 *
 * In the test environment window.__pluginHost is absent, so the section
 * renders the no-op fallback (empty list, buttons present but inert).
 * The full wired path (PluginsSectionInner + usePluginRecords) is exercised
 * by plugins-integration.test.ts and the manual smoke-test flow.
 */
import { render, screen } from '@testing-library/react';
import { getSections } from '../settings/registry';
// Side-effect import: registers the 'plugins' section with the settings registry.
import '../settings/sections/PluginsSection';

describe('PluginsSection (no host fallback)', () => {
  it('registers itself in the settings registry and renders Install button when host is absent', () => {
    const section = getSections().find(s => s.id === 'plugins');
    expect(section).toBeDefined();
    const Component = section!.component;
    render(<Component />);
    expect(screen.getByRole('button', { name: /install from folder/i })).toBeInTheDocument();
  });
});
