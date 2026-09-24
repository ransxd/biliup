'use client'
import useSWR from 'swr'
import { fetcher } from '@/app/lib/api-streamer'
import styles from './workbench.module.scss'

interface DensityView {
  bucket_ms: number
  counts: number[]
  total: number
  segments: number
}

/** 概览条上约 200 个点就够看出起伏 */
const TARGET_BUCKETS = 200

/**
 * 弹幕密度曲线，叠在概览条上：数据来自每个写完的分段旁的弹幕 XML（录制中的分段关段后才有）。
 * 没有弹幕文件时不画。
 */
export function DanmakuDensity({
  sessionId,
  duration,
  recording,
}: {
  sessionId: number
  duration: number
  recording: boolean
}) {
  // 桶宽按分钟取整：场次变长时不必每次都换 URL
  const bucket = Math.max(10_000, Math.ceil(duration / TARGET_BUCKETS / 60_000) * 60_000)
  const { data } = useSWR<DensityView>(
    `/v1/sessions/${sessionId}/danmaku-density?bucket_ms=${bucket}`,
    fetcher,
    { refreshInterval: recording ? 60_000 : 0, revalidateOnFocus: false, keepPreviousData: true }
  )
  if (!data || data.total === 0 || duration <= 0) return null
  const max = Math.max(...data.counts)
  // 与概览条同一把尺子（0 到 max(1 秒, 时长)）
  const span = Math.max(1000, duration)
  const xOf = (ms: number) => Math.min(100, (ms / span) * 100).toFixed(2)
  const pts = data.counts.map((c, i) => `${xOf((i + 0.5) * data.bucket_ms)},${(100 - (c / max) * 100).toFixed(1)}`)
  const firstX = xOf(0.5 * data.bucket_ms)
  const lastX = xOf((data.counts.length - 0.5) * data.bucket_ms)
  return (
    <svg
      className={styles.density}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={`弹幕密度：共 ${data.total} 条，最密处每 ${Math.round(data.bucket_ms / 1000)} 秒 ${max} 条`}
    >
      <title>{`弹幕密度（共 ${data.total} 条）`}</title>
      <polygon points={`${firstX},100 ${pts.join(' ')} ${lastX},100`} />
    </svg>
  )
}
