import type { ConnectionTarget } from '../../../connection/model';

/** Strip credentials from a Mongo URI authority: scheme://user:pass@host → scheme://host. */
function redactUri(uri: string): string {
  return uri.replace(/(\/\/)[^/@]*@/, '$1');
}

// One formatter per target kind. `satisfies` makes the compiler fail if a new
// ConnectionTarget kind is added without a matching formatter (extension contract).
// To support a new target kind: add its entry here. No other changes needed.
const SUMMARY_BY_KIND = {
  uri: (t: Extract<ConnectionTarget, { kind: 'uri' }>) => redactUri(t.uri),
  direct: (t: Extract<ConnectionTarget, { kind: 'direct' }>) =>
    `${t.host}:${t.port}${t.replicaSet ? ` · ${t.replicaSet}` : ''}`,
} satisfies { [K in ConnectionTarget['kind']]: (t: Extract<ConnectionTarget, { kind: K }>) => string };

/** Human-readable one-line summary of a connection's target, for list subtitles. */
export function connectionSummary(target: ConnectionTarget): string {
  return (SUMMARY_BY_KIND[target.kind] as (t: ConnectionTarget) => string)(target);
}
