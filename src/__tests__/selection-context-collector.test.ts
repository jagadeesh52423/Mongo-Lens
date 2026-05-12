import { describe, it, expect, beforeEach } from 'vitest';
import {
  SelectionContextCollector,
  ContextCollector,
} from '../services/ai/ContextCollector';
import { useEditorStore } from '../store/editor';
import { useConnectionsStore } from '../store/connections';
import { useResultsStore } from '../store/results';
import type { EditorTab } from '../types';

const baseTab = (over: Partial<EditorTab> = {}): EditorTab => ({
  id: 't1',
  title: 't1.js',
  content: 'db.users.find()\ndb.orders.find()',
  isDirty: false,
  type: 'script',
  ...over,
});

beforeEach(() => {
  useConnectionsStore.setState({
    connections: [],
    activeConnectionId: null,
    activeDatabase: null,
    connectedIds: new Set(),
  });
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    selections: {},
  });
  useResultsStore.setState({ byTab: {} });
});

describe('SelectionContextCollector', () => {
  const collector = new SelectionContextCollector();

  it('returns empty string when there is no active tab', async () => {
    expect(await collector.collect()).toBe('');
  });

  it('returns empty string when active tab has no recorded selection', async () => {
    useEditorStore.setState({
      tabs: [baseTab()],
      activeTabId: 't1',
      selections: {},
    });
    expect(await collector.collect()).toBe('');
  });

  it('returns empty string when selection is null', async () => {
    useEditorStore.setState({
      tabs: [baseTab()],
      activeTabId: 't1',
      selections: { t1: null },
    });
    expect(await collector.collect()).toBe('');
  });

  it('returns empty string when selection text is whitespace-only', async () => {
    useEditorStore.setState({
      tabs: [baseTab()],
      activeTabId: 't1',
      selections: { t1: { text: '   \n  \t', startLine: 1, endLine: 2 } },
    });
    expect(await collector.collect()).toBe('');
  });

  it('emits a fenced block with line range for a multi-line selection', async () => {
    useEditorStore.setState({
      tabs: [baseTab({ content: 'a\nb\nc\nd\ne' })],
      activeTabId: 't1',
      selections: {
        t1: { text: 'b\nc\nd', startLine: 2, endLine: 4 },
      },
    });
    const out = await collector.collect();
    expect(out).toBe('Selected portion (lines 2–4):\n```\nb\nc\nd\n```');
  });

  it('emits a block even when the selection spans the entire script (no collapse to "full script")', async () => {
    const fullScript = 'db.users.find()\ndb.orders.find()';
    useEditorStore.setState({
      tabs: [baseTab({ content: fullScript })],
      activeTabId: 't1',
      selections: {
        t1: { text: fullScript, startLine: 1, endLine: 2 },
      },
    });
    const out = await collector.collect();
    expect(out).toContain('Selected portion (lines 1–2):');
    expect(out).toContain(fullScript);
  });

  it('uses an en-dash (U+2013), not a hyphen, in the header', async () => {
    useEditorStore.setState({
      tabs: [baseTab()],
      activeTabId: 't1',
      selections: { t1: { text: 'x', startLine: 1, endLine: 1 } },
    });
    const out = await collector.collect();
    expect(out.startsWith('Selected portion (lines 1–1):')).toBe(true);
  });

  it('emits a single-line block for single-line selections', async () => {
    useEditorStore.setState({
      tabs: [baseTab()],
      activeTabId: 't1',
      selections: { t1: { text: 'db.orders.find()', startLine: 2, endLine: 2 } },
    });
    expect(await collector.collect()).toBe(
      'Selected portion (lines 2–2):\n```\ndb.orders.find()\n```',
    );
  });

  it('preserves leading/trailing whitespace inside the selection block (only the trim check is for emptiness)', async () => {
    useEditorStore.setState({
      tabs: [baseTab()],
      activeTabId: 't1',
      selections: {
        t1: { text: '  indented\n  more', startLine: 3, endLine: 4 },
      },
    });
    const out = await collector.collect();
    expect(out).toContain('  indented\n  more');
  });
});

describe('editor store selection plumbing', () => {
  it('setSelection writes per tab', () => {
    useEditorStore.getState().setSelection('t1', {
      text: 'hi',
      startLine: 1,
      endLine: 1,
    });
    expect(useEditorStore.getState().selections.t1).toEqual({
      text: 'hi',
      startLine: 1,
      endLine: 1,
    });
  });

  it('setSelection accepts null to clear', () => {
    useEditorStore.getState().setSelection('t1', {
      text: 'hi',
      startLine: 1,
      endLine: 1,
    });
    useEditorStore.getState().setSelection('t1', null);
    expect(useEditorStore.getState().selections.t1).toBeNull();
  });

  it('closeTab drops the tab and its selection entry', () => {
    useEditorStore.getState().openTab(baseTab());
    useEditorStore
      .getState()
      .setSelection('t1', { text: 'hi', startLine: 1, endLine: 1 });
    useEditorStore.getState().closeTab('t1');
    expect(useEditorStore.getState().selections.t1).toBeUndefined();
  });

  it('setSelection is a no-op when the new value is deep-equal to the current one', () => {
    useEditorStore
      .getState()
      .setSelection('t1', { text: 'hi', startLine: 1, endLine: 1 });
    const snapshotA = useEditorStore.getState().selections;
    useEditorStore
      .getState()
      .setSelection('t1', { text: 'hi', startLine: 1, endLine: 1 });
    const snapshotB = useEditorStore.getState().selections;
    expect(snapshotB).toBe(snapshotA);
  });
});

describe('ContextCollector orchestration — selection scenarios', () => {
  it('scenario 1 (no selection): output contains no "Selected portion" block', async () => {
    useEditorStore.setState({
      tabs: [baseTab({ content: 'db.users.find()' })],
      activeTabId: 't1',
      selections: {},
    });
    const out = await new ContextCollector().collectAll();
    expect(out).toContain('Editor Content:');
    expect(out).not.toContain('Selected portion');
  });

  it('scenario 2 (multi-line selection): output contains the selection block in order after Editor Content', async () => {
    useEditorStore.setState({
      tabs: [baseTab({ content: 'a\nb\nc\nd' })],
      activeTabId: 't1',
      selections: {
        t1: { text: 'b\nc', startLine: 2, endLine: 3 },
      },
    });
    const out = await new ContextCollector().collectAll();
    const editorIdx = out.indexOf('Editor Content:');
    const selIdx = out.indexOf('Selected portion (lines 2–3):');
    expect(editorIdx).toBeGreaterThanOrEqual(0);
    expect(selIdx).toBeGreaterThan(editorIdx);
  });

  it('scenario 3 (multi-query, option 3 skipped): falls back to first-group results preview, no errors', async () => {
    useEditorStore.setState({
      tabs: [baseTab({ content: 'db.users.find()\ndb.orders.find()' })],
      activeTabId: 't1',
      selections: {
        t1: { text: 'db.orders.find()', startLine: 2, endLine: 2 },
      },
    });
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [
            { __group: 0, docs: [{ _id: 'u1', name: 'alice' }] },
            { __group: 1, docs: [{ _id: 'o1', total: 42 }] },
          ],
        } as any,
      },
    });
    const out = await new ContextCollector().collectAll();
    // Selection block must be present
    expect(out).toContain('Selected portion (lines 2–2):');
    // Results section reflects FIRST group (option 3 deferred — last-run preview / first-group fallback)
    expect(out).toContain('Query Results (first 1 of 1 documents):');
    expect(out).toContain('"name": "alice"');
    // Did not crash / mention an error
    expect(out).not.toMatch(/error/i);
  });

  it('scenario 4 (whitespace-only): assembled prompt is byte-identical to the no-selection case', async () => {
    useEditorStore.setState({
      tabs: [baseTab({ content: 'db.users.find()' })],
      activeTabId: 't1',
      selections: {},
    });
    const baseline = await new ContextCollector().collectAll();

    useEditorStore.setState({
      tabs: [baseTab({ content: 'db.users.find()' })],
      activeTabId: 't1',
      selections: { t1: { text: '   \n\t', startLine: 1, endLine: 2 } },
    });
    const withWs = await new ContextCollector().collectAll();
    expect(withWs).toBe(baseline);
  });

  it('scenario 5 (full-script selection): emits the block, does NOT collapse to "full script", and Editor Content is still present', async () => {
    const full = 'db.users.find()\ndb.orders.find()';
    useEditorStore.setState({
      tabs: [baseTab({ content: full })],
      activeTabId: 't1',
      selections: { t1: { text: full, startLine: 1, endLine: 2 } },
    });
    const out = await new ContextCollector().collectAll();
    expect(out).toContain('Editor Content:');
    expect(out).toContain('Selected portion (lines 1–2):');
    expect(out).not.toContain('full script');
  });

  it('scenario 1b (no selection): byte-identical to a captured baseline from main', async () => {
    // Baseline captured by running ContextCollector.collectAll() against main
    // (commit 77ebce3) with the fixture: connection "local" / db "mydb",
    // one tab content "db.users.find()", one result doc {_id:'x', n:1}.
    const expected =
      'Current Context:\n' +
      '- Connection: local\n' +
      '- Database: mydb\n' +
      '\n' +
      'Editor Content:\n' +
      '```\n' +
      'db.users.find()\n' +
      '```\n' +
      '\n' +
      'Query Results (first 1 of 1 documents):\n' +
      '```json\n' +
      '[\n' +
      '  {\n' +
      '    "_id": "x",\n' +
      '    "n": 1\n' +
      '  }\n' +
      ']\n' +
      '```\n' +
      '\n' +
      'Schema (inferred from first result):\n' +
      '- _id: string\n' +
      '- n: number';

    useConnectionsStore.setState({
      connections: [{ id: 'c1', name: 'local', createdAt: 't' }],
      activeConnectionId: 'c1',
      activeDatabase: 'mydb',
      connectedIds: new Set(['c1']),
    });
    useEditorStore.setState({
      tabs: [
        baseTab({ connectionId: 'c1', database: 'mydb', content: 'db.users.find()' }),
      ],
      activeTabId: 't1',
      selections: {}, // no selection
    });
    useResultsStore.setState({
      byTab: {
        t1: { groups: [{ __group: 0, docs: [{ _id: 'x', n: 1 }] }] } as any,
      },
    });

    const out = await new ContextCollector().collectAll();
    expect(out).toBe(expected);
  });

  it('section ordering: Connection → Editor → Selection → Results → Schema', async () => {
    useConnectionsStore.setState({
      connections: [{ id: 'c1', name: 'local', createdAt: 't' }],
      activeConnectionId: 'c1',
      activeDatabase: 'mydb',
      connectedIds: new Set(['c1']),
    });
    useEditorStore.setState({
      tabs: [baseTab({ connectionId: 'c1', database: 'mydb', content: 'a\nb' })],
      activeTabId: 't1',
      selections: { t1: { text: 'a\nb', startLine: 1, endLine: 2 } },
    });
    useResultsStore.setState({
      byTab: {
        t1: { groups: [{ __group: 0, docs: [{ _id: 'x', n: 1 }] }] } as any,
      },
    });
    const out = await new ContextCollector().collectAll();
    const order = [
      'Current Context:',
      'Editor Content:',
      'Selected portion',
      'Query Results',
      'Schema (inferred from first result):',
    ].map((s) => out.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
  });
});
