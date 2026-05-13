import { EnforcementRegistry } from './EnforcementRegistry';
import { readmePresentRule } from './rules/readmePresent';

export { EnforcementRegistry };
export * from './types';

/**
 * Default registry, pre-registered with built-in rules. Production code uses
 * this; tests inject their own EnforcementRegistry to assert behavior in
 * isolation.
 *
 * To add a new built-in rule: import it here, then call register below. No
 * other files need editing.
 */
export const defaultEnforcementRegistry = new EnforcementRegistry();
defaultEnforcementRegistry.register(readmePresentRule);
