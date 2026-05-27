import styles from './ConsolePanel.module.css';

interface Props {
  logs: string[];
}

/** Renders captured print()/console.log output for the active run. */
export function ConsolePanel({ logs }: Props) {
  return <pre className={styles.console}>{logs.join('\n')}</pre>;
}
