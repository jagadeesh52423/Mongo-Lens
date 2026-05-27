import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Panel } from '../Panel';

describe('Panel', () => {
  it('renders header title and right slot', () => {
    render(
      <Panel>
        <Panel.Header title="Results" right={<button>X</button>} />
        <Panel.Body>body</Panel.Body>
        <Panel.Footer>footer</Panel.Footer>
      </Panel>
    );
    expect(screen.getByText('Results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByText('footer')).toBeInTheDocument();
  });

  it('header falls back to children when title not provided', () => {
    render(
      <Panel>
        <Panel.Header>Inline Title</Panel.Header>
      </Panel>
    );
    expect(screen.getByText('Inline Title')).toBeInTheDocument();
  });
});
