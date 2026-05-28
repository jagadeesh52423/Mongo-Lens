import { useCallback, useState } from 'react';
import { connectV2, disconnectV2, type SaveInput } from '../../../connection/ipc';
import { useConnectionsV2 } from './useConnectionsV2';
import { nextDuplicateName } from './nameUtils';
import type { Connection } from '../../../connection/model';

/** Pending host-key confirmation while waiting on the user. */
interface PendingHostKey {
  connectionId: string;
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  /** Passphrase already collected, if any, to re-supply on the retry call. */
  passphrase?: string;
}

interface UseConnectionActions {
  // CRUD (save lives on the v2 store directly; dialog calls it; the hook only
  // surfaces the right-click duplicate + delete actions).
  duplicate: (c: Connection) => Promise<void>;
  remove: (c: Connection) => Promise<void>;
  // Connect lifecycle
  connect: (c: Connection) => Promise<void>;
  disconnect: (c: Connection) => Promise<void>;
  // SSH prompt state — read by the panel to render the SSH dialogs.
  passphraseFor: Connection | null;
  setPassphraseFor: (c: Connection | null) => void;
  submitPassphrase: (passphrase: string) => void;
  pendingHostKey: PendingHostKey | null;
  setPendingHostKey: (p: PendingHostKey | null) => void;
  acceptHostKey: () => void;
  // Error surface
  connectError: string | null;
  clearConnectError: () => void;
  // Expansion state for connected entries (so the tree opens automatically).
  expandedConns: Set<string>;
  toggleExpanded: (id: string) => void;
  setExpanded: (next: Set<string>) => void;
}

/**
 * Encapsulates the connection duplicate/delete + connect/disconnect lifecycle,
 * including SSH passphrase and host-key prompt state. The panel layer reads
 * these callbacks/state directly so it stays focused on rendering.
 *
 * All CRUD and connect IPC goes through the v2 commands
 * (`src/connection/ipc.ts`); the legacy `src/ipc.ts` connection wrappers
 * were dropped from this file in PR 5 / Task 18.
 */
export function useConnectionActions(): UseConnectionActions {
  const connections = useConnectionsV2((s) => s.connections);
  const activeConnectionId = useConnectionsV2((s) => s.activeConnectionId);
  const saveV2Store = useConnectionsV2((s) => s.save);
  const removeV2Store = useConnectionsV2((s) => s.remove);
  const setActive = useConnectionsV2((s) => s.setActive);
  const markConnected = useConnectionsV2((s) => s.markConnected);
  const markDisconnected = useConnectionsV2((s) => s.markDisconnected);

  const [passphraseFor, setPassphraseFor] = useState<Connection | null>(null);
  const [pendingHostKey, setPendingHostKey] = useState<PendingHostKey | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [expandedConns, setExpandedConns] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((id: string) => {
    setExpandedConns((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  /** Core connect logic, shared by first attempt, passphrase retry, and host-key retry. */
  const doConnect = useCallback(async (c: Connection, passphrase?: string, acceptHostKey?: boolean) => {
    try {
      const result = await connectV2(c.id, passphrase, acceptHostKey);
      if (result.type === 'connected') {
        markConnected(c.id);
        setExpandedConns((s) => new Set(s).add(c.id));
        setActive(c.id, null);
      } else if (result.type === 'passphraseRequired') {
        // Prompt for passphrase; on submit retry with it.
        setPassphraseFor(c);
      } else if (result.type === 'hostKeyUnknown') {
        // Prompt user to confirm fingerprint.
        setPendingHostKey({
          connectionId: result.connectionId,
          host: result.host,
          port: result.port,
          algorithm: result.algorithm,
          fingerprint: result.fingerprint,
          passphrase,
        });
      }
    } catch (e) {
      setConnectError((e as Error).message ?? String(e));
    }
  }, [markConnected, setActive]);

  const duplicate = useCallback(async (c: Connection) => {
    // Clone the v2 connection wholesale, but stamp a fresh id (empty triggers
    // server-side gen by `connections_v2_save`), a unique name, and a new
    // createdAt. Secrets are intentionally not copied — the keychain entries
    // belong to the source id; the user can re-enter them via the dialog if
    // needed. This matches the legacy duplicate semantics.
    const input: SaveInput = {
      connection: {
        ...c,
        id: '',
        name: nextDuplicateName(c.name, connections.map((x) => x.name)),
        createdAt: new Date().toISOString(),
      },
      secrets: [],
    };
    await saveV2Store(input);
  }, [connections, saveV2Store]);

  const connect = useCallback((c: Connection) => doConnect(c), [doConnect]);

  const disconnect = useCallback(async (c: Connection) => {
    await disconnectV2(c.id);
    markDisconnected(c.id);
    setExpandedConns((s) => {
      const n = new Set(s);
      n.delete(c.id);
      return n;
    });
    if (activeConnectionId === c.id) setActive(null, null);
  }, [activeConnectionId, markDisconnected, setActive]);

  const remove = useCallback(async (c: Connection) => {
    if (!confirm(`Delete connection "${c.name}"?`)) return;
    await removeV2Store(c.id);
  }, [removeV2Store]);

  const submitPassphrase = useCallback((passphrase: string) => {
    const c = passphraseFor;
    setPassphraseFor(null);
    if (c) doConnect(c, passphrase);
  }, [passphraseFor, doConnect]);

  const acceptHostKey = useCallback(() => {
    const pending = pendingHostKey;
    setPendingHostKey(null);
    if (!pending) return;
    const c = connections.find((x) => x.id === pending.connectionId);
    if (c) doConnect(c, pending.passphrase, true);
  }, [pendingHostKey, connections, doConnect]);

  return {
    duplicate, remove,
    connect, disconnect,
    passphraseFor, setPassphraseFor, submitPassphrase,
    pendingHostKey, setPendingHostKey, acceptHostKey,
    connectError, clearConnectError: () => setConnectError(null),
    expandedConns, toggleExpanded, setExpanded: setExpandedConns,
  };
}
