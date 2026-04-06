/**
 * Streaming renderer for draw.io diagrams.
 *
 * Adapted for Pneuma's file-change-driven architecture:
 * Pneuma receives complete (but growing) .drawio files from chokidar.
 *
 * Pipeline: file XML → extractMxGraphXml → healPartialXml → streamMergeXmlDelta
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface PendingEdge {
  cell: MxCell;
  sourceId: string | null;
  targetId: string | null;
}

export interface StreamState {
  graph: DrawioGraph;
  pendingEdges: PendingEdge[];
}

// ── XML Extraction ───────────────────────────────────────────────────────────

export interface DiagramPage {
  id: string;
  name: string;
  xml: string; // raw <mxGraphModel> XML
}

/**
 * Extract all <diagram> pages from a .drawio file.
 * Each page has an id, name, and its <mxGraphModel> XML content.
 */
export function extractDiagramPages(drawioXml: string): DiagramPage[] {
  const pages: DiagramPage[] = [];
  const diagramRegex = /<diagram\s+([^>]*)>([\s\S]*?)<\/diagram>/g;
  let match: RegExpExecArray | null;

  while ((match = diagramRegex.exec(drawioXml)) !== null) {
    const attrs = match[1];
    const content = match[2];

    const idMatch = attrs.match(/id="([^"]*)"/);
    const nameMatch = attrs.match(/name="([^"]*)"/);
    const id = idMatch ? idMatch[1] : `page-${pages.length}`;
    const name = nameMatch ? nameMatch[1] : `Page ${pages.length + 1}`;

    const mgmIdx = content.indexOf("<mxGraphModel");
    if (mgmIdx !== -1) {
      const endTag = "</mxGraphModel>";
      const endIdx = content.lastIndexOf(endTag);
      const xml = endIdx !== -1
        ? content.substring(mgmIdx, endIdx + endTag.length)
        : content.substring(mgmIdx);
      pages.push({ id, name, xml });
    }
  }

  // Fallback: no <diagram> wrapper, raw <mxGraphModel>
  if (pages.length === 0) {
    const mgmIdx = drawioXml.indexOf("<mxGraphModel");
    if (mgmIdx !== -1) {
      const endTag = "</mxGraphModel>";
      const endIdx = drawioXml.lastIndexOf(endTag);
      const xml = endIdx !== -1
        ? drawioXml.substring(mgmIdx, endIdx + endTag.length)
        : drawioXml.substring(mgmIdx);
      pages.push({ id: "page-1", name: "Page 1", xml });
    }
  }

  return pages;
}

/**
 * Extract the <mxGraphModel> XML from a .drawio file (first page only).
 * Kept for streaming where we always target the first/active page.
 */
export function extractMxGraphXml(drawioXml: string): string | null {
  const pages = extractDiagramPages(drawioXml);
  return pages.length > 0 ? pages[0].xml : null;
}

// ── Partial XML Healing ──────────────────────────────────────────────────────

/**
 * Heal truncated XML by auto-closing unclosed tags.
 * Returns null if the XML is too incomplete to be useful.
 */
export function healPartialXml(partialXml: string): string | null {
  if (partialXml == null || typeof partialXml !== "string") return null;
  if (partialXml.indexOf("<root") === -1) return null;

  const lastClose = partialXml.lastIndexOf(">");
  if (lastClose === -1) return null;

  let xml = partialXml.substring(0, lastClose + 1);
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<!--[\s\S]*$/, "");

  const tagStack: string[] = [];
  const tagRegex = /<(\/?[a-zA-Z][a-zA-Z0-9]*)[^>]*?(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(stripped)) !== null) {
    const nameOrClose = match[1];
    const selfClose = match[2];
    if (match[0].charAt(1) === "?") continue;
    if (selfClose === "/") continue;
    if (nameOrClose.charAt(0) === "/") {
      const closeName = nameOrClose.substring(1);
      if (tagStack.length > 0 && tagStack[tagStack.length - 1] === closeName) {
        tagStack.pop();
      }
    } else {
      tagStack.push(nameOrClose);
    }
  }

  for (let i = tagStack.length - 1; i >= 0; i--) {
    xml += "</" + tagStack[i] + ">";
  }

  return xml;
}

// ── Stream State Management ──────────────────────────────────────────────────

export function createStreamState(graph: DrawioGraph): StreamState {
  return {
    graph,
    pendingEdges: [],
  };
}

export function destroyStreamState(state: StreamState): void {
  state.graph.destroy();
}

// ── Incremental Merge ────────────────────────────────────────────────────────

/**
 * Merge parsed XML into a live Graph instance incrementally.
 * Updates existing cells, inserts new ones, resolves pending edge terminals.
 */
export function streamMergeXmlDelta(state: StreamState, xmlNode: Element): void {
  const { graph } = state;
  if (xmlNode.nodeName !== "mxGraphModel") return;

  // Propagate sketch mode: inject sketch=1 into cell styles when model-level sketch is enabled.
  // The renderer checks per-cell style, not the model attribute.
  const sketchEnabled = xmlNode.getAttribute("sketch") === "1";

  const model = graph.getModel();
  const codec = new mxCodec(xmlNode.ownerDocument);
  codec.lookup = (id: string) => model.getCell(id);

  const rootNode = xmlNode.getElementsByTagName("root")[0];
  if (rootNode == null) return;

  const cellNodes = rootNode.childNodes;

  model.beginUpdate();
  try {
    for (let i = 0; i < cellNodes.length; i++) {
      const cellNode = cellNodes[i] as Element;
      if (cellNode.nodeType !== 1) continue;

      let actualCellNode = cellNode;
      if (cellNode.nodeName === "UserObject" || cellNode.nodeName === "object") {
        const inner = cellNode.getElementsByTagName("mxCell");
        if (inner.length > 0) {
          actualCellNode = inner[0];
          if (!actualCellNode.getAttribute("id") && cellNode.getAttribute("id")) {
            actualCellNode.setAttribute("id", cellNode.getAttribute("id")!);
          }
        }
      }

      const id = actualCellNode.getAttribute("id");
      if (id == null) continue;

      const existing = model.getCell(id);

      if (existing != null) {
        let style = actualCellNode.getAttribute("style");
        if (style != null && sketchEnabled && style.length > 0 && !style.includes("sketch=")) {
          style = "sketch=1;curveFitting=1;jiggle=2;fontFamily=Segoe Print;" + style;
        }
        if (style != null && style !== existing.style) model.setStyle(existing, style);

        const value = actualCellNode.getAttribute("value");
        if (value != null && value !== existing.value) model.setValue(existing, value);

        const geoNodes = actualCellNode.getElementsByTagName("mxGeometry");
        if (geoNodes.length > 0) {
          const geo = codec.decode(geoNodes[0]) as MxGeometry | null;
          if (geo != null) {
            model.setGeometry(existing, geo);

            // Make visible when geometry arrives for initially hidden cells
            if (!existing.visible && (geo.width > 0 || geo.height > 0)) {
              model.setVisible(existing, true);
            }
          }
        }
      } else {
        streamInsertCell(state, model, codec, actualCellNode, sketchEnabled);
      }
    }

    // Resolve pending edges
    const stillPending: PendingEdge[] = [];
    for (const entry of state.pendingEdges) {
      if (!model.contains(entry.cell)) continue;
      let resolved = true;

      if (entry.sourceId != null && entry.cell.source == null) {
        const src = model.getCell(entry.sourceId);
        if (src != null) model.setTerminal(entry.cell, src, true);
        else resolved = false;
      }
      if (entry.targetId != null && entry.cell.target == null) {
        const tgt = model.getCell(entry.targetId);
        if (tgt != null) model.setTerminal(entry.cell, tgt, false);
        else resolved = false;
      }
      if (resolved) model.setVisible(entry.cell, true);
      else stillPending.push(entry);
    }
    state.pendingEdges = stillPending;
  } finally {
    model.endUpdate();
  }
}

function streamInsertCell(
  state: StreamState,
  model: MxGraphModel,
  codec: MxCodecInstance,
  cellNode: Element,
  sketchEnabled = false,
): void {
  const id = cellNode.getAttribute("id");
  const parentId = cellNode.getAttribute("parent");
  const sourceId = cellNode.getAttribute("source");
  const targetId = cellNode.getAttribute("target");
  const value = cellNode.getAttribute("value");
  let style = cellNode.getAttribute("style");
  if (sketchEnabled && style && style.length > 0 && !style.includes("sketch=")) {
    style = "sketch=1;curveFitting=1;jiggle=2;fontFamily=Segoe Print;" + style;
  }
  const isVertex = cellNode.getAttribute("vertex") === "1";
  const isEdge = cellNode.getAttribute("edge") === "1";
  const isConnectable = cellNode.getAttribute("connectable");
  const isVisible = cellNode.getAttribute("visible");

  const cell = new mxCell(value, null, style);
  cell.id = id!;
  cell.vertex = isVertex;
  cell.edge = isEdge;
  if (isConnectable === "0") cell.connectable = false;
  if (isVisible === "0") cell.visible = false;

  const geoNodes = cellNode.getElementsByTagName("mxGeometry");
  let hasGeo = false;
  if (geoNodes.length > 0) {
    const geo = codec.decode(geoNodes[0]) as MxGeometry | null;
    if (geo != null) {
      cell.geometry = geo;
      hasGeo = (geo.width > 0 || geo.height > 0) || geo.relative;
    }
  }

  if (isVertex && !hasGeo) {
    cell.visible = false;
  }

  let parent = parentId != null ? model.getCell(parentId) : null;
  if (parent == null && model.root != null) {
    if (id === "0") return;
    if (id === "1") {
      if (model.getCell("1") != null) return;
      parent = model.root;
    } else {
      parent = model.getCell("1") || model.root;
    }
  }
  if (parent == null) return;

  model.add(parent, cell);

  if (isEdge) {
    const source = sourceId != null ? model.getCell(sourceId) : null;
    const target = targetId != null ? model.getCell(targetId) : null;
    let hasMissing = false;

    if (source != null) model.setTerminal(cell, source, true);
    else if (sourceId != null) hasMissing = true;

    if (target != null) model.setTerminal(cell, target, false);
    else if (targetId != null) hasMissing = true;

    if (hasMissing) {
      model.setVisible(cell, false);
      state.pendingEdges.push({ cell, sourceId, targetId });
    }
  }
}
