import { Component, ItemView, Modal, Notice, Platform, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { Category, discoverCategories, isChannelFile, isChannelPath, remapPath, SessionState } from "./channels";
import { CreateChannelModal } from "./CreateChannelModal";
import { parseChannel } from "./messages";
import { MAX_PENDING_IMAGES, PendingImage, prepareImage, sendWithImages } from "./attachments";

import { MobileLayout } from "./MobileLayout";

export const PRIVATE_SERVER_VIEW = "private-server-view";

export class PrivateServerView extends ItemView {
  private mobileLayout: MobileLayout | null = null;
  private categories: Category[] = [];
  private sidebar!: HTMLElement;
  private heading!: HTMLElement;
  private feed!: HTMLElement;
  private composer!: HTMLFormElement;
  private input!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private imageButton!: HTMLButtonElement;
  private imagePicker!: HTMLInputElement;
  private previews!: HTMLElement;
  private previewUrls: string[] = [];
  private addingImages = false;
  private pickerChannel: TFile | null = null;
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
    const header = Platform.isMobile ? main.createDiv("private-server-mobile-header") : main;
    if (Platform.isMobile) this.mobileLayout = this.addChild(new MobileLayout(this.contentEl, layout, this.sidebar, main, header));
    this.heading = header.createEl("h2", { cls: "private-server-channel-header" });
    this.feed = main.createDiv({ cls: "private-server-feed", attr: { role: "log", "aria-label": "Messages", tabindex: "0" } });
    this.composer = main.createEl("form", { cls: "private-server-composer" });
    this.previews = this.composer.createDiv({ cls: "private-server-pending-images", attr: { "aria-label": "Pending images" } });
    this.imagePicker = this.composer.createEl("input", { cls: "private-server-image-picker", attr: {
      type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", multiple: "true", tabindex: "-1", "aria-label": "Choose images",
    } });
    this.imagePicker.hidden = true;
    this.imagePicker.onchange = () => {
      const files = Array.from(this.imagePicker.files ?? []);
      this.imagePicker.value = "";
      void this.addImages(files, this.pickerChannel);
    };
    const row = Platform.isMobile ? this.composer.createDiv("private-server-composer-row") : this.composer;
    this.input = row.createEl("textarea", { attr: { rows: Platform.isMobile ? "1" : "3", "aria-label": "Message" } });
    const actions = Platform.isMobile ? row : this.composer.createDiv("private-server-composer-actions");
    this.imageButton = actions.createEl("button", { cls: "private-server-attach-button", text: Platform.isMobile ? "+" : "Add images", attr: { type: "button", "aria-label": "Add images", title: "Add images" } });
    if (Platform.isMobile) row.insertBefore(this.imageButton, this.input);
    this.imageButton.onclick = () => {
      this.pickerChannel = this.selectedFile;
      this.imagePicker.click();
    };
    if (!Platform.isMobile) actions.createSpan({ cls: "private-server-hint", text: "Enter to send · Shift+Enter for a newline" });
    this.sendButton = actions.createEl("button", { cls: "private-server-send-button", text: Platform.isMobile ? "➤" : "Send", attr: { type: "submit", "aria-label": "Send message", title: "Send message" } });
    this.composer.onsubmit = event => { event.preventDefault(); void this.send(); };
    this.input.onpaste = event => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter(item => item.kind === "file").map(item => item.getAsFile()).filter((file): file is File => file !== null);
      if (files.length) {
        event.preventDefault();
        void this.addImages(files, this.selectedFile);
      }
    };
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
    scope.registerEvent(vault.on("create", file => {
      if (isChannelPath(file.path)) this.queueRefresh();
      else if (file.path.startsWith("Attachments/") && this.selectedFile) void this.loadFeed(false);
    }));
    scope.registerEvent(vault.on("delete", file => { if (isChannelPath(file.path)) this.queueRefresh(); }));
    scope.registerEvent(vault.on("rename", (file, oldPath) => {
      if (!(isChannelPath(file.path) || isChannelPath(oldPath))) return;
      if (this.session.selectedPath) this.session.selectedPath = remapPath(this.session.selectedPath, oldPath, file.path);
      this.session.collapsedPaths = new Set([...this.session.collapsedPaths].map(path => remapPath(path, oldPath, file.path)));
      this.session.pendingImages = new Map([...this.session.pendingImages].map(([path, images]) => [remapPath(path, oldPath, file.path), images]));
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
    if (this.mobileLayout) this.removeChild(this.mobileLayout);
    this.mobileLayout = null;
    if (this.eventScope) this.removeChild(this.eventScope);
    this.eventScope = null;
    this.readVersion++;
    this.clearPreviewUrls();
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
            if (this.eventScope) { this.refresh(); this.mobileLayout?.close(); }
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
            this.renderSidebar(); this.selectCurrent(); this.mobileLayout?.close();
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
    this.renderPreviews();
    void this.loadFeed(changed);
  }

  private updateComposer(): void {
    this.composer.hidden = !this.selectedFile;
    this.input.disabled = !this.writable || this.sending;
    this.imageButton.disabled = !this.writable || this.sending || this.addingImages;
    this.sendButton.disabled = !this.writable || this.sending || this.addingImages || (!this.input.value.trim() && !this.pendingImages().length);
    this.sendButton.setText(this.sending ? (Platform.isMobile ? "…" : "Sending…") : (Platform.isMobile ? "➤" : "Send"));
    this.mobileLayout?.resizeComposer(this.input, this.feed);
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
          for (const part of message.parts) {
            if (part.type === "text") {
              if (part.text.trim()) article.createDiv({ cls: "private-server-message-body", text: part.text });
              continue;
            }
            const attachment = this.app.vault.getAbstractFileByPath(part.path);
            if (!(attachment instanceof TFile)) {
              article.createEl("p", { cls: "private-server-hint", text: `Image unavailable: ${part.path}` });
              continue;
            }
            const url = this.app.vault.getResourcePath(attachment);
            const open = article.createEl("button", { cls: "private-server-feed-image", attr: { type: "button", "aria-label": `Open ${attachment.name}` } });
            const image = open.createEl("img", { attr: { src: url, alt: attachment.name, loading: "lazy" } });
            image.onload = () => {
              if (this.eventScope && version === this.readVersion && (scrollToEnd || wasAtBottom)) this.feed.scrollTop = this.feed.scrollHeight;
            };
            image.onerror = () => { image.alt = `Image unavailable: ${attachment.name}`; };
            open.onclick = () => {
              const modal = new Modal(this.app);
              modal.contentEl.addClass("private-server-image-modal");
              modal.contentEl.createEl("img", { attr: { src: url, alt: attachment.name } });
              modal.open();
            };
          }
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

  private pendingImages(): PendingImage[] {
    return this.selectedFile ? this.session.pendingImages.get(this.selectedFile.path) ?? [] : [];
  }

  private clearPreviewUrls(): void {
    for (const url of this.previewUrls) URL.revokeObjectURL(url);
    this.previewUrls = [];
  }

  private renderPreviews(): void {
    this.clearPreviewUrls();
    this.previews.empty();
    for (const image of this.pendingImages()) {
      const url = URL.createObjectURL(image.blob);
      this.previewUrls.push(url);
      const item = this.previews.createDiv("private-server-pending-image");
      item.createEl("img", { attr: { src: url, alt: image.name } });
      const remove = item.createEl("button", { text: Platform.isMobile ? "×" : "Remove", attr: { type: "button", "aria-label": `Remove ${image.name}`, title: `Remove ${image.name}` } });
      remove.disabled = this.sending;
      remove.onclick = () => {
        if (!this.selectedFile || this.sending) return;
        this.session.pendingImages.set(this.selectedFile.path, this.pendingImages().filter(entry => entry.id !== image.id));
        this.renderPreviews(); this.updateComposer();
      };
    }
  }

  private async addImages(files: File[], channel: TFile | null): Promise<void> {
    if (!channel || this.sending || this.addingImages || !this.writable) return;
    this.addingImages = true; this.updateComposer();
    try {
      for (const file of files) {
        if ((this.session.pendingImages.get(channel.path) ?? []).length >= MAX_PENDING_IMAGES) {
          new Notice("Attach up to 10 images per message."); break;
        }
        try {
          const image = await prepareImage(file);
          if (!isChannelFile(channel) || this.app.vault.getAbstractFileByPath(channel.path) !== channel) {
            new Notice("The channel no longer exists. Choose a channel and add the images again."); break;
          }
          this.session.pendingImages.set(channel.path, [...this.session.pendingImages.get(channel.path) ?? [], image]);
        } catch (cause) { new Notice(cause instanceof Error ? cause.message : "Could not add image."); }
      }
    } finally {
      this.addingImages = false;
      if (this.eventScope) { this.renderPreviews(); this.updateComposer(); }
    }
  }

  private async send(): Promise<void> {
    const file = this.selectedFile;
    const body = this.input.value;
    const images = [...this.pendingImages()];
    if (!file || !this.writable || this.sending || this.addingImages || (!body.trim() && !images.length)) return;
    this.session.drafts.set(file.path, body);
    this.sending = true; this.updateComposer(); this.renderPreviews();
    try {
      await sendWithImages(this.app.vault, file, body, images);
      const sentIds = new Set(images.map(image => image.id));
      const remaining = (this.session.pendingImages.get(file.path) ?? []).filter(image => !sentIds.has(image.id));
      if (remaining.length) this.session.pendingImages.set(file.path, remaining);
      else this.session.pendingImages.delete(file.path);
      if (this.session.drafts.get(file.path) === body) this.session.drafts.delete(file.path);
      if (this.eventScope && this.selectedFile === file) {
        this.input.value = "";
        this.renderPreviews();
        await this.loadFeed(true);
      }
    } catch (cause) {
      new Notice(`Message not sent. Your draft is preserved. ${cause instanceof Error ? cause.message : "Please try again."}`);
    } finally {
      this.sending = false;
      if (this.eventScope) { this.renderPreviews(); this.updateComposer(); if (!Platform.isMobile && this.selectedFile === file && this.writable) this.input.focus(); }
    }
  }
}
