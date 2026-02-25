import { Plugin, PluginSettingTab, App, Setting, Notice, setIcon } from "obsidian";
import { copyPngToClipboard, copySvgToClipboard } from "./export";

type CopyFormat = "png" | "svg";

interface MermaidCopySettings {
  copyFormat: CopyFormat;
}

const DEFAULT_SETTINGS: MermaidCopySettings = {
  copyFormat: "png",
};

export default class MermaidCopyPlugin extends Plugin {
  settings: MermaidCopySettings = DEFAULT_SETTINGS;
  private observer: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MermaidCopySettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.processAll();
      this.startObserver();
    });

    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.scheduleProcess())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.scheduleProcess())
    );
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
  }

  private startObserver(): void {
    const target = document.querySelector(".workspace");
    if (!target) return;

    this.observer = new MutationObserver(() => this.scheduleProcess());
    this.observer.observe(target, { childList: true, subtree: true });
  }

  private scheduleProcess(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.processAll(), 300);
  }

  private processAll(): void {
    document.querySelectorAll(".cm-embed-block.cm-lang-mermaid").forEach((block) => {
      if (block.querySelector(".mermaid-copy-btn")) return;
      if (!block.querySelector(".mermaid svg")) return;

      const editBtn = block.querySelector<HTMLElement>(".edit-block-button");
      if (!editBtn) return;

      const copyBtn = document.createElement("div");
      copyBtn.className = "edit-block-button mermaid-copy-btn";
      copyBtn.setAttribute("aria-label", "Copy diagram");
      setIcon(copyBtn, "copy");

      copyBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const svg = block.querySelector<SVGSVGElement>(".mermaid svg");
        if (!svg) {
          new Notice("No diagram found");
          return;
        }
        try {
          if (this.settings.copyFormat === "svg") {
            await copySvgToClipboard(svg);
          } else {
            await copyPngToClipboard(svg);
          }
          setIcon(copyBtn, "check");
          const t = setTimeout(() => {
            setIcon(copyBtn, "copy");
            this.activeTimeouts.delete(t);
          }, 2000);
          this.activeTimeouts.add(t);
        } catch (err) {
          new Notice("Failed to copy diagram");
          console.error(err);
        }
      });

      editBtn.insertAdjacentElement("afterend", copyBtn);
    });
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
      .setName("Copy format")
      .setDesc("Choose whether the copy button copies the diagram as PNG or SVG.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("png", "PNG (image)")
          .addOption("svg", "SVG (markup)")
          .setValue(this.plugin.settings.copyFormat)
          .onChange(async (value) => {
            this.plugin.settings.copyFormat = value as CopyFormat;
            await this.plugin.saveSettings();
          })
      );
  }
}
