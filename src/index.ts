import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { ClipStore, readBody } from "./store.js";
import type { PluginContext, PluginContributions } from "@modera/plugin-sdk";

let stop: (() => void) | undefined;

export async function activate(context: PluginContext): Promise<PluginContributions> {
  context.signal.throwIfAborted();
  const clips = new ClipStore(context.storagePath, join(__dirname, "media"));
  const token = randomBytes(32).toString("hex");
  const mount = `/boot/${randomBytes(24).toString("hex")}`;
  const server = createServer(async (request, response) => {
    const address = server.address();
    const host = address && typeof address !== "string" ? `127.0.0.1:${address.port}` : "";
    if (request.headers.host !== host || !request.url?.startsWith(mount + "/")) {
      response.writeHead(403).end();
      return;
    }
    const origin = request.headers.origin;
    if (origin && origin !== "null" && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin || "null");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Modera-Boot, X-Video-Name, Range");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    const path = new URL(request.url, "http://localhost").pathname.slice(mount.length);
    const authenticated = request.headers["x-modera-boot"] === token;
    // A media element cannot send a header; the unguessable mount path grants only video reads.
    const mediaPath = /^\/media\/(?:[a-f0-9-]{36}|file-[a-f0-9]{32}|builtin-(?:brand|cyberpunk|awakening|startup)|manual-intro|environment)$/.test(path);
    if (!authenticated && !(request.method === "GET" && mediaPath)) {
      response.writeHead(403).end();
      return;
    }
    const json = (status: number, payload: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(payload));
    };
    try {
      if (request.method === "GET" && path === "/library") {
        json(200, { clips: await clips.clips(), settings: await clips.settings(), introPath: clips.introFile, videoDirectory: clips.videoDirectory });
      } else if (request.method === "POST" && path === "/settings") {
        const patch = JSON.parse((await readBody(request, 16 * 1024)).toString());
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("invalid settings");
        const previous = await clips.settings();
        const allowed = ["selectedClipId", "playOnAppStart", "randomPlayback", "fitMode", "pinnedSessions", "conversationOverrides"];
        if (Object.keys(patch).some((key) => !allowed.includes(key))) throw new Error("unknown setting");
        const next = { ...previous, ...patch };
        const available = new Set((await clips.clips()).map((clip) => clip.id));
        if (next.selectedClipId !== null && next.selectedClipId !== "default" && !available.has(next.selectedClipId)) throw new Error("clip unavailable");
        if (typeof next.playOnAppStart !== "boolean") throw new Error("invalid playback setting");
        if (typeof next.randomPlayback !== "boolean") throw new Error("invalid random playback setting");
        if (!["cover", "contain"].includes(next.fitMode)) throw new Error("invalid fit mode");
        if (!Array.isArray(next.pinnedSessions) || next.pinnedSessions.some((id: unknown) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)))
          throw new Error("invalid pinned sessions");
        if (!next.conversationOverrides || typeof next.conversationOverrides !== "object" || Array.isArray(next.conversationOverrides) || Object.values(next.conversationOverrides).some((id) => !/^(?:[a-f0-9-]{36}|file-[a-f0-9]{32}|builtin-(?:brand|cyberpunk|awakening|startup)|manual-intro|environment)$/.test(String(id))))
          throw new Error("invalid conversation override");
        json(200, { settings: await clips.save(next) });
      } else if (request.method === "POST" && path === "/upload") {
        const name = decodeURIComponent(String(request.headers["x-video-name"] || ""));
        const video = await readBody(request, 100 * 1024 * 1024);
        json(201, { clip: await clips.upload(name, video) });
      } else if (request.method === "DELETE" && mediaPath) {
        json((await clips.remove(path.slice(7))) ? 200 : 404, { ok: true });
      } else if (request.method === "GET" && mediaPath) {
        await clips.stream(path.slice(7), request.headers.range, response);
      } else response.writeHead(404).end();
    } catch (error) {
      json(400, { error: error instanceof Error ? error.message : "request failed" });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Boot animation server unavailable");
  const endpoint = `http://127.0.0.1:${address.port}${mount}`;
  stop = () => server.close();
  context.signal.addEventListener("abort", stop, { once: true });
  return {
    ui: [{
      id: "modera.boot-animation.connection",
      slot: "window.overlay",
      requiredPermissions: ["host.inject"],
      async render() {
        return { title: "Boot Animation", children: [], data: { endpoint, token } };
      },
    }],
  };
}

export async function deactivate() {
  stop?.();
  stop = undefined;
}
