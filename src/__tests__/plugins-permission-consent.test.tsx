import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionConsentDialog } from '../plugins/ui/PermissionConsentDialog';

describe('PermissionConsentDialog', () => {
  it('lists each requested scope in human-readable form', () => {
    render(
      <PermissionConsentDialog
        pluginName="Schema Visualizer"
        scopes={['database:read', 'network:fetch:https://*.acme.com']}
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );
    expect(screen.getByText(/Schema Visualizer/)).toBeInTheDocument();
    expect(screen.getByText(/Read from your databases/i)).toBeInTheDocument();
    expect(screen.getByText(/Make network requests to/i)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/\*\.acme\.com/)).toBeInTheDocument();
  });

  it('fires onApprove when Approve is clicked', async () => {
    const onApprove = vi.fn();
    render(
      <PermissionConsentDialog pluginName="Foo" scopes={['database:read']} onApprove={onApprove} onDeny={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalled();
  });

  it('fires onDeny when Deny is clicked', async () => {
    const onDeny = vi.fn();
    render(
      <PermissionConsentDialog pluginName="Foo" scopes={['database:read']} onApprove={() => {}} onDeny={onDeny} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(onDeny).toHaveBeenCalled();
  });
});
