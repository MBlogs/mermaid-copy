import { Notice } from "obsidian";

interface SvgBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const INLINE_STYLE_PROPERTIES = [
  "alignment-baseline",
  "align-items",
  "box-sizing",
  "color",
  "dominant-baseline",
  "display",
  "fill",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "height",
  "justify-content",
  "letter-spacing",
  "line-height",
  "margin",
  "max-width",
  "min-width",
  "opacity",
  "overflow",
  "padding",
  "paint-order",
  "stroke",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-width",
  "text-align",
  "text-anchor",
  "width",
  "white-space",
];

function parseNumericAttribute(value: string | null): number | null {
  if (!value || value.trim().endsWith("%")) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseViewBox(svg: SVGSVGElement): SvgBounds | null {
  const raw = svg.getAttribute("viewBox");
  if (!raw) return null;

  const values = raw
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value));

  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [x, y, width, height] = values;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function getSvgExportBounds(svg: SVGSVGElement): SvgBounds {
  const viewBox = parseViewBox(svg);
  const width = parseNumericAttribute(svg.getAttribute("width"));
  const height = parseNumericAttribute(svg.getAttribute("height"));

  if (viewBox) {
    return {
      x: viewBox.x,
      y: viewBox.y,
      width: width || viewBox.width,
      height: height || viewBox.height,
    };
  }

  if (width && height) {
    return { x: 0, y: 0, width, height };
  }

  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { x: 0, y: 0, width: rect.width, height: rect.height };
  }

  try {
    const bbox = svg.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return {
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
      };
    }
  } catch {
    // getBBox can throw while the source SVG is detached or hidden.
  }

  return { x: 0, y: 0, width: 1, height: 1 };
}

function inlineComputedStyles(source: Element, clone: Element): void {
  const computed = window.getComputedStyle(source);
  const style = clone instanceof HTMLElement || clone instanceof SVGElement
    ? clone.style
    : null;

  if (!style) return;

  for (const property of INLINE_STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value) style.setProperty(property, value);
  }

  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);
  for (let index = 0; index < sourceChildren.length; index += 1) {
    const sourceChild = sourceChildren[index];
    const cloneChild = cloneChildren[index];
    if (sourceChild && cloneChild) inlineComputedStyles(sourceChild, cloneChild);
  }
}

function preserveForeignObjectOverflow(clone: SVGSVGElement): void {
  clone.querySelectorAll<SVGForeignObjectElement>("foreignObject").forEach((foreignObject) => {
    foreignObject.setAttribute("overflow", "visible");
    foreignObject.querySelectorAll<HTMLElement>("div, span").forEach((element) => {
      element.style.overflow = "visible";
    });
  });
}

async function waitForFonts(): Promise<void> {
  if ("fonts" in document && document.fonts?.ready) {
    await document.fonts.ready;
  }
}

export function extractSvgString(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const bounds = getSvgExportBounds(svg);

  inlineComputedStyles(svg, clone);
  preserveForeignObjectOverflow(clone);

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xhtml", "http://www.w3.org/1999/xhtml");
  clone.setAttribute("width", String(bounds.width));
  clone.setAttribute("height", String(bounds.height));
  clone.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
  clone.setAttribute("overflow", "visible");

  return new XMLSerializer().serializeToString(clone);
}

export async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  await waitForFonts();

  const bounds = getSvgExportBounds(svg);
  const svgString = extractSvgString(svg);
  const width = bounds.width;
  const height = bounds.height;

  const base64 = btoa(
    Array.from(new TextEncoder().encode(svgString), (b) => String.fromCharCode(b)).join("")
  );
  const dataUrl = `data:image/svg+xml;base64,${base64}`;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load SVG as image"));
    image.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas 2d context");

  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to create PNG blob"))),
      "image/png"
    );
  });
}

export async function copySvgToClipboard(svg: SVGSVGElement): Promise<void> {
  const svgString = extractSvgString(svg);
  await navigator.clipboard.writeText(svgString);
  new Notice("SVG copied to clipboard");
}

export async function copyPngToClipboard(svg: SVGSVGElement): Promise<void> {
  const blob = await svgToPngBlob(svg);

  if (typeof ClipboardItem === "undefined" || !navigator.clipboard.write) {
    new Notice("PNG copy is not supported on this device — try SVG format in settings");
    return;
  }

  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": blob }),
  ]);
  new Notice("PNG copied to clipboard");
}
