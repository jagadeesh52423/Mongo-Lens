interface Props {
  docs: unknown[];
}

export function JsonView({ docs }: Props) {
  return (
    <div style={{ fontFamily: 'var(--font-mono)', padding: 10, overflow: 'auto' }}>
      {docs.map((d, i) => (
        <pre
          key={i}
          style={{
            margin: '0 0 10px',
            whiteSpace: 'pre-wrap',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 8,
          }}
        >
          {JSON.stringify(d, null, 2)}
        </pre>
      ))}
    </div>
  );
}
