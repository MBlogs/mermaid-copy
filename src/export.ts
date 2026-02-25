import { Notice } from "obsidian";

export function extractSvgString(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  if (!clone.getAttribute("width") || !clone.getAttribute("height")) {
    const bbox = svg.getBBox();
    clone.setAttribute("width", String(bbox.width));
    clone.setAttribute("height", String(bbox.height));
  }

  return new XMLSerializer().serializeToString(clone);
}

export async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const svgString = extractSvgString(svg);

  const width = parseFloat(svg.getAttribute("width") || String(svg.getBBox().width));
  const height = parseFloat(svg.getAttribute("height") || String(svg.getBBox().height));

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
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": blob }),
  ]);
  new Notice("PNG copied to clipboard");
}
