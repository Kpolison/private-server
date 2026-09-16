import { TFile, TFolder, Vault } from "obsidian";
import { isChannelFile } from "./channels";
import { parseChannel, sendMessage } from "./messages";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PENDING_IMAGES = 10;
export type ImageExtension = "png" | "jpeg" | "gif" | "webp";
export interface PendingImage { id: string; name: string; blob: Blob; extension: ImageExtension; }

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function attachmentFilename(extension: ImageExtension): string {
  if (!["png", "jpeg", "gif", "webp"].includes(extension)) throw new Error("Unsupported image format.");
  return `private-server-${new Date().toISOString().replace(/[-:.]/g, "")}-${randomId()}.${extension}`;
}
export async function prepareImage(file: File): Promise<PendingImage> {
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error("Choose an image no larger than 10 MiB.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  let extension: ImageExtension;
  if ([137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) extension = "png";
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) extension = "jpeg";
  else if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) extension = "gif";
  else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") extension = "webp";
  else throw new Error("Only PNG, JPEG, GIF, and WebP images are supported.");
  // Use the detected format rather than trusting a filename or mobile picker MIME type.
  return { id: randomId(), name: file.name || `Image.${extension}`, extension, blob: file.slice(0, file.size, `image/${extension}`) };
}

export async function sendWithImages(vault: Vault, channel: TFile, text: string, images: readonly PendingImage[], replyToId?: string): Promise<void> {
  if (!images.length) return sendMessage(vault, channel, text, replyToId);
  if (images.length > MAX_PENDING_IMAGES) throw new Error("Attach up to 10 images per message.");
  if (!isChannelFile(channel) || vault.getAbstractFileByPath(channel.path) !== channel) throw new Error("This channel no longer exists.");
  const parsed = parseChannel(await vault.read(channel));
  if (!parsed.writable) throw new Error(parsed.reason);
  if (typeof vault.process !== "function") throw new Error("Update Obsidian to support safe channel writes.");
  let folder = vault.getAbstractFileByPath("Attachments");
  if (!folder) {
    try { await vault.createFolder("Attachments"); }
    catch (cause) { if (!(vault.getAbstractFileByPath("Attachments") instanceof TFolder)) throw cause; }
    folder = vault.getAbstractFileByPath("Attachments");
  }
  if (!(folder instanceof TFolder)) throw new Error("Attachments must be a root folder.");
  const created: { file: TFile; path: string; bytes: ArrayBuffer }[] = [];
  let body = text;
  try {
    for (const image of images) {
      if (!image.blob.size || image.blob.size > MAX_IMAGE_BYTES) throw new Error("Choose an image no larger than 10 MiB.");
      const bytes = await image.blob.arrayBuffer();
      let path = `Attachments/${attachmentFilename(image.extension)}`;
      // createBinary also rejects existing paths; never overwrite on a late collision.
      for (let attempt = 0; vault.getAbstractFileByPath(path) && attempt < 5; attempt++) {
        path = `Attachments/${attachmentFilename(image.extension)}`;
      }
      if (vault.getAbstractFileByPath(path)) throw new Error("Could not reserve a unique image name. Try sending again.");
      const file = await vault.createBinary(path, bytes);
      created.push({ file, path, bytes });
    }
    const embeds = created.map(({ path }) => `![[${path}]]`).join("\n");
    body = text.trim() ? `${text}\n\n${embeds}` : embeds;
    await sendMessage(vault, channel, body, replyToId);
  } catch (cause) {
    if (!created.length) throw cause;
    // A storage adapter may report failure after committing. Confirm before deleting images.
    let current: string;
    try { current = await vault.read(channel); }
    catch { throw new Error("Could not confirm whether the send completed. Images were retained. Check the channel before retrying."); }
    if (created.length === images.length && parseChannel(current).messages.some(message => message.body === body)) return;
    const retained: string[] = [];
    for (const entry of created) {
      try {
        if (current.includes(entry.path) || entry.file.path !== entry.path || vault.getAbstractFileByPath(entry.path) !== entry.file) {
          retained.push(entry.path); continue;
        }
        // Leave externally changed files intact, even in the unlikely event of a concurrent edit.
        const actual = new Uint8Array(await vault.readBinary(entry.file));
        const original = new Uint8Array(entry.bytes);
        if (actual.length !== original.length || !actual.every((value, index) => value === original[index])) {
          retained.push(entry.path); continue;
        }
        await vault.delete(entry.file);
      } catch { retained.push(entry.path); }
    }
    const reason = cause instanceof Error ? cause.message : "Could not send images.";
    throw new Error(reason + (retained.length ? ` Some new images could not be removed: ${retained.join(", ")}` : " Newly created images were removed."));
  }
}
