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
  const fallbackClip = () => library.clips.find((clip) => clip.id === "environment")?.id
    || library.clips.find((clip) => clip.id === "manual-intro")?.id
    || library.clips.find((clip) => clip.writable || clip.id.startsWith("file-"))?.id || null;
  const activeClip = (session) => {
    const override = session && library.settings.conversationOverrides[session];
    if (override && library.clips.some((clip) => clip.id === override)) return override;
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
    const footer = document.querySelector(".app-sidebar [data-plugin-sidebar-footer]");
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
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape" && playback) closePlayback();
  };
  window.addEventListener("keydown", onKeyDown);
  const play = (id) => {
    if (dialog?.open) dialog.close();
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
    renderDialog();
  };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const renderDialog = () => {
    if (!dialog) return;
    const body = dialog.querySelector(".modera-boot-content");
    body.replaceChildren();
    const description = element("p", "启动或进入已固定的会话时播放片头。可上传 MP4、WebM 或 M4V 视频（最大 100 MB）。侧栏页脚的 🎞 用于固定当前会话。");
    body.append(description);
    const upload = element("input", "");
    upload.type = "file";
    upload.accept = ".mp4,.webm,.m4v,video/mp4,video/webm";
    upload.setAttribute("aria-label", "添加片头视频");
    upload.addEventListener("change", async () => {
      const file = upload.files?.[0];
      if (!file) return;
      if (file.size > 100 * 1024 * 1024) { showError("视频不能超过 100 MB"); return; }
      try {
        const result = await request("/upload", {
          method: "POST", headers: { "X-Video-Name": encodeURIComponent(file.name) }, body: file,
        });
        library = await request("/library");
        await save({ selectedClipId: result.clip.id });
      } catch (error) { showError(error.message); }
    });
    body.append(upload);
    const manual = element("p", `也可把视频放到 ${library.videoDirectory}、把默认 MP4 放到 ${library.introPath}，或在启动 Modera 前设置 MODERA_BOOT_ANIMATION 为视频路径。放入后点击刷新片库。`);
    body.append(manual);
    const refresh = element("button", "刷新片库");
    refresh.addEventListener("click", async () => {
      try { library = await request("/library"); renderDialog(); }
      catch (error) { showError(error.message); }
    });
    body.append(refresh);
    const startup = document.createElement("label");
    const check = element("input", "");
    check.type = "checkbox";
    check.checked = library.settings.playOnAppStart;
    check.addEventListener("change", () => void save({ playOnAppStart: check.checked }).catch((error) => showError(error.message)));
    startup.append(check, " 每次启动 Modera 时播放一次");
    body.append(startup);
    const fit = document.createElement("label");
    fit.textContent = "画面适配 ";
    const fitSelect = document.createElement("select");
    for (const [value, label] of [["cover", "铺满窗口"], ["contain", "完整显示"]]) {
      const option = element("option", label);
      option.value = value;
      fitSelect.append(option);
    }
    fitSelect.value = library.settings.fitMode;
    fitSelect.addEventListener("change", () => void save({ fitMode: fitSelect.value }).catch((error) => showError(error.message)));
    fit.append(fitSelect);
    body.append(fit);
    if (currentSession && library.settings.conversationOverrides[currentSession]) {
      const clearOverride = element("button", "取消本会话专属视频");
      clearOverride.addEventListener("click", () => {
        const conversationOverrides = { ...library.settings.conversationOverrides };
        delete conversationOverrides[currentSession];
        void save({ conversationOverrides }).catch((error) => showError(error.message));
      });
      body.append(clearOverride);
    }
    body.append(element("h3", "片库"));
    const fallback = element("div", "默认 Modera 动画", "modera-boot-row");
    const fallbackPreview = element("button", "预览");
    fallbackPreview.addEventListener("click", () => play(null));
    const fallbackSelect = element("button", "选用默认");
    fallbackSelect.addEventListener("click", () => void save({ selectedClipId: "default" }).catch((error) => showError(error.message)));
    fallback.append(fallbackPreview, fallbackSelect);
    body.append(fallback);
    for (const clip of library.clips) {
      const row = element("div", "", "modera-boot-row");
      row.append(element("span", clip.name));
      const preview = element("button", "预览");
      preview.addEventListener("click", () => play(clip.id));
      const select = element("button", library.settings.selectedClipId === clip.id ? "已选中" : "选用");
      select.disabled = library.settings.selectedClipId === clip.id;
      select.addEventListener("click", () => void save({ selectedClipId: clip.id }).catch((error) => showError(error.message)));
      row.append(preview, select);
      if (currentSession) {
        const onlyHere = element("button", library.settings.conversationOverrides[currentSession] === clip.id ? "本会话已选" : "仅本会话");
        onlyHere.disabled = library.settings.conversationOverrides[currentSession] === clip.id;
        onlyHere.addEventListener("click", () => void save({ conversationOverrides: { ...library.settings.conversationOverrides, [currentSession]: clip.id } }).catch((error) => showError(error.message)));
        row.append(onlyHere);
      }
      if (clip.writable) {
        const remove = element("button", "删除");
        remove.addEventListener("click", async () => {
          try {
            await request(`/media/${clip.id}`, { method: "DELETE" });
            library = await request("/library");
            renderDialog();
          } catch (error) { showError(error.message); }
        });
        row.append(remove);
      }
      body.append(row);
    }
  };
  const showError = (message) => {
    if (!dialog) return;
    dialog.querySelector(".modera-boot-error").textContent = message;
  };
  launcher.addEventListener("click", () => {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = "modera-boot-settings";
    dialog.setAttribute("aria-label", "片头动画设置");
    const close = element("button", "关闭", "modera-boot-close");
    close.addEventListener("click", () => dialog.close());
    dialog.append(close, element("h2", "片头动画"), element("p", "", "modera-boot-error"), element("div", "", "modera-boot-content"));
    dialog.addEventListener("close", () => { dialog.remove(); dialog = null; launcher.focus(); });
    document.body.append(dialog);
    renderDialog();
    dialog.showModal();
  });
  const unsubscribe = onSessionChanged((id) => {
    if (id === currentSession) return;
    currentSession = id;
    syncPin();
    renderDialog();
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
    dialog?.close();
    footerActions.remove();
  };
  signal.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
