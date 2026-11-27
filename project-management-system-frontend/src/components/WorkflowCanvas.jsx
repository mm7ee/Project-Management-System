/** @import { StatusDef } from '../data/workflows' */
/** @import { Connection, Edge, Node } from '@xyflow/react' */
// The workflow as a picture you can edit: statuses are boxes, moves are arrows. Drag from one box's edge to another
// to add a move; select an arrow and press Delete (or use the table) to remove it. "From any status" moves are
// listed under the picture, since they have no single starting box. Loaded only on the Workflows page.
import { useCallback, useMemo, useState } from "react";
import * as Flow from "@xyflow/react";
import { Background, Controls, MarkerType, Position, ReactFlow, applyNodeChanges } from "@xyflow/react";
// (Handle is both a type and a component in the package; JSDoc type-checking needs the component taken explicitly.)
const Handle = Flow.Handle;
import "@xyflow/react/dist/style.css";
import { CATEGORY_META } from "../data/workflows";

/** @typedef {{ name: string; from: string | null; to: string; rules: unknown[] }} CanvasMove */

/** A status box, with handles to start and end arrows. @param {{ data: { status: StatusDef; initial: boolean; count: number } }} p */
function StatusNode({ data }) {
  const cat = CATEGORY_META[data.status.category];
  return (
    <div className={`wfc-node cat-${data.status.category.toLowerCase()} ${data.initial ? "start" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <b>{data.status.name}</b>
      <small>
        {cat.label}
        {data.initial ? " · start" : ""}
        {data.count ? ` · ${data.count} items` : ""}
      </small>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const NODE_TYPES = { status: StatusNode };

/**
 * @param {{
 *   statuses: { id: string; initial: boolean }[];
 *   catalogue: Map<string, StatusDef>;
 *   moves: CanvasMove[];
 *   usage: Record<string, number>;
 *   canEdit: boolean;
 *   onAdd: (from: string, to: string) => void;
 *   onRemove: (index: number) => void;
 * }} p
 */
export default function WorkflowCanvas({ statuses, catalogue, moves, usage, canEdit, onAdd, onRemove }) {
  // Laid out left to right in workflow order, two rows so long workflows fit; boxes can be dragged (not saved).
  const laid = useMemo(
    () =>
      statuses
        .filter((s) => catalogue.has(s.id))
        .map((s, i) => ({
          id: s.id,
          type: "status",
          position: { x: Math.floor(i / 2) * 210 + (i % 2) * 105, y: (i % 2) * 120 },
          data: { status: /** @type {StatusDef} */ (catalogue.get(s.id)), initial: s.initial, count: usage[s.id] ?? 0 },
        })),
    [statuses, catalogue, usage],
  );
  const [dragged, setDragged] = useState(/** @type {Record<string, { x: number; y: number }>} */ ({}));
  /** @type {Node[]} */ const nodes = laid.map((n) => ({ ...n, position: dragged[n.id] ?? n.position }));
  /** @type {Edge[]} */ const edges = moves
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.from)
    .map(({ m, i }) => ({
      id: `m${i}`,
      source: /** @type {string} */ (m.from),
      target: m.to,
      label: m.name,
      markerEnd: { type: MarkerType.ArrowClosed },
      deletable: canEdit,
      data: { index: i },
      className: m.rules.length ? "wfc-edge has-rules" : "wfc-edge",
    }));
  const onNodesChange = useCallback(
    /** @param {import('@xyflow/react').NodeChange[]} changes */ (changes) => {
      const next = applyNodeChanges(changes, nodes);
      setDragged(Object.fromEntries(next.map((n) => [n.id, n.position])));
    },
    [nodes],
  );
  const anyMoves = moves.filter((m) => !m.from);
  return (
    <div className="wfc">
      <div className="wfc-canvas" role="img" aria-label={`Workflow diagram: ${statuses.length} statuses and ${moves.length} moves. The table below lists the same moves.`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          nodesConnectable={canEdit}
          edgesFocusable={canEdit}
          onConnect={(/** @type {Connection} */ c) => {
            if (c.source && c.target && c.source !== c.target) onAdd(c.source, c.target);
          }}
          onEdgesDelete={(/** @type {Edge[]} */ gone) => {
            // Highest index first, so the others keep their place.
            for (const e of [...gone].sort((a, b) => Number(b.data?.index) - Number(a.data?.index))) onRemove(Number(e.data?.index));
          }}
          deleteKeyCode={canEdit ? ["Delete", "Backspace"] : null}
          fitView
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
        >
          <Background gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="field-hint">
        {canEdit ? "Drag from the right edge of one status to another to add a move. Select an arrow and press Delete to remove it. " : ""}
        {anyMoves.length > 0 && `From any status: ${anyMoves.map((m) => `${m.name} → ${catalogue.get(m.to)?.name ?? m.to}`).join("; ")}.`}
      </p>
    </div>
  );
}
