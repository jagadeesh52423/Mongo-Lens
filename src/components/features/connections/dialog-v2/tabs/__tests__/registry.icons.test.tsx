import { describe, it, expect } from 'vitest';
import { TABS } from '../registry';

describe('TAB registry icons', () => {
  it('every tab declares an icon', () => {
    for (const t of TABS) expect(t.icon, `tab ${t.id} missing icon`).toBeTruthy();
  });
});
