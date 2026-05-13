import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { objectField, FieldRendererRegistry, stringField } from '../plugins/config/fieldRenderers';

describe('ObjectField', () => {
  it('matches type:object', () => {
    expect(objectField.matches({ type: 'object', properties: {} })).toBe(true);
  });

  it('renders one child field per property', () => {
    const reg = new FieldRendererRegistry();
    reg.register(stringField);
    render(<>{objectField.render({
      schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
      value: { a: 'x', b: 'y' },
      onCommit: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _registry: reg as any,
    } as any)}</>);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('commits a merged object when a child commits', () => {
    const onCommit = vi.fn();
    const reg = new FieldRendererRegistry();
    reg.register(stringField);
    render(<>{objectField.render({
      schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
      value: { a: 'x', b: 'y' },
      onCommit,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _registry: reg as any,
    } as any)}</>);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: 'changed' } });
    fireEvent.blur(inputs[0]);
    expect(onCommit).toHaveBeenLastCalledWith({ a: 'changed', b: 'y' });
  });
});
