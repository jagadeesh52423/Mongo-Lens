import { describe, it, expect } from 'vitest';
import { connectionSummary } from '../connectionSummary';

describe('connectionSummary', () => {
  it('formats a direct target as host:port', () => {
    expect(connectionSummary({ kind: 'direct', host: 'localhost', port: 27017 }))
      .toBe('localhost:27017');
  });

  it('appends the replica set when present', () => {
    expect(connectionSummary({ kind: 'direct', host: 'db', port: 27017, replicaSet: 'rs0' }))
      .toBe('db:27017 · rs0');
  });

  it('passes a credential-free URI through unchanged', () => {
    expect(connectionSummary({ kind: 'uri', uri: 'mongodb://localhost:27017' }))
      .toBe('mongodb://localhost:27017');
  });

  it('redacts user:pass credentials from a URI authority', () => {
    expect(connectionSummary({ kind: 'uri', uri: 'mongodb+srv://alice:s3cret@cluster.example.net/app' }))
      .toBe('mongodb+srv://cluster.example.net/app');
  });
});
