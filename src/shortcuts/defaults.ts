import type { ShortcutDefinition } from '../services/KeyboardService';

// implement ShortcutDefinition and add entry here to register a new shortcut
export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // Global — settings
  { id: 'open-settings', label: 'Open Settings', keys: { cmd: true, key: ',' }, scope: 'global' },

  // Global — tabs
  { id: 'tab.next', label: 'Next Tab', keys: { ctrl: true, key: 'Tab' }, scope: 'global' },
  { id: 'tab.prev', label: 'Previous Tab', keys: { ctrl: true, shift: true, key: 'Tab' }, scope: 'global' },
  { id: 'tab.close', label: 'Close Tab', keys: { ctrl: true, key: 'w' }, scope: 'global' },
  { id: 'tab.new', label: 'New Tab', keys: { ctrl: true, key: 't' }, scope: 'global' },

  // Global — tab quick-switch
  { id: 'tab.goTo.1', label: 'Go to Tab 1', keys: { ctrl: true, key: '1' }, scope: 'global' },
  { id: 'tab.goTo.2', label: 'Go to Tab 2', keys: { ctrl: true, key: '2' }, scope: 'global' },
  { id: 'tab.goTo.3', label: 'Go to Tab 3', keys: { ctrl: true, key: '3' }, scope: 'global' },
  { id: 'tab.goTo.4', label: 'Go to Tab 4', keys: { ctrl: true, key: '4' }, scope: 'global' },
  { id: 'tab.goTo.5', label: 'Go to Tab 5', keys: { ctrl: true, key: '5' }, scope: 'global' },
  { id: 'tab.goTo.6', label: 'Go to Tab 6', keys: { ctrl: true, key: '6' }, scope: 'global' },
  { id: 'tab.goTo.7', label: 'Go to Tab 7', keys: { ctrl: true, key: '7' }, scope: 'global' },
  { id: 'tab.goTo.8', label: 'Go to Tab 8', keys: { ctrl: true, key: '8' }, scope: 'global' },
  { id: 'tab.goTo.9', label: 'Go to Tab 9', keys: { ctrl: true, key: '9' }, scope: 'global' },

  // Results — copy actions
  { id: 'cell.copyValue', label: 'Copy Value', keys: { cmd: true, key: 'c' }, scope: 'results', showInContextMenu: true },
  { id: 'cell.copyField', label: 'Copy Field', keys: { ctrl: true, cmd: true, key: 'c' }, scope: 'results', showInContextMenu: true },
  { id: 'cell.copyFieldPath', label: 'Copy Field Path', keys: { shift: true, alt: true, cmd: true, key: 'c' }, scope: 'results', showInContextMenu: true },
  { id: 'cell.copyDocument', label: 'Copy Document', keys: { shift: true, cmd: true, key: 'c' }, scope: 'results', showInContextMenu: true },

  // Results — record actions
  { id: 'cell.viewRecord', label: 'View Full Record', keys: { key: 'F3' }, scope: 'results', showInContextMenu: true },
  { id: 'cell.editRecord', label: 'Edit Full Record', keys: { key: 'F4' }, scope: 'results', showInContextMenu: true },

  // Results — cell navigation
  { id: 'cell.navigateUp', label: 'Navigate Up', keys: { key: 'ArrowUp' }, scope: 'results' },
  { id: 'cell.navigateDown', label: 'Navigate Down', keys: { key: 'ArrowDown' }, scope: 'results' },
  { id: 'cell.navigateLeft', label: 'Navigate Left', keys: { key: 'ArrowLeft' }, scope: 'results' },
  { id: 'cell.navigateRight', label: 'Navigate Right', keys: { key: 'ArrowRight' }, scope: 'results' },
];
