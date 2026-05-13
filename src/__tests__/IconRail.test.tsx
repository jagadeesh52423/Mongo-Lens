import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconRail } from '../components/layout/IconRail';

const items = [
  { id: 'a', title: 'Alpha',  icon: 'A', render: () => ({ dispose: () => {} }) },
  { id: 'b', title: 'Bravo',  icon: 'B', render: () => ({ dispose: () => {} }) },
];

describe('IconRail', () => {
  it('renders one button per item', () => {
    render(<IconRail items={items} activeId="a" onChange={vi.fn()} onSettingsOpen={vi.fn()} settingsOpen={false} />);
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bravo' })).toBeInTheDocument();
  });

  it('fires onChange with the clicked item id', async () => {
    const onChange = vi.fn();
    render(<IconRail items={items} activeId="a" onChange={onChange} onSettingsOpen={vi.fn()} settingsOpen={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bravo' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('fires onSettingsOpen when Settings clicked', async () => {
    const onSettingsOpen = vi.fn();
    render(<IconRail items={items} activeId="a" onChange={vi.fn()} onSettingsOpen={onSettingsOpen} settingsOpen={false} />);
    await userEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(onSettingsOpen).toHaveBeenCalledTimes(1);
  });

  it('renders the icon text of each item', () => {
    render(<IconRail items={items} activeId="a" onChange={vi.fn()} onSettingsOpen={vi.fn()} settingsOpen={false} />);
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveTextContent('A');
    expect(screen.getByRole('button', { name: 'Bravo' })).toHaveTextContent('B');
  });
});
