import { createElement, useState, useRef } from 'react';
import { recordActionRegistry } from '../RecordActionRegistry';
import { confirmDiscardUnsaved } from '../../../utils/confirmDiscard';
import { updateDocument } from '../../../ipc';
import { JsonRecordEditor, type JsonRecordEditorHandle } from '../../../components/editor/JsonRecordEditor';

recordActionRegistry.register({
  id: 'cell.editRecord',
  label: 'Edit Full Record',
  keyBinding: { key: 'F4' },
  scope: 'results',
  showInContextMenu: true,
  // F4 requires a known target collection AND that the result came from a
  // read-only query (find/findOne). Aggregations, mutations, maintenance ops,
  // and cursor streams must not be edited from the results grid — even if a
  // collection name is extractable. See QueryTypeRegistry for classification.
  canExecute: (ctx) => !!ctx.collection && ctx.category === 'query',
  execute(context, host) {
    const { doc, connectionId, database, collection } = context;
    const { _id: _removed, ...docWithoutId } = doc;
    const originalJson = JSON.stringify(doc, null, 2);
    const idStr = String(doc._id ?? '');
    // Lifted out of EditBody so the modal's beforeClose hook can inspect the
    // current text without bridging React state across the host boundary.
    const liveJsonRef: { current: string } = { current: originalJson };
    // Set after a successful save so the programmatic close that follows
    // doesn't trip the unsaved-changes prompt.
    const savedRef: { current: boolean } = { current: false };

    function isDirty(): boolean {
      if (savedRef.current) return false;
      if (liveJsonRef.current === originalJson) return false;
      try {
        const parsed = JSON.parse(liveJsonRef.current);
        const { _id: _drop, ...rest } = parsed as Record<string, unknown>;
        return JSON.stringify(rest) !== JSON.stringify(docWithoutId);
      } catch {
        // Unparseable text differs from original → treat as dirty.
        return true;
      }
    }

    function EditBody() {
      const [editedJson, setEditedJson] = useState(originalJson);
      const [error, setError] = useState<string | null>(null);
      const [saving, setSaving] = useState(false);
      const editedJsonRef = useRef(editedJson);
      editedJsonRef.current = editedJson;
      liveJsonRef.current = editedJson;
      const editorRef = useRef<JsonRecordEditorHandle>(null);

      async function handleSubmit() {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(editedJsonRef.current);
        } catch (e) {
          setError((e as Error).message);
          return;
        }
        if ('_id' in parsed && String(parsed._id) !== idStr) {
          setError(`_id cannot be changed. Original: ${idStr}`);
          return;
        }
        const { _id: _drop, ...parsedWithoutId } = parsed;
        if (JSON.stringify(parsedWithoutId) === JSON.stringify(docWithoutId)) {
          savedRef.current = true;
          host.close();
          return;
        }
        setSaving(true);
        setError(null);
        try {
          await updateDocument(connectionId!, database!, collection!, idStr, JSON.stringify(parsedWithoutId));
          host.triggerDocUpdate();
          savedRef.current = true;
          host.close();
        } catch (e) {
          setError(String(e));
        } finally {
          setSaving(false);
        }
      }

      return createElement('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, gap: 8 } },
        createElement(JsonRecordEditor, {
          key: 'editor',
          ref: editorRef,
          value: editedJson,
          onChange: (v: string) => {
            setEditedJson(v);
            setError(null);
          },
          error: !!error,
        }),
        error ? createElement('div', {
          key: 'error',
          style: {
            background: 'var(--accent-red-dim, #742a2a)',
            border: '1px solid var(--accent-red, #fc8181)',
            borderRadius: 4, padding: '4px 8px',
            color: 'var(--accent-red, #fc8181)', fontSize: 12,
          },
        }, `✕ ${error}`) : null,
        createElement('div', {
          key: 'footer',
          style: { display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' },
        },
          createElement('span', {
            key: 'hint',
            style: { marginRight: 'auto', color: 'var(--fg-dim)', fontSize: 11 },
          }, 'No changes → submit is a no-op'),
          createElement('button', {
            key: 'format',
            onClick: () => editorRef.current?.format(),
            disabled: saving,
          }, 'Format JSON'),
          createElement('button', { key: 'cancel', onClick: host.close, disabled: saving }, 'Cancel'),
          createElement('button', { key: 'submit', onClick: handleSubmit, disabled: saving }, saving ? 'Saving…' : 'Submit'),
        ),
      );
    }

    host.openModal('Edit Record', createElement(EditBody, null), null, {
      beforeClose: async () => {
        if (!isDirty()) return true;
        return confirmDiscardUnsaved();
      },
    });
  },
});
