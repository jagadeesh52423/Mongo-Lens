import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { arrayField, FieldRendererRegistry, stringField } from '../plugins/config/fieldRenderers';

describe('ArrayField', () => {
  it('matches type:array', () => {
    expect(arrayField.matches({ type: 'array', items: { type: 'string' } })).toBe(true);
    expect(arrayField.matches({ type: 'string' })).toBe(false);
  });

  it('renders one row per initial item using items schema', () => {
    const reg = new FieldRendererRegistry();
    reg.register(stringField);
    render(<>{arrayField.render({
      schema: { type: 'array', items: { type: 'string' } },
      value: ['a', 'b'],
      onCommit: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _registry: reg as any,
    } as any)}</>);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('Add appends a row; Remove removes one; commit fires with full array', () => {
    const onCommit = vi.fn();
    const reg = new FieldRendererRegistry();
    reg.register(stringField);
    render(<>{arrayField.render({
      schema: { type: 'array', items: { type: 'string' } },
      value: ['x'],
      onCommit,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _registry: reg as any,
    } as any)}</>);

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(inputs[1], { target: { value: 'y' } });
    fireEvent.blur(inputs[1]);
    expect(onCommit).toHaveBeenLastCalledWith(['x', 'y']);

    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    expect(onCommit).toHaveBeenLastCalledWith(['y']);
  });
});
