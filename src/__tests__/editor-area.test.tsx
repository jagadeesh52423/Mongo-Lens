import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorArea } from '../components/editor/EditorArea';
import { useEditorStore } from '../store/editor';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v?: string) => void }) => (
    <textarea
      data-testid="mock-monaco"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

describe('EditorArea', () => {
  it('renders placeholder with no tabs', () => {
    render(<EditorArea />);
    expect(screen.getByText(/No editor tab/i)).toBeInTheDocument();
  });

  it('renders a script tab and updates content', async () => {
    useEditorStore.getState().openTab({
      id: 't1', title: 'a.js', content: 'db.users.find({})', isDirty: false, type: 'script',
    });
    const user = userEvent.setup();
    render(<EditorArea />);
    const ta = screen.getByTestId('mock-monaco') as HTMLTextAreaElement;
    await user.clear(ta);
    await user.type(ta, 'x');
    expect(useEditorStore.getState().tabs[0].content).toBe('x');
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });
});
