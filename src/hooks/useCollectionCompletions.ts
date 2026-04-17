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
    listCollections(connectionId, database)
      .then(setList)
      .catch(() => setList([]));
  }, [connectionId, database]);

  return list;
}
