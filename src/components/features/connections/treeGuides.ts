export type GuideSegment = 'line' | 'tee' | 'elbow' | 'empty';

/**
 * Guide segments for one tree row.
 * @param ancestorsHaveMoreSiblings outermost→innermost parent: true if that ancestor
 *        has siblings after it (draw a continuation line in its column), else false.
 * @param isLast whether THIS row is the last among its own siblings.
 * Returns one segment per column; the final segment is this row's connector
 * ('elbow' when isLast, else 'tee'); each preceding column is 'line' (ancestor has
 * more siblings → continuation) or 'empty'.
 *
 * Generalizes to arbitrary depth: N ancestor flags → N+1 columns. To add a deeper
 * level, pass one more ancestor flag; the CSS .guide cell rules are depth-agnostic.
 */
export function treeGuides(ancestorsHaveMoreSiblings: boolean[], isLast: boolean): GuideSegment[] {
  return [
    ...ancestorsHaveMoreSiblings.map((more): GuideSegment => (more ? 'line' : 'empty')),
    isLast ? 'elbow' : 'tee',
  ];
}
