import { parseYaml, TFile, TFolder, Vault } from "obsidian";
import { isChannelFile, isChannelPath } from "./channels";

export const CHANNEL_TEMPLATE = "---\nprivate-server-channel: true\nprivate-server-format: 1\n---\n";
export type MessagePart = { type: "text"; text: string } | { type: "image"; path: string };
export interface Message {
  id?: string; replyToId?: string; timestamp: string; body: string; parts: MessagePart[];
  source: { start: number; end: number; block: string; snapshot: string };
}
const idPattern = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
export function messageId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
}
export function messageText(message: Message): string {
  return message.parts.filter(p => p.type === "text").map(p => p.text).join("").trim();
}
export function messagePreview(message: Message): string {
  return messageText(message).replace(/\s+/g, " ").slice(0, 120) || "Image";
}

export function parseMessageParts(body: string): MessagePart[] {
  const parts: MessagePart[] = [];
  // Only local images in the attachment root; never remote URLs or path traversal.
  const embed = /!\[\[(Attachments\/[^\]\[\r\n|]+\.(?:png|jpe?g|gif|webp))\]\]/gi;
  let end = 0;
  for (const match of body.matchAll(embed)) {
    const path = match[1]!;
    if (path.split("/").some(segment => !segment || segment === "." || segment === "..") || path.includes("\\")) continue;
    const index = match.index!;
    if (index > end) parts.push({ type: "text", text: body.slice(end, index) });
    parts.push({ type: "image", path });
    end = index + match[0].length;
  }
  if (end < body.length) parts.push({ type: "text", text: body.slice(end) });
  return parts;
}
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
  const headerLines = frontmatter[0].split("\n").length - 1;
  const rawLines = source.split("\n");
  const offsets = [0];
  for (const line of rawLines) offsets.push(offsets[offsets.length - 1]! + line.length + 1);
  const lines = text.slice(frontmatter[0].length).split("\n");
  const ids = new Set<string>();
  const messages: Message[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index] === "") { index++; continue; }
    const start = offsets[headerLines + index]!;
    const match = timestampPattern.exec(lines[index] ?? "");
    const timestamp = match?.[1];
    if (!timestamp || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
      return reject("Read-only: this file contains unrecognized content. Nothing has been changed.");
    }
    index++;
    if (lines[index] === "") index++;
    let id: string | undefined;
    let replyToId: string | undefined;
    while (lines[index]?.startsWith("<!--")) {
      const metadata = /^<!-- private-server-(id|reply-to): (.*?) -->$/.exec(lines[index]!);
      if (!metadata || !idPattern.test(metadata[2]!)) return reject("Read-only: invalid message metadata.");
      if (metadata[1] === "id") {
        if (id || ids.has(metadata[2]!)) return reject("Read-only: duplicate message ID.");
        id = metadata[2]!; ids.add(id);
      } else {
        if (replyToId) return reject("Read-only: duplicate reply metadata.");
        replyToId = metadata[2]!;
      }
      index++;
    }
    if (replyToId && !id) return reject("Read-only: a reply requires a message ID.");
    if (lines[index] === "") index++;
    const body: string[] = [];
    while (index < lines.length && (lines[index] === ">" || lines[index]?.startsWith("> "))) {
      body.push(lines[index] === ">" ? "" : lines[index]!.slice(2));
      index++;
    }
    if (!body.length || !body.join("\n").trim()) return reject("Read-only: a message has an invalid body.");
    const end = Math.min(source.length, offsets[headerLines + index]!);
    messages.push({ id, replyToId, timestamp, body: body.join("\n"), parts: parseMessageParts(body.join("\n")),
      source: { start, end, block: source.slice(start, end), snapshot: source } });
  }
  return { writable: true, messages };
}

export function appendMessage(source: string, body: string, timestamp = new Date().toISOString(), replyToId?: string): string {
  if (!body.trim()) throw new Error("Type a message before sending.");
  const parsed = parseChannel(source);
  if (!parsed.writable) throw new Error(parsed.reason);
  if (!timestampPattern.test(`## ${timestamp}`) || !Number.isFinite(Date.parse(timestamp))) throw new Error("Invalid message timestamp.");
  if (replyToId && (!idPattern.test(replyToId) || !parsed.messages.some(m => m.id === replyToId))) {
    throw new Error("The original message is unavailable. Cancel the reply or choose another message.");
  }
  let id = messageId();
  while (parsed.messages.some(m => m.id === id)) id = messageId();
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const quoted = body.replace(/\r\n?/g, "\n").split("\n").map(line => `> ${line}`).join(eol);
  // Preserve every existing byte; append only, inside Vault.process's atomic update.
  return source + (source.endsWith(eol + eol) ? "" : source.endsWith(eol) ? eol : eol + eol) +
    `## ${timestamp}${eol}${eol}<!-- private-server-id: ${id} -->${eol}` +
    (replyToId ? `<!-- private-server-reply-to: ${replyToId} -->${eol}` : "") + `${eol}${quoted}${eol}${eol}`;
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

export async function sendMessage(vault: Vault, file: TFile, body: string, replyToId?: string): Promise<void> {
  if (!body.trim()) throw new Error("Type a message before sending.");
  if (!isChannelFile(file) || vault.getAbstractFileByPath(file.path) !== file) throw new Error("This channel no longer exists.");
  if (typeof vault.process !== "function") throw new Error("Update Obsidian to support safe channel writes.");
  await vault.process(file, current => {
    if (!isChannelFile(file)) throw new Error("The channel was moved outside its group.");
    return appendMessage(current, body, undefined, replyToId);
  });
}

/** ID blocks may move, but their contents must still match the displayed version.
 * Legacy blocks require an unchanged file snapshot: identical duplicates are ambiguous after edits. */
export async function mutateMessage(vault: Vault, file: TFile, expected: Message,
  action: "identify" | "edit" | "delete", text = ""): Promise<string> {
  if (!isChannelFile(file) || vault.getAbstractFileByPath(file.path) !== file) throw new Error("This channel no longer exists.");
  if (typeof vault.process !== "function") throw new Error("Update Obsidian to support safe channel writes.");
  let result = expected.id ?? "";
  await vault.process(file, current => {
    if (!isChannelFile(file) || vault.getAbstractFileByPath(file.path) !== file) throw new Error("The channel moved or was deleted.");
    const parsed = parseChannel(current);
    if (!parsed.writable) throw new Error(parsed.reason);
    const target = expected.id ? parsed.messages.find(m => m.id === expected.id)
      : current === expected.source.snapshot ? parsed.messages.find(m => m.source.start === expected.source.start) : undefined;
    if (!target || target.source.block !== expected.source.block) throw new Error("This message changed. Reopen its actions and try again. Your input is preserved.");
    if (action === "identify" && target.id) { result = target.id; return current; }
    const eol = target.source.block.includes("\r\n") ? "\r\n" : "\n";
    if (action !== "delete" && !result) {
      do { result = messageId(); } while (parsed.messages.some(m => m.id === result));
    }
    let replacement = "";
    if (action === "identify") {
      const split = target.source.block.indexOf(eol) + eol.length;
      replacement = target.source.block.slice(0, split) + `${eol}<!-- private-server-id: ${result} -->${eol}` + target.source.block.slice(split);
    } else if (action === "edit") {
      const images = target.parts.filter(p => p.type === "image").map(p => `![[${p.path}]]`);
      if (!text.trim() && !images.length) throw new Error("A text-only message cannot be empty.");
      // Editing text cannot add/remove attachment embeds; image changes have their own future UI.
      if (parseMessageParts(text).some(p => p.type === "image")) throw new Error("Edit text only; existing images are kept automatically.");
      const body = [text.replace(/\r\n?/g, "\n"), ...images].filter(x => x.trim()).join("\n\n");
      replacement = `## ${target.timestamp}${eol}${eol}<!-- private-server-id: ${result} -->${eol}` +
        (target.replyToId ? `<!-- private-server-reply-to: ${target.replyToId} -->${eol}` : "") +
        eol + body.split("\n").map(line => `> ${line}`).join(eol) + eol;
    }
    return current.slice(0, target.source.start) + replacement + current.slice(target.source.end);
  });
  return result;
}
