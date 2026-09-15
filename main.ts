import { Notice, Plugin } from "obsidian";

export default class PrivateServerPlugin extends Plugin {
  onload(): void {
    const openPrivateServer = () => {
      new Notice("Private Server is working.");
    };

    this.addRibbonIcon("message-square", "Open Private Server", openPrivateServer);
    this.addCommand({
      id: "open-private-server",
      name: "Open Private Server",
      callback: openPrivateServer,
    });
  }
}
