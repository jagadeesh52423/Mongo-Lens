/**
 * Enforces the plugin-agnostic invariant:
 * Host source files (outside __tests__) must not contain any plugin-specific
 * identifiers. Adding a built-in panel must NEVER require host code to know
 * plugin names — that knowledge belongs in plugin manifests only.
 *
 * Uses Vitest's import.meta.glob to scan source files in-process (no subprocess),
 * avoiding the need for @types/node in the browser-oriented tsconfig.
 */
import { describe, it, expect } from 'vitest';

// Glob all non-test TypeScript source files at bundle time.
// The keys are resolved module paths relative to the project root.
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** Filter out __tests__ directories so only host implementation is checked. */
function hostSourceContent(): string {
  return Object.entries(sources)
    .filter(([path]) => !path.includes('__tests__'))
    .map(([, content]) => content as string)
    .join('\n');
}

describe('plugin-agnostic host invariant', () => {
  let combined: string;

  beforeAll(() => {
    combined = hostSourceContent();
  });

  it('src/ host files contain no reference to "datafleet"', () => {
    expect(combined).not.toContain('datafleet');
  });

  it('src/ host files contain no reference to "DataFleet"', () => {
    expect(combined).not.toContain('DataFleet');
  });

  it('src/ host files contain no reference to "data-fleet"', () => {
    expect(combined).not.toContain('data-fleet');
  });
});
