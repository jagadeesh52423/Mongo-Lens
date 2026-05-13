import Ajv, { ErrorObject } from 'ajv';
import type { ConfigurationContribution } from '../manifest';
import type { ConfigValueError } from './types';

const ajv = new Ajv({ allErrors: true, strict: false });

function compile(schema: ConfigurationContribution) {
  return ajv.compile({
    type: 'object',
    properties: schema.properties as Record<string, unknown>,
    required: schema.required ?? [],
    additionalProperties: true,
  });
}

const cache = new WeakMap<ConfigurationContribution, ReturnType<typeof compile>>();

function compiledFor(schema: ConfigurationContribution) {
  let c = cache.get(schema);
  if (!c) { c = compile(schema); cache.set(schema, c); }
  return c;
}

export function validateConfig(
  schema: ConfigurationContribution,
  values: Record<string, unknown>,
): ConfigValueError[] {
  const c = compiledFor(schema);
  if (c(values)) return [];
  return (c.errors ?? []).map(formatError);
}

const constraintKeywords = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'enum',
]);

function formatError(e: ErrorObject): ConfigValueError {
  if (e.keyword === 'required') {
    return { key: (e.params as { missingProperty: string }).missingProperty,
             message: 'is required' };
  }
  const key = e.instancePath.replace(/^\//, '') || '/';
  const base = e.message ?? 'invalid';
  const msg = constraintKeywords.has(e.keyword) ? `${base} (${e.keyword})` : base;
  return { key, message: msg };
}
