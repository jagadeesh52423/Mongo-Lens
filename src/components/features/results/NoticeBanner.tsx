import { Text } from '../../ui';
import styles from './NoticeBanner.module.css';

interface Props {
  message: string;
}

/**
 * Neutral single-line notice banner shown in place of a result view when a
 * group has no tabular data to display (e.g. an unsupported change stream).
 * Text is selectable so users can copy the message.
 */
export function NoticeBanner({ message }: Props) {
  return (
    <div className={styles.banner}>
      <Text variant="dim" selectable>{message}</Text>
    </div>
  );
}
