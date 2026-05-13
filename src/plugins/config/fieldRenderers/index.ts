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
// Concrete registrations happen in Tasks 14–17.
