import { parseYaml, TFile, TFolder, Vault } from "obsidian";
import { isChannelFile, isChannelPath } from "./channels";

export const CHANNEL_TEMPLATE = "---\nprivate-server-channel: true\nprivate-server-format: 1\n---\n";
export interface Message { timestamp: string; body: string; }
export interface ChannelDocument { writable: boolean; messages: Message[]; reason?: string; }
const timestampPattern = /^## (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/;

export function parseChannel(source: string): ChannelDocument {
  const text = source.replace(/\r\n/g, "\n");
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  const reject = (reason: string): ChannelDocument => ({ writable: false, messages: [], reason });
  if (!frontmatter) return reject("Read-only: this file is not marked as a Private Server channel.");
  try {
    const metadata = parseYaml(frontmatter[1] ?? "");
    if (metadata?.["private-server-channel"] !== true || metadata?.["private-server-format"] !== 1) {
      return reject("Read-only: this file does not use the supported Private Server channel format.");
    }
  } catch { return reject("Read-only: this file has invalid channel metadata."); }
  const lines = text.slice(frontmatter[0].length).split("\n");
  const messages: Message[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index] === "") { index++; continue; }
    const match = timestampPattern.exec(lines[index] ?? "");
    const timestamp = match?.[1];
    if (!timestamp || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
      return reject("Read-only: this file contains unrecognized content. Nothing has been changed.");
    }
    index++;
    if (lines[index] === "") index++;
    const body: string[] = [];
    while (index < lines.length && (lines[index] === ">" || lines[index]?.startsWith("> "))) {
      body.push(lines[index] === ">" ? "" : lines[index]!.slice(2));
      index++;
    }
    if (!body.length || !body.join("\n").trim()) return reject("Read-only: a message has an invalid body.");
    messages.push({ timestamp, body: body.join("\n") });
  }
  return { writable: true, messages };
}

export function appendMessage(source: string, body: string, timestamp = new Date().toISOString()): string {
  if (!body.trim()) throw new Error("Type a message before sending.");
  const parsed = parseChannel(source);
  if (!parsed.writable) throw new Error(parsed.reason);
  if (!timestampPattern.test(`## ${timestamp}`) || !Number.isFinite(Date.parse(timestamp))) throw new Error("Invalid message timestamp.");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const quoted = body.replace(/\r\n?/g, "\n").split("\n").map(line => `> ${line}`).join(eol);
  // Preserve every existing byte; append only, inside Vault.process's atomic update.
  return source + (source.endsWith(eol + eol) ? "" : source.endsWith(eol) ? eol : eol + eol) +
    `## ${timestamp}${eol}${eol}${quoted}${eol}${eol}`;
}

export function channelFilename(input: string): string {
  const name = input.trim().replace(/\.md$/i, "");
  if (!name || name.length > 100 || name === "." || name === ".." ||
      /[\x00-\x1f\x7f/\\:*?"<>|#\[\]^]/.test(name) || /^[.]/.test(name) || /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error("Use a name of 1–100 characters without path separators, reserved names, or filename punctuation.");
  }
  return `${name}.md`;
}

export async function createChannel(vault: Vault, group: TFolder, name: string): Promise<TFile> {
  if (!isChannelPath(group.path) || group.path.split("/").length !== 3 || vault.getAbstractFileByPath(group.path) !== group) {
    throw new Error("This group no longer exists. Select an existing group.");
  }
  const filename = channelFilename(name);
  const key = filename.normalize("NFC").toLocaleLowerCase();
  if (group.children.some(file => file.name.normalize("NFC").toLocaleLowerCase() === key)) {
    throw new Error("A file with that name already exists in this group. Choose another name.");
  }
  return vault.create(`${group.path}/${filename}`, CHANNEL_TEMPLATE);
}

export async function sendMessage(vault: Vault, file: TFile, body: string): Promise<void> {
  if (!body.trim()) throw new Error("Type a message before sending.");
  if (!isChannelFile(file) || vault.getAbstractFileByPath(file.path) !== file) throw new Error("This channel no longer exists.");
  if (typeof vault.process !== "function") throw new Error("Update Obsidian to support safe channel writes.");
  await vault.process(file, current => {
    if (!isChannelFile(file)) throw new Error("The channel was moved outside its group.");
    return appendMessage(current, body);
  });
}
