'use client'
import { useMemo } from 'react'
import { readPref, useRawPref, writePref } from './use-local-pref'

/**
 * 剪辑台的「选段」：入点、出点都是落刀点（关键帧或分段末尾）上的场次时间。
 * 导出和 `clips` 表在后续版本才有，在那之前选段只存在这台浏览器的 localStorage 里，按场次分开。
 */
export interface ClipDraft {
  id: string
  in_ms: number
  out_ms: number
  label: string
  /** 从哪个标记建的；手动选的为 null */
  marker_id: number | null
  /** Unix 毫秒 */
  created_at: number
}

/** 一场最多存这么多个选段，防止误操作把 localStorage 写满 */
export const MAX_DRAFTS = 500

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

/** 唯一的写入口：每次都从存储里读最新的一份再改，其它标签页的改动不会被覆盖 */
function updateDrafts(sessionId: number, change: (drafts: ClipDraft[]) => ClipDraft[]) {
  const next = change(parse(readPref(draftsKey(sessionId)))).sort((a, b) => a.in_ms - b.in_ms)
  writePref(draftsKey(sessionId), JSON.stringify(next))
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function addDraft(
  sessionId: number,
  draft: { in_ms: number; out_ms: number; label?: string; marker_id?: number | null }
): ClipDraft | null {
  const created: ClipDraft = {
    id: newId(),
    in_ms: draft.in_ms,
    out_ms: draft.out_ms,
    label: draft.label ?? '',
    marker_id: draft.marker_id ?? null,
    created_at: Date.now(),
  }
  let added = false
  updateDrafts(sessionId, (drafts) => {
    if (drafts.length >= MAX_DRAFTS) return drafts
    added = true
    return [...drafts, created]
  })
  return added ? created : null
}

export function updateDraft(sessionId: number, id: string, patch: Partial<Pick<ClipDraft, 'in_ms' | 'out_ms' | 'label'>>) {
  updateDrafts(sessionId, (drafts) => drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)))
}

export function removeDraft(sessionId: number, id: string) {
  updateDrafts(sessionId, (drafts) => drafts.filter((d) => d.id !== id))
}

export function useClipDrafts(sessionId: number): ClipDraft[] {
  const raw = useRawPref(draftsKey(sessionId))
  return useMemo(() => parse(raw), [raw])
}
