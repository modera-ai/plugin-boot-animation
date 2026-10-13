const bootMark = "__moderaBootAnimationPlayed";

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
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "modera-boot-launcher";
  launcher.textContent = "片头动画";
  launcher.setAttribute("aria-haspopup", "dialog");
  document.body.append(launcher);

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
    if (id) {
      const video = document.createElement("video");
      video.className = "modera-boot-video";
      video.style.objectFit = library.settings.fitMode;
      video.src = `${endpoint}/media/${encodeURIComponent(id)}`;
      video.playsInline = true;
      video.autoplay = true;
      video.addEventListener("ended", closePlayback, { once: true });
      video.addEventListener("error", closePlayback, { once: true });
      frame.prepend(video);
      void video.play().catch(() => {
        if (number !== playNumber) return;
        video.muted = true;
        return video.play().catch(closePlayback);
      });
    } else {
      const brand = document.createElement("div");
      brand.className = "modera-boot-brand";
      brand.innerHTML = '<span class="modera-boot-orbit"></span><strong>MODERA</strong>';
      frame.prepend(brand);
      setTimeout(() => { if (number === playNumber) closePlayback(); }, 2500);
    }
    document.body.append(frame);
    playback = frame;
    skip.focus();
  };

  const save = async (patch) => {
    const result = await request("/settings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    library.settings = result.settings;
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
    const description = element("p", "启动或进入已固定的会话时播放片头。可上传 MP4、WebM 或 M4V 视频（最大 100 MB）。");
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
    if (currentSession) {
      const pin = element("button", library.settings.pinnedSessions[currentSession] ? "取消此会话的片头" : "将选中片头固定到此会话");
      pin.disabled = !library.settings.selectedClipId && !library.settings.pinnedSessions[currentSession];
      pin.addEventListener("click", () => {
        const pinnedSessions = { ...library.settings.pinnedSessions };
        if (pinnedSessions[currentSession]) delete pinnedSessions[currentSession];
        else pinnedSessions[currentSession] = library.settings.selectedClipId;
        void save({ pinnedSessions }).catch((error) => showError(error.message));
      });
      body.append(pin);
    }
    body.append(element("h3", "片库"));
    const fallback = element("div", "默认 Modera 动画", "modera-boot-row");
    const fallbackPreview = element("button", "预览");
    fallbackPreview.addEventListener("click", () => play(null));
    fallback.append(fallbackPreview);
    body.append(fallback);
    for (const clip of library.clips) {
      const row = element("div", "", "modera-boot-row");
      row.append(element("span", clip.name));
      const preview = element("button", "预览");
      preview.addEventListener("click", () => play(clip.id));
      const select = element("button", library.settings.selectedClipId === clip.id ? "已选中" : "选用");
      select.disabled = library.settings.selectedClipId === clip.id;
      select.addEventListener("click", () => void save({ selectedClipId: clip.id }).catch((error) => showError(error.message)));
      const remove = element("button", "删除");
      remove.addEventListener("click", async () => {
        try {
          await request(`/media/${clip.id}`, { method: "DELETE" });
          library = await request("/library");
          renderDialog();
        } catch (error) { showError(error.message); }
      });
      row.append(preview, select, remove);
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
    renderDialog();
    if (id && library.settings.pinnedSessions[id]) play(library.settings.pinnedSessions[id]);
  });
  if (library.settings.playOnAppStart && !window[bootMark]) {
    window[bootMark] = true;
    play(currentSession && library.settings.pinnedSessions[currentSession] || library.settings.selectedClipId);
  }
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    window.removeEventListener("keydown", onKeyDown);
    closePlayback();
    dialog?.close();
    launcher.remove();
  };
  signal.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
