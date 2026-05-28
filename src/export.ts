import { Notice } from "obsidian";

/* ---------- Inline styles from the live cascade ---------- */

const PAINT_PROPS = [
  "fill", "fill-opacity",
  "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray",
  "stroke-linecap", "stroke-linejoin",
  "color", "opacity",
  "font-family", "font-size", "font-weight", "font-style",
  "text-anchor", "text-decoration",
];

function inlinePaint(live: Element, clone: Element): void {
  const computed = getComputedStyle(live);
  let inline = "";
  for (const prop of PAINT_PROPS) {
    const value = computed.getPropertyValue(prop);
    if (value) inline += `${prop}:${value};`;
  }
  const existing = clone.getAttribute("style");
  clone.setAttribute("style", inline + (existing ?? ""));

  const liveKids = live.children;
  const cloneKids = clone.children;
  const n = Math.min(liveKids.length, cloneKids.length);
  for (let i = 0; i < n; i++) inlinePaint(liveKids[i], cloneKids[i]);
}

function ancestorFilter(el: Element): string {
  let node: Element | null = el;
  while (node) {
    const f = getComputedStyle(node).filter;
    if (f && f !== "none") return f;
    node = node.parentElement;
  }
  return "none";
}

/* ---------- Font embedding ---------- */

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fontMime(url: string): string {
  const u = url.toLowerCase();
  if (u.includes(".woff2")) return "font/woff2";
  if (u.includes(".woff")) return "font/woff";
  if (u.includes(".ttf")) return "font/ttf";
  if (u.includes(".otf")) return "font/otf";
  return "application/octet-stream";
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, "").trim();
}

function usedFamilies(svg: SVGSVGElement): Set<string> {
  const generics = new Set([
    "serif", "sans-serif", "monospace", "cursive", "fantasy",
    "system-ui", "ui-monospace", "ui-sans-serif", "ui-serif", "emoji", "math",
  ]);
  const families = new Set<string>();
  const els: Element[] = [svg, ...Array.from(svg.querySelectorAll("text, tspan, p, span, div, foreignObject"))];
  for (const el of els) {
    const ff = getComputedStyle(el).fontFamily;
    if (!ff) continue;
    for (const token of ff.split(",")) {
      const name = stripQuotes(token);
      if (!name) continue;
      if (generics.has(name.toLowerCase())) continue;
      if (/^[?\s\uFFFD]+$/.test(name)) continue;
      families.add(name);
    }
  }
  return families;
}

async function embedSrc(src: string): Promise<string | null> {
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  let haveData = /url\(\s*['"]?data:/i.test(src);
  const jobs: { whole: string; url: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(src)) !== null) {
    if (!m[2].startsWith("data:")) jobs.push({ whole: m[0], url: m[2] });
  }
  let result = src;
  for (const job of jobs) {
    try {
      const res = await fetch(job.url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      result = result.replace(job.whole, `url("data:${fontMime(job.url)};base64,${b64}")`);
      haveData = true;
    } catch (e) {
      console.warn("mermaid-copy: could not fetch font", job.url, e);
    }
  }
  return haveData ? result : null;
}

async function buildFontFaceCss(families: Set<string>): Promise<string> {
  if (families.size === 0) return "";
  const wanted = new Set(Array.from(families).map((f) => f.toLowerCase()));
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = stripQuotes(rule.style.getPropertyValue("font-family"));
      if (!wanted.has(family.toLowerCase())) continue;
      const src = rule.style.getPropertyValue("src");
      if (!src) continue;
      const embedded = await embedSrc(src);
      if (!embedded) continue;
      const weight = rule.style.getPropertyValue("font-weight") || "normal";
      const style = rule.style.getPropertyValue("font-style") || "normal";
      out.push(`@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:${embedded};}`);
    }
  }
  return out.join("");
}

/* ---------- Padding for rasteriser layout drift ---------- */

function padNodeHeights(clone: SVGSVGElement, pad = 8): void {
  for (const node of Array.from(clone.querySelectorAll("g.node"))) {
    const rect = node.querySelector(":scope > rect") as SVGRectElement | null;
    if (rect) {
      const h = parseFloat(rect.getAttribute("height") || "0");
      const y = parseFloat(rect.getAttribute("y") || "0");
      rect.setAttribute("height", String(h + pad));
      rect.setAttribute("y", String(y - pad / 2));
    }
    const fo = node.querySelector("foreignObject") as SVGForeignObjectElement | null;
    if (fo) {
      const h = parseFloat(fo.getAttribute("height") || "0");
      fo.setAttribute("height", String(h + pad));
      const labelG = fo.parentElement as Element | null;
      if (labelG && labelG.nodeName.toLowerCase() === "g") {
        const t = labelG.getAttribute("transform") || "";
        const m = t.match(/translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
        if (m) {
          const tx = parseFloat(m[1]);
          const ty = parseFloat(m[2]);
          labelG.setAttribute("transform", t.replace(m[0], `translate(${tx}, ${ty - pad / 2})`));
        }
      }
    }
  }
  const vb = clone.getAttribute("viewBox");
  if (vb) {
    const p = vb.split(/\s+/).map(parseFloat);
    if (p.length === 4) {
      p[1] -= pad / 2;
      p[3] += pad;
      clone.setAttribute("viewBox", p.join(" "));
    }
  }
  const h = clone.getAttribute("height");
  if (h) clone.setAttribute("height", String(parseFloat(h) + pad));
}

/* ---------- Public export API ---------- */

export type RasterMime = "image/png" | "image/webp";

export async function extractSvgString(svg: SVGSVGElement, bakeFilter = false): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  inlinePaint(svg, clone);

  const fontCss = await buildFontFaceCss(usedFamilies(svg));
  if (fontCss) {
    const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.textContent = fontCss;
    clone.insertBefore(styleEl, clone.firstChild);
  }

  padNodeHeights(clone);

  if (bakeFilter) {
    const filter = ancestorFilter(svg);
    if (filter !== "none") clone.style.setProperty("filter", filter, "important");
  }

  if (!clone.getAttribute("width") || !clone.getAttribute("height")) {
    const bbox = svg.getBBox();
    clone.setAttribute("width", String(bbox.width));
    clone.setAttribute("height", String(bbox.height));
  }

  return new XMLSerializer().serializeToString(clone);
}

/**
 * Rasterise to PNG or WebP. The MIME determines the output format only;
 * everything else (font embedding, filter replay, scale handling) is shared.
 */
export async function svgToRasterBlob(
  svg: SVGSVGElement,
  scale: number,
  mimeType: RasterMime,
): Promise<Blob> {
  const svgString = await extractSvgString(svg, false);

  const width = parseFloat(svg.getAttribute("width") || String(svg.getBBox().width));
  const height = parseFloat(svg.getAttribute("height") || String(svg.getBBox().height)) + 8;

  const base64 = btoa(
    Array.from(new TextEncoder().encode(svgString), (b) => String.fromCharCode(b)).join("")
  );
  const dataUrl = `data:image/svg+xml;base64,${base64}`;

  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas 2d context");

  const filter = ancestorFilter(svg);
  if (filter !== "none") ctx.filter = filter;

  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);

  // For WebP, request lossless quality to keep crisp edges on diagram lines.
  const quality = mimeType === "image/webp" ? 1.0 : undefined;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Failed to create ${mimeType} blob`))),
      mimeType,
      quality,
    );
  });
}

export async function copySvgToClipboard(svg: SVGSVGElement): Promise<void> {
  const svgString = await extractSvgString(svg, true);
  await navigator.clipboard.writeText(svgString);
  new Notice("SVG copied to clipboard");
}

export async function copyRasterToClipboard(
  svg: SVGSVGElement,
  scale: number,
  mimeType: RasterMime,
): Promise<void> {
  const blob = await svgToRasterBlob(svg, scale, mimeType);

  if (typeof ClipboardItem === "undefined" || !navigator.clipboard.write) {
    new Notice("Image copy is not supported on this device \u2014 try SVG, or enable Save to vault");
    return;
  }

  try {
    await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
    const label = mimeType === "image/webp" ? "WebP" : "PNG";
    new Notice(`${label} copied to clipboard`);
  } catch (err) {
    if (mimeType === "image/webp") {
      new Notice("WebP clipboard not supported here \u2014 switch format to PNG, or enable Save to vault");
      return;
    }
    throw err;
  }
}
