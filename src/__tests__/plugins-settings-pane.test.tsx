import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginsSettingsPane } from '../plugins/ui/PluginsSettingsPane';

const records = [
  { id: 'acme.foo', dir: '/p/acme.foo', state: 'discovered' as const, manifest: { id: 'acme.foo', name: 'Foo', version: '1.0.0', engines: { mongolens: '^1.0.0' }, main: 'dist/main.js', permissions: ['database:read'] } },
  { id: 'acme.x', dir: '/p/acme.x', state: 'broken' as const, errors: ['bad'] },
];

describe('PluginsSettingsPane', () => {
  it('lists installed plugins with their state', () => {
    render(<PluginsSettingsPane records={records} onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    expect(screen.getByText('Foo')).toBeInTheDocument();
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText(/broken/i)).toBeInTheDocument();
  });

  it('clicking "Install from folder…" fires onInstall', async () => {
    const onInstall = vi.fn();
    render(<PluginsSettingsPane records={[]} onInstall={onInstall} onEnable={() => {}} onDisable={() => {}} onUninstall={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /install from folder/i }));
    expect(onInstall).toHaveBeenCalled();
  });

  it('clicking Uninstall on a row fires onUninstall with the id', async () => {
    const onUninstall = vi.fn();
    render(<PluginsSettingsPane records={records} onInstall={() => {}} onEnable={() => {}} onDisable={() => {}} onUninstall={onUninstall} />);
    await userEvent.click(screen.getAllByRole('button', { name: /uninstall/i })[0]);
    expect(onUninstall).toHaveBeenCalledWith('acme.foo');
  });
});
