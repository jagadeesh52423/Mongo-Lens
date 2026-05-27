/**
 * Build a unique name for a duplicate of `source` among `existing` names.
 * Strips a trailing `(N)` from `source` to find the base, then returns
 * `base(K)` where K is one greater than the highest existing K for that base
 * (treating the bare base as K=0). Example: ["test", "test(2)"] + "test" → "test(3)".
 */
export function nextDuplicateName(source: string, existing: readonly string[]): string {
  const m = source.match(/^(.*?)\((\d+)\)$/);
  const base = m ? m[1] : source;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}(?:\\((\\d+)\\))?$`);
  let max = 0;
  for (const name of existing) {
    const hit = name.match(re);
    if (!hit) continue;
    const n = hit[1] ? parseInt(hit[1], 10) : 0;
    if (n > max) max = n;
  }
  return `${base}(${max + 1})`;
}
