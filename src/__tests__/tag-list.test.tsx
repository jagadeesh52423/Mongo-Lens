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
});
