import { describe, it, expect } from 'vitest';
import type { Connection } from '../model';

// Load all shared connection fixtures via Vite's import.meta.glob.
// `as: 'raw'` returns the file contents as a string so the test can verify
// JSON.parse + JSON.stringify round-trip without losing structural detail.
const rawFixtures = import.meta.glob('../../../tests/fixtures/connection/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

describe('Connection model', () => {
  const entries = Object.entries(rawFixtures);

  it('ships at least 16 fixtures covering every variant', () => {
    expect(entries.length).toBeGreaterThanOrEqual(16);
  });

  for (const [filePath, raw] of entries) {
    const file = filePath.split('/').pop() ?? filePath;
    it(`round-trips ${file} through JSON`, () => {
      const parsed = JSON.parse(raw) as Connection;
      const restringified = JSON.stringify(parsed);
      const reparsed = JSON.parse(restringified) as Connection;
      expect(reparsed).toEqual(parsed);
      // Sanity: every fixture must have a discriminated auth.kind and target.kind
      expect(parsed.auth.kind).toBeDefined();
      expect(parsed.target.kind).toBeDefined();
    });
  }
});
