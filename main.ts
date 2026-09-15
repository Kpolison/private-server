import { Plugin } from "obsidian";
import { SessionState } from "./channels";
import { PrivateServerView, PRIVATE_SERVER_VIEW } from "./PrivateServerView";

export default class PrivateServerPlugin extends Plugin {
  private opening: Promise<void> | null = null;
  private session: SessionState = {
    selectedPath: null,
    collapsedPaths: new Set(),
    drafts: new Map(),
    pendingImages: new Map(),
  };

  onload(): void {
    this.registerView(PRIVATE_SERVER_VIEW, (leaf) => new PrivateServerView(leaf, this.session));
    const openPrivateServer = () => this.openView();
    this.addRibbonIcon("message-square", "Open Private Server", openPrivateServer);
    this.addCommand({
      id: "open-private-server",
      name: "Open Private Server",
      callback: openPrivateServer,
    });
  }

  private async openView(): Promise<void> {
    // Serialize rapid clicks while the first leaf is being initialized.
    if (this.opening) return this.opening;
    this.opening = this.revealView();
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
  }

  private async revealView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(PRIVATE_SERVER_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: PRIVATE_SERVER_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
}
