// DiagramEditor — node-based visual editor backed by React Flow
// (@xyflow/react, MIT).
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-03 — kairo Diagram
// parity batch.)
//
// Diagrams live as `.md` files under `vault/diagrams/*.md` with the
// graph JSON stored under a single `diagram` frontmatter string so
// it round-trips through the existing vault YAML parser (which only
// understands flat scalars + simple arrays):
//
//   ---
//   type: diagram
//   title: Auth flow
//   diagram: '{"nodes":[...],"edges":[...]}'
//   ---
//
// The body is left free for the user to write prose around the
// diagram. PNG export is a single click via `html-to-image`.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import { vaultRead, vaultWrite } from '@/lib/kernel';
import styles from './Notes.module.css';
import '@xyflow/react/dist/style.css';

interface DiagramEditorProps {
  path: string;
}

interface PersistedDiagram {
  nodes: Node[];
  edges: Edge[];
}

const decodeDiagram = (fm: Record<string, unknown>): PersistedDiagram => {
  const raw = fm.diagram;
  if (typeof raw !== 'string' || !raw.trim()) return { nodes: [], edges: [] };
  try {
    const parsed = JSON.parse(raw) as PersistedDiagram;
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
};

const NODE_KINDS = [
  { label: 'Process', style: 'process' },
  { label: 'Decision', style: 'decision' },
  { label: 'Data', style: 'data' },
] as const;

const styleForKind = (kind: string): React.CSSProperties => {
  if (kind === 'decision') {
    return {
      background: 'color-mix(in oklch, #e5b13a 18%, transparent)',
      border: '1px solid #e5b13a',
      borderRadius: '6px',
      padding: '8px 12px',
    };
  }
  if (kind === 'data') {
    return {
      background: 'color-mix(in oklch, #4aa6e5 18%, transparent)',
      border: '1px solid #4aa6e5',
      borderRadius: '999px',
      padding: '8px 16px',
    };
  }
  return {
    background: 'var(--color-bg-l1)',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    padding: '8px 12px',
  };
};

const InnerEditor = ({ path }: DiagramEditorProps): ReactElement => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const entry = await vaultRead(path);
      const fm = (entry.frontmatter ?? {}) as Record<string, unknown>;
      const { nodes: n, edges: e } = decodeDiagram(fm);
      setNodes(n);
      setEdges(e);
      setFrontmatter(fm);
      setBody(typeof entry.body === 'string' ? entry.body : '');
      setDirty(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('diagram load failed', err);
    }
  }, [path, setNodes, setEdges]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
      setDirty(true);
    },
    [setEdges],
  );

  const handleAddNode = useCallback(
    (kind: string) => {
      const id = `n${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const label = window.prompt('Node label', kind) ?? kind;
      const newNode: Node = {
        id,
        position: { x: 80 + nodes.length * 30, y: 80 + nodes.length * 30 },
        data: { label, kind },
        style: styleForKind(kind),
      };
      setNodes((ns) => ns.concat(newNode));
      setDirty(true);
    },
    [nodes.length, setNodes],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload: PersistedDiagram = { nodes, edges };
      await vaultWrite({
        path,
        content: body,
        frontmatter: {
          ...frontmatter,
          type: 'diagram',
          diagram: JSON.stringify(payload),
        },
      });
      setDirty(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('diagram save failed', err);
    } finally {
      setSaving(false);
    }
  }, [body, edges, frontmatter, nodes, path]);

  const handleExportPng = useCallback(async () => {
    const el = canvasRef.current;
    if (!el) return;
    try {
      const dataUrl = await toPng(el, {
        backgroundColor: '#ffffff',
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = `${path.replace(/[/.]/g, '-')}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('png export failed', err);
    }
  }, [path]);

  // Wrap React Flow's change handlers so we mark the document dirty
  // on node moves / edge edits.
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      const mutates = changes.some(
        (c) => c.type === 'position' || c.type === 'remove' || c.type === 'add',
      );
      if (mutates) setDirty(true);
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      setDirty(true);
    },
    [onEdgesChange],
  );

  const headerCount = useMemo(
    () => `${nodes.length} nodes · ${edges.length} edges`,
    [nodes.length, edges.length],
  );

  return (
    <section className={styles.diagramEditor} aria-label="Diagram editor">
      <header className={styles.diagramHeader}>
        <span className={styles.diagramCount}>{headerCount}</span>
        {NODE_KINDS.map((k) => (
          <button
            key={k.label}
            type="button"
            className={styles.actionButton}
            onClick={() => handleAddNode(k.style)}
          >
            + {k.label}
          </button>
        ))}
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => void handleExportPng()}
        >
          PNG
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
        >
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </header>
      <div ref={canvasRef} className={styles.diagramCanvas}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          fitView
        >
          <Background gap={16} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </section>
  );
};

export const DiagramEditor = ({ path }: DiagramEditorProps): ReactElement => (
  <ReactFlowProvider>
    <InnerEditor path={path} />
  </ReactFlowProvider>
);
