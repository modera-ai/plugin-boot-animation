import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { ClipStore, parseRange } from "../src/store.js";

test("video selection survives reload and removing a clip clears its session pin", async () => {
  const directory = await mkdtemp(join(import.meta.dirname, ".boot-test-"));
  try {
    const first = new ClipStore(directory);
    const clip = await first.upload("intro.mp4", Buffer.from("video bytes"));
    await first.save({
      selectedClipId: clip.id,
      playOnAppStart: false,
      fitMode: "contain",
      pinnedSessions: { "session-1": clip.id },
    });
    const second = new ClipStore(directory);
    assert.equal((await second.clips())[0].name, "intro.mp4");
    assert.equal((await second.settings()).playOnAppStart, false);
    assert.equal((await second.settings()).pinnedSessions["session-1"], clip.id);
    await second.remove(clip.id);
    assert.equal((await second.settings()).selectedClipId, null);
    assert.deepEqual((await second.settings()).pinnedSessions, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("media byte ranges reject invalid and unsatisfiable requests", () => {
  assert.deepEqual(parseRange("bytes=3-5", 10), { start: 3, end: 5 });
  assert.deepEqual(parseRange("bytes=-4", 10), { start: 6, end: 9 });
  assert.equal(parseRange("bytes=10-", 10), null);
  assert.equal(parseRange("bytes=7-3", 10), null);
  assert.equal(parseRange("bytes=1-2,4-5", 10), null);
});
