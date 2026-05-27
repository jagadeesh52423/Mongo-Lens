import { useRef } from 'react';
import { Panel, PanelGroup, type ImperativePanelHandle } from 'react-resizable-panels';
import { IconRail } from './IconRail';
import { SidePanel } from './SidePanel';
import { StatusBar } from './StatusBar';
import { EditorArea } from '../editor/EditorArea';
import { AIFloatingButton } from '../ai/AIFloatingButton';
import { AIChatPanel } from '../ai/AIChatPanel';
import { SettingsView } from '../../../settings/SettingsView';
import { SplitHandle } from '../../shared/SplitHandle';
import type { ActivityItem } from '../../../layout/activityBar';
import { useConnectionsStore } from '../../../store/connections';
import styles from './AppShell.module.css';

interface Props {
  items: ActivityItem[];
  activeId: string | null;
  onChangeActiveItem: (id: string) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onCloseSettings: () => void;
  onSendMessage: (tabId: string, content: string) => void;
  onClearContext: (tabId: string) => void;
}

/**
 * Top-level layout chrome around the three panes. Pure rendering — all state
 * (activity selection, settings open, AI orchestration) is owned upstream
 * and passed in as props.
 *
 * Layout:
 *   IconRail | (SidePanel | EditorArea via PanelGroup) | AIChatPanel (docked-right)
 *   ↑ row                                                 ↑ flex sibling of PanelGroup
 *   StatusBar (full-width footer)
 *
 * Note on the main split: `react-resizable-panels` is intentionally kept here
 * (rather than swapped for `ResizableSplit`) because it provides the
 * drag-to-collapse behavior (collapsible + collapsedSize={0}) that the
 * design-system primitive does not yet model. Migration to `ResizableSplit`
 * can land as a follow-up after the primitive grows a `collapseThreshold`.
 */
export function AppShell({
  items,
  activeId,
  onChangeActiveItem,
  settingsOpen,
  onToggleSettings,
  onCloseSettings,
  onSendMessage,
  onClearContext,
}: Props) {
  const sidePanelRef = useRef<ImperativePanelHandle>(null);
  const { connections, activeConnectionId, activeDatabase } = useConnectionsStore();
  const active = connections.find((c) => c.id === activeConnectionId);

  return (
    <div className={styles.root}>
      <div className={styles.body}>
        <IconRail
          items={items}
          activeId={activeId}
          onChange={onChangeActiveItem}
          onSettingsOpen={onToggleSettings}
          settingsOpen={settingsOpen}
        />
        {settingsOpen ? (
          <SettingsView onClose={onCloseSettings} />
        ) : (
          <div className={styles.mainArea}>
            <PanelGroup direction="horizontal" style={{ flex: 1 }}>
              <Panel
                ref={sidePanelRef}
                minSize={10}
                defaultSize={20}
                collapsible
                collapsedSize={0}
              >
                <SidePanel item={items.find((i) => i.id === activeId) ?? null} />
              </Panel>
              <SplitHandle direction="horizontal" />
              <Panel minSize={50} defaultSize={80}>
                <div className={styles.editorPane}>
                  <EditorArea />
                </div>
              </Panel>
            </PanelGroup>
            {/*
              AIChatPanel returns null when panelOpen is false, so it consumes
              no layout space when closed. It owns its own width (380-600px)
              and a left-edge drag handle, so it lives as a flex sibling next
              to PanelGroup rather than as a Panel inside it — the two resize
              mechanisms would otherwise conflict.
            */}
            <AIChatPanel
              onSendMessage={onSendMessage}
              onOpenSettings={onToggleSettings}
              onClearContext={onClearContext}
            />
          </div>
        )}
      </div>
      {!settingsOpen && <AIFloatingButton />}
      <StatusBar
        connectionName={active?.name}
        database={activeDatabase ?? undefined}
        nodeStatus="Node.js ready"
      />
    </div>
  );
}
