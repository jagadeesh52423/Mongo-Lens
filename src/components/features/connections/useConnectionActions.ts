import { useCallback, useState } from 'react';
import {
  createConnection,
  updateConnection as ipcUpdate,
  deleteConnection as ipcDelete,
} from '../../../ipc';
import { connectV2, disconnectV2 } from '../../../connection/ipc';
import { useConnectionsStore } from '../../../store/connections';
import { nextDuplicateName } from './nameUtils';
import type { Connection, ConnectionInput } from '../../../types';

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
  // CRUD
  save: (input: ConnectionInput, editing: Connection | null) => Promise<void>;
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
 * Encapsulates the connection CRUD + connect/disconnect lifecycle, including
 * SSH passphrase and host-key prompt state. The panel layer reads these
 * callbacks/state directly so it stays focused on rendering.
 */
export function useConnectionActions(): UseConnectionActions {
  const {
    connections,
    activeConnectionId,
    addConnection,
    updateConnection,
    removeConnection,
    setActive,
    markConnected,
    markDisconnected,
  } = useConnectionsStore();
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

  const save = useCallback(async (input: ConnectionInput, editing: Connection | null) => {
    if (editing) {
      const updated = await ipcUpdate(editing.id, input);
      updateConnection(updated);
    } else {
      const c = await createConnection(input);
      addConnection(c);
    }
  }, [addConnection, updateConnection]);

  const duplicate = useCallback(async (c: Connection) => {
    const input: ConnectionInput = {
      name: nextDuplicateName(c.name, connections.map((x) => x.name)),
      host: c.host,
      port: c.port,
      authDb: c.authDb,
      username: c.username,
      connString: c.connString,
      sshHost: c.sshHost,
      sshPort: c.sshPort,
      sshUser: c.sshUser,
      sshKeyPath: c.sshKeyPath,
    };
    const created = await createConnection(input);
    addConnection(created);
  }, [connections, addConnection]);

  const remove = useCallback(async (c: Connection) => {
    if (!confirm(`Delete connection "${c.name}"?`)) return;
    await ipcDelete(c.id);
    removeConnection(c.id);
  }, [removeConnection]);

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
    save, duplicate, remove,
    connect, disconnect,
    passphraseFor, setPassphraseFor, submitPassphrase,
    pendingHostKey, setPendingHostKey, acceptHostKey,
    connectError, clearConnectError: () => setConnectError(null),
    expandedConns, toggleExpanded, setExpanded: setExpandedConns,
  };
}
