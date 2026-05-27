import { Text } from '../../ui';
import styles from './ErrorBanner.module.css';

interface Props {
  message: string;
}

/**
 * Single-line monospace error banner shown above the results body. The text is
 * always selectable so users can Cmd+C the error.
 */
export function ErrorBanner({ message }: Props) {
  return (
    <div className={styles.banner}>
      <Text variant="error" selectable>{message}</Text>
    </div>
  );
}
