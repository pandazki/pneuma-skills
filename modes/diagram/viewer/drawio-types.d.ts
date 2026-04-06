/**
 * Minimal TypeScript declarations for draw.io viewer-static.min.js globals.
 * Only declares methods/properties actually used by DiagramPreview.
 */

interface MxCell {
  id: string;
  value: string | null;
  style: string | null;
  vertex: boolean;
  edge: boolean;
  visible: boolean;
  connectable: boolean;
  source: MxCell | null;
  target: MxCell | null;
  geometry: MxGeometry | null;
  parent: MxCell | null;
}

interface MxGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  relative: boolean;
  points: Array<{ x: number; y: number }> | null;
}

interface MxGraphModel {
  cells: Record<string, MxCell>;
  root: MxCell | null;
  getCell(id: string): MxCell | null;
  add(parent: MxCell, cell: MxCell, index?: number): MxCell;
  setStyle(cell: MxCell, style: string): void;
  setValue(cell: MxCell, value: string): void;
  setGeometry(cell: MxCell, geometry: MxGeometry): void;
  setTerminal(cell: MxCell, terminal: MxCell | null, isSource: boolean): void;
  setVisible(cell: MxCell, visible: boolean): void;
  beginUpdate(): void;
  endUpdate(): void;
  contains(cell: MxCell): boolean;
  getParent(cell: MxCell): MxCell | null;
}

interface MxCellState {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: { node: SVGElement | HTMLElement } | null;
  text: { node: SVGElement | HTMLElement } | null;
}

interface DrawioGraph {
  getModel(): MxGraphModel;
  container: HTMLElement;
  view: {
    validate(): void;
    getState(cell: MxCell): MxCellState | null;
    scale: number;
    translate: { x: number; y: number };
    scaleAndTranslate(scale: number, tx: number, ty: number): void;
    getGraphBounds(): { x: number; y: number; width: number; height: number };
  };
  setEnabled(enabled: boolean): void;
  destroy(): void;
  getCellAt(x: number, y: number, parent?: MxCell | null): MxCell | null;
}

interface MxCodecInstance {
  lookup: ((id: string) => MxCell | null) | null;
  decode(node: Element): unknown;
}

declare class Graph {
  constructor(container: HTMLElement);
  container: HTMLElement;
  getModel(): MxGraphModel;
  view: DrawioGraph["view"];
  setEnabled(enabled: boolean): void;
  destroy(): void;
  getCellAt(x: number, y: number, parent?: MxCell | null): MxCell | null;
}

declare class GraphViewer {
  static createViewerForElement(
    element: HTMLElement,
    callback: (viewer: { graph: DrawioGraph }) => void,
  ): void;
  static processElements(): void;
}

declare class mxCodec {
  constructor(doc?: Document);
  lookup: ((id: string) => MxCell | null) | null;
  decode(node: Element): unknown;
}

declare namespace mxUtils {
  function parseXml(xml: string): Document;
}

// rough.js global (loaded before viewer-static for sketch mode)
interface Window {
  rough: unknown;
}

// draw.io Editor global (used for sketch mode flag)
declare namespace Editor {
  let sketchMode: boolean;
}

declare class mxCell {
  constructor(value?: string | null, geometry?: MxGeometry | null, style?: string | null);
  id: string;
  value: string | null;
  style: string | null;
  vertex: boolean;
  edge: boolean;
  visible: boolean;
  connectable: boolean;
  source: MxCell | null;
  target: MxCell | null;
  geometry: MxGeometry | null;
  parent: MxCell | null;
}
