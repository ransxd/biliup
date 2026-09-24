'use client'
import React, { useState } from 'react'
import { Button, Empty, Input, Popconfirm, TabPane, Tabs, Toast, Tooltip, Typography } from '@douyinfe/semi-ui'
import { IconDelete, IconEdit, IconFlag, IconScissors } from '@douyinfe/semi-icons'
import { deleteMarker, formatSessionTime, type Marker, renameMarker, ReportedError } from '@/app/lib/markers'
import { type ClipDraft, removeDraft, updateDraft } from '@/app/lib/clip-drafts'
import { formatPrecise, formatSpan } from '@/app/lib/sessions'
import styles from './workbench.module.scss'

const MAX_LABEL_CHARS = 100

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function InlineRename({
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string
  placeholder: string
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
        maxLength={MAX_LABEL_CHARS}
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

function DraftRow({
  sessionId,
  draft,
  active,
  warning,
  onLoad,
}: {
  sessionId: number
  draft: ClipDraft
  active: boolean
  warning: string | null
  onLoad: (d: ClipDraft) => void
}) {
  const [renaming, setRenaming] = useState(false)
  return (
    <li className={styles.row} data-current={active || undefined}>
      <button
        type="button"
        className={styles.rowTime}
        onClick={() => onLoad(draft)}
        title="载入到细节条，跳到入点"
      >
        <IconScissors size="small" aria-hidden="true" />
        {formatSessionTime(draft.in_ms)}
      </button>
      <div className={styles.rowBody}>
        {renaming ? (
          <InlineRename
            initial={draft.label}
            placeholder="给这个选段起个名字"
            onCancel={() => setRenaming(false)}
            onSave={(label) => {
              updateDraft(sessionId, draft.id, { label })
              setRenaming(false)
            }}
          />
        ) : (
          <>
            <span className={styles.rowLabel} data-empty={!draft.label || undefined}>
              {draft.label || '未命名选段'}
            </span>
            <span className={styles.rowMeta}>
              {formatPrecise(draft.in_ms)} → {formatPrecise(draft.out_ms)} · {formatSpan(draft.out_ms - draft.in_ms)}
            </span>
            {warning ? <span className={styles.rowWarn}>{warning}</span> : null}
          </>
        )}
      </div>
      {renaming ? null : (
        <div className={styles.rowActions}>
          <Button
            size="small"
            theme="borderless"
            icon={<IconEdit />}
            aria-label="给选段改名"
            onClick={() => setRenaming(true)}
          />
          <Popconfirm
            title="删除这个选段？"
            okText="删除"
            okType="danger"
            onConfirm={() => removeDraft(sessionId, draft.id)}
          >
            <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} aria-label="删除选段" />
          </Popconfirm>
        </div>
      )}
    </li>
  )
}

export type PanelTab = 'markers' | 'drafts'

export function SidePanel({
  sessionId,
  tab,
  onTab,
  markers,
  markersLoading,
  markersError,
  drafts,
  activeDraft,
  draftWarning,
  currentMarker,
  canEdit,
  editReason,
  onSeekMarker,
  onSelectMarker,
  onLoadDraft,
  compact,
}: {
  sessionId: number
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  markers: Marker[]
  markersLoading: boolean
  markersError: boolean
  drafts: ClipDraft[]
  activeDraft: string | null
  draftWarning: (d: ClipDraft) => string | null
  currentMarker: number | null
  canEdit: boolean
  editReason: string
  onSeekMarker: (m: Marker) => void
  onSelectMarker: (m: Marker) => void
  onLoadDraft: (d: ClipDraft) => void
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
    <section className={styles.panel} aria-label="标记与选段">
      <Tabs type="line" size="small" activeKey={tab} onChange={(k) => onTab(k as PanelTab)} keepDOM={false}>
        <TabPane tab={`标记 ${markers.length}`} itemKey="markers">
          {markerList}
        </TabPane>
        <TabPane tab={`选段 ${drafts.length}`} itemKey="drafts">
          <Text type="tertiary" size="small" className={styles.panelNote}>
            选段先存在这台浏览器里；导出（快速剪：按关键帧切，不转码 / 精确剪：转码）在后续版本提供。
          </Text>
          {drafts.length === 0 ? (
            <Empty
              description="还没有选段。在细节条上用 I / O（或「入点」「出点」按钮）选一段，再点「存为选段」"
              className={styles.empty}
            />
          ) : (
            <ul className={styles.list} aria-label="选段列表">
              {drafts.map((d) => (
                <DraftRow
                  key={d.id}
                  sessionId={sessionId}
                  draft={d}
                  active={activeDraft === d.id}
                  warning={draftWarning(d)}
                  onLoad={onLoadDraft}
                />
              ))}
            </ul>
          )}
        </TabPane>
      </Tabs>
    </section>
  )
}
