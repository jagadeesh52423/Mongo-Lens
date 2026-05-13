import type { FieldRenderer } from './index';

export const booleanField: FieldRenderer = {
  matches: (s) => s.type === 'boolean',
  render: ({ value, error, onCommit, id }) => (
    <span>
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        onChange={(e) => onCommit(e.target.checked)}
      />
      {error && <small className="field-error">{error}</small>}
    </span>
  ),
};
