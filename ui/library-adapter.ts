import { createElement, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { VideoLibrary } from "./video-library.js";

export type FitMode = "cover" | "contain";
export type ClipInfo = {
  id: string;
  name: string;
  bytes: number;
  source?: string;
  file?: string;
  ext?: string;
  writable?: boolean;
  legacy?: boolean;
  copies?: number;
  faststart?: boolean;
};
type Settings = {
  selectedClipId: string | null;
  conversationOverrides: Record<string, string>;
  fitMode: FitMode;
  randomPlayback: boolean;
  playOnAppStart: boolean;
};
type Library = { clips: ClipInfo[]; settings: Settings; videoDirectory: string };
type LibraryOptions = {
  read: () => { library: Library; sessionId: string | null };
  save: (patch: Partial<Settings>) => Promise<void>;
  refresh: () => Promise<void>;
  play: (id: string | null, preview?: boolean) => void;
  activeClip: (sessionId: string | null) => string | null;
  close: () => void;
};
export type ClientStore = ReturnType<typeof createLibrary>;
export const useClientStore = (store: ClientStore) =>
  useSyncExternalStore(store.subscribe, store.getSnapshot);

export function createLibrary({ read, save, refresh, play, activeClip, close }: LibraryOptions) {
  const listeners = new Set<() => void>();
  let busy = false;
  let status = { text: "", kind: "" };
  let playback: { clipId: string | null; previewClipId: string | null } = { clipId: null, previewClipId: null };
  const snapshot = () => {
    const { library, sessionId } = read();
    return {
      catalog: {
        userDir: library.videoDirectory,
        clips: library.clips.map((clip) => ({
          ...clip,
          source: clip.id.startsWith("builtin-") ? "embedded" : clip.id === "environment" ? "env" : "yours",
        })),
      },
      settings: library.settings,
      conversationClipId: (sessionId && library.settings.conversationOverrides[sessionId]) || null,
      sessionId: sessionId || null,
      loading: false,
      busy,
      playback,
      status,
    };
  };
  let current = snapshot();
  const update = () => {
    current = snapshot();
    for (const listener of listeners) listener();
  };
  const action = async (operation: () => Promise<void>, message = "") => {
    if (busy) return;
    busy = true;
    update();
    try {
      await operation();
      status = { text: message, kind: "dba-ok" };
    } catch (error) {
      status = { text: error instanceof Error ? error.message : String(error), kind: "dba-err" };
    } finally {
      busy = false;
      update();
    }
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => current,
    update,
    preview: (id: string) => play(id, true),
    selectClip: (id: string) => action(() => save({ selectedClipId: id }), "已设为全局片头"),
    setConversationClip: (id: string | null) => action(async () => {
      const { library, sessionId } = read();
      if (!sessionId) return;
      const conversationOverrides = { ...library.settings.conversationOverrides };
      if (id === null) delete conversationOverrides[sessionId];
      else conversationOverrides[sessionId] = id;
      await save({ conversationOverrides });
    }, id === null ? "本会话已回到全局片头" : "已为本会话指定片头"),
    setFitMode: (fitMode: FitMode) => action(() => save({ fitMode })),
    setRandomPlayback: (randomPlayback: boolean) => action(() => save({ randomPlayback })),
    setPlayOnAppStart: (playOnAppStart: boolean) => action(() => save({ playOnAppStart })),
    playMode: () => play(activeClip(read().sessionId)),
    loadCatalog: () => action(refresh),
    setPlayback: (clipId: string | null, preview = false, playing = clipId !== null) => {
      playback = { clipId, previewClipId: preview ? clipId : null };
      // Keep the picker mounted and restore it when preview finishes.
      container.style.visibility = playing ? "hidden" : "";
      update();
    },
    destroy: () => { root.unmount(); container.remove(); },
  };
  root.render(createElement(VideoLibrary, { store, onClose: close }));
  return store;
}
