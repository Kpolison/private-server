import { TFolder, Vault } from "obsidian";

export const CHANNELS_ROOT = "Channels";

export interface Channel {
  name: string;
  path: string;
}

export interface Category extends Channel {
  channels: Channel[];
}

export interface SessionState {
  selectedPath: string | null;
  collapsedPaths: Set<string>;
}

export function isChannelPath(path: string): boolean {
  return path === CHANNELS_ROOT || path.startsWith(`${CHANNELS_ROOT}/`);
}

function folders(parent: TFolder): TFolder[] {
  return parent.children
    .filter((child): child is TFolder => child instanceof TFolder)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function discoverCategories(vault: Vault): Category[] {
  const root = vault.getAbstractFileByPath(CHANNELS_ROOT);
  if (!(root instanceof TFolder)) return [];

  return folders(root).map((category) => ({
    name: category.name,
    path: category.path,
    channels: folders(category).map(({ name, path }) => ({ name, path })),
  }));
}

// Preserve selection when a channel or its parent category is renamed/moved.
export function remapPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  return path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : path;
}
