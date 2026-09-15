import { Component, ItemView, TFolder, WorkspaceLeaf } from "obsidian";
import { Category, discoverCategories, isChannelPath, remapPath, SessionState } from "./channels";

export const PRIVATE_SERVER_VIEW = "private-server-view";

export class PrivateServerView extends ItemView {
  private categories: Category[] = [];
  private sidebar!: HTMLElement;
  private heading!: HTMLElement;
  private emptyState!: HTMLElement;
  private eventScope: Component | null = null;
  private refreshQueued = false;

  constructor(leaf: WorkspaceLeaf, private session: SessionState) {
    super(leaf);
  }

  getViewType(): string { return PRIVATE_SERVER_VIEW; }
  getDisplayText(): string { return "Private Server"; }
  getIcon(): string { return "message-square"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("private-server-view");
    this.contentEl.createEl("header", {
      cls: "private-server-server-header", text: "Personal Discord Server",
    });
    const layout = this.contentEl.createDiv("private-server-layout");
    this.sidebar = layout.createEl("nav", {
      cls: "private-server-sidebar", attr: { "aria-label": "Channels" },
    });
    const main = layout.createEl("section", { cls: "private-server-main" });
    this.heading = main.createEl("h2", { cls: "private-server-channel-header" });
    this.emptyState = main.createEl("p", {
      cls: "private-server-empty", attr: { "aria-live": "polite" },
    });

    const scope = this.addChild(new Component());
    this.eventScope = scope;
    const { vault } = this.app;
    scope.registerEvent(vault.on("create", (file) => {
      if (file instanceof TFolder && isChannelPath(file.path)) this.queueRefresh();
    }));
    scope.registerEvent(vault.on("delete", (file) => {
      if (file instanceof TFolder && isChannelPath(file.path)) this.queueRefresh();
    }));
    scope.registerEvent(vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFolder) || !(isChannelPath(file.path) || isChannelPath(oldPath))) return;
      if (this.session.selectedPath) {
        this.session.selectedPath = remapPath(this.session.selectedPath, oldPath, file.path);
      }
      this.session.collapsedPaths = new Set([...this.session.collapsedPaths]
        .map((path) => remapPath(path, oldPath, file.path)));
      this.queueRefresh();
    }));
    this.refresh();
    this.app.workspace.onLayoutReady(() => {
      if (this.eventScope === scope) this.refresh();
    });
  }

  async onClose(): Promise<void> {
    if (this.eventScope) this.removeChild(this.eventScope);
    this.eventScope = null;
    this.contentEl.empty();
    this.contentEl.removeClass("private-server-view");
  }

  private queueRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      if (this.eventScope) this.refresh();
    });
  }

  private refresh(): void {
    this.categories = discoverCategories(this.app.vault);
    const channels = this.categories.flatMap((category) => category.channels);
    if (!channels.some((channel) => channel.path === this.session.selectedPath)) {
      this.session.selectedPath = channels[0]?.path ?? null;
    }
    const categoryPaths = new Set(this.categories.map((category) => category.path));
    for (const path of this.session.collapsedPaths) {
      if (!categoryPaths.has(path)) this.session.collapsedPaths.delete(path);
    }
    this.renderSidebar();
    this.renderContent();
  }

  private renderSidebar(): void {
    const scrollTop = this.sidebar.scrollTop;
    const active = this.contentEl.ownerDocument.activeElement;
    const focusKey = active && this.sidebar.contains(active) ? active.getAttribute("data-key") : null;
    this.sidebar.empty();
    let restoreFocus: HTMLButtonElement | undefined;
    for (const category of this.categories) {
      const section = this.sidebar.createEl("section", { cls: "private-server-category" });
      const collapsed = this.session.collapsedPaths.has(category.path);
      const toggle = section.createEl("button", {
        cls: "private-server-category-toggle",
        attr: { type: "button", "aria-expanded": String(!collapsed), "data-key": category.path },
      });
      toggle.createSpan({ cls: "private-server-chevron", text: collapsed ? "›" : "⌄", attr: { "aria-hidden": "true" } });
      toggle.createSpan({ text: category.name });
      if (focusKey === category.path) restoreFocus = toggle;
      toggle.onclick = () => {
        if (collapsed) this.session.collapsedPaths.delete(category.path);
        else this.session.collapsedPaths.add(category.path);
        this.renderSidebar();
      };
      if (collapsed) continue;
      if (!category.channels.length) section.createEl("p", { cls: "private-server-hint", text: "No channels yet." });
      for (const channel of category.channels) {
        const selected = channel.path === this.session.selectedPath;
        const button = section.createEl("button", {
          cls: `private-server-channel${selected ? " private-server-channel-selected" : ""}`,
          attr: { type: "button", "aria-pressed": String(selected), "data-key": channel.path },
        });
        button.createSpan({ cls: "private-server-hash", text: "#", attr: { "aria-hidden": "true" } });
        button.createSpan({ text: channel.name });
        if (focusKey === channel.path) restoreFocus = button;
        button.onclick = () => {
          this.session.selectedPath = channel.path;
          this.renderSidebar();
          this.renderContent();
        };
      }
    }
    if (!this.categories.length) {
      this.sidebar.createEl("p", { cls: "private-server-hint", text: "No categories found in Channels." });
    }
    restoreFocus?.focus({ preventScroll: true });
    this.sidebar.scrollTop = scrollTop;
  }

  private renderContent(): void {
    const channel = this.categories.flatMap((category) => category.channels)
      .find((entry) => entry.path === this.session.selectedPath);
    this.heading.setText(channel ? `# ${channel.name}` : "No channels available");
    this.emptyState.setText(channel ? "This channel is empty." : "Channels will appear here from Channels / Category / Channel folders.");
  }
}
