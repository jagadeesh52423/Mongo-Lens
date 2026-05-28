const SWATCHES = [
  { color: undefined, label: 'No tag' },
  { color: '#ef4444', label: 'prod' },
  { color: '#f59e0b', label: 'staging' },
  { color: '#10b981', label: 'dev' },
  { color: '#3b82f6', label: 'local' },
] as const;

export function ColorPicker({ value, onChange }: { value: string | undefined; onChange: (c: string | undefined) => void }) {
  return (
    <select
      aria-label="Environment color"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    >
      {SWATCHES.map((s) => (
        <option key={s.label} value={s.color ?? ''}>● {s.label}</option>
      ))}
    </select>
  );
}
