// Adapted from NativeDog1/dsh-boot-animation, BSD-3-Clause; see NOTICE.
import type { ReactElement } from "react";
import { createElement as h, useEffect } from "react";
import { useClientStore, type ClientStore, type ClipInfo, type FitMode } from "./library-adapter.js";
import { ensureStyle } from "./library-styles.js";
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
}

/** Where a clip comes from, as one word a user can act on. */
const SOURCE_LABEL: Record<string, string> = {
  yours: '你自己加的',
  embedded: '插件内置',
  env: '环境变量',
}

export function VideoLibrary({ store, onClose }: { store: ClientStore; onClose: () => void }): ReactElement {
  ensureStyle()
  const snapshot = useClientStore(store)
  const clips = snapshot.catalog?.clips ?? []
  const selectedClipId = snapshot.settings.selectedClipId
  const playingClipId = snapshot.playback.clipId
  const previewClipId = snapshot.playback.previewClipId
  const conversationClipId = snapshot.conversationClipId
  const hasSession = snapshot.sessionId !== null
  const nameOf = (clipId: string): string => clips.find((item) => item.id === clipId)?.name ?? clipId

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const busy = snapshot.busy

  return h(
    'div',
    {
      className: 'dba-veil',
      onClick: (event: { target: unknown; currentTarget: unknown }) => {
        if (event.target === event.currentTarget) onClose()
      },
    },
    h(
      'div',
      { className: 'dba-lib', role: 'dialog', 'aria-label': '片头片库', 'aria-modal': true, onClick: (event: { stopPropagation: () => void }) => event.stopPropagation() },
      h('h3', null, '片头片库'),
      h(
        'p',
        null,
        '「▶ 预览」立刻播这一段（不改你的选择）；「选它」设为全局片头；「仅本会话」只让当前这个会话播它。',
      ),
      h(
        'div',
        { className: 'dba-ses' },
        hasSession
          ? conversationClipId === null
            ? '本会话跟随全局片头。想只给这个会话换一段，点那一行的「仅本会话」。'
            : '本会话固定播放：' + nameOf(conversationClipId)
          : '还没有打开的会话：先打开一个对话，才能只对它生效。',
        conversationClipId === null
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: 'dba-row-btn',
                disabled: busy,
                title: '取消这个会话的固定片头，回到全局选择',
                onClick: () => {
                  if (!busy) void store.setConversationClip(null)
                },
              },
              '取消（回到全局）',
            ),
      ),
      ...(clips.length === 0
        ? [h('div', { className: 'dba-item' }, h('span', { className: 'dba-nm' }, snapshot.loading ? '（正在读取…）' : '（还没找到任何视频）'))]
        : clips.map((clip: ClipInfo) =>
            h(
              'div',
              {
                key: clip.id,
                className:
                  'dba-item' +
                  (clip.id === selectedClipId ? ' dba-cur' : '') +
                  (clip.id === conversationClipId ? ' dba-ses-cur' : ''),
                title: clip.file ?? clip.id,
              },
              h('span', { className: 'dba-mark' }, clip.id === selectedClipId ? '✓' : ''),
              h('span', { className: 'dba-nm' }, clip.name),
              clip.id === conversationClipId ? h('span', { className: 'dba-badge dba-b-ses' }, '本会话') : null,
              clip.id === playingClipId
                ? h('span', { className: 'dba-badge dba-b-sel' }, previewClipId === clip.id ? '预览中' : '播放中')
                : null,
              clip.legacy ? h('span', { className: 'dba-badge' }, '原片源') : null,
              (clip.copies ?? 1) > 1
                ? h(
                    'span',
                    {
                      className: 'dba-badge',
                      title:
                        '这一段在磁盘上有 ' +
                        String(clip.copies) +
                        ' 份相同的副本，已合并成一条。你的文件没有被删，只是不重复列出。',
                    },
                    '合并 ' + String(clip.copies) + ' 份重复',
                  )
                : null,
              (clip.ext === '.mp4' || clip.ext === '.m4v') && clip.faststart === false
                ? h(
                    'span',
                    {
                      className: 'dba-badge dba-b-warn',
                      title: '这个文件的索引表(moov)在末尾：浏览器要整段下载完才出画面，容易黑屏。用 ffmpeg -c copy -movflags +faststart 重排一次即可。',
                    },
                    '⚠ 未优化',
                  )
                : null,
              h('span', { className: 'dba-badge' }, SOURCE_LABEL[clip.source] ?? clip.source),
              h('span', { className: 'dba-meta' }, formatBytes(clip.bytes)),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dba-row-btn',
                  title: '立刻播放这一段，不改变你的选择',
                  onClick: () => {
                    store.preview(clip.id)
                  },
                },
                '▶ 预览',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dba-row-btn' + (clip.id === selectedClipId ? '' : ' dba-go'),
                  disabled: busy || clip.id === selectedClipId,
                  title: '设为以后开片头时播放的片段',
                  onClick: () => {
                    if (!busy) void store.selectClip(clip.id)
                  },
                },
                clip.id === selectedClipId ? '已选' : '选它',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dba-row-btn' + (clip.id === conversationClipId ? ' dba-go' : ''),
                  disabled: busy || !hasSession,
                  title: hasSession
                    ? '只让当前这个会话播这一段 —— 不改你给其它会话和全局选的那一段'
                    : '先打开一个对话，才能只对它生效',
                  onClick: () => {
                    if (!busy && hasSession) void store.setConversationClip(clip.id)
                  },
                },
                clip.id === conversationClipId ? '本会话 ✓' : '仅本会话',
              ),
            ),
          )),
      h(
        'div',
        { className: 'dba-dir' },
        '想加自己的片子：把 mp4 放进这个文件夹，再点「刷新」',
        h('br', null),
        h('code', null, snapshot.catalog?.userDir ?? '…'),
      ),
      h(
        'div',
        { className: 'dba-fit' },
        h('span', null, '播放方式：'),
        h(
          'button',
          {
            type: 'button',
            className: 'dba-btn' + (snapshot.settings.fitMode === 'cover' ? ' dba-btn-on' : ''),
            title: '铺满整个窗口，超出部分裁掉 —— 不留黑边',
            onClick: () => void store.setFitMode('cover' satisfies FitMode),
          },
          '铺满屏幕',
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dba-btn' + (snapshot.settings.fitMode === 'contain' ? ' dba-btn-on' : ''),
            title: '完整显示整帧，长宽比不匹配时留黑边',
            onClick: () => void store.setFitMode('contain' satisfies FitMode),
          },
          '完整显示',
        ),
        h('span', { className: 'dba-flex' }),
        h(
          'button',
          {
            type: 'button',
            className: 'dba-btn' + (snapshot.settings.randomPlayback ? ' dba-btn-on' : ''),
            title: '每次开片头时，从所有可播放的片段里随机挑一段（连续两次不会挑到同一段）',
            onClick: () => void store.setRandomPlayback(!snapshot.settings.randomPlayback),
          },
          snapshot.settings.randomPlayback ? '🎲 随机播放：开' : '🎲 随机播放：关',
        ),
      ),
      /**
       * The when-to-play switch (0.4.2). Its state is the HOST's
       * `playOnAppStart`, read back from `/videos.json` — never a client-side
       * guess — and the label spells out both rules so it cannot mislead.
       */
      h(
        'div',
        { className: 'dba-fit' },
        h('span', null, '什么时候播：'),
        h(
          'button',
          {
            type: 'button',
            className: 'dba-btn' + (snapshot.settings.playOnAppStart ? ' dba-btn-on' : ''),
            title:
              '每次启动 Modera 应用时播放一次片头；同一轮使用中不重复，下次打开 Modera 再播一次。' +
              '关掉后只在你新建会话时播一次。被钉住的会话不受这个开关影响，仍然每次进入都重播。',
            onClick: () => void store.setPlayOnAppStart(!snapshot.settings.playOnAppStart),
          },
          snapshot.settings.playOnAppStart
            ? '🚀 每次启动 Modera 时播放一次：开'
            : '🚀 每次启动 Modera 时播放一次：关（只在新建会话时播）',
        ),
        h(
          'span',
          { className: 'dba-note' },
          snapshot.settings.playOnAppStart
            ? '同一轮使用中不重复；下次打开 Modera 再播'
            : '只在新建会话时播一次',
        ),
      ),
      h(
        'div',
        { className: 'dba-bar' },
        h(
          'button',
          {
            type: 'button',
            className: 'dba-btn',
            title: '立刻按当前设置播一次（随机开启时就是从全部片段里随机挑一段）',
            onClick: () => void store.playMode(snapshot.settings.randomPlayback ? 'random' : 'selected', 'active'),
          },
          '▶ 播一次',
        ),
        h('button', { type: 'button', className: 'dba-btn', onClick: () => void store.loadCatalog() }, '刷新'),
        h('button', { type: 'button', className: 'dba-btn', onClick: onClose }, '关闭'),
      ),
      h('div', { className: 'dba-msg ' + snapshot.status.kind }, snapshot.status.text),
    ),
  )
}
