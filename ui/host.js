import { createLibrary } from "./library-adapter.ts";

const bootMark = "__moderaBootAnimationPlayed";
const draftMark = "__moderaBootAnimationInitialDraftPlayed";

export default async function mount({ projectId, currentSessionId, onSessionChanged, signal }) {
  const connection = await window.modera.plugins.uiRequest({
    id: "modera.boot-animation.connection",
    projectId,
    sessionId: "",
    locale: document.documentElement.lang || "zh-CN",
  });
  if (signal.aborted) return;
  const { endpoint, token } = connection.data || {};
  if (!/^http:\/\/127\.0\.0\.1:\d+\/boot\/[a-f0-9]{48}$/.test(endpoint) || !/^[a-f0-9]{64}$/.test(token))
    throw new Error("Invalid boot animation endpoint");

  const request = async (path, options = {}) => {
    const response = await fetch(endpoint + path, {
      ...options,
      headers: { "X-Modera-Boot": token, ...options.headers },
      signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request failed");
    return payload;
  };
  let library = await request("/library");
  let currentSession = currentSessionId();
  let playback = null;
  let dialog = null;
  let playNumber = 0;
  let lastRandomClip = null;
  const fallbackClip = () => library.clips.find((clip) => clip.id === "environment")?.id
    || library.clips.find((clip) => clip.id === "manual-intro")?.id
    || library.clips.find((clip) => clip.writable || clip.id.startsWith("file-"))?.id || null;
  const activeClip = (session) => {
    const override = session && library.settings.conversationOverrides[session];
    if (override && library.clips.some((clip) => clip.id === override)) return override;
    if (library.settings.randomPlayback && library.clips.length) {
      const candidates = library.clips.filter((clip) => clip.id !== lastRandomClip);
      const choices = candidates.length ? candidates : library.clips;
      lastRandomClip = choices[Math.floor(Math.random() * choices.length)].id;
      return lastRandomClip;
    }
    if (library.settings.selectedClipId === "default") return null;
    if (library.settings.selectedClipId && library.clips.some((clip) => clip.id === library.settings.selectedClipId))
      return library.settings.selectedClipId;
    return fallbackClip();
  };
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "modera-boot-launcher";
  launcher.textContent = "🎬";
  launcher.title = "片头片库";
  launcher.setAttribute("aria-label", "片头片库");
  launcher.setAttribute("aria-haspopup", "dialog");
  const pinButton = document.createElement("button");
  pinButton.type = "button";
  pinButton.className = "modera-boot-pin";
  const footerActions = document.createElement("div");
  footerActions.className = "modera-boot-footer-actions";
  footerActions.append(pinButton, launcher);
  const placeFooter = () => {
    const footer = document.querySelector(".app-sidebar [data-plugin-sidebar-above-footer]")
      || document.querySelector(".app-sidebar [data-plugin-sidebar-footer]");
    if (footer && footerActions.parentElement !== footer) footer.append(footerActions);
    else if (!footer && footerActions.isConnected) footerActions.remove();
  };
  const footerObserver = new MutationObserver(placeFooter);
  footerObserver.observe(document.getElementById("root") || document.body, { childList: true, subtree: true });
  placeFooter();
  const syncPin = () => {
    const pinned = !!currentSession && library.settings.pinnedSessions.includes(currentSession);
    pinButton.textContent = pinned ? "🎬" : "🎞";
    pinButton.title = pinned ? "取消此会话片头固定" : "每次进入此会话时播放片头";
    pinButton.setAttribute("aria-label", pinButton.title);
    pinButton.setAttribute("aria-pressed", String(pinned));
    pinButton.disabled = !currentSession;
  };
  pinButton.addEventListener("click", async () => {
    const pinnedSessions = new Set(library.settings.pinnedSessions);
    if (pinnedSessions.has(currentSession)) pinnedSessions.delete(currentSession);
    else pinnedSessions.add(currentSession);
    try { await save({ pinnedSessions: [...pinnedSessions] }); }
    catch (error) { showError(error.message); }
  });
  syncPin();

  const closePlayback = () => {
    ++playNumber;
    if (!playback) return;
    playback.querySelector("video")?.pause();
    playback.remove();
    playback = null;
    dialog?.setPlayback(null);
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape" && playback) {
      event.stopImmediatePropagation();
      closePlayback();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  const play = (id, preview = false) => {
    closePlayback();
    const number = playNumber;
    const frame = document.createElement("div");
    frame.className = "modera-boot-overlay";
    frame.setAttribute("role", "dialog");
    frame.setAttribute("aria-label", "片头动画");
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "modera-boot-skip";
    skip.textContent = "跳过 ×";
    skip.addEventListener("click", closePlayback);
    frame.append(skip);
    let video;
    if (id) {
      video = document.createElement("video");
      video.className = "modera-boot-video";
      video.style.objectFit = library.settings.fitMode;
      video.src = `${endpoint}/media/${encodeURIComponent(id)}`;
      video.playsInline = true;
      video.autoplay = true;
      video.addEventListener("ended", closePlayback, { once: true });
      video.addEventListener("error", closePlayback, { once: true });
      setTimeout(() => { if (number === playNumber && video.readyState < 3) closePlayback(); }, 25000);
      frame.prepend(video);
    } else {
      const brand = document.createElement("div");
      brand.className = "modera-boot-brand";
      brand.innerHTML = '<span class="modera-boot-orbit"></span><strong>MODERA</strong>';
      frame.prepend(brand);
      setTimeout(() => { if (number === playNumber) closePlayback(); }, 2500);
    }
    document.body.append(frame);
    playback = frame;
    dialog?.setPlayback(id, preview, true);
    if (video) void video.play().catch(() => {
      if (number !== playNumber) return;
      video.muted = true;
      return video.play().catch(closePlayback);
    });
    skip.focus();
  };

  const save = async (patch) => {
    const result = await request("/settings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    library.settings = result.settings;
    syncPin();
    dialog?.update();
  };
  const closeLibrary = () => {
    dialog?.destroy();
    dialog = null;
    launcher.focus();
  };
  const showError = (message) => console.error("[modera.boot-animation]", message);
  launcher.addEventListener("click", () => {
    if (dialog) return;
    dialog = createLibrary({
      read: () => ({ library, sessionId: currentSession }),
      save,
      refresh: async () => { library = await request("/library"); },
      play,
      activeClip,
      close: closeLibrary,
    });
  });
  const unsubscribe = onSessionChanged((id) => {
    if (id === currentSession) return;
    currentSession = id;
    syncPin();
    dialog?.update();
    if (id && library.settings.pinnedSessions.includes(id)) play(activeClip(id));
  });
  const onNewDraft = () => {
    if (!library.settings.playOnAppStart) play(activeClip(""));
  };
  window.addEventListener("modera:conversation-created-draft", onNewDraft);
  if (currentSession && library.settings.pinnedSessions.includes(currentSession)) {
    if (library.settings.playOnAppStart) window[bootMark] = true;
    play(activeClip(currentSession));
  } else if (library.settings.playOnAppStart && !window[bootMark]) {
    window[bootMark] = true;
    play(activeClip(currentSession));
  } else if (!library.settings.playOnAppStart && !currentSession && !window[draftMark]) {
    window[draftMark] = true;
    play(activeClip(""));
  }
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    window.removeEventListener("modera:conversation-created-draft", onNewDraft);
    footerObserver.disconnect();
    window.removeEventListener("keydown", onKeyDown);
    closePlayback();
    closeLibrary();
    footerActions.remove();
  };
  signal.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
