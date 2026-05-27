import styles from './JsonView.module.css';

interface Props {
  docs: unknown[];
}

export function JsonView({ docs }: Props) {
  return (
    <div className={styles.container}>
      {docs.map((d, i) => (
        <pre key={i} className={styles.doc}>
          {JSON.stringify(d, null, 2)}
        </pre>
      ))}
    </div>
  );
}
