import { viewModeRegistry } from './ViewModeRegistry';
import { TableViewMode } from './TableViewMode';
import { JsonViewMode } from './JsonViewMode';

viewModeRegistry.register(TableViewMode);
viewModeRegistry.register(JsonViewMode);

export * from './ViewModeRegistry';
