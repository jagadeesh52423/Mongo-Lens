import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
    constructor(_: unknown) {}
  },
}));

import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { ToolsUnsupportedError } from './AIProvider';

const cfg = { baseUrl: 'http://x', apiToken: 't', model: 'm', streaming: false };
beforeEach(() => { create.mockReset(); });

describe('chatWithTools', () => {
  it('maps tool_calls to ToolCall[] with parsed args', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: '', tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'runMongo', arguments: '{"statement":"db.x.find()"}' } },
      ] } }],
    });
    const p = new OpenAICompatibleProvider(cfg);
    const res = await p.chatWithTools({ messages: [{ role: 'user', content: 'hi' }], model: 'm' }, []);
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'runMongo', arguments: { statement: 'db.x.find()' } }]);
  });

  it('returns content when no tool_calls', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: 'done' } }] });
    const p = new OpenAICompatibleProvider(cfg);
    const res = await p.chatWithTools({ messages: [{ role: 'user', content: 'hi' }], model: 'm' }, []);
    expect(res).toEqual({ content: 'done', toolCalls: [] });
  });

  it('serializes assistant tool_calls and tool results in the outgoing messages', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
    const p = new OpenAICompatibleProvider(cfg);
    await p.chatWithTools({
      model: 'm',
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'runMongo', arguments: { statement: 's' } }] },
        { role: 'tool', toolCallId: 'c1', content: 'result' },
      ],
    }, []);
    const sent = create.mock.calls[0][0].messages;
    expect(sent[1]).toEqual({ role: 'assistant', content: null, tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'runMongo', arguments: '{"statement":"s"}' } },
    ] });
    expect(sent[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'result' });
  });

  it('throws ToolsUnsupportedError on a tool-related 400', async () => {
    create.mockRejectedValue(Object.assign(new Error('tools not supported'), { status: 400 }));
    const p = new OpenAICompatibleProvider(cfg);
    await expect(p.chatWithTools({ messages: [{ role: 'user', content: 'x' }], model: 'm' }, []))
      .rejects.toBeInstanceOf(ToolsUnsupportedError);
  });
});
