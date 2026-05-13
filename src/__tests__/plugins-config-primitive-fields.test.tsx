import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { stringField, numberField, booleanField } from '../plugins/config/fieldRenderers';

describe('StringField', () => {
  it('renders an <input type="text"> for plain string', () => {
    const node = stringField.render({
      schema: { type: 'string' }, value: 'hello', onCommit: () => {},
    });
    render(<>{node}</>);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('hello');
  });

  it('renders <select> for string + enum', () => {
    const node = stringField.render({
      schema: { type: 'string', enum: ['a', 'b', 'c'] }, value: 'b', onCommit: () => {},
    });
    render(<>{node}</>);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('b');
    expect(Array.from(select.options).map(o => o.value)).toEqual(['a', 'b', 'c']);
  });

  it('commits value on blur for text', () => {
    const onCommit = vi.fn();
    const node = stringField.render({
      schema: { type: 'string' }, value: '', onCommit,
    });
    render(<>{node}</>);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'typed' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('typed');
  });
});

describe('NumberField', () => {
  it('renders an <input type="number">', () => {
    const node = numberField.render({
      schema: { type: 'integer' }, value: 5, onCommit: () => {},
    });
    render(<>{node}</>);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('5');
  });

  it('commits parsed number on blur', () => {
    const onCommit = vi.fn();
    const node = numberField.render({
      schema: { type: 'integer' }, value: 0, onCommit,
    });
    render(<>{node}</>);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(42);
  });
});

describe('BooleanField', () => {
  it('renders an <input type="checkbox">', () => {
    const node = booleanField.render({
      schema: { type: 'boolean' }, value: true, onCommit: () => {},
    });
    render(<>{node}</>);
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it('commits on change (not blur)', () => {
    const onCommit = vi.fn();
    const node = booleanField.render({
      schema: { type: 'boolean' }, value: false, onCommit,
    });
    render(<>{node}</>);
    const cb = screen.getByRole('checkbox');
    fireEvent.click(cb);
    expect(onCommit).toHaveBeenCalledWith(true);
  });
});
