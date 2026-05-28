import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagList } from '../components/features/saved-scripts/TagList';

describe('TagList', () => {
  test('renders one chip per tag', () => {
    render(<TagList tags={['prod', 'auth']} />);
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('auth')).toBeInTheDocument();
  });

  test('renders nothing when empty', () => {
    const { container } = render(<TagList tags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('invokes onClick(tag) when chip clicked', () => {
    const onClick = vi.fn();
    render(<TagList tags={['prod']} onClick={onClick} />);
    fireEvent.click(screen.getByText('prod'));
    expect(onClick).toHaveBeenCalledWith('prod');
  });

  test('shows remove ✕ button when onRemove is provided', () => {
    const onRemove = vi.fn();
    render(<TagList tags={['prod']} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('Remove tag prod'));
    expect(onRemove).toHaveBeenCalledWith('prod');
  });

  test('activates interactive chip on Enter key', () => {
    const onClick = vi.fn();
    render(<TagList tags={['prod']} onClick={onClick} />);
    const chip = screen.getByText('prod');
    fireEvent.keyDown(chip, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith('prod');
  });

  test('activates interactive chip on Space key and prevents page scroll', () => {
    const onClick = vi.fn();
    render(<TagList tags={['prod']} onClick={onClick} />);
    const chip = screen.getByText('prod');
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    chip.dispatchEvent(event);
    expect(onClick).toHaveBeenCalledWith('prod');
    expect(event.defaultPrevented).toBe(true);
  });

  test('does not bind key handler when chip is non-interactive', () => {
    render(<TagList tags={['prod']} />);
    const chip = screen.getByText('prod');
    // Non-interactive chips have no role="button" and no tabIndex.
    expect(chip).not.toHaveAttribute('role', 'button');
    expect(chip).not.toHaveAttribute('tabindex');
  });
});
