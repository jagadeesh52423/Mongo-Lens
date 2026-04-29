import { createElement } from 'react';
import { recordActionRegistry } from '../RecordActionRegistry';
import { JsonRecordEditor } from '../../../components/editor/JsonRecordEditor';

recordActionRegistry.register({
  id: 'cell.viewRecord',
  label: 'View Full Record',
  keyBinding: { key: 'F3' },
  scope: 'results',
  showInContextMenu: true,
  canExecute: () => true,
  execute(context, host) {
    const { doc } = context;
    const json = JSON.stringify(doc, null, 2);
    const idStr = String(doc._id ?? '');

    const body = createElement(JsonRecordEditor, { value: json, readOnly: true });

    const editAction = recordActionRegistry.getById('cell.editRecord');
    const canEdit = editAction?.canExecute(context) ?? false;

    const footer = createElement('span', { style: { display: 'flex', gap: 8, alignItems: 'center', flex: 1 } },
      idStr ? createElement('span', {
        key: 'id',
        style: {
          marginRight: 'auto', fontSize: 11, color: 'var(--fg-dim)',
          background: 'var(--bg-rail)', border: '1px solid var(--border)',
          borderRadius: 3, padding: '1px 6px', fontFamily: 'var(--font-mono)',
        },
      }, idStr) : null,
      createElement('button', { key: 'close', onClick: host.close }, 'Close'),
      canEdit ? createElement('button', {
        key: 'edit',
        onClick: () => host.executeAction('cell.editRecord'),
      }, 'Edit (F4)') : null,
    );

    host.openModal('Full Record', body, footer);
  },
});
