// Workbench — level-1 mcp-composition canvas (ADR-007 workbench § canvas v1).
//
// React Flow is the wiring surface ONLY (canvas-only; execution stays in the
// CTRL executor — no borrowed dataflow engine). The palette lists the user's
// installed mcps (real list_mcps, no mock); dragging one onto the canvas
// drops a node that renders the actual mcp. The Irisy side-pane is the
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
import { listMcps, type McpSummary } from '@/lib/kernel';
import { normalizeIcon } from '@/lib/icon';
import { IconRenderer } from '@/components/primitives';
import styles from './workbench.module.css';

const DRAG_MIME = 'application/ctrl-mcp-node';

type McpNodeData = { mcp: McpSummary };
type McpNode = Node<McpNodeData, 'mcp'>;

// Custom node — renders the real mcp (brief §3: nodes show the actual
// mcp, not default boxes). Left handle = input port, right = output;
// JSON Schema typed-port validation lands with the io schema work.
function McpNodeView({ data }: NodeProps<McpNode>): ReactElement {
  const { mcp } = data;
  const icon = normalizeIcon(mcp.icon, mcp.name);
  return (
    <div className={styles.node} data-color={mcp.mcp_color}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <span className={styles.nodeIcon} aria-hidden="true">
        <IconRenderer icon={icon} size={26} ariaLabel={mcp.name} />
      </span>
      <span className={styles.nodeLabel}>{mcp.name}</span>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}

const nodeTypes: NodeTypes = { mcp: McpNodeView };

function Canvas(): ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState<McpNode>([]);
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
      let mcp: McpSummary;
      try {
        mcp = JSON.parse(raw) as McpSummary;
      } catch {
        return;
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const node: McpNode = {
        id: `${mcp.id}:${Date.now()}`,
        type: 'mcp',
        position,
        data: { mcp },
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
  const { data: mcps = [], isLoading, isError } = useQuery({
    queryKey: ['mcps'],
    queryFn: listMcps,
  });

  const onDragStart = (event: DragEvent<HTMLDivElement>, mcp: McpSummary): void => {
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(mcp));
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className={styles.palette} aria-label="Mcp palette">
      <h2 className={styles.sectionTitle}>Mcps</h2>
      {isLoading ? (
        <p className={styles.hint}>Loading…</p>
      ) : isError ? (
        <p className={styles.hint}>Kernel unreachable.</p>
      ) : mcps.length === 0 ? (
        <p className={styles.hint}>No mcps yet — install some from Pool.</p>
      ) : (
        <div className={styles.paletteList}>
          {mcps.map((mcp) => (
            <div
              key={mcp.id}
              className={styles.paletteItem}
              draggable
              onDragStart={(event) => onDragStart(event, mcp)}
              title={`Drag ${mcp.name} onto the canvas`}
            >
              <IconRenderer
                icon={normalizeIcon(mcp.icon, mcp.name)}
                size={18}
                ariaLabel={mcp.name}
              />
              <span className={styles.paletteLabel}>{mcp.name}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

export function WorkbenchRoute(): ReactElement {
  // 2026-05-29 restructure: Irisy chat is shell-level; the workbench's
  // own copilot column was dropped (the user now talks to Irisy in the
  // fixed shell pane to the right).
  return (
    <div className={styles.shell}>
      <Palette />
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </div>
  );
}
