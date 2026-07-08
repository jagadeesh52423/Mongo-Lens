import { useEffect, useState } from 'react';
import { listCollections } from '../ipc';
import type { CollectionNode } from '../types';

export function useCollectionCompletions(
  connectionId: string | null,
  database: string | null,
): CollectionNode[] {
  const [list, setList] = useState<CollectionNode[]>([]);

  useEffect(() => {
    if (!connectionId || !database) {
      setList([]);
      return;
    }
    let cancelled = false;
    listCollections(connectionId, database)
      .then((collections) => {
        if (cancelled) return;
        setList(collections);
      })
      .catch(() => {
        if (cancelled) return;
        setList([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, database]);

  return list;
}
