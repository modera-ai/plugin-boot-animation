import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_CLIPS } from "./builtin-clips.js";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const VIDEO_TYPES = new Map([
  [".mp4", "video/mp4"], [".webm", "video/webm"], [".m4v", "video/mp4"],
]);
const CLIP_ID = /^(?:[a-f0-9-]{36}|file-[a-f0-9]{32}|builtin-(?:brand|cyberpunk|awakening|startup)|manual-intro|environment|default)$/;
const fileId = (name) => `file-${createHash("sha256").update(name).digest("hex").slice(0, 32)}`;
const DEFAULT_SETTINGS = {
  selectedClipId: null,
  playOnAppStart: true,
  randomPlayback: false,
  fitMode: "cover",
  pinnedSessions: [],
  conversationOverrides: {},
};

export function normalizeSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const sessionId = (value) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const legacyPins = !Array.isArray(source.pinnedSessions) && source.pinnedSessions && typeof source.pinnedSessions === "object"
    ? source.pinnedSessions : {};
  const pinnedSessions = (Array.isArray(source.pinnedSessions)
    ? source.pinnedSessions : Object.keys(legacyPins))
    .filter(sessionId).slice(-200);
  const conversationOverrides = {};
  const overrides = source.conversationOverrides && typeof source.conversationOverrides === "object"
    ? source.conversationOverrides : legacyPins;
  for (const [session, id] of Object.entries(overrides).slice(-200))
    if (sessionId(session) && CLIP_ID.test(id)) conversationOverrides[session] = id;
  return {
    selectedClipId: CLIP_ID.test(source.selectedClipId)
      ? source.selectedClipId : null,
    playOnAppStart: source.playOnAppStart !== false,
    randomPlayback: source.randomPlayback === true,
    fitMode: source.fitMode === "contain" ? "contain" : "cover",
    pinnedSessions,
    conversationOverrides,
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
  constructor(directory, builtinDirectory) {
    this.directory = directory;
    this.builtinDirectory = builtinDirectory;
    this.videoDirectory = join(directory, "videos");
    this.settingsFile = join(directory, "selection.json");
    this.namesFile = join(directory, "clip-names.json");
    this.introFile = join(directory, "intro.mp4");
  }

  async settings() {
    try { return normalizeSettings(JSON.parse(await readFile(this.settingsFile, "utf8"))); }
    catch { return { ...DEFAULT_SETTINGS, pinnedSessions: [], conversationOverrides: {} }; }
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
    for (const clip of BUILTIN_CLIPS) {
      const file = await this.file(clip.id);
      if (file) clips.push({ id: clip.id, name: clip.name, bytes: file.size, type: file.type, writable: false });
    }
    for (const file of files) {
      const match = /\.(mp4|webm|m4v)$/i.exec(file);
      if (!match) continue;
      const info = await stat(join(this.videoDirectory, file)).catch(() => null);
      if (!info?.isFile()) continue;
      const uploaded = /^([a-f0-9-]{36})\.(mp4|webm|m4v)$/.exec(file);
      const id = uploaded ? uploaded[1] : fileId(file);
      clips.push({ id, name: String(names[id] || file), bytes: info.size, type: VIDEO_TYPES.get(match[0].toLowerCase()), writable: !!uploaded });
    }
    const intro = await stat(this.introFile).catch(() => null);
    if (intro?.isFile() && intro.size > 0) clips.push({ id: "manual-intro", name: "手动放入的 intro.mp4", bytes: intro.size, type: "video/mp4", writable: false });
    const environment = process.env.MODERA_BOOT_ANIMATION;
    const extension = environment && /\.(mp4|webm|m4v)$/i.exec(environment)?.[0].toLowerCase();
    if (environment && extension && VIDEO_TYPES.has(extension)) {
      const info = await stat(environment).catch(() => null);
      if (info?.isFile() && info.size > 0)
        clips.push({ id: "environment", name: "环境变量指定的视频", bytes: info.size, type: VIDEO_TYPES.get(extension), writable: false });
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
    const builtin = BUILTIN_CLIPS.find((clip) => clip.id === id);
    if (builtin) {
      if (!this.builtinDirectory) return null;
      const path = join(this.builtinDirectory, builtin.file);
      const info = await stat(path).catch(() => null);
      return info?.isFile() && info.size > 0 ? { path, size: info.size, type: "video/mp4" } : null;
    }
    if (id === "manual-intro" || id === "environment") {
      const path = id === "manual-intro" ? this.introFile : process.env.MODERA_BOOT_ANIMATION;
      const extension = path && /\.(mp4|webm|m4v)$/i.exec(path)?.[0].toLowerCase();
      if (!path || !extension || !VIDEO_TYPES.has(extension)) return null;
      const info = await stat(path).catch(() => null);
      return info?.isFile() && info.size > 0 ? { path, size: info.size, type: VIDEO_TYPES.get(extension) } : null;
    }
    if (/^file-[a-f0-9]{32}$/.test(id)) {
      for (const name of await readdir(this.videoDirectory).catch(() => [])) {
        if (fileId(name) !== id || !/\.(mp4|webm|m4v)$/i.test(name)) continue;
        const path = join(this.videoDirectory, name);
        const info = await stat(path).catch(() => null);
        if (info?.isFile()) return { path, size: info.size, type: VIDEO_TYPES.get(/\.(mp4|webm|m4v)$/i.exec(name)[0].toLowerCase()) };
      }
      return null;
    }
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    for (const extension of VIDEO_TYPES.keys()) {
      const path = join(this.videoDirectory, id + extension);
      const info = await stat(path).catch(() => null);
      if (info?.isFile()) return { path, size: info.size, type: VIDEO_TYPES.get(extension) };
    }
    return null;
  }

  async remove(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return false;
    const file = await this.file(id);
    if (!file) return false;
    await rm(file.path);
    const names = await readFile(this.namesFile, "utf8").then(JSON.parse).catch(() => ({}));
    delete names[id];
    await writeFile(this.namesFile, JSON.stringify(names));
    const settings = await this.settings();
    if (settings.selectedClipId === id) settings.selectedClipId = null;
    for (const [session, clip] of Object.entries(settings.conversationOverrides))
      if (clip === id) delete settings.conversationOverrides[session];
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
