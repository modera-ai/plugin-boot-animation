import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ClipStore, normalizeSettings, parseRange } from "../src/store.js";

test("bundled clips keep stable selections across reload without copying into user storage", async () => {
  const directory = await mkdtemp(join(import.meta.dirname, ".boot-test-"));
  try {
    const media = join(import.meta.dirname, "../media");
    const first = new ClipStore(directory, media);
    const clips = await first.clips();
    assert.equal(clips.length, 4);
    await first.save({ selectedClipId: clips[0].id, conversationOverrides: { "session-1": clips[3].id } });
    const second = new ClipStore(directory, media);
    assert.equal((await second.settings()).selectedClipId, clips[0].id);
    assert.equal((await second.settings()).conversationOverrides["session-1"], clips[3].id);
    assert.equal((await second.file(clips[0].id)).path, join(media, "deepseek-brand-intro.mp4"));
    assert.equal(await second.remove(clips[0].id), false);
    assert.equal(await second.file("builtin-../intro"), null);
    assert.equal((await new ClipStore(directory, join(directory, "missing")).clips()).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("video selection survives reload and removing a clip clears its session pin", async () => {
  const directory = await mkdtemp(join(import.meta.dirname, ".boot-test-"));
  try {
    const first = new ClipStore(directory);
    const clip = await first.upload("intro.mp4", Buffer.from("video bytes"));
    await first.save({
      selectedClipId: clip.id,
      playOnAppStart: false,
      randomPlayback: true,
      fitMode: "contain",
      pinnedSessions: ["session-1"],
      conversationOverrides: { "session-1": clip.id },
    });
    const second = new ClipStore(directory);
    assert.equal((await second.clips())[0].name, "intro.mp4");
    assert.equal((await second.settings()).playOnAppStart, false);
    assert.equal((await second.settings()).randomPlayback, true);
    assert.deepEqual((await second.settings()).pinnedSessions, ["session-1"]);
    assert.equal((await second.settings()).conversationOverrides["session-1"], clip.id);
    await second.remove(clip.id);
    assert.equal((await second.settings()).selectedClipId, null);
    assert.deepEqual((await second.settings()).pinnedSessions, ["session-1"]);
    assert.deepEqual((await second.settings()).conversationOverrides, {});
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

test("manual intro and environment video are discoverable without importing them", async () => {
  const directory = await mkdtemp(join(import.meta.dirname, ".boot-test-"));
  const previous = process.env.MODERA_BOOT_ANIMATION;
  try {
    const intro = join(directory, "intro.mp4");
    const external = join(directory, "external.webm");
    const videos = join(directory, "videos");
    await mkdir(videos);
    await writeFile(join(videos, "my clip.mp4"), "folder video");
    await writeFile(intro, "manual video");
    await writeFile(external, "external video");
    process.env.MODERA_BOOT_ANIMATION = external;
    const store = new ClipStore(directory);
    const listed = await store.clips();
    assert.deepEqual(listed.slice(1).map((clip) => clip.id), ["manual-intro", "environment"]);
    assert.match(listed[0].id, /^file-[a-f0-9]{32}$/);
    assert.equal((await store.file(listed[0].id)).size, 12);
    assert.equal((await store.file("manual-intro")).size, 12);
    assert.equal((await store.file("environment")).size, 14);
    assert.equal(await store.remove("manual-intro"), false);
  } finally {
    if (previous === undefined) delete process.env.MODERA_BOOT_ANIMATION;
    else process.env.MODERA_BOOT_ANIMATION = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("old pinned clip settings keep replay and clip choice separately", () => {
  assert.deepEqual(normalizeSettings({ pinnedSessions: { "session-1": "00000000-0000-0000-0000-000000000001" } }).pinnedSessions, ["session-1"]);
  assert.equal(normalizeSettings({ pinnedSessions: { "session-1": "00000000-0000-0000-0000-000000000001" } }).conversationOverrides["session-1"], "00000000-0000-0000-0000-000000000001");
});
