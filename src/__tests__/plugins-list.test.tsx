import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PluginList } from '../plugins/ui/PluginList';
import type { PluginRecord } from '../plugins/PluginManager';

const baseRec = (over: Partial<PluginRecord>): PluginRecord => ({
  id: over.id ?? 'x',
  dir: '/p/x',
  state: over.state ?? 'discovered',
  findings: over.findings ?? [],
  manifest: over.manifest ?? { id: over.id ?? 'x', name: 'X', version: '1.0.0',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engines: { mongolens: '^1.0.0' } as any, main: 'm.js' },
  ...over,
});

describe('PluginList', () => {
  it('renders all records with name and version', () => {
    const records = [
      baseRec({ id: 'a', manifest: { id: 'a', name: 'Alpha', version: '1.0.0',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        engines: { mongolens: '^1.0.0' } as any, main: 'm.js' } }),
      baseRec({ id: 'b', manifest: { id: 'b', name: 'Beta',  version: '2.0.0',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        engines: { mongolens: '^1.0.0' } as any, main: 'm.js' } }),
    ];
    render(<PluginList records={records} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/Alpha/)).toBeTruthy();
    expect(screen.getByText(/Beta/)).toBeTruthy();
    expect(screen.getByText(/1\.0\.0/)).toBeTruthy();
    expect(screen.getByText(/2\.0\.0/)).toBeTruthy();
  });

  it('shows the warning indicator for records with warning findings', () => {
    const records = [baseRec({ id: 'a',
      findings: [{ ruleId: 'r', severity: 'warning', message: 'm' }] })];
    render(<PluginList records={records} selectedId={null} onSelect={() => {}} />);
    const item = screen.getByRole('listitem');
    expect(item.getAttribute('data-severity')).toBe('warning');
  });

  it('shows the error indicator for records with any error finding', () => {
    const records = [baseRec({ id: 'a',
      findings: [
        { ruleId: 'r', severity: 'warning', message: 'm1' },
        { ruleId: 'r', severity: 'error',   message: 'm2' },
      ] })];
    render(<PluginList records={records} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole('listitem').getAttribute('data-severity')).toBe('error');
  });

  it('marks the selected item with aria-selected', () => {
    const records = [
      baseRec({ id: 'a' }),
      baseRec({ id: 'b' }),
    ];
    render(<PluginList records={records} selectedId="b" onSelect={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0].getAttribute('aria-selected')).toBe('false');
    expect(items[1].getAttribute('aria-selected')).toBe('true');
  });

  it('fires onSelect with the record id when clicked', () => {
    const onSelect = vi.fn();
    const records = [baseRec({ id: 'a' })];
    render(<PluginList records={records} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('listitem'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});
