import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const plugin = require("../dist/index.cjs");

test("local service protects settings and streams selected media by range", async () => {
  const directory = await mkdtemp(join(import.meta.dirname, ".boot-server-test-"));
  const controller = new AbortController();
  try {
    const contribution = await plugin.activate({ storagePath: directory, signal: controller.signal });
    const { endpoint, token } = (await contribution.ui[0].render()).data;
    const unauthenticated = await fetch(endpoint + "/library");
    assert.equal(unauthenticated.status, 403);
    const headers = { "X-Modera-Boot": token };
    const initial = await fetch(endpoint + "/library", { headers }).then((response) => response.json());
    const builtins = initial.clips.filter((clip) => clip.id.startsWith("builtin-"));
    assert.deepEqual(builtins.map((clip) => clip.id), ["builtin-brand", "builtin-cyberpunk", "builtin-awakening", "builtin-startup"]);
    for (const builtin of builtins) {
      assert.equal(builtin.writable, false);
      const media = await fetch(`${endpoint}/media/${builtin.id}`, { headers: { Range: "bytes=0-31" } });
      assert.equal(media.status, 206);
      assert.equal(media.headers.get("content-type"), "video/mp4");
      assert.equal(media.headers.get("content-range"), `bytes 0-31/${builtin.bytes}`);
      assert.equal(Buffer.from(await media.arrayBuffer()).toString("ascii", 4, 8), "ftyp");
      const selected = await fetch(endpoint + "/settings", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ selectedClipId: builtin.id, conversationOverrides: { "session-1": builtin.id } }),
      });
      assert.equal(selected.status, 200);
      const saved = (await selected.json()).settings;
      assert.equal(saved.selectedClipId, builtin.id);
      assert.equal(saved.conversationOverrides["session-1"], builtin.id);
      assert.equal((await fetch(`${endpoint}/media/${builtin.id}`, { method: "DELETE", headers })).status, 404);
    }
    assert.equal((await fetch(`${endpoint}/media/builtin-unknown`)).status, 403);
    const upload = await fetch(endpoint + "/upload", {
      method: "POST", headers: { ...headers, "X-Video-Name": "intro.mp4" }, body: Buffer.from("abcdefghij"),
    });
    assert.equal(upload.status, 201);
    const { clip } = await upload.json();
    const range = await fetch(`${endpoint}/media/${clip.id}`, { headers: { Range: "bytes=2-5" } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await range.text(), "cdef");
    const settings = await fetch(endpoint + "/settings", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ selectedClipId: clip.id, playOnAppStart: false, randomPlayback: true }),
    });
    assert.equal(settings.status, 200);
    const library = await fetch(endpoint + "/library", { headers }).then((response) => response.json());
    assert.equal(library.settings.selectedClipId, clip.id);
    assert.equal(library.settings.playOnAppStart, false);
    assert.equal(library.settings.randomPlayback, true);
  } finally {
    controller.abort();
    await plugin.deactivate();
    await rm(directory, { recursive: true, force: true });
  }
});
