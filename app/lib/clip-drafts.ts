'use client'
import { useMemo } from 'react'
import { readPref, removePref, useRawPref, writePref } from './use-local-pref'

/**
 * 旧版剪辑台存在这台浏览器 localStorage 里的「选段」（按场次分开）。选段现在是服务端的切片（`clips.ts`），
 * 这里只剩读出旧数据、让用户选择「存到服务器」或「丢弃」；不会自动迁移，也不再写入新的。
 */
export interface ClipDraft {
  id: string
  in_ms: number
  out_ms: number
  label: string
  marker_id: number | null
  /** Unix 毫秒 */
  created_at: number
}

const draftsKey = (sessionId: number) => `biliup.workbench.drafts.${sessionId}`

function parse(raw: string | null): ClipDraft[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter(
      (d): d is ClipDraft =>
        !!d &&
        typeof d.id === 'string' &&
        Number.isFinite(d.in_ms) &&
        Number.isFinite(d.out_ms) &&
        d.out_ms > d.in_ms &&
        typeof d.label === 'string'
    )
  } catch {
    return []
  }
}

/** 删掉指定的旧选段；每次都从存储里读最新的一份再改，其它标签页的改动不会被覆盖 */
export function removeDrafts(sessionId: number, ids: string[]) {
  const drop = new Set(ids)
  const next = parse(readPref(draftsKey(sessionId))).filter((d) => !drop.has(d.id))
  if (next.length) writePref(draftsKey(sessionId), JSON.stringify(next))
  else removePref(draftsKey(sessionId))
}

export function useClipDrafts(sessionId: number): ClipDraft[] {
  const raw = useRawPref(draftsKey(sessionId))
  return useMemo(() => parse(raw), [raw])
}
