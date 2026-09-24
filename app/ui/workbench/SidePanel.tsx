'use client'
import React, { useState } from 'react'
import { Button, Empty, Input, Popconfirm, Progress, TabPane, Tabs, Toast, Tooltip, Typography } from '@douyinfe/semi-ui'
import { IconDelete, IconDownload, IconEdit, IconFlag, IconScissors } from '@douyinfe/semi-icons'
import { deleteMarker, formatSessionTime, type Marker, renameMarker, ReportedError } from '@/app/lib/markers'
import { type ClipDraft, removeDrafts } from '@/app/lib/clip-drafts'
import {
  type Clip,
  type ClipMode,
  clipModeText,
  createClip,
  deleteClip,
  downloadClip,
  exportClip,
  extensionOf,
  isMp4,
  MAX_TITLE_CHARS,
  updateClip,
} from '@/app/lib/clips'
import { formatSize } from '@/app/lib/use-dashboard'
import { formatPrecise, formatSpan } from '@/app/lib/sessions'
import styles from './workbench.module.scss'

const MAX_LABEL_CHARS = 100

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function InlineRename({
  initial,
  placeholder,
  maxLength = MAX_LABEL_CHARS,
  onSave,
  onCancel,
}: {
  initial: string
  placeholder: string
  maxLength?: number
  onSave: (label: string) => Promise<void> | void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      await onSave(value.trim())
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className={styles.renameRow}>
      <Input
        size="small"
        autoFocus
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label="名字"
        disabled={saving}
        onChange={setValue}
        onEnterPress={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
      />
      <Button size="small" theme="solid" loading={saving} onClick={save}>
        保存
      </Button>
      <Button size="small" theme="borderless" type="tertiary" disabled={saving} onClick={onCancel}>
        取消
      </Button>
    </div>
  )
}

function rangeText(m: Marker): string {
  const parts: string[] = []
  if (m.lookback_ms) parts.push(`前 ${formatSpan(m.lookback_ms)}`)
  if (m.lookahead_ms) parts.push(`后 ${formatSpan(m.lookahead_ms)}`)
  return parts.length ? `默认范围：${parts.join('、')}` : '没有默认范围'
}

function MarkerRow({
  marker,
  current,
  canEdit,
  editReason,
  onSeek,
  onSelect,
}: {
  marker: Marker
  current: boolean
  canEdit: boolean
  editReason: string
  onSeek: (m: Marker) => void
  /** 窄屏没有选段，不给这个动作 */
  onSelect?: (m: Marker) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const time = formatSessionTime(marker.at_ms)
  return (
    <li id={`marker-row-${marker.id}`} className={styles.row} data-current={current || undefined}>
      <button
        type="button"
        className={styles.rowTime}
        onClick={() => onSeek(marker)}
        title={`跳到 ${time}`}
        style={marker.color ? { color: marker.color } : undefined}
      >
        <IconFlag size="small" aria-hidden="true" />
        {time}
      </button>
      <div className={styles.rowBody}>
        {renaming ? (
          <InlineRename
            initial={marker.label}
            placeholder={`给 ${time} 的标记起个名字`}
            onCancel={() => setRenaming(false)}
            onSave={async (label) => {
              try {
                await renameMarker(marker.session_id, marker.id, label)
                setRenaming(false)
              } catch (e) {
                if (!(e instanceof ReportedError)) Toast.error({ content: `改名失败：${errorText(e)}`, duration: 4 })
              }
            }}
          />
        ) : (
          <>
            <span className={styles.rowLabel} data-empty={!marker.label || undefined}>
              {marker.label || '未命名标记'}
            </span>
            <span className={styles.rowMeta}>{rangeText(marker)}</span>
          </>
        )}
      </div>
      {renaming ? null : (
        <div className={styles.rowActions}>
          {onSelect ? (
            <Tooltip content="按这个标记的默认范围建一个选段（入点、出点吸附到关键帧）">
              <Button
                size="small"
                theme="borderless"
                icon={<IconScissors />}
                aria-label={`按 ${time} 的标记选段`}
                onClick={() => onSelect(marker)}
              />
            </Tooltip>
          ) : null}
          <Tooltip content={canEdit ? '改名' : editReason}>
            <Button
              size="small"
              theme="borderless"
              icon={<IconEdit />}
              aria-label={`给 ${time} 的标记改名`}
              disabled={!canEdit}
              onClick={() => setRenaming(true)}
            />
          </Tooltip>
          {canEdit ? (
            <Popconfirm
              title="删除这个标记？"
              content={`${time} ${marker.label}`}
              okText="删除"
              okType="danger"
              onConfirm={() =>
                deleteMarker(marker.session_id, marker.id).then(
                  () => Toast.success({ content: `已删除 ${time} 的标记`, duration: 2 }),
                  (e: unknown) => {
                    if (!(e instanceof ReportedError)) Toast.error({ content: `删除失败：${errorText(e)}`, duration: 4 })
                  }
                )
              }
            >
              <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} aria-label={`删除 ${time} 的标记`} />
            </Popconfirm>
          ) : (
            <Tooltip content={editReason}>
              <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} aria-label="删除" disabled />
            </Tooltip>
          )}
        </div>
      )}
    </li>
  )
}

function ClipStatus({ clip }: { clip: Clip }) {
  if (clip.state === 'exporting') {
    const ratio = clip.progress?.ratio ?? null
    return (
      <div className={styles.clipStatus} data-state="exporting" role="status">
        <span>
          正在剪 · {clip.progress?.phase ?? '准备中'}
          {ratio !== null ? ` ${Math.round(ratio * 100)}%` : ''}
        </span>
        {ratio !== null ? (
          <Progress percent={Math.round(ratio * 100)} size="small" aria-label="导出进度" className={styles.clipProgress} />
        ) : null}
      </div>
    )
  }
  if (clip.state === 'ready' || clip.state === 'published') {
    const widened =
      clip.cut_in_ms !== null &&
      clip.cut_out_ms !== null &&
      (clip.cut_in_ms !== clip.in_ms || clip.cut_out_ms !== clip.out_ms)
    const facts = [
      clipModeText(clip.mode),
      extensionOf(clip).slice(1).toUpperCase(),
      clip.output_bytes !== null ? formatSize(clip.output_bytes) : null,
      clip.duration_ms !== null ? formatSpan(clip.duration_ms) : null,
    ].filter(Boolean)
    return (
      <div className={styles.clipStatus} data-state="ready">
        <span>
          {clip.state === 'published' ? '已发布' : '已剪好'} · {facts.join(' · ')}
        </span>
        {widened ? (
          <span className={styles.rowMeta}>
            实际切在 {formatPrecise(clip.cut_in_ms!)} → {formatPrecise(clip.cut_out_ms!)}（对齐关键帧）
          </span>
        ) : null}
      </div>
    )
  }
  if (clip.state === 'failed') {
    return (
      <div className={styles.clipStatus} data-state="failed" role="alert">
        失败{clip.mode ? `（${clipModeText(clip.mode)}）` : ''}：{clip.error || '原因未知'}
      </div>
    )
  }
  return (
    <div className={styles.clipStatus} data-state="draft">
      还没导出
    </div>
  )
}

const QUICK_TIP = '按关键帧切，不转码，几秒就好；入点、出点对齐到关键帧（可能比选段略宽），保持录像原格式'
const PRECISE_TIP = '用服务器上的 ffmpeg 转码成 H.264 / AAC 的 MP4，首尾帧对准选段；较慢，占 CPU'

function ExportButton({
  mode,
  clip,
  ffmpeg,
  canEdit,
  editReason,
  label,
  primary,
}: {
  mode: ClipMode
  clip: Clip
  ffmpeg: FfmpegState
  canEdit: boolean
  editReason: string
  label: string
  primary?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const reason = !canEdit ? editReason : mode === 'precise' ? ffmpeg.reason : null
  const run = async () => {
    setBusy(true)
    try {
      await exportClip(clip, mode)
    } catch (e) {
      if (!(e instanceof ReportedError)) Toast.error({ content: `没能开始导出：${errorText(e)}`, duration: 4 })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Tooltip content={reason ?? (mode === 'quick' ? QUICK_TIP : PRECISE_TIP)}>
      <span className={styles.inlineWrap}>
        <Button
          size="small"
          theme={primary ? 'solid' : 'light'}
          loading={busy}
          disabled={reason !== null}
          onClick={run}
        >
          {label}
        </Button>
      </span>
    </Tooltip>
  )
}

function DownloadButton({
  clip,
  format,
  label,
  disabledReason,
  canDownload,
}: {
  clip: Clip
  format: 'source' | 'mp4'
  label: string
  disabledReason: string | null
  canDownload: boolean
}) {
  const [busy, setBusy] = useState(false)
  const reason = !canDownload ? '没有下载文件的权限：需要 file.view' : disabledReason
  const run = async () => {
    setBusy(true)
    try {
      await downloadClip(clip, format)
    } catch (e) {
      if (!(e instanceof ReportedError)) Toast.error({ content: `下载失败：${errorText(e)}`, duration: 5 })
    } finally {
      setBusy(false)
    }
  }
  const button = (
    <Button size="small" theme="light" icon={<IconDownload />} loading={busy} disabled={reason !== null} onClick={run}>
      {busy && format === 'mp4' && !isMp4(clip) ? '正在转 MP4…' : label}
    </Button>
  )
  return reason !== null ? (
    <Tooltip content={reason}>
      <span className={styles.inlineWrap}>{button}</span>
    </Tooltip>
  ) : (
    button
  )
}

function ClipTools({
  clip,
  ffmpeg,
  canEdit,
  editReason,
  canDownload,
}: {
  clip: Clip
  ffmpeg: FfmpegState
  canEdit: boolean
  editReason: string
  canDownload: boolean
}) {
  if (clip.state === 'exporting' || clip.state === 'published' || clip.state === 'discarded') return null
  const ext = extensionOf(clip)
  if (clip.state === 'ready') {
    const other: ClipMode = clip.mode === 'precise' ? 'quick' : 'precise'
    return (
      <div className={styles.clipTools}>
        <DownloadButton
          clip={clip}
          format="source"
          label={`下载 ${ext.slice(1).toUpperCase() || '文件'}`}
          disabledReason={null}
          canDownload={canDownload}
        />
        {isMp4(clip) ? null : (
          <DownloadButton
            clip={clip}
            format="mp4"
            label="MP4"
            disabledReason={
              ffmpeg.reason
                ? `${ffmpeg.reason}。可以先下载源格式（${ext.slice(1).toUpperCase()}），多数播放器和剪辑软件能直接打开`
                : null
            }
            canDownload={canDownload}
          />
        )}
        <ExportButton
          mode={other}
          clip={clip}
          ffmpeg={ffmpeg}
          canEdit={canEdit}
          editReason={editReason}
          label={other === 'precise' ? '改用精确剪' : '改用快速剪'}
        />
      </div>
    )
  }
  const retry = clip.state === 'failed' ? (clip.mode ?? 'quick') : null
  return (
    <div className={styles.clipTools}>
      {retry ? (
        <ExportButton
          mode={retry}
          clip={clip}
          ffmpeg={ffmpeg}
          canEdit={canEdit}
          editReason={editReason}
          label={`重试${clipModeText(retry)}`}
          primary
        />
      ) : null}
      {retry !== 'quick' ? (
        <ExportButton
          mode="quick"
          clip={clip}
          ffmpeg={ffmpeg}
          canEdit={canEdit}
          editReason={editReason}
          label="快速剪"
          primary={!retry}
        />
      ) : null}
      {retry !== 'precise' ? (
        <ExportButton
          mode="precise"
          clip={clip}
          ffmpeg={ffmpeg}
          canEdit={canEdit}
          editReason={editReason}
          label="精确剪"
        />
      ) : null}
    </div>
  )
}

function ClipRow({
  clip,
  active,
  warning,
  ffmpeg,
  canEdit,
  editReason,
  canDownload,
  onLoad,
}: {
  clip: Clip
  active: boolean
  warning: string | null
  ffmpeg: FfmpegState
  canEdit: boolean
  editReason: string
  canDownload: boolean
  onLoad: (c: Clip) => void
}) {
  const [renaming, setRenaming] = useState(false)
  return (
    <li className={styles.row} data-current={active || undefined} data-clip-state={clip.state}>
      <button type="button" className={styles.rowTime} onClick={() => onLoad(clip)} title="载入到细节条，跳到入点">
        <IconScissors size="small" aria-hidden="true" />
        {formatSessionTime(clip.in_ms)}
      </button>
      <div className={styles.rowBody}>
        {renaming ? (
          <InlineRename
            initial={clip.title}
            placeholder="给这个切片起个名字（下载时用作文件名）"
            maxLength={MAX_TITLE_CHARS}
            onCancel={() => setRenaming(false)}
            onSave={async (title) => {
              try {
                await updateClip(clip, { title })
                setRenaming(false)
              } catch (e) {
                if (!(e instanceof ReportedError)) Toast.error({ content: `改名失败：${errorText(e)}`, duration: 4 })
              }
            }}
          />
        ) : (
          <>
            <span className={styles.rowLabel} data-empty={!clip.title || undefined}>
              {clip.title || `未命名切片 #${clip.id}`}
            </span>
            <span className={styles.rowMeta}>
              {formatPrecise(clip.in_ms)} → {formatPrecise(clip.out_ms)} · {formatSpan(clip.out_ms - clip.in_ms)}
            </span>
            <ClipStatus clip={clip} />
            {warning ? <span className={styles.rowWarn}>{warning}</span> : null}
            <ClipTools clip={clip} ffmpeg={ffmpeg} canEdit={canEdit} editReason={editReason} canDownload={canDownload} />
          </>
        )}
      </div>
      {renaming ? null : (
        <div className={styles.rowActions}>
          <Tooltip content={canEdit ? '改名' : editReason}>
            <Button
              size="small"
              theme="borderless"
              icon={<IconEdit />}
              aria-label="给切片改名"
              disabled={!canEdit}
              onClick={() => setRenaming(true)}
            />
          </Tooltip>
          {canEdit ? (
            <Popconfirm
              title="删除这个切片？"
              content={clip.state === 'exporting' ? '正在进行的导出会停下，' : clip.file_name ? '导出的文件会一起删掉' : undefined}
              okText="删除"
              okType="danger"
              onConfirm={() =>
                deleteClip(clip).then(
                  () => Toast.success({ content: '已删除切片', duration: 2 }),
                  (e: unknown) => {
                    if (!(e instanceof ReportedError)) Toast.error({ content: `删除失败：${errorText(e)}`, duration: 4 })
                  }
                )
              }
            >
              <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} aria-label="删除切片" />
            </Popconfirm>
          ) : (
            <Tooltip content={editReason}>
              <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} aria-label="删除" disabled />
            </Tooltip>
          )}
        </div>
      )}
    </li>
  )
}

/** 旧版剪辑台存在本机的选段：由用户决定存到服务器还是丢弃，不自动迁移 */
function LegacyDrafts({
  sessionId,
  drafts,
  markers,
  canEdit,
}: {
  sessionId: number
  drafts: ClipDraft[]
  markers: Marker[]
  canEdit: boolean
}) {
  const [busy, setBusy] = useState(false)
  if (drafts.length === 0) return null
  const upload = async () => {
    setBusy(true)
    const done: string[] = []
    let failure: string | null = null
    for (const d of drafts) {
      try {
        await createClip(sessionId, {
          in_ms: d.in_ms,
          out_ms: d.out_ms,
          title: d.label.trim().slice(0, MAX_TITLE_CHARS),
          marker_id: d.marker_id !== null && markers.some((m) => m.id === d.marker_id) ? d.marker_id : null,
        })
        done.push(d.id)
      } catch (e) {
        failure = errorText(e)
        if (e instanceof ReportedError) break
      }
    }
    removeDrafts(sessionId, done)
    setBusy(false)
    if (failure) {
      Toast.warning({
        content: `存了 ${done.length} 个，${drafts.length - done.length} 个没存上：${failure}。没存上的还留在本机`,
        duration: 6,
      })
    } else {
      Toast.success({ content: `已把 ${done.length} 个选段存到服务器`, duration: 3 })
    }
  }
  return (
    <div className={styles.legacy} role="region" aria-label="本机的旧选段">
      <span>
        这台浏览器里还有 {drafts.length} 个旧版选段（导出功能上线前只存在本机）。存到服务器后才能导出、别的设备也看得到。
      </span>
      <span className={styles.legacyActions}>
        <Tooltip content={canEdit ? '逐个建成切片，建好的从本机删掉' : '需要 clip.edit 权限'}>
          <span className={styles.inlineWrap}>
            <Button size="small" theme="solid" loading={busy} disabled={!canEdit} onClick={upload}>
              存到服务器
            </Button>
          </span>
        </Tooltip>
        <Popconfirm
          title={`丢弃本机的 ${drafts.length} 个旧选段？`}
          content="只删这台浏览器里的记录，服务器上的切片不受影响"
          okText="丢弃"
          okType="danger"
          onConfirm={() => removeDrafts(sessionId, drafts.map((d) => d.id))}
        >
          <Button size="small" theme="borderless" type="tertiary" disabled={busy}>
            丢弃
          </Button>
        </Popconfirm>
      </span>
    </div>
  )
}

export type PanelTab = 'markers' | 'clips'
type FfmpegState = { ready: boolean; reason: string | null }

export function SidePanel({
  sessionId,
  tab,
  onTab,
  markers,
  markersLoading,
  markersError,
  clips,
  clipsLoading,
  clipsError,
  legacyDrafts,
  activeClip,
  clipWarning,
  currentMarker,
  canEdit,
  editReason,
  canDownload,
  ffmpeg,
  onSeekMarker,
  onSelectMarker,
  onLoadClip,
  compact,
}: {
  sessionId: number
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  markers: Marker[]
  markersLoading: boolean
  markersError: boolean
  clips: Clip[]
  clipsLoading: boolean
  clipsError: boolean
  legacyDrafts: ClipDraft[]
  activeClip: number | null
  clipWarning: (c: Clip) => string | null
  currentMarker: number | null
  canEdit: boolean
  editReason: string
  canDownload: boolean
  ffmpeg: FfmpegState
  onSeekMarker: (m: Marker) => void
  onSelectMarker: (m: Marker) => void
  onLoadClip: (c: Clip) => void
  /** 手机宽度：只有标记列表 */
  compact: boolean
}) {
  const { Text } = Typography
  const markerList = (
    <>
      {!canEdit ? (
        <Text type="tertiary" size="small" className={styles.panelNote}>
          {editReason}
        </Text>
      ) : null}
      {markersError ? (
        <Empty description="标记列表加载失败，稍后会自动重试" className={styles.empty} />
      ) : markers.length === 0 ? (
        <Empty
          description={markersLoading ? '正在加载标记…' : '这一场还没有标记。按「标记」或 M 在当前画面打一个'}
          className={styles.empty}
        />
      ) : (
        <ul className={styles.list} aria-label="标记列表">
          {markers.map((m) => (
            <MarkerRow
              key={m.id}
              marker={m}
              current={currentMarker === m.id}
              canEdit={canEdit}
              editReason={editReason}
              onSeek={onSeekMarker}
              onSelect={compact ? undefined : onSelectMarker}
            />
          ))}
        </ul>
      )}
    </>
  )
  if (compact) {
    return (
      <section className={styles.panel} data-compact="true" aria-label="标记">
        <div className={styles.panelHead}>
          <IconFlag aria-hidden="true" /> 标记 <span className={styles.panelCount}>{markers.length}</span>
        </div>
        {markerList}
      </section>
    )
  }
  return (
    <section className={styles.panel} aria-label="标记与切片">
      <Tabs type="line" size="small" activeKey={tab} onChange={(k) => onTab(k as PanelTab)} keepDOM={false}>
        <TabPane tab={`标记 ${markers.length}`} itemKey="markers">
          {markerList}
        </TabPane>
        <TabPane tab={`切片 ${clips.length}`} itemKey="clips">
          <LegacyDrafts sessionId={sessionId} drafts={legacyDrafts} markers={markers} canEdit={canEdit} />
          <Text type="tertiary" size="small" className={styles.panelNote}>
            快速剪按关键帧切、不转码；精确剪用 ffmpeg 转码成 MP4，首尾对准选段。文件存在服务器的 clips 目录下。
          </Text>
          {clipsError && clips.length === 0 ? (
            <Empty description="切片列表加载失败，稍后会自动重试" className={styles.empty} />
          ) : clips.length === 0 ? (
            <Empty
              description={
                clipsLoading
                  ? '正在加载切片…'
                  : '还没有切片。在细节条上用 I / O（或「入点」「出点」按钮）选一段，再点「存为切片」'
              }
              className={styles.empty}
            />
          ) : (
            <ul className={styles.list} aria-label="切片列表">
              {clips.map((c) => (
                <ClipRow
                  key={c.id}
                  clip={c}
                  active={activeClip === c.id}
                  warning={clipWarning(c)}
                  ffmpeg={ffmpeg}
                  canEdit={canEdit}
                  editReason={editReason}
                  canDownload={canDownload}
                  onLoad={onLoadClip}
                />
              ))}
            </ul>
          )}
        </TabPane>
      </Tabs>
    </section>
  )
}
