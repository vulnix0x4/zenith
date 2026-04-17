import { useCallback, useEffect, useRef } from 'react';
import {
  useTabStore,
  type DropZone,
  type LeafContent,
  type PaneNode,
} from '../../stores/tabStore';
import styles from './SplitTerminal.module.css';

interface SplitTerminalProps {
  tabId: string;
  pane: PaneNode;
  focusedLeafId: string;
  /** Register / unregister the DOM container that will host this leaf's
   *  xterm. AppLayout owns a slot registry and portals XTerminal instances
   *  into the registered DOM nodes -- this keeps the terminals alive across
   *  tree reorganization (split / merge), which would otherwise unmount
   *  them and wipe the visible buffer. */
  registerSlot: (leafId: string, el: HTMLDivElement | null) => void;
  /** Fired when the user clicks a pane header / tries to remove it.
   *  Removing the LAST leaf in a tab closes the whole tab. */
  onClosePane: (leafId: string) => void;
  /** Drag-handling -- the parent owns the global drag state so the drop
   *  overlay can be rendered above all the panes. */
  onDragOverPane: (leafId: string, zone: DropZone | null, rect: DOMRect | null) => void;
  onDropOnPane: (leafId: string, zone: DropZone) => void;
  isDragActive: boolean;
  /** When the leaf id matches `dragHoverLeafId`, render the drop overlay. */
  dragHoverLeafId: string | null;
  dragHoverZone: DropZone | null;
}

/** Compute which edge zone a pointer is over inside a leaf's bounds. We
 *  divide the rect into 4 trapezoids meeting at the centre; the pointer's
 *  position relative to those triangles picks one zone. Internal helper --
 *  not exported so Vite Fast Refresh stays happy with this component file. */
function zoneFromPointer(rect: DOMRect, clientX: number, clientY: number): DropZone {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const w = rect.width;
  const h = rect.height;
  const left = x;
  const right = w - x;
  const top = y;
  const bottom = h - y;
  const min = Math.min(left, right, top, bottom);
  if (min === left) return 'left';
  if (min === right) return 'right';
  if (min === top) return 'top';
  return 'bottom';
}

function PaneLeaf({
  leaf,
  isFocused,
  registerSlot,
  onClosePane,
  onDragOverPane,
  onDropOnPane,
  isDragActive,
  showOverlay,
  hoverZone,
  onFocus,
  paneCount,
}: {
  leaf: LeafContent;
  isFocused: boolean;
  registerSlot: (leafId: string, el: HTMLDivElement | null) => void;
  onClosePane: (leafId: string) => void;
  onDragOverPane: (leafId: string, zone: DropZone | null, rect: DOMRect | null) => void;
  onDropOnPane: (leafId: string, zone: DropZone) => void;
  isDragActive: boolean;
  showOverlay: boolean;
  hoverZone: DropZone | null;
  onFocus: () => void;
  paneCount: number;
}) {
  // Plug our slot div into AppLayout's registry so it can portal an
  // XTerminal instance in. The cleanup empties the registry entry so a
  // stale DOM node is never read after unmount.
  const slotRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    registerSlot(leaf.leafId, slotRef.current);
    return () => registerSlot(leaf.leafId, null);
    // leaf.leafId is stable; registerSlot is referentially stable (useCallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isDragActive) return;
      // preventDefault + dropEffect together tell the browser the drop is
      // valid here -- without both, the cursor shows "no entry" (red X).
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const zone = zoneFromPointer(rect, e.clientX, e.clientY);
      onDragOverPane(leaf.leafId, zone, rect);
    },
    [isDragActive, onDragOverPane, leaf.leafId]
  );

  const handleDragLeave = useCallback(() => {
    if (!isDragActive) return;
    onDragOverPane(leaf.leafId, null, null);
  }, [isDragActive, onDragOverPane, leaf.leafId]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isDragActive) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const zone = zoneFromPointer(rect, e.clientX, e.clientY);
      onDropOnPane(leaf.leafId, zone);
    },
    [isDragActive, onDropOnPane, leaf.leafId]
  );

  return (
    <div
      className={`${styles.pane} ${isFocused && paneCount > 1 ? styles.paneFocused : ''}`}
      onMouseDownCapture={onFocus}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {paneCount > 1 && (
        <div className={styles.paneHeader}>
          <span className={styles.paneTitle}>{leaf.title}</span>
          <button
            className={styles.paneClose}
            title="Close pane"
            onClick={(e) => {
              e.stopPropagation();
              onClosePane(leaf.leafId);
            }}
          >
            &times;
          </button>
        </div>
      )}
      {/* Slot div -- AppLayout portals an XTerminal into here. Keeping the
          xterm instance alive across re-parents requires this indirection. */}
      <div ref={slotRef} className={styles.terminalSlot} />
      {showOverlay && hoverZone && <DropZoneOverlay zone={hoverZone} />}
    </div>
  );
}

/** Visual highlight for the chosen drop edge. Half-transparent cyan slab
 *  covering the half of the pane that the dropped tab will occupy. */
function DropZoneOverlay({ zone }: { zone: DropZone }) {
  const style: React.CSSProperties = (() => {
    switch (zone) {
      case 'left':
        return { left: 0, top: 0, bottom: 0, width: '50%' };
      case 'right':
        return { right: 0, top: 0, bottom: 0, width: '50%' };
      case 'top':
        return { top: 0, left: 0, right: 0, height: '50%' };
      case 'bottom':
        return { bottom: 0, left: 0, right: 0, height: '50%' };
    }
  })();
  return <div className={styles.dropOverlay} style={style} />;
}

interface PaneTreeNodeProps {
  node: PaneNode;
  paneCount: number;
  focusedLeafId: string;
  onFocusLeaf: (leafId: string) => void;
  registerSlot: (leafId: string, el: HTMLDivElement | null) => void;
  onClosePane: (leafId: string) => void;
  onDragOverPane: (leafId: string, zone: DropZone | null, rect: DOMRect | null) => void;
  onDropOnPane: (leafId: string, zone: DropZone) => void;
  isDragActive: boolean;
  dragHoverLeafId: string | null;
  dragHoverZone: DropZone | null;
}

function PaneTreeNode(props: PaneTreeNodeProps) {
  const { node } = props;
  if (node.kind === 'leaf') {
    const isHover = props.dragHoverLeafId === node.content.leafId;
    return (
      <PaneLeaf
        leaf={node.content}
        isFocused={props.focusedLeafId === node.content.leafId}
        registerSlot={props.registerSlot}
        onClosePane={props.onClosePane}
        onDragOverPane={props.onDragOverPane}
        onDropOnPane={props.onDropOnPane}
        isDragActive={props.isDragActive}
        showOverlay={isHover}
        hoverZone={isHover ? props.dragHoverZone : null}
        onFocus={() => props.onFocusLeaf(node.content.leafId)}
        paneCount={props.paneCount}
      />
    );
  }
  const flexDir = node.direction === 'horizontal' ? 'row' : 'column';
  const firstFlex = node.ratio;
  const secondFlex = 1 - node.ratio;
  return (
    <div className={styles.split} style={{ flexDirection: flexDir }}>
      <div className={styles.splitChild} style={{ flex: `${firstFlex} ${firstFlex} 0` }}>
        <PaneTreeNode {...props} node={node.first} />
      </div>
      <div className={node.direction === 'horizontal' ? styles.dividerH : styles.dividerV} />
      <div className={styles.splitChild} style={{ flex: `${secondFlex} ${secondFlex} 0` }}>
        <PaneTreeNode {...props} node={node.second} />
      </div>
    </div>
  );
}

export default function SplitTerminal({
  tabId,
  pane,
  focusedLeafId,
  registerSlot,
  onClosePane,
  onDragOverPane,
  onDropOnPane,
  isDragActive,
  dragHoverLeafId,
  dragHoverZone,
}: SplitTerminalProps) {
  const setFocusedLeaf = useTabStore((s) => s.setFocusedLeaf);
  const onFocusLeaf = useCallback(
    (leafId: string) => setFocusedLeaf(tabId, leafId),
    [setFocusedLeaf, tabId]
  );

  const paneCount = countLeaves(pane);

  return (
    <div className={styles.splitContainer}>
      <PaneTreeNode
        node={pane}
        paneCount={paneCount}
        focusedLeafId={focusedLeafId}
        onFocusLeaf={onFocusLeaf}
        registerSlot={registerSlot}
        onClosePane={onClosePane}
        onDragOverPane={onDragOverPane}
        onDropOnPane={onDropOnPane}
        isDragActive={isDragActive}
        dragHoverLeafId={dragHoverLeafId}
        dragHoverZone={dragHoverZone}
      />
    </div>
  );
}

function countLeaves(pane: PaneNode): number {
  return pane.kind === 'leaf' ? 1 : countLeaves(pane.first) + countLeaves(pane.second);
}
