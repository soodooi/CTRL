// GraphView — force-directed knowledge graph of the vault.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-02 — kairo feature
// parity batch.)
//
// Reads the kernel `vault_graph_data` command (already shipped in
// §8.3 #15) and renders nodes + edges via `react-force-graph-2d`
// (MIT). Nodes are vault note paths; edges are resolved wikilinks /
// markdown links. Clicking a node emits `onSelect(path)` which the
// caller (NotesApp) uses to switch the selected note.
//
// Two scopes — global (every node) or local (focused on the active
// selection + its 1-hop neighbours). Search filter trims the global
// view by substring match on the path.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import ForceGraph2D from 'react-force-graph-2d';
import { vaultGraphData } from '@/lib/kernel';
import styles from './Notes.module.css';

interface GraphViewProps {
  focusPath: string | null;
  onSelect: (path: string) => void;
}

interface NodeDatum {
  id: string;
  label: string;
  emphasis: boolean;
}

interface EdgeDatum {
  source: string;
  target: string;
}

const baseName = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};

const stem = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

export const GraphView = ({ focusPath, onSelect }: GraphViewProps): ReactElement => {
  const [scope, setScope] = useState<'global' | 'local'>('global');
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const { data: graph, isLoading } = useQuery({
    queryKey: ['vault-graph-data'],
    queryFn: () => vaultGraphData(),
    staleTime: 30_000,
  });

  // Resize observer — the force layout needs a concrete (width, height)
  // so it can place nodes; container measurement is the cheapest signal.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.max(100, width), height: Math.max(100, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [] as NodeDatum[], edges: [] as EdgeDatum[] };
    const allNodes = graph.nodes ?? [];
    const allEdges = graph.edges ?? [];

    if (scope === 'local' && focusPath) {
      // 1-hop neighbourhood around focusPath.
      const neighbours = new Set<string>([focusPath]);
      for (const e of allEdges) {
        if (e.from === focusPath) neighbours.add(e.to);
        if (e.to === focusPath) neighbours.add(e.from);
      }
      const ns: NodeDatum[] = allNodes
        .filter((p) => neighbours.has(p))
        .map((p) => ({ id: p, label: stem(baseName(p)), emphasis: p === focusPath }));
      const es: EdgeDatum[] = allEdges
        .filter((e) => neighbours.has(e.from) && neighbours.has(e.to))
        .map((e) => ({ source: e.from, target: e.to }));
      return { nodes: ns, edges: es };
    }

    const filterLower = filter.trim().toLowerCase();
    const ns: NodeDatum[] = allNodes
      .filter((p) => !filterLower || p.toLowerCase().includes(filterLower))
      .map((p) => ({ id: p, label: stem(baseName(p)), emphasis: p === focusPath }));
    const allowed = new Set(ns.map((n) => n.id));
    const es: EdgeDatum[] = allEdges
      .filter((e) => allowed.has(e.from) && allowed.has(e.to))
      .map((e) => ({ source: e.from, target: e.to }));
    return { nodes: ns, edges: es };
  }, [graph, scope, focusPath, filter]);

  return (
    <section className={styles.graphView} aria-label="Graph view">
      <header className={styles.graphHeader}>
        <div className={styles.graphScope}>
          <button
            type="button"
            className={styles.graphScopeButton}
            data-active={scope === 'global' || undefined}
            onClick={() => setScope('global')}
          >
            Global
          </button>
          <button
            type="button"
            className={styles.graphScopeButton}
            data-active={scope === 'local' || undefined}
            onClick={() => setScope('local')}
            disabled={!focusPath}
            title={focusPath ? 'Show 1-hop neighbours' : 'Select a note first'}
          >
            Local
          </button>
        </div>
        <input
          type="search"
          className={styles.graphFilter}
          placeholder="Filter nodes…"
          value={filter}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
          disabled={scope === 'local'}
        />
        <span className={styles.graphCount}>
          {nodes.length} node{nodes.length === 1 ? '' : 's'} ·{' '}
          {edges.length} link{edges.length === 1 ? '' : 's'}
        </span>
      </header>
      <div ref={containerRef} className={styles.graphCanvas}>
        {isLoading ? (
          <p className={styles.muted}>Loading graph…</p>
        ) : nodes.length === 0 ? (
          <p className={styles.muted}>
            {filter ? 'No nodes match the filter.' : 'Vault has no graph data yet.'}
          </p>
        ) : (
          <ForceGraph2D
            graphData={{ nodes, links: edges }}
            width={size.width}
            height={size.height}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as unknown as NodeDatum & { x?: number; y?: number };
              const x = n.x ?? 0;
              const y = n.y ?? 0;
              const label = n.label;
              const fontSize = 11 / globalScale;
              ctx.font = `${fontSize}px sans-serif`;
              const radius = n.emphasis ? 5 : 3.5;
              ctx.beginPath();
              ctx.arc(x, y, radius, 0, 2 * Math.PI);
              ctx.fillStyle = n.emphasis ? '#e5b13a' : '#7c7c84';
              ctx.fill();
              ctx.fillStyle = '#cccccc';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(label, x + radius + 2, y);
            }}
            linkColor={() => 'rgba(180, 180, 200, 0.35)'}
            linkWidth={0.4}
            cooldownTicks={80}
            onNodeClick={(node) => {
              const n = node as unknown as NodeDatum;
              onSelect(n.id);
            }}
          />
        )}
      </div>
    </section>
  );
};
