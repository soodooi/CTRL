// Workbench — level-1 keycap-composition canvas (ADR-022).
//
// React Flow is the wiring surface ONLY (canvas-only; execution stays in the
// CTRL executor — no borrowed dataflow engine). The palette lists the user's
// installed keycaps (real list_keycaps, no mock); dragging one onto the canvas
// drops a node that renders the actual keycap. The Irisy side-pane is the
// co-pilot (graph-patch tool calls land in a later increment).
//
// Per decision_pwa_two_panel_layout this renders inside the workspace pane —
// the left keyboard + right rail stay fixed; the workbench does NOT take over
// the whole window.
//
// Heavy deps (@xyflow/react) load only here: this route is lazy-imported in
// app.tsx, so the canvas + its CSS stay off the critical-path bundle.

import {
  useCallback,
  type DragEvent,
  type ReactElement,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { listKeycaps, type KeycapSummary } from '@/lib/kernel';
import { normalizeIcon } from '@/lib/icon';
import { IconRenderer } from '@/components/primitives';
import { IrisyChat } from '@/components/irisy/IrisyChat';
import styles from './workbench.module.css';

const DRAG_MIME = 'application/ctrl-keycap-node';

type KeycapNodeData = { keycap: KeycapSummary };
type KeycapNode = Node<KeycapNodeData, 'keycap'>;

// Custom node — renders the real keycap (brief §3: nodes show the actual
// keycap, not default boxes). Left handle = input port, right = output;
// JSON Schema typed-port validation lands with the io schema work.
function KeycapNodeView({ data }: NodeProps<KeycapNode>): ReactElement {
  const { keycap } = data;
  const icon = normalizeIcon(keycap.icon, keycap.name);
  return (
    <div className={styles.node} data-color={keycap.keycap_color}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <span className={styles.nodeIcon} aria-hidden="true">
        <IconRenderer icon={icon} size={26} ariaLabel={keycap.name} />
      </span>
      <span className={styles.nodeLabel}>{keycap.name}</span>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}

const nodeTypes: NodeTypes = { keycap: KeycapNodeView };

function Canvas(): ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState<KeycapNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const raw = event.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      event.preventDefault();
      let keycap: KeycapSummary;
      try {
        keycap = JSON.parse(raw) as KeycapSummary;
      } catch {
        return;
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const node: KeycapNode = {
        id: `${keycap.id}:${Date.now()}`,
        type: 'keycap',
        position,
        data: { keycap },
      };
      setNodes((nds) => nds.concat(node));
    },
    [screenToFlowPosition, setNodes],
  );

  return (
    <div className={styles.canvas} onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

function Palette(): ReactElement {
  const { data: keycaps = [], isLoading, isError } = useQuery({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
  });

  const onDragStart = (event: DragEvent<HTMLDivElement>, keycap: KeycapSummary): void => {
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(keycap));
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className={styles.palette} aria-label="Keycap palette">
      <h2 className={styles.sectionTitle}>Keycaps</h2>
      {isLoading ? (
        <p className={styles.hint}>Loading…</p>
      ) : isError ? (
        <p className={styles.hint}>Kernel unreachable.</p>
      ) : keycaps.length === 0 ? (
        <p className={styles.hint}>No keycaps yet — install some from Pool.</p>
      ) : (
        <div className={styles.paletteList}>
          {keycaps.map((keycap) => (
            <div
              key={keycap.id}
              className={styles.paletteItem}
              draggable
              onDragStart={(event) => onDragStart(event, keycap)}
              title={`Drag ${keycap.name} onto the canvas`}
            >
              <IconRenderer
                icon={normalizeIcon(keycap.icon, keycap.name)}
                size={18}
                ariaLabel={keycap.name}
              />
              <span className={styles.paletteLabel}>{keycap.name}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

export function WorkbenchRoute(): ReactElement {
  return (
    <div className={styles.shell}>
      <Palette />
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
      <aside className={styles.copilot} aria-label="Irisy co-pilot">
        <IrisyChat />
      </aside>
    </div>
  );
}
