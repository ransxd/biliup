'use client'
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { Button, Empty, Spin, Switch, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui'
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconFlag,
  IconLive,
  IconPause,
  IconPlay,
  IconRefresh,
  IconScissors,
  IconVolume2,
  IconVolumnSilent,
} from '@douyinfe/semi-icons'
import PageHeader from '../components/PageHeader'
import { fetcher, type LiveStreamerEntity } from '@/app/lib/api-streamer'
import { useMe } from '@/app/lib/use-me'
import { canPreview, formatSize, previewDisabledReason } from '@/app/lib/use-dashboard'
import { useWindowWidth } from '@/app/lib/useIsMobile'
import {
  createLiveMarker,
  createMarkerAt,
  formatSessionTime,
  type Marker,
  markersUrl,
  playerLatencyMs,
  ReportedError,
} from '@/app/lib/markers'
import {
  ceilPoint,
  cutPoints,
  dvrContainer,
  floorPoint,
  formatPrecise,
  formatSpan,
  gapsIn,
  hasPlayableMedia,
  isFragmentedMp4,
  isReadable,
  type KeyframeList,
  keyframesUrl,
  type SegmentView,
  segmentAt,
  type SessionDetail,
  segmentEnd,
  sessionUrl,
  unavailableIn,
} from '@/app/lib/sessions'
import { useClipDrafts } from '@/app/lib/clip-drafts'
import { type Clip, type ClipMode, createClip, updateClip, useFfmpeg, useSessionClips } from '@/app/lib/clips'
import { useBoolPref } from '@/app/lib/use-local-pref'
import { LivePreviewPlayer } from '@/app/ui/LivePreview'
import { isTyping, showMarkerToast } from '@/app/ui/MarkerControls'
import DvrPlayer, { type DvrHandle, type DvrPhase } from '@/app/ui/workbench/DvrPlayer'
import { DetailBar, OverviewBar, type Selection } from '@/app/ui/workbench/Timeline'
import { DanmakuDensity } from '@/app/ui/workbench/DanmakuDensity'
import { type PanelTab, SidePanel } from '@/app/ui/workbench/SidePanel'
import styles from '@/app/ui/workbench/workbench.module.scss'

/** 细节条的范围：当前位置前后各 5 分钟 */
const DETAIL_HALF_MS = 5 * 60_000
/** 播放头离细节条边缘不到这么远就把细节条挪到以它为中心 */
const DETAIL_EDGE_MS = 60_000
/** 细节条的关键帧按整分钟取，挪动一点不必重新请求 */
const KEYFRAME_GRID_MS = 60_000
/** J / L 跳多远 */
const JUMP_MS = 10_000
/** 暂停超过这么久就断开回看连接：服务端按 1 倍速持续发送，暂停着不断开浏览器缓冲会一直涨 */
const DETACH_AFTER_PAUSE_MS = 20_000
/** 场次进行中时，详情（分段、时长）和细节条末尾的关键帧多久刷新一次 */
const LIVE_REFRESH_MS = 3_000
/** 刚开录时详情里已经有画面、盘上还没有（下载器写盘有缓冲），回看返回 404；隔这么久重试 */
const NO_MEDIA_RETRY_MS = 3_000
/** 手机宽度：只留播放器、标记按钮和标记列表 */
const COMPACT_WIDTH = 760

/**
 * 进行中、或还没有能播的画面时定时刷新详情。放在组件外：SWR 按引用比较这个选项，
 * 每次渲染换一个新函数会重置计时器，回看时每秒几次的重渲染会让它永远等不到点。
 */
const detailRefreshInterval = (d?: SessionDetail) => (!d || d.recording || !hasPlayableMedia(d) ? LIVE_REFRESH_MS : 0)

type Mode =
  | { kind: 'dvr'; from: number; nonce: number }
  | { kind: 'live' }
  /** 暂停太久（或在直播里暂停）后断开了连接，停在 `at` */
  | { kind: 'detached'; at: number }

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className={styles.kbd} aria-hidden="true">
      {children}
    </kbd>
  )
}

export default function WorkbenchPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.center}>
          <Spin size="large" />
        </div>
      }
    >
      <WorkbenchRoute />
    </Suspense>
  )
}

function WorkbenchRoute() {
  const params = useSearchParams()
  const router = useRouter()
  const raw = params.get('session')
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : null
  const t = params.get('t')
  const initialT = t && /^\d+$/.test(t) ? Number(t) : null
  if (id === null) {
    return (
      <>
        <PageHeader icon={<IconScissors size="large" />} title="剪辑台" />
        <div className={styles.center}>
          <Empty
            title="没有指定场次"
            description="从「历史记录 → 场次」里点「打开剪辑台」进入"
          >
            <Button theme="solid" onClick={() => router.push('/history')}>
              去历史记录
            </Button>
          </Empty>
        </div>
      </>
    )
  }
  return <Workbench key={id} sessionId={id} initialT={initialT} />
}

function Workbench({ sessionId, initialT }: { sessionId: number; initialT: number | null }) {
  const { Text } = Typography
  const router = useRouter()
  const { can, isLoading: meLoading } = useMe()
  const canEdit = can('clip.edit')
  const canDownload = can('file.view')
  const editReason = meLoading
    ? '正在读取权限…'
    : '只读观察者不能改标记和切片：需要 clip.edit 权限，请让管理员把你的角色改成操作员'
  const ffmpeg = useFfmpeg()
  const width = useWindowWidth()
  const compact = width < COMPACT_WIDTH

  // ---------- 数据 ----------
  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
    mutate: reloadDetail,
  } = useSWR<SessionDetail>(sessionUrl(sessionId), fetcher, {
    refreshInterval: detailRefreshInterval,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const notFound = detailError && /不存在|404/.test(errorText(detailError))
  const {
    data: markerData,
    error: markersError,
    isLoading: markersLoading,
  } = useSWR<{ markers: Marker[] }>(markersUrl(sessionId), fetcher, {
    refreshInterval: detail?.recording ? 10_000 : 0,
  })
  const markers = useMemo(() => markerData?.markers ?? [], [markerData])
  const { data: streamers, error: streamersError } = useSWR<LiveStreamerEntity[]>(
    detail?.recording ? '/v1/streamers' : null,
    fetcher,
    { refreshInterval: 10_000 }
  )
  const { data: clipData, error: clipsError, isLoading: clipsLoading } = useSessionClips(sessionId)
  const clips = useMemo(() => clipData?.clips ?? [], [clipData])
  const legacyDrafts = useClipDrafts(sessionId)

  const segments = useMemo(() => detail?.segments ?? [], [detail])
  const gaps = useMemo(() => detail?.gaps ?? [], [detail])
  /** 时间轴画到最后一个分段的末尾：后端的场次时长只算可读分段，末尾已清理的分段也要画出来 */
  const duration = segments.reduce((end, s) => Math.max(end, segmentEnd(s)), detail?.duration_ms ?? 0)
  const playable = detail ? hasPlayableMedia(detail) : false
  const readableSegments = segments.filter(isReadable)
  const onlyFmp4 = readableSegments.length > 0 && readableSegments.every(isFragmentedMp4)

  const liveStreamer = useMemo(
    () => (detail ? streamers?.find((s) => s.id === detail.streamer_id && s.session_id === detail.id) : undefined),
    [detail, streamers]
  )
  const liveReason: string | null = !detail
    ? '正在加载'
    : !detail.recording
      ? '这一场已经结束'
      : !streamers && !streamersError
        ? '正在查找直播间'
        : !liveStreamer
          ? '找不到正在录这一场的直播间'
          : !canPreview(liveStreamer)
            ? (previewDisabledReason(liveStreamer) ?? '这一路暂时不能预览')
            : null
  const liveReady = !detail?.recording || !!streamers || !!streamersError

  // ---------- 播放模式 ----------
  const [mode, setMode] = useState<Mode | null>(null)
  // 第一次拿齐数据时定下起始模式（进行中且能预览 → 直播；否则从头 / 从 ?t= 回看），之后只由用户操作改变
  if (mode === null && detail && liveReady && (playable || liveReason === null)) {
    setMode(
      initialT !== null || liveReason !== null || !detail.recording
        ? { kind: 'dvr', from: initialT ?? 0, nonce: 0 }
        : { kind: 'live' }
    )
  }
  const [phase, setPhase] = useState<DvrPhase>('connecting')
  const [message, setMessage] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [pos, setPos] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [muted, setMuted] = useState(false)
  const dvrRef = useRef<DvrHandle>(null)
  const liveRootRef = useRef<HTMLDivElement>(null)

  const live = mode?.kind === 'live'
  /** 现在画面对应的场次时间；直播时按时间轴末尾减去播放器缓冲估算 */
  const current = (): number => {
    if (!mode) return 0
    if (mode.kind === 'live') return Math.max(0, duration - (playerLatencyMs(liveRootRef.current) ?? 0))
    if (mode.kind === 'detached') return mode.at
    return dvrRef.current?.position() ?? pos ?? mode.from
  }
  const playhead = !mode
    ? null
    : mode.kind === 'live'
      ? duration
      : mode.kind === 'detached'
        ? mode.at
        : (pos ?? mode.from)

  // ---------- 细节条范围 ----------
  const center = focus ?? playhead ?? 0
  const winFrom = Math.max(0, Math.min(center - DETAIL_HALF_MS, duration - 2 * DETAIL_HALF_MS))
  const winTo = Math.max(winFrom + Math.min(2 * DETAIL_HALF_MS, Math.max(duration, 60_000)), winFrom + 1000)
  const kFrom = Math.floor(winFrom / KEYFRAME_GRID_MS) * KEYFRAME_GRID_MS
  const kTo = Math.ceil(winTo / KEYFRAME_GRID_MS) * KEYFRAME_GRID_MS
  const nearTail = !!detail?.recording && kTo >= duration - KEYFRAME_GRID_MS
  const {
    data: keyframeData,
    isLoading: keyframesLoading,
  } = useSWR<KeyframeList>(playable ? keyframesUrl(sessionId, kFrom, kTo) : null, fetcher, {
    keepPreviousData: true,
    refreshInterval: nearTail ? LIVE_REFRESH_MS : 0,
    revalidateOnFocus: false,
  })
  const keyframes = useMemo(() => keyframeData?.keyframes ?? [], [keyframeData])
  const points = useMemo(() => cutPoints(keyframes, segments, kFrom, kTo), [keyframes, segments, kFrom, kTo])
  const windowPoints = useMemo(() => points.filter((p) => p >= winFrom && p <= winTo), [points, winFrom, winTo])

  // ---------- 选段 ----------
  const [selection, setSelection] = useState<Selection>({ in: null, out: null })
  const [activeClip, setActiveClip] = useState<number | null>(null)
  /** 选段是按哪个标记建的；存成切片时带上 */
  const [selectionMarker, setSelectionMarker] = useState<number | null>(null)
  const [snap, setSnap] = useBoolPref('biliup.workbench.snap', true)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<PanelTab>('markers')
  const [pickedMarker, setPickedMarker] = useState<number | null>(null)

  const blocked = useCallback((segment: SegmentView) => {
    Toast.warning({
      id: 'segment-blocked',
      content: `这一段录像${segment.state === 'missing' ? '文件已经不在了' : '已被清理'}，不能回看，也不能剪进切片`,
      duration: 3,
    })
  }, [])

  const openAt = (ms: number) => {
    setMessage(null)
    setPhase('connecting')
    setMode((m) => ({ kind: 'dvr', from: Math.max(0, Math.round(ms)), nonce: (m?.kind === 'dvr' ? m.nonce : 0) + 1 }))
  }

  const seek = (target: number) => {
    const ms = Math.min(Math.max(0, target), Math.max(0, duration))
    const seg = segmentAt(segments, ms)
    if (seg && !isReadable(seg)) {
      blocked(seg)
      return
    }
    if (onlyFmp4) {
      Toast.warning({ id: 'fmp4', content: '分片 MP4 录像暂不支持回看', duration: 3 })
      return
    }
    setPos(ms)
    setFocus(ms)
    if (mode?.kind === 'dvr' && dvrRef.current?.seekWithin(ms)) return
    openAt(ms)
  }

  const onPosition = (ms: number) => {
    // 服务端在同一条响应里跳过已清理 / 丢失的分段（时间戳照场次时间往后跳），mpegts.js 会把这种跳变抹平接着放，
    // 这时按起播点推算的位置会落进不可读的分段里、比真实画面慢一截：从下一个可读分段重开，把位置对回来
    // 只认严格落在不可读分段内部、且离起播点有一段距离的位置：分段首尾相接，边界上的位置也属于下一个可读分段
    const seg = segments.find((s) => ms > s.start_ms && ms < segmentEnd(s))
    const inCleaned =
      mode?.kind === 'dvr' &&
      ms > mode.from + 500 &&
      !!seg &&
      !isReadable(seg) &&
      !segments.some((s) => isReadable(s) && ms >= s.start_ms && ms <= segmentEnd(s))
    if (inCleaned) {
      const end = segmentEnd(seg)
      const next = segments.find((s) => isReadable(s) && s.start_ms >= end)
      if (next) {
        Toast.info({ id: 'deleted-skip', content: `跳过已清理的录像，从 ${formatSessionTime(next.start_ms)} 继续`, duration: 2 })
        setPos(next.start_ms)
        openAt(next.start_ms)
        return
      }
    }
    setPos(ms)
    setFocus((f) => {
      const c = f ?? ms
      const from = Math.max(0, c - DETAIL_HALF_MS)
      const to = from + 2 * DETAIL_HALF_MS
      return ms < from + DETAIL_EDGE_MS || ms > to - DETAIL_EDGE_MS ? ms : f
    })
  }
  const onPhase = useCallback((p: DvrPhase, text?: string, status?: number) => {
    setPhase(p)
    setMessage(p === 'error' ? (text ?? '回看出错') : null)
    setErrorStatus(p === 'error' ? (status ?? null) : null)
  }, [])
  // 响应结束：断流缺口 / 编码参数变化处从下一个可读分段接着放；没有下一段就停在这里
  const onEnded = (lastMs: number) => {
    let index = -1
    segments.forEach((s, i) => {
      if (s.start_ms <= lastMs + 500) index = i
    })
    const next = segments.slice(index + 1).find(isReadable)
    if (next && mode?.kind === 'dvr' && next.start_ms > mode.from) {
      if (next.gap_before_ms > 0) {
        Toast.info({ id: 'gap-skip', content: `跳过 ${formatSpan(next.gap_before_ms)} 的断流，从下一段继续`, duration: 2 })
      }
      setPos(next.start_ms)
      openAt(next.start_ms)
      return
    }
    setPos(lastMs)
    setMessage(detail?.recording ? '已经放到最新的画面' : '这一场放完了')
  }

  // 暂停太久就断开回看连接（服务端照常按 1 倍速发送，不断开浏览器缓冲会一直涨），继续时从停下的地方重开
  const modeKind = mode?.kind
  useEffect(() => {
    if (modeKind !== 'dvr' || phase !== 'paused') return
    const timer = setTimeout(() => {
      const at = dvrRef.current?.position()
      if (at !== undefined) setMode({ kind: 'detached', at })
    }, DETACH_AFTER_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [modeKind, phase])

  const recording = !!detail?.recording
  const retryFrom = mode?.kind === 'dvr' && phase === 'error' && errorStatus === 404 && recording ? mode.from : null
  useEffect(() => {
    if (retryFrom === null) return
    const timer = setTimeout(
      () => setMode((m) => (m?.kind === 'dvr' ? { kind: 'dvr', from: retryFrom, nonce: m.nonce + 1 } : m)),
      NO_MEDIA_RETRY_MS
    )
    return () => clearTimeout(timer)
  }, [retryFrom])

  const playing = mode?.kind === 'live' || (mode?.kind === 'dvr' && (phase === 'playing' || phase === 'waiting'))
  const togglePlay = () => {
    if (!mode) return
    if (mode.kind === 'live') {
      setMode({ kind: 'detached', at: current() })
      return
    }
    if (mode.kind === 'detached') {
      openAt(mode.at)
      return
    }
    if (phase === 'ended' || phase === 'error') {
      openAt(current())
      return
    }
    if (dvrRef.current?.paused()) dvrRef.current.play()
    else dvrRef.current?.pause()
  }

  const goLive = () => {
    if (liveReason !== null) {
      Toast.warning({ id: 'live-off', content: `不能回到直播：${liveReason}`, duration: 3 })
      return
    }
    setPos(null)
    setFocus(null)
    setMessage(null)
    setMode({ kind: 'live' })
  }

  const stepKeyframe = (dir: -1 | 1) => {
    const p = current()
    const kf = keyframes.map((k) => k.t_ms)
    const target = dir < 0 ? floorPoint(kf, p - 300) : ceilPoint(kf, p + 300)
    if (target === null) {
      Toast.info({ id: 'no-keyframe', content: dir < 0 ? '前面没有关键帧了' : '后面还没有关键帧', duration: 2 })
      return
    }
    seek(target)
  }

  const mark = () => {
    if (!mode || !detail) return
    if (!canEdit) {
      Toast.warning({ id: 'marker-disabled', content: editReason, duration: 3 })
      return
    }
    const request =
      mode.kind === 'live'
        ? createLiveMarker(sessionId, { pressedAt: Date.now(), latencyMs: playerLatencyMs(liveRootRef.current) })
        : createMarkerAt(sessionId, current())
    request.then(
      (m) => {
        setPickedMarker(m.id)
        showMarkerToast(m)
      },
      (e: unknown) => {
        if (!(e instanceof ReportedError)) Toast.error({ content: `标记失败：${errorText(e)}`, duration: 4 })
      }
    )
  }

  const setPoint = (which: 'in' | 'out') => {
    const p = current()
    const exact = Math.round(Math.min(Math.max(0, p), duration))
    const value = !snap ? exact : which === 'in' ? floorPoint(points, p) : ceilPoint(points, p)
    if (value === null) {
      Toast.info({
        id: 'no-cut',
        content: which === 'in' ? '这之前还没有关键帧' : '这之后还没有关键帧，等几秒再按',
        duration: 2,
      })
      return
    }
    setSelection((s) =>
      which === 'in'
        ? { in: value, out: s.out !== null && s.out <= value ? null : s.out }
        : { in: s.in !== null && s.in >= value ? null : s.in, out: value }
    )
  }

  const selectionProblem = (from: number | null, to: number | null): string | null => {
    if (from === null || to === null) return null
    const bad = unavailableIn(segments, from, to)
    if (bad.length) return `跨过了 ${bad.length} 段已被清理的录像，不能导出，请缩到可用的范围里`
    return null
  }
  const selectionNote = (from: number, to: number): string | null => {
    const n = gapsIn(gaps, from, to)
    return n ? `跨过 ${n} 个断流缺口，导出时如实拼接，不补黑帧` : null
  }
  const clipWarning = (c: Clip) => selectionProblem(c.in_ms, c.out_ms) ?? selectionNote(c.in_ms, c.out_ms)
  const selProblem = selectionProblem(selection.in, selection.out)
  const loadedClip = clips.find((c) => c.id === activeClip) ?? null
  const clipChanged = !!loadedClip && (loadedClip.in_ms !== selection.in || loadedClip.out_ms !== selection.out)
  const canSave = canEdit && selection.in !== null && selection.out !== null && !selProblem

  /** 存为新切片（`exportMode` 给了就建好立即导出），或把选段改动写回载入的切片 */
  const saveClip = async (asNew: boolean, exportMode?: ClipMode) => {
    if (selection.in === null || selection.out === null) return
    if (!canEdit) {
      Toast.warning({ id: 'clip-disabled', content: editReason, duration: 3 })
      return
    }
    if (selProblem) {
      Toast.warning({ content: selProblem, duration: 3 })
      return
    }
    setSaving(true)
    try {
      if (!asNew && loadedClip) {
        const updated = await updateClip(loadedClip, { in_ms: selection.in, out_ms: selection.out })
        Toast.success({
          content: loadedClip.file_name && !updated.file_name ? '切片范围已更新，之前导出的文件已作废，请重新导出' : '切片范围已更新',
          duration: 3,
        })
        return
      }
      const created = await createClip(sessionId, {
        in_ms: selection.in,
        out_ms: selection.out,
        marker_id: selectionMarker,
        export: exportMode,
      })
      setActiveClip(created.id)
      setTab('clips')
      Toast.success({
        content: `已存为切片（${formatSpan(created.out_ms - created.in_ms)}）${exportMode ? '，正在快速剪' : ''}`,
        duration: 2,
      })
    } catch (e) {
      if (!(e instanceof ReportedError)) Toast.error({ content: `保存切片失败：${errorText(e)}`, duration: 4 })
    } finally {
      setSaving(false)
    }
  }

  const loadClip = (c: Clip) => {
    setActiveClip(c.id)
    setSelectionMarker(c.marker_id)
    setSelection({ in: c.in_ms, out: c.out_ms })
    seek(c.in_ms)
  }

  const pickMarker = (m: Marker) => {
    setPickedMarker(m.id)
    setTab('markers')
    document.getElementById(`marker-row-${m.id}`)?.scrollIntoView({ block: 'nearest' })
    seek(m.at_ms)
  }

  // 按标记的默认范围选段：范围两端不一定在当前细节条里，单独取一次那附近的关键帧
  const selectFromMarker = async (m: Marker) => {
    const a = Math.max(0, m.at_ms - m.lookback_ms)
    const b = Math.min(m.at_ms + m.lookahead_ms, duration)
    try {
      let inMs: number | null = a
      let outMs: number | null = b
      if (snap) {
        const list: KeyframeList = await fetcher(keyframesUrl(sessionId, a - 30_000, b + 30_000))
        const near = cutPoints(list.keyframes, segments, a - 30_000, b + 30_000)
        inMs = floorPoint(near, a) ?? near[0] ?? null
        outMs = ceilPoint(near, b <= a ? a + 1 : b) ?? near[near.length - 1] ?? null
      }
      if (inMs === null || outMs === null || outMs <= inMs) {
        Toast.warning({
          content: snap ? '这个标记附近没有可以落刀的关键帧' : '这个标记的默认范围是空的，请手动选入点、出点',
          duration: 3,
        })
        return
      }
      const problem = selectionProblem(inMs, outMs)
      if (problem) Toast.warning({ content: problem, duration: 3 })
      setActiveClip(null)
      setSelectionMarker(m.id)
      setSelection({ in: inMs, out: outMs })
      setPickedMarker(m.id)
      seek(inMs)
    } catch (e) {
      Toast.error({ content: `读取关键帧失败：${errorText(e)}`, duration: 3 })
    }
  }

  // ---------- 快捷键（都有对应的按钮，快捷键只是加速） ----------
  const keyActions = useRef<(e: KeyboardEvent) => void>(() => {})
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const actions: Record<string, () => void> = {
      ' ': togglePlay,
      k: togglePlay,
      j: () => seek(current() - JUMP_MS),
      l: () => seek(current() + JUMP_MS),
      ArrowLeft: () => stepKeyframe(-1),
      ArrowRight: () => stepKeyframe(1),
      m: mark,
      ...(compact ? {} : { i: () => setPoint('in'), o: () => setPoint('out') }),
    }
    const action = actions[key]
    if (!action || !mode) return
    if (e.repeat && (key === 'm' || key === 'i' || key === 'o' || key === ' ' || key === 'k')) return
    e.preventDefault()
    action()
  }
  useEffect(() => {
    keyActions.current = onKey
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyActions.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // ---------- 渲染 ----------
  const header = (
    <PageHeader
      icon={<IconScissors size="large" />}
      title={detail ? `剪辑台 · ${detail.streamer_name || '未知主播'}` : '剪辑台'}
      description={
        detail ? (
          <span className={styles.headMeta}>
            {detail.recording ? (
              <Tag size="small" color="red">
                录制中
              </Tag>
            ) : (
              <Tag size="small" color="grey">
                已结束
              </Tag>
            )}
            <span className={styles.headTitle} title={detail.title}>
              {detail.title || '无标题'}
            </span>
            <span>
              {new Date(detail.started_at).toLocaleString()} · {formatSessionTime(duration)} · {segments.length} 段
              {detail.bytes ? ` · ${formatSize(detail.bytes)}` : ''}
            </span>
          </span>
        ) : (
          `场次 #${sessionId}`
        )
      }
      actions={
        <Button icon={<IconArrowLeft />} onClick={() => router.push('/history')}>
          <span className={styles.hideNarrow}>返回历史记录</span>
        </Button>
      }
    />
  )

  if (!detail) {
    return (
      <>
        {header}
        <div className={styles.center}>
          {detailLoading ? (
            <Spin size="large" tip="正在加载场次…" />
          ) : notFound ? (
            <Empty
              title={`找不到场次 #${sessionId}`}
              description="可能还没写出第一个分段，或者已经被删除了"
            >
              <Button onClick={() => router.push('/history')}>回到历史记录</Button>
            </Empty>
          ) : (
            <Empty title="加载失败" description={detailError ? errorText(detailError) : '请检查后端连接'}>
              <Button icon={<IconRefresh />} onClick={() => reloadDetail()}>
                重试
              </Button>
            </Empty>
          )}
        </div>
      </>
    )
  }

  const currentMarker =
    pickedMarker ??
    (playhead === null
      ? null
      : (markers.find((m) => Math.abs(m.at_ms - playhead) < 1500)?.id ?? null))
  const timeText = live ? '直播' : `${formatPrecise(playhead ?? 0)} / ${formatSessionTime(duration)}`

  let stage: React.ReactNode
  if (!playable && !live) {
    stage = (
      <div className={styles.stageMessage}>
        {detail.recording ? (
          <>
            <Spin />
            <span>正在等第一段画面…</span>
          </>
        ) : (
          <span>这一场没有可以回看的画面（录像可能已被清理）</span>
        )}
      </div>
    )
  } else if (onlyFmp4 && !live) {
    stage = (
      <div className={styles.stageMessage}>
        <span>
          这一场是分片 MP4 录像（B 站 hls_fmp4），暂不支持回看。可以在直播间设置里改用 FLV 或 TS 协议录制；
          标记和时间轴照常可用。
        </span>
        {liveReason === null ? (
          <Button icon={<IconLive />} onClick={goLive}>
            看直播
          </Button>
        ) : null}
      </div>
    )
  } else if (!mode) {
    stage = (
      <div className={styles.stageMessage}>
        <Spin />
      </div>
    )
  } else if (mode.kind === 'live' && liveStreamer) {
    stage = <LivePreviewPlayer streamer={liveStreamer} />
  } else if (mode.kind === 'live') {
    stage = (
      <div className={styles.stageMessage}>
        <span>直播已经不可用：{liveReason}</span>
        <Button onClick={() => openAt(Math.max(0, duration - 30_000))}>回看最后 30 秒</Button>
      </div>
    )
  } else if (mode.kind === 'detached') {
    stage = (
      <div className={styles.stageMessage}>
        <span>已暂停在 {formatPrecise(mode.at)}（回看连接已断开，不占内存）</span>
        <Button theme="solid" icon={<IconPlay />} onClick={() => openAt(mode.at)}>
          从这里继续
        </Button>
      </div>
    )
  } else {
    const overlay =
      retryFrom !== null
        ? '正在等第一段画面：录像还没写到盘上，3 秒后自动重试…'
        : phase === 'error'
        ? message
        : message
          ? message
          : phase === 'connecting'
            ? '正在打开回看…'
            : phase === 'waiting'
              ? '缓冲中…'
              : null
    stage = (
      <>
        <DvrPlayer
          key={`${mode.from}-${mode.nonce}`}
          ref={dvrRef}
          sessionId={sessionId}
          from={mode.from}
          type={dvrContainer(segments, mode.from)}
          muted={muted}
          onPosition={onPosition}
          onPhase={onPhase}
          onEnded={onEnded}
          onMutedChange={setMuted}
        />
        {overlay ? (
          <div className={styles.stageOverlay} data-kind={phase}>
            <span>{overlay}</span>
            {phase === 'error' || message ? (
              <span className={styles.stageActions}>
                <Button size="small" icon={<IconRefresh />} onClick={() => openAt(current())}>
                  从这里重新打开
                </Button>
                {detail.recording && liveReason === null ? (
                  <Button size="small" icon={<IconLive />} onClick={goLive}>
                    回到直播
                  </Button>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
      </>
    )
  }

  const markButton = (
    <Tooltip content={canEdit ? '在当前画面打一个标记（M）' : editReason}>
      <span className={styles.inlineWrap}>
        <Button
          icon={<IconFlag />}
          theme="solid"
          className={styles.markBtn}
          disabled={!canEdit || !mode}
          onClick={mark}
          aria-keyshortcuts="M"
        >
          标记 <Kbd>M</Kbd>
        </Button>
      </span>
    </Tooltip>
  )

  return (
    <>
      {header}
      <div className={styles.page} data-compact={compact || undefined}>
        <div className={styles.main}>
          <div className={styles.stage} ref={liveRootRef} data-mode={mode?.kind ?? 'none'}>
            {stage}
            {live ? <span className={styles.liveBadge}>直播</span> : null}
          </div>

          <div className={styles.transport} role="toolbar" aria-label="播放控制">
            <Button
              className={styles.hideCompact}
              theme="borderless"
              onClick={() => seek(current() - JUMP_MS)}
              disabled={!mode || !playable}
              aria-keyshortcuts="J"
            >
              后退 10 秒 <Kbd>J</Kbd>
            </Button>
            <Button
              theme="light"
              icon={playing ? <IconPause /> : <IconPlay />}
              onClick={togglePlay}
              disabled={!mode}
              aria-keyshortcuts="Space K"
            >
              {playing ? '暂停' : '播放'} <Kbd>空格</Kbd>
            </Button>
            <Button
              className={styles.hideCompact}
              theme="borderless"
              onClick={() => seek(current() + JUMP_MS)}
              disabled={!mode || !playable}
              aria-keyshortcuts="L"
            >
              前进 10 秒 <Kbd>L</Kbd>
            </Button>
            <Button
              className={styles.hideCompact}
              theme="borderless"
              icon={<IconChevronLeft />}
              onClick={() => stepKeyframe(-1)}
              disabled={!mode || !playable}
              aria-keyshortcuts="ArrowLeft"
            >
              上一个关键帧 <Kbd>←</Kbd>
            </Button>
            <Button
              className={styles.hideCompact}
              theme="borderless"
              icon={<IconChevronRight />}
              iconPosition="right"
              onClick={() => stepKeyframe(1)}
              disabled={!mode || !playable}
              aria-keyshortcuts="ArrowRight"
            >
              下一个关键帧 <Kbd>→</Kbd>
            </Button>
            <span className={styles.time} aria-live="off">
              {timeText}
            </span>
            {mode?.kind === 'dvr' ? (
              <Button
                theme="borderless"
                icon={muted ? <IconVolumnSilent /> : <IconVolume2 />}
                onClick={() => {
                  setMuted(!muted)
                  dvrRef.current?.setMuted(!muted)
                }}
                aria-label={muted ? '取消静音' : '静音'}
              />
            ) : null}
            {detail.recording ? (
              <Tooltip content={liveReason ?? '断开回看，切回正在录的直播画面'}>
                <span className={styles.inlineWrap}>
                  <Button
                    icon={<IconLive />}
                    type={live ? 'tertiary' : 'primary'}
                    disabled={live || liveReason !== null}
                    onClick={goLive}
                  >
                    {live ? '正在看直播' : '回到直播'}
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            <span className={styles.hideCompact}>{markButton}</span>
          </div>

          {compact ? (
            <>
              <Button
                className={styles.bigMark}
                icon={<IconFlag />}
                theme="solid"
                size="large"
                block
                disabled={!canEdit || !mode}
                onClick={mark}
              >
                标记当前画面
              </Button>
              {!canEdit ? (
                <Text type="tertiary" size="small">
                  {editReason}
                </Text>
              ) : null}
              <Text type="tertiary" size="small" className={styles.compactNote}>
                概览条、细节条和选段需要至少 760 px 宽的窗口。
              </Text>
            </>
          ) : (
            <>
              <OverviewBar
                duration={duration}
                segments={segments}
                gaps={gaps}
                markers={markers}
                selection={selection}
                playhead={playhead}
                live={live}
                detailWindow={[winFrom, winTo]}
                overlay={
                  segments.some((seg) => seg.has_danmaku) ? (
                    <DanmakuDensity sessionId={sessionId} duration={duration} recording={detail.recording} />
                  ) : null
                }
                onSeek={seek}
                onBlocked={blocked}
                onPickMarker={pickMarker}
              />
              <DetailBar
                from={winFrom}
                to={winTo}
                segments={segments}
                gaps={gaps}
                points={windowPoints}
                markers={markers}
                selection={selection}
                playhead={playhead}
                loading={keyframesLoading}
                truncated={!!keyframeData?.truncated}
                onSeek={seek}
                onBlocked={blocked}
                snap={snap}
                onChange={setSelection}
                onPickMarker={pickMarker}
              />
              <div className={styles.selectionBar} role="toolbar" aria-label="选段">
                <Button onClick={() => setPoint('in')} disabled={!mode || !playable} aria-keyshortcuts="I">
                  入点 <Kbd>I</Kbd>
                </Button>
                <span className={styles.selValue}>{selection.in === null ? '—' : formatPrecise(selection.in)}</span>
                <Button onClick={() => setPoint('out')} disabled={!mode || !playable} aria-keyshortcuts="O">
                  出点 <Kbd>O</Kbd>
                </Button>
                <span className={styles.selValue}>{selection.out === null ? '—' : formatPrecise(selection.out)}</span>
                {selection.in !== null && selection.out !== null ? (
                  <span className={styles.selInfo} data-problem={selProblem ? true : undefined}>
                    长度 {formatSpan(selection.out - selection.in)}
                    {selProblem ? ` · ${selProblem}` : selectionNote(selection.in, selection.out) ? ` · ${selectionNote(selection.in, selection.out)}` : ''}
                  </span>
                ) : (
                  <span className={styles.selInfo}>
                    {snap
                      ? '入点、出点吸附到关键帧：入点取之前最近的，出点取之后最近的；快速剪正好切在这里'
                      : '不吸附：入点、出点就是当前画面的时刻；精确剪按这里转码，快速剪会放宽到最近的关键帧'}
                  </span>
                )}
                <label className={styles.snapToggle}>
                  <Switch size="small" checked={snap} onChange={setSnap} aria-label="入点、出点吸附到关键帧" />
                  吸附关键帧
                </label>
                <span className={styles.selActions}>
                  {clipChanged ? (
                    <Tooltip content={canEdit ? '把新的入点、出点写回载入的切片；已导出的文件会作废' : editReason}>
                      <span className={styles.inlineWrap}>
                        <Button onClick={() => saveClip(false)} disabled={!!selProblem || !canEdit || saving}>
                          更新这个切片
                        </Button>
                      </span>
                    </Tooltip>
                  ) : null}
                  <Tooltip content={canEdit ? '存到服务器，之后在右侧「切片」里导出' : editReason}>
                    <span className={styles.inlineWrap}>
                      <Button
                        theme="solid"
                        icon={<IconScissors />}
                        loading={saving}
                        disabled={!canSave || (!!loadedClip && !clipChanged)}
                        onClick={() => saveClip(true)}
                      >
                        {clipChanged ? '另存为新切片' : '存为切片'}
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip content={canEdit ? '存为切片并立即快速剪（按关键帧切，不转码）' : editReason}>
                    <span className={styles.inlineWrap}>
                      <Button disabled={!canSave || (!!loadedClip && !clipChanged) || saving} onClick={() => saveClip(true, 'quick')}>
                        存并快速剪
                      </Button>
                    </span>
                  </Tooltip>
                  <Button
                    theme="borderless"
                    type="tertiary"
                    disabled={selection.in === null && selection.out === null}
                    onClick={() => {
                      setSelection({ in: null, out: null })
                      setActiveClip(null)
                      setSelectionMarker(null)
                    }}
                  >
                    清除
                  </Button>
                </span>
              </div>
            </>
          )}
        </div>
        <aside className={styles.aside}>
          <SidePanel
            sessionId={sessionId}
            tab={tab}
            onTab={setTab}
            markers={markers}
            markersLoading={markersLoading}
            markersError={!!markersError}
            clips={clips}
            clipsLoading={clipsLoading}
            clipsError={!!clipsError}
            legacyDrafts={legacyDrafts}
            activeClip={activeClip}
            clipWarning={clipWarning}
            currentMarker={currentMarker}
            canEdit={canEdit}
            editReason={editReason}
            canDownload={canDownload}
            ffmpeg={ffmpeg}
            onSeekMarker={pickMarker}
            onSelectMarker={selectFromMarker}
            onLoadClip={loadClip}
            compact={compact}
          />
        </aside>
      </div>
    </>
  )
}
