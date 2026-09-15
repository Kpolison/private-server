import { Component, ItemView, Notice, Platform, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { Category, discoverCategories, isChannelFile, isChannelPath, remapPath, SessionState } from "./channels";
import { CreateChannelModal } from "./CreateChannelModal";
import { parseChannel, sendMessage } from "./messages";

export const PRIVATE_SERVER_VIEW = "private-server-view";

export class PrivateServerView extends ItemView {
  private categories: Category[] = [];
  private sidebar!: HTMLElement;
  private heading!: HTMLElement;
  private feed!: HTMLElement;
  private composer!: HTMLFormElement;
  private input!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private eventScope: Component | null = null;
  private refreshQueued = false;
  private selectedFile: TFile | null = null;
  private readVersion = 0;
  private writable = false;
  private sending = false;

  constructor(leaf: WorkspaceLeaf, private session: SessionState) { super(leaf); }
  getViewType(): string { return PRIVATE_SERVER_VIEW; }
  getDisplayText(): string { return "Private Server"; }
  getIcon(): string { return "message-square"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("private-server-view");
    this.contentEl.createEl("header", { cls: "private-server-server-header", text: "Personal Discord Server" });
    const layout = this.contentEl.createDiv("private-server-layout");
    this.sidebar = layout.createEl("nav", { cls: "private-server-sidebar", attr: { "aria-label": "Channels" } });
    const main = layout.createEl("section", { cls: "private-server-main" });
    this.heading = main.createEl("h2", { cls: "private-server-channel-header" });
    this.feed = main.createDiv({ cls: "private-server-feed", attr: { role: "log", "aria-label": "Messages", tabindex: "0" } });
    this.composer = main.createEl("form", { cls: "private-server-composer" });
    this.input = this.composer.createEl("textarea", { attr: { rows: "3", "aria-label": "Message" } });
    const actions = this.composer.createDiv("private-server-composer-actions");
    actions.createSpan({ cls: "private-server-hint", text: Platform.isMobile ? "Text messages" : "Enter to send · Shift+Enter for a newline" });
    this.sendButton = actions.createEl("button", { text: "Send", attr: { type: "submit" } });
    this.composer.onsubmit = event => { event.preventDefault(); void this.send(); };
    this.input.oninput = () => {
      if (this.selectedFile) this.session.drafts.set(this.selectedFile.path, this.input.value);
      this.updateComposer();
    };
    this.input.onkeydown = event => {
      if (!Platform.isMobile && event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault(); void this.send();
      }
    };

    const scope = this.addChild(new Component());
    this.eventScope = scope;
    const { vault } = this.app;
    scope.registerEvent(vault.on("create", file => { if (isChannelPath(file.path)) this.queueRefresh(); }));
    scope.registerEvent(vault.on("delete", file => { if (isChannelPath(file.path)) this.queueRefresh(); }));
    scope.registerEvent(vault.on("rename", (file, oldPath) => {
      if (!(isChannelPath(file.path) || isChannelPath(oldPath))) return;
      if (this.session.selectedPath) this.session.selectedPath = remapPath(this.session.selectedPath, oldPath, file.path);
      this.session.collapsedPaths = new Set([...this.session.collapsedPaths].map(path => remapPath(path, oldPath, file.path)));
      this.session.drafts = new Map([...this.session.drafts].map(([path, text]) => [remapPath(path, oldPath, file.path), text]));
      this.queueRefresh();
    }));
    scope.registerEvent(vault.on("modify", file => {
      if (file === this.selectedFile) void this.loadFeed(false);
    }));
    this.refresh();
    this.app.workspace.onLayoutReady(() => { if (this.eventScope === scope) this.refresh(); });
  }

  async onClose(): Promise<void> {
    if (this.eventScope) this.removeChild(this.eventScope);
    this.eventScope = null;
    this.readVersion++;
    this.selectedFile = null;
    this.contentEl.empty();
    this.contentEl.removeClass("private-server-view");
  }

  private queueRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => { this.refreshQueued = false; if (this.eventScope) this.refresh(); });
  }

  private refresh(): void {
    this.categories = discoverCategories(this.app.vault);
    const channels = this.categories.flatMap(category => category.groups.flatMap(group => group.channels));
    if (!channels.some(channel => channel.path === this.session.selectedPath)) this.session.selectedPath = channels[0]?.path ?? null;
    this.renderSidebar();
    this.selectCurrent();
  }

  private renderSidebar(): void {
    const scrollTop = this.sidebar.scrollTop;
    const active = this.contentEl.ownerDocument.activeElement;
    const focusKey = active && this.sidebar.contains(active) ? active.getAttribute("data-key") : null;
    this.sidebar.empty();
    let restoreFocus: HTMLButtonElement | undefined;
    const button = (parent: HTMLElement, name: string, cls: string, key: string, action: () => void): HTMLButtonElement => {
      const el = parent.createEl("button", { text: name, cls, attr: { type: "button", "data-key": key } });
      el.onclick = action;
      if (key === focusKey) restoreFocus = el;
      return el;
    };
    for (const category of this.categories) {
      const section = this.sidebar.createEl("section", { cls: "private-server-category" });
      section.createEl("h3", { cls: "private-server-category-label", text: category.name });
      for (const group of category.groups) {
        const collapsed = this.session.collapsedPaths.has(group.path);
        const row = section.createDiv("private-server-group-row");
        const toggle = button(row, `${collapsed ? "›" : "⌄"} ${group.name}`, "private-server-group-toggle", group.path, () => {
          if (collapsed) this.session.collapsedPaths.delete(group.path);
          else this.session.collapsedPaths.add(group.path);
          this.renderSidebar();
        });
        toggle.setAttribute("aria-expanded", String(!collapsed));
        const add = button(row, "+", "private-server-add-channel", `add:${group.path}`, () => {
          const folder = this.app.vault.getAbstractFileByPath(group.path);
          if (!(folder instanceof TFolder)) { new Notice("This group no longer exists."); return; }
          new CreateChannelModal(this.app, folder, file => {
            this.session.collapsedPaths.delete(file.parent?.path ?? group.path);
            this.session.selectedPath = file.path;
            if (this.eventScope) this.refresh();
          }).open();
        });
        add.setAttribute("aria-label", `Create channel in ${group.name}`);
        add.setAttribute("title", `Create channel in ${group.name}`);
        if (collapsed) continue;
        if (!group.channels.length) section.createEl("p", { cls: "private-server-hint private-server-group-empty", text: "No channels yet. Use + to create one." });
        for (const channel of group.channels) {
          const selected = channel.path === this.session.selectedPath;
          const el = button(section, `# ${channel.name}`, `private-server-channel${selected ? " private-server-channel-selected" : ""}`, channel.path, () => {
            this.session.selectedPath = channel.path;
            this.renderSidebar(); this.selectCurrent();
          });
          el.setAttribute("aria-pressed", String(selected));
        }
      }
      if (!category.groups.length) section.createEl("p", { cls: "private-server-hint", text: "No groups yet." });
    }
    if (!this.categories.length) this.sidebar.createEl("p", { cls: "private-server-hint", text: "No categories found in Channels." });
    restoreFocus?.focus({ preventScroll: true });
    this.sidebar.scrollTop = scrollTop;
  }

  private selectCurrent(): void {
    const file = this.session.selectedPath ? this.app.vault.getAbstractFileByPath(this.session.selectedPath) : null;
    const selected = isChannelFile(file) ? file : null;
    const changed = this.selectedFile !== selected;
    this.selectedFile = selected;
    this.heading.setText(selected ? `# ${selected.basename}` : "No channel selected");
    this.input.placeholder = selected ? `Message #${selected.basename}` : "Select a channel";
    if (changed) this.input.value = selected ? this.session.drafts.get(selected.path) ?? "" : "";
    void this.loadFeed(changed);
  }

  private updateComposer(): void {
    this.composer.hidden = !this.selectedFile;
    this.input.disabled = !this.writable || this.sending;
    this.sendButton.disabled = !this.writable || this.sending || !this.input.value.trim();
    this.sendButton.setText(this.sending ? "Sending…" : "Send");
  }

  private async loadFeed(scrollToEnd: boolean): Promise<void> {
    const file = this.selectedFile;
    const version = ++this.readVersion;
    this.writable = false;
    this.updateComposer();
    if (!file) {
      this.feed.empty();
      this.feed.createEl("p", { cls: "private-server-empty", text: "Create a channel using the + button beside a group." });
      return;
    }
    const wasAtBottom = this.feed.scrollHeight - this.feed.scrollTop - this.feed.clientHeight < 64;
    const previousScroll = this.feed.scrollTop;
    if (scrollToEnd) { this.feed.empty(); this.feed.createEl("p", { text: "Loading messages…", cls: "private-server-hint" }); }
    try {
      const source = await this.app.vault.read(file);
      if (!this.eventScope || version !== this.readVersion || file !== this.selectedFile) return;
      const document = parseChannel(source);
      this.writable = document.writable;
      this.feed.empty();
      if (!document.writable) {
        this.feed.createEl("p", { cls: "private-server-empty", text: document.reason });
        this.feed.createEl("pre", { cls: "private-server-message-body", text: source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "") });
      } else if (!document.messages.length) {
        this.feed.createEl("p", { cls: "private-server-empty", text: `No messages yet.\nStart the conversation in #${file.basename}.` });
      } else {
        for (const message of document.messages) {
          const article = this.feed.createEl("article", { cls: "private-server-message" });
          const meta = article.createDiv("private-server-message-meta");
          meta.createSpan({ cls: "private-server-author", text: "Kyle" });
          meta.createEl("time", {
            cls: "private-server-timestamp",
            text: new Date(message.timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
            attr: { datetime: message.timestamp, title: message.timestamp },
          });
          article.createDiv({ cls: "private-server-message-body", text: message.body });
        }
      }
      this.feed.scrollTop = scrollToEnd || wasAtBottom ? this.feed.scrollHeight : previousScroll;
    } catch (cause) {
      if (!this.eventScope || version !== this.readVersion) return;
      this.feed.empty();
      this.feed.createEl("p", { cls: "private-server-empty", text: "Could not read this channel. Select it again to retry. Your draft is preserved." });
      new Notice(cause instanceof Error ? cause.message : "Could not read channel.");
    } finally {
      if (this.eventScope && version === this.readVersion) this.updateComposer();
    }
  }

  private async send(): Promise<void> {
    const file = this.selectedFile;
    const body = this.input.value;
    if (!file || !this.writable || this.sending || !body.trim()) return;
    this.session.drafts.set(file.path, body);
    this.sending = true; this.updateComposer();
    try {
      await sendMessage(this.app.vault, file, body);
      if (this.session.drafts.get(file.path) === body) this.session.drafts.delete(file.path);
      if (this.eventScope && this.selectedFile === file) {
        this.input.value = "";
        await this.loadFeed(true);
      }
    } catch (cause) {
      new Notice(`Message not sent. Your draft is preserved. ${cause instanceof Error ? cause.message : "Please try again."}`);
    } finally {
      this.sending = false;
      if (this.eventScope) { this.updateComposer(); if (this.selectedFile === file && this.writable) this.input.focus(); }
    }
  }
}
