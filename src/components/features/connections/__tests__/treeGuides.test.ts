import { describe, it, expect } from 'vitest';
import { treeGuides } from '../treeGuides';

describe('treeGuides', () => {
  it('returns a single elbow for the last database', () => {
    expect(treeGuides([], true)).toEqual(['elbow']);
  });

  it('returns a single tee for a non-last database', () => {
    expect(treeGuides([], false)).toEqual(['tee']);
  });

  it('draws a continuation line then a tee for a collection under a non-last database', () => {
    expect(treeGuides([true], false)).toEqual(['line', 'tee']);
  });

  it('draws a continuation line then an elbow for the last collection under a non-last database', () => {
    expect(treeGuides([true], true)).toEqual(['line', 'elbow']);
  });

  it('draws a blank gutter then an elbow for the last collection under the last database', () => {
    expect(treeGuides([false], true)).toEqual(['empty', 'elbow']);
  });

  it('draws a blank gutter then a tee for a non-last collection under the last database', () => {
    expect(treeGuides([false], false)).toEqual(['empty', 'tee']);
  });
});
