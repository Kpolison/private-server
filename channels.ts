import type { PendingImage } from "./attachments";
import { TFile, TFolder, Vault } from "obsidian";

export const CHANNELS_ROOT = "Channels";
export interface Channel { name: string; path: string; }
export interface Group extends Channel { channels: Channel[]; }
export interface Category extends Channel { groups: Group[]; }
export interface SessionState {
  selectedPath: string | null;
  collapsedPaths: Set<string>;
  drafts: Map<string, string>;
  pendingImages: Map<string, PendingImage[]>;
}
export function isChannelPath(path: string): boolean {
  return path === CHANNELS_ROOT || path.startsWith(`${CHANNELS_ROOT}/`);
}
export function isChannelFile(file: unknown): file is TFile {
  return file instanceof TFile && file.extension.toLowerCase() === "md" &&
    file.path.split("/").length === 4 && isChannelPath(file.path);
}
function folders(parent: TFolder): TFolder[] {
  return parent.children.filter((child): child is TFolder => child instanceof TFolder)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
export function discoverCategories(vault: Vault): Category[] {
  const root = vault.getAbstractFileByPath(CHANNELS_ROOT);
  if (!(root instanceof TFolder)) return [];
  return folders(root).map(category => ({
    name: category.name, path: category.path,
    groups: folders(category).map(group => ({
      name: group.name, path: group.path,
      channels: group.children.filter(isChannelFile)
        .map(file => ({ name: file.basename, path: file.path }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    })),
  }));
}
export function remapPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  return path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : path;
}
