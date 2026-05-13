import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PluginConfigRoute } from '../plugins/ui/PluginConfigRoute';
import { ConfigService } from '../plugins/config/ConfigService';
import { ConfigStore } from '../plugins/config/ConfigStore';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';
import { PermissionBroker } from '../plugins/PermissionBroker';
import type { ConfigurationContribution } from '../plugins/manifest';

class FakeWorkspace {
  store = new Map<string, unknown>();
  async get(k: string) { return this.store.get(k); }
  async update(k: string, v: unknown) { this.store.set(k, v); }
}

const schema: ConfigurationContribution = {
  title: 'P', properties: { url: { type: 'string', title: 'URL' } },
};

function makeSvc() {
  const ws = new FakeWorkspace();
  const kb = new InMemoryKeychainBackend();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = new ConfigStore('p', schema, ws as any, kb);
  return new ConfigService('p', schema, store, new PermissionBroker(),
    { recheckEnforcement: async () => {} });
}

describe('PluginConfigRoute', () => {
  it('renders breadcrumb with plugin name', async () => {
    render(<PluginConfigRoute pluginName="Datafleet" schema={schema}
      configService={makeSvc()} onBack={() => {}} />);
    await screen.findByText(/Datafleet/);
    expect(screen.getByText(/Plugins.*Datafleet.*Settings/)).toBeTruthy();
  });

  it('renders non-compact form', async () => {
    render(<PluginConfigRoute pluginName="P" schema={schema}
      configService={makeSvc()} onBack={() => {}} />);
    await screen.findByLabelText('URL');
    expect(document.querySelector('.plugin-config-form.compact')).toBeNull();
  });

  it('Back button calls onBack', async () => {
    const onBack = vi.fn();
    render(<PluginConfigRoute pluginName="P" schema={schema}
      configService={makeSvc()} onBack={onBack} />);
    await screen.findByLabelText('URL');
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders "no settings" empty state when schema is null', () => {
    render(<PluginConfigRoute pluginName="P" schema={null}
      configService={undefined} onBack={() => {}} />);
    expect(screen.getByText(/no configurable settings/i)).toBeTruthy();
  });
});
