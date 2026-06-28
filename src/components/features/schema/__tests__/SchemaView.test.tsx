import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchemaView } from '../SchemaView';
import type { SchemaResult } from '../../../../types';

vi.mock('../../../../ipc', () => ({ analyzeSchema: vi.fn() }));

const result: SchemaResult = {
  sampled: 2,
  sampleSize: 1000,
  schema: {
    count: 2,
    fields: [
      {
        name: 'name', path: 'name', count: 2, probability: 1, type: 'String',
        types: [{ name: 'String', path: 'name', count: 2, probability: 1, values: ['a', 'b'] }],
      },
      {
        name: 'age', path: 'age', count: 1, probability: 0.5, type: ['Number', 'Undefined'],
        types: [{ name: 'Number', path: 'age', count: 1, probability: 0.5, values: [1] }],
      },
    ],
  },
};

describe('SchemaView', () => {
  it('renders fields with presence % and type badges from a given result', () => {
    render(<SchemaView result={result} loading={false} error={null} onReanalyze={() => {}} sampleSize={1000} onSampleSizeChange={() => {}} />);
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('age')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument(); // name presence
    expect(screen.getByText('50%')).toBeInTheDocument();  // age presence
    expect(screen.getByText(/String/)).toBeInTheDocument();
    expect(screen.getByText(/sampled 2/i)).toBeInTheDocument();
  });
});
