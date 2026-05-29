import { describe, it, expect } from 'vitest';
import { parseStagedError, stageHeading } from '../staged-error';

describe('parseStagedError', () => {
  it('parses a lowercase stage prefix into { stage, error }', () => {
    expect(parseStagedError('tls: self-signed certificate')).toEqual({
      stage: 'tls',
      error: 'self-signed certificate',
    });
  });

  it('parses every known stage keyword', () => {
    expect(parseStagedError('ssh: tunnel refused')).toEqual({ stage: 'ssh', error: 'tunnel refused' });
    expect(parseStagedError('auth: bad password')).toEqual({ stage: 'auth', error: 'bad password' });
    expect(parseStagedError('ping: timed out')).toEqual({ stage: 'ping', error: 'timed out' });
  });

  it('tolerates the legacy capitalized prefix and lowercases the stage', () => {
    expect(parseStagedError('Ssh: handshake failed')).toEqual({
      stage: 'ssh',
      error: 'handshake failed',
    });
  });

  it('returns the raw string unchanged when there is no stage prefix', () => {
    expect(parseStagedError('connection timed out')).toBe('connection timed out');
  });

  it('does NOT misparse an arbitrary message that merely contains a colon', () => {
    // "database error" is not a known stage keyword, so the colon must be ignored.
    expect(parseStagedError('database error: connection refused')).toBe(
      'database error: connection refused',
    );
  });

  it('does NOT misparse a stage keyword that is not a leading prefix', () => {
    // "auth" appears mid-sentence, not as a "<stage>: " prefix.
    expect(parseStagedError('failed auth: retry')).toBe('failed auth: retry');
  });

  it('requires whitespace after the colon, so "tls:value" stays plain', () => {
    expect(parseStagedError('tls:no-space')).toBe('tls:no-space');
  });

  it('produces a stage that maps to a stageHeading', () => {
    const parsed = parseStagedError('auth: nope');
    expect(typeof parsed).not.toBe('string');
    if (typeof parsed !== 'string') {
      expect(stageHeading(parsed.stage)).toBe('Authentication failed');
    }
  });
});
