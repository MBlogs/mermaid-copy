import {
  App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, setIcon,
} from "obsidian";
import {
  copyRasterToClipboard, copySvgToClipboard, extractSvgString, svgToRasterBlob, RasterMime,
} from "./export";

type CopyFormat = "png" | "svg" | "webp";

interface MermaidCopySettings {
  copyFormat: CopyFormat;
  scale: number;
  saveToVault: boolean;
}

const DEFAULT_SETTINGS: MermaidCopySettings = {
  copyFormat: "png",
  scale: 2,
  saveToVault: false,
};

const EXT_BY_FORMAT: Record<CopyFormat, string> = {
  png: "png",
  svg: "svg",
  webp: "webp",
};

const RASTER_MIME: Record<"png" | "webp", RasterMime> = {
  png: "image/png",
  webp: "image/webp",
};

export default class MermaidCopyPlugin extends Plugin {
  settings: MermaidCopySettings = DEFAULT_SETTINGS;
  observer: MutationObserver | null = null;
  debounceTimer: number | null = null;
  activeTimeouts: Set<number> = new Set();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MermaidCopySettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      this.processAll();
      this.startObserver();
    });
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleProcess()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleProcess()));
  }

  onunload() {
    this.observer?.disconnect();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const t of this.activeTimeouts) clearTimeout(t);
    this.activeTimeouts.clear();
    document.querySelectorAll(".mermaid-copy-btn").forEach((el) => el.remove());
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Refresh buttons in case icon/label needs to flip between copy and save modes.
    document.querySelectorAll(".mermaid-copy-btn").forEach((el) => el.remove());
    this.processAll();
  }

  startObserver() {
    const target = document.querySelector(".workspace");
    if (!target) return;
    this.observer = new MutationObserver(() => this.scheduleProcess());
    this.observer.observe(target, { childList: true, subtree: true });
  }

  scheduleProcess() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => this.processAll(), 300);
  }

  processAll() {
    document.querySelectorAll(".cm-embed-block.cm-lang-mermaid").forEach((block) => {
      if (block.querySelector(".mermaid-copy-btn")) return;
      if (!block.querySelector(".mermaid svg")) return;
      const editBtn = block.querySelector(".edit-block-button");
      if (!editBtn) return;

      const copyBtn = document.createElement("div");
      copyBtn.className = "edit-block-button mermaid-copy-btn";
      const saving = this.settings.saveToVault;
      copyBtn.setAttribute("aria-label", saving ? "Save diagram to vault" : "Copy diagram");
      setIcon(copyBtn, saving ? "save" : "copy");

      copyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const svg = block.querySelector(".mermaid svg") as SVGSVGElement | null;
        if (!svg) { new Notice("No diagram found"); return; }
        this.handleAction(svg)
          .then(() => {
            setIcon(copyBtn, "check");
            const t = window.setTimeout(() => {
              setIcon(copyBtn, this.settings.saveToVault ? "save" : "copy");
              this.activeTimeouts.delete(t);
            }, 2000);
            this.activeTimeouts.add(t);
          })
          .catch((err) => { new Notice("Failed"); console.error(err); });
      });

      editBtn.insertAdjacentElement("afterend", copyBtn);
    });
  }

  /* ---------- Action dispatcher ---------- */

  async handleAction(svg: SVGSVGElement): Promise<void> {
    if (this.settings.saveToVault) {
      await this.saveToVault(svg);
    } else {
      await this.copyToClipboard(svg);
    }
  }

  async copyToClipboard(svg: SVGSVGElement): Promise<void> {
    const { copyFormat, scale } = this.settings;
    if (copyFormat === "svg") {
      await copySvgToClipboard(svg);
    } else {
      await copyRasterToClipboard(svg, scale, RASTER_MIME[copyFormat]);
    }
  }

  /**
   * Write the diagram into the vault as an attachment and put a wiki link
   * onto the clipboard. The paste UX stays identical to the clipboard path:
   * you paste, and a short link lands wherever you wanted the embed.
   */
  async saveToVault(svg: SVGSVGElement): Promise<void> {
    const { copyFormat, scale } = this.settings;
    const ext = EXT_BY_FORMAT[copyFormat];
    const filename = `mermaid-${this.timestamp()}.${ext}`;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const sourcePath = view?.file?.path ?? "";
    const path = await this.app.fileManager.getAvailablePathForAttachment(filename, sourcePath);

    if (copyFormat === "svg") {
      const svgString = await extractSvgString(svg, true);
      await this.app.vault.create(path, svgString);
    } else {
      const blob = await svgToRasterBlob(svg, scale, RASTER_MIME[copyFormat]);
      const buf = await blob.arrayBuffer();
      await this.app.vault.createBinary(path, buf);
    }

    const created = this.app.vault.getAbstractFileByPath(path);
    let link = `![[${filename}]]`;
    if (created instanceof TFile && view?.file) {
      link = this.app.fileManager.generateMarkdownLink(created, view.file.path);
    }
    await navigator.clipboard.writeText(link);

    new Notice(`Saved ${filename} \u2014 link copied, paste to embed`);
  }

  timestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
}

class MermaidCopySettingTab extends PluginSettingTab {
  plugin: MermaidCopyPlugin;

  constructor(app: App, plugin: MermaidCopyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Format")
      .setDesc(
        "Image format for the copied or saved diagram. PNG and WebP are raster images; WebP is typically 25-35% smaller than PNG at equivalent quality. SVG is vector but its markup is large \u2014 if you want to use SVG, enable 'Save to vault' below so it's stored as a file rather than pasted inline."
      )
      .addDropdown((d) =>
        d.addOption("png", "PNG")
          .addOption("webp", "WebP")
          .addOption("svg", "SVG")
          .setValue(this.plugin.settings.copyFormat)
          .onChange(async (value) => {
            this.plugin.settings.copyFormat = value as CopyFormat;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Resolution")
      .setDesc(
        "Scale factor for raster output. Higher values produce sharper images on high-DPI displays at the cost of larger files. Has no effect on SVG."
      )
      .addDropdown((d) =>
        d.addOption("1", "1x (standard)")
          .addOption("2", "2x (retina)")
          .addOption("3", "3x (high)")
          .addOption("4", "4x (very high)")
          .setValue(String(this.plugin.settings.scale))
          .onChange(async (value) => {
            this.plugin.settings.scale = parseInt(value, 10) || 2;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Save to vault instead of clipboard")
      .setDesc(
        "When on, the button writes the image as an attachment in your vault and copies a wiki link to the clipboard. The paste UX is the same \u2014 you paste, and a short link lands wherever you want the embed. Keeps notes light, and is the practical way to use SVG. Default off."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.saveToVault)
          .onChange(async (value) => {
            this.plugin.settings.saveToVault = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
