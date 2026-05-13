import { ReactNode } from 'react';
import type { JSONSchemaProperty } from '../../manifest';

export interface FieldRendererProps {
  id?: string;
  schema: JSONSchemaProperty;
  value: unknown;
  error?: string;
  onCommit(value: unknown): void;
}

// implement this interface to add a new field renderer variant
export interface FieldRenderer {
  matches(schema: JSONSchemaProperty): boolean;
  render(props: FieldRendererProps): ReactNode;
}

export class FieldRendererRegistry {
  private list: FieldRenderer[] = [];
  register(r: FieldRenderer): void { this.list.push(r); }
  find(schema: JSONSchemaProperty): FieldRenderer | undefined {
    return this.list.find(r => r.matches(schema));
  }
  all(): readonly FieldRenderer[] { return this.list; }
}

export const defaultFieldRendererRegistry = new FieldRendererRegistry();

export { stringField } from './StringField';
export { numberField } from './NumberField';
export { booleanField } from './BooleanField';
export { secretField } from './SecretField';
export { arrayField } from './ArrayField';
export { objectField } from './ObjectField';

import { stringField } from './StringField';
import { numberField } from './NumberField';
import { booleanField } from './BooleanField';
import { secretField } from './SecretField';
import { arrayField } from './ArrayField';
import { objectField } from './ObjectField';

// Order matters: more-specific renderers register first.
defaultFieldRendererRegistry.register(numberField);
defaultFieldRendererRegistry.register(booleanField);
defaultFieldRendererRegistry.register(secretField);   // before stringField
defaultFieldRendererRegistry.register(stringField);
defaultFieldRendererRegistry.register(arrayField);
defaultFieldRendererRegistry.register(objectField);
