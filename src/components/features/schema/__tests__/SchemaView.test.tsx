import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SchemaView } from '../SchemaView';
import type { SchemaResult } from '../../../../types';

vi.mock('../../../../ipc', () => ({ analyzeSchema: vi.fn() }));

const flatResult: SchemaResult = {
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

// Schema with a Document parent → nested leaf child
const nestedResult: SchemaResult = {
  sampled: 1,
  sampleSize: 1000,
  schema: {
    count: 1,
    fields: [
      {
        name: 'customer', path: 'customer', count: 1, probability: 1, type: 'Document',
        types: [{
          name: 'Document', path: 'customer', count: 1, probability: 1,
          fields: [
            {
              name: 'city', path: 'customer.city', count: 1, probability: 1, type: 'String',
              types: [{ name: 'String', path: 'customer.city', count: 1, probability: 1, values: ['Paris'] }],
            },
          ],
        }],
      },
    ],
  },
};

describe('SchemaView', () => {
  it('renders fields with presence % and type badges from a given result', () => {
    render(<SchemaView result={flatResult} loading={false} error={null} onReanalyze={() => {}} sampleSize={1000} onSampleSizeChange={() => {}} />);
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('age')).toBeInTheDocument();
    // Presence pct and type pct both emit '100%' / '50%'; check at least one is present
    expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0);
    expect(screen.getByText(/String/)).toBeInTheDocument();
    expect(screen.getByText(/sampled 2/i)).toBeInTheDocument();
  });

  it('shows a colored type dot badge for each BSON type', () => {
    render(<SchemaView result={flatResult} loading={false} error={null} onReanalyze={() => {}} sampleSize={1000} onSampleSizeChange={() => {}} />);
    // Each badge contains a type name — verify at least one badge text is present
    expect(screen.getByText(/^String$/)).toBeInTheDocument();
    expect(screen.getByText(/^Number$/)).toBeInTheDocument();
  });

  it('renders a nested leaf field in Tree mode (default)', () => {
    render(<SchemaView result={nestedResult} loading={false} error={null} onReanalyze={() => {}} sampleSize={1000} onSampleSizeChange={() => {}} />);
    // Parent document and its child leaf are both visible in default Tree mode
    expect(screen.getByText('customer')).toBeInTheDocument();
    expect(screen.getByText('city')).toBeInTheDocument();
  });

  it('toggling to Flat mode shows dotted prefix + leaf for a nested field', () => {
    render(<SchemaView result={nestedResult} loading={false} error={null} onReanalyze={() => {}} sampleSize={1000} onSampleSizeChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Flat' }));
    // In flat mode the parent row is replaced by "customer." (prefix) + "city" (leaf)
    expect(screen.getByText('customer.')).toBeInTheDocument();
    expect(screen.getByText('city')).toBeInTheDocument();
  });

  it('collapsing a Tree parent hides its children', () => {
    render(<SchemaView result={nestedResult} loading={false} error={null} onReanalyze={() => {}} sampleSize={1000} onSampleSizeChange={() => {}} />);
    // child is visible before collapse
    expect(screen.getByText('city')).toBeInTheDocument();
    // click the parent row to collapse
    fireEvent.click(screen.getByText('customer'));
    expect(screen.queryByText('city')).not.toBeInTheDocument();
  });

  it('renders EJSON $oid sample value as its hex string', () => {
    const ejsonResult: SchemaResult = {
      sampled: 1,
      sampleSize: 100,
      schema: {
        count: 1,
        fields: [{
          name: '_id', path: '_id', count: 1, probability: 1, type: 'ObjectId',
          types: [{ name: 'ObjectId', path: '_id', count: 1, probability: 1, values: [{ $oid: 'deadbeef1234' }] }],
        }],
      },
    };
    render(<SchemaView result={ejsonResult} loading={false} error={null} onReanalyze={() => {}} sampleSize={100} onSampleSizeChange={() => {}} />);
    expect(screen.getByText('deadbeef1234')).toBeInTheDocument();
  });
});
