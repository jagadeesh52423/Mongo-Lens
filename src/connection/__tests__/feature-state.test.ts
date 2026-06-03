import { describe, it, expect } from 'vitest';
import {
  BLANK_SSH,
  BLANK_PROXY,
  isBlankSsh,
  isBlankProxy,
  isBlankTls,
} from '../feature-state';

describe('feature-state', () => {
  it('BLANK_SSH is disabled and blank', () => {
    expect(BLANK_SSH.enabled).toBe(false);
    expect(isBlankSsh(BLANK_SSH)).toBe(true);
  });
  it('SSH with a host is not blank', () => {
    expect(isBlankSsh({ ...BLANK_SSH, host: 'jump.example' })).toBe(false);
  });
  it('BLANK_PROXY is disabled and blank', () => {
    expect(BLANK_PROXY.enabled).toBe(false);
    expect(isBlankProxy(BLANK_PROXY)).toBe(true);
  });
  it('TLS disabled with no extras is blank; with a CA file is not', () => {
    expect(isBlankTls({ enabled: false })).toBe(true);
    expect(isBlankTls({ enabled: true })).toBe(false);
    expect(isBlankTls({ enabled: false, caFile: '/x.pem' } as never)).toBe(false);
  });
});
