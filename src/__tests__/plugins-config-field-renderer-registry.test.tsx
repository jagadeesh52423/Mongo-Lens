import { describe, it, expect } from 'vitest';
import { FieldRendererRegistry } from '../plugins/config/fieldRenderers';
import type { FieldRenderer } from '../plugins/config/fieldRenderers';

const make = (id: string, match: (s: { type: string; format?: string }) => boolean): FieldRenderer => ({
  matches: (s) => match(s as { type: string; format?: string }),
  // eslint-disable-next-line react/jsx-key
  render: () => <span data-id={id} />,
});

describe('FieldRendererRegistry', () => {
  it('returns first matcher in registration order', () => {
    const reg = new FieldRendererRegistry();
    reg.register(make('A', s => s.type === 'string'));
    reg.register(make('B', s => s.type === 'string'));
    const r = reg.find({ type: 'string' });
    expect(r).toBeTruthy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r!.render({} as any) as any).props['data-id']).toBe('A');
  });

  it('returns undefined when nothing matches', () => {
    const reg = new FieldRendererRegistry();
    expect(reg.find({ type: 'string' })).toBeUndefined();
  });

  it('matcher priority lets custom renderer beat default', () => {
    const reg = new FieldRendererRegistry();
    reg.register(make('date', s => s.type === 'string' && s.format === 'date'));
    reg.register(make('string', s => s.type === 'string'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((reg.find({ type: 'string', format: 'date' })!.render({} as any) as any).props['data-id']).toBe('date');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((reg.find({ type: 'string' })!.render({} as any) as any).props['data-id']).toBe('string');
  });
});
