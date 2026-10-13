import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const VIDEO_TYPES = new Map([
  [".mp4", "video/mp4"], [".webm", "video/webm"], [".m4v", "video/mp4"],
]);
const DEFAULT_SETTINGS = {
  selectedClipId: null,
  playOnAppStart: true,
  fitMode: "cover",
  pinnedSessions: {},
};

export function normalizeSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const pinnedSessions = {};
  if (source.pinnedSessions && typeof source.pinnedSessions === "object") {
    for (const [session, id] of Object.entries(source.pinnedSessions).slice(-200))
      if (/^[a-zA-Z0-9_-]{1,128}$/.test(session) && /^[a-f0-9-]{36}$/.test(id))
        pinnedSessions[session] = id;
  }
  return {
    selectedClipId: /^[a-f0-9-]{36}$/.test(source.selectedClipId)
      ? source.selectedClipId : null,
    playOnAppStart: source.playOnAppStart !== false,
    fitMode: source.fitMode === "contain" ? "contain" : "cover",
    pinnedSessions,
  };
}

export function parseRange(header, size) {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[2] && match[1] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end)
    return null;
  return { start, end: Math.min(end, size - 1) };
}

export class ClipStore {
  constructor(directory) {
    this.directory = directory;
    this.videoDirectory = join(directory, "videos");
    this.settingsFile = join(directory, "selection.json");
    this.namesFile = join(directory, "clip-names.json");
  }

  async settings() {
    try { return normalizeSettings(JSON.parse(await readFile(this.settingsFile, "utf8"))); }
    catch { return { ...DEFAULT_SETTINGS, pinnedSessions: {} }; }
  }

  async save(settings) {
    const next = normalizeSettings(settings);
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.settingsFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next));
    await rename(temporary, this.settingsFile);
    return next;
  }

  async clips() {
    const files = await readdir(this.videoDirectory).catch(() => []);
    const names = await readFile(this.namesFile, "utf8").then(JSON.parse).catch(() => ({}));
    const clips = [];
    for (const file of files) {
      const match = /^([a-f0-9-]{36})\.(mp4|webm|m4v)$/.exec(file);
      if (!match) continue;
      const info = await stat(join(this.videoDirectory, file)).catch(() => null);
      if (!info?.isFile()) continue;
      clips.push({ id: match[1], name: String(names[match[1]] || match[1]), bytes: info.size, type: VIDEO_TYPES.get(`.${match[2]}`) });
    }
    return clips;
  }

  async upload(name, bytes) {
    const extension = /\.(mp4|webm|m4v)$/i.exec(name)?.[0].toLowerCase();
    if (!extension || !VIDEO_TYPES.has(extension)) throw new Error("unsupported video type");
    if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) throw new Error("video must be 1–100 MB");
    const id = randomUUID();
    await mkdir(this.videoDirectory, { recursive: true });
    await writeFile(join(this.videoDirectory, id + extension), bytes, { flag: "wx" });
    const names = await readFile(this.namesFile, "utf8").then(JSON.parse).catch(() => ({}));
    names[id] = name.slice(0, 120);
    await writeFile(this.namesFile, JSON.stringify(names));
    return { id, name: name.slice(0, 120), bytes: bytes.length, type: VIDEO_TYPES.get(extension) };
  }

  async file(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    for (const extension of VIDEO_TYPES.keys()) {
      const path = join(this.videoDirectory, id + extension);
      const info = await stat(path).catch(() => null);
      if (info?.isFile()) return { path, size: info.size, type: VIDEO_TYPES.get(extension) };
    }
    return null;
  }

  async remove(id) {
    const file = await this.file(id);
    if (!file) return false;
    await rm(file.path);
    const names = await readFile(this.namesFile, "utf8").then(JSON.parse).catch(() => ({}));
    delete names[id];
    await writeFile(this.namesFile, JSON.stringify(names));
    const settings = await this.settings();
    if (settings.selectedClipId === id) settings.selectedClipId = null;
    for (const [session, pinned] of Object.entries(settings.pinnedSessions))
      if (pinned === id) delete settings.pinnedSessions[session];
    await this.save(settings);
    return true;
  }

  async stream(id, rangeHeader, response) {
    const file = await this.file(id);
    if (!file) { response.writeHead(404).end(); return; }
    const range = parseRange(rangeHeader, file.size);
    if (!range) {
      response.writeHead(416, { "Content-Range": `bytes */${file.size}`, "Cache-Control": "no-store" }).end();
      return;
    }
    response.writeHead(rangeHeader ? 206 : 200, {
      "Content-Type": file.type,
      "Content-Length": range.end - range.start + 1,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      ...(rangeHeader ? { "Content-Range": `bytes ${range.start}-${range.end}/${file.size}` } : {}),
    });
    createReadStream(file.path, range).on("error", () => response.destroy()).pipe(response);
  }
}

export async function readBody(request, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error("request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
