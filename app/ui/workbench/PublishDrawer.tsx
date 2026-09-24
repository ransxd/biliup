'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  Banner,
  Button,
  Cascader,
  DatePicker,
  Input,
  Radio,
  RadioGroup,
  Select,
  SideSheet,
  Spin,
  TagInput,
  TextArea,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui'
import { IconDelete, IconImage, IconLive, IconSend, IconUpload } from '@douyinfe/semi-icons'
import { fetcher, type StudioEntity } from '@/app/lib/api-streamer'
import { type Clip, updateClip } from '@/app/lib/clips'
import { formatSessionTime, ReportedError } from '@/app/lib/markers'
import {
  COVER_TYPES,
  type CoverSource,
  coverFromFile,
  coverFromFrame,
  coverFromLive,
  coverUrl,
  DTIME_MAX_DAYS,
  DTIME_MIN_HOURS,
  MAX_ARCHIVE_TITLE,
  MAX_BATCH,
  MAX_COVER_BYTES,
  MAX_DESC,
  MAX_PARTS,
  MAX_TAG_CHARS,
  MAX_TAGS,
  type PreviewArchive,
  previewPublish,
  publishBatch,
  publishClip,
  type PublishBody,
  removeCover,
  type StudioOverride,
} from '@/app/lib/publish'
import { useTypeTree } from '@/app/lib/use-streamers'
import styles from './workbench.module.scss'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

type DtimeMode = 'template' | 'now' | 'at'
const STREAMER_TEMPLATE = 'streamer'

/** 表单里的覆盖值：空的字段表示沿用模板 */
interface Form {
  title: string
  desc: string
  tags: string[]
  tid: number | null
  tidV2: number | null
  dtimeMode: DtimeMode
  dtimeAt: Date | null
  cover: CoverSource | null
}

function formOf(over: StudioOverride | undefined): Form {
  const o = over ?? {}
  return {
    title: o.title ?? '',
    desc: o.desc ?? '',
    tags: o.tags ?? [],
    tid: o.tid ?? null,
    tidV2: o.tid_v2 ?? null,
    dtimeMode: o.dtime === undefined ? 'template' : o.dtime === 0 ? 'now' : 'at',
    dtimeAt: o.dtime ? new Date(o.dtime * 1000) : null,
    cover: o.cover ?? null,
  }
}

function dtimeProblem(form: Form): string | null {
  if (form.dtimeMode !== 'at') return null
  if (!form.dtimeAt) return '选一个定时发布的时间'
  const ms = form.dtimeAt.getTime() - Date.now()
  if (ms < DTIME_MIN_HOURS * 3_600_000) return `定时发布要在 ${DTIME_MIN_HOURS} 小时之后`
  if (ms > DTIME_MAX_DAYS * 86_400_000) return `定时发布最多在 ${DTIME_MAX_DAYS} 天之内`
  return null
}

function overrideOf(form: Form): StudioOverride {
  const over: StudioOverride = {}
  if (form.title.trim()) over.title = form.title.trim()
  if (form.desc.trim()) over.desc = form.desc
  if (form.tags.length) over.tags = form.tags
  if (form.tid !== null) {
    over.tid = form.tid
    if (form.tidV2 !== null) over.tid_v2 = form.tidV2
  }
  if (form.dtimeMode === 'now') over.dtime = 0
  if (form.dtimeMode === 'at' && form.dtimeAt) over.dtime = Math.floor(form.dtimeAt.getTime() / 1000)
  if (form.cover) over.cover = form.cover
  return over
}

function coverText(cover: CoverSource | null): string {
  if (!cover) return '上传模板里的封面（模板没设封面时由 B 站自动截取）'
  if (cover.source === 'frame') return `录像里 ${formatSessionTime(cover.t_ms)} 的画面`
  if (cover.source === 'live') return '开播时的直播间封面'
  return '上传的图片'
}

function localTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString('zh-CN', { hour12: false })
}

/** 分区在树里的路径（父分区、子分区）；Cascader 的值要完整路径 */
function tidPath(
  tree: { value: number; children: { value: number }[] }[] | undefined,
  tid: number | null
): number[] | undefined {
  if (tid === null || !tree) return undefined
  const parent = tree.find((t) => t.children.some((c) => c.value === tid))
  return parent ? [parent.value, tid] : undefined
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </div>
  )
}

export interface PublishTarget {
  /** 要发布的切片（已按时间排好，都属于这一场） */
  clips: Clip[]
  /** 从切片列表的多选进来 */
  batch: boolean
}

export function PublishDrawer({
  sessionId,
  target,
  onClose,
  canSubmit,
  canEdit,
  ffmpeg,
  currentMs,
  playable,
}: {
  sessionId: number
  target: PublishTarget | null
  onClose: () => void
  canSubmit: boolean
  canEdit: boolean
  ffmpeg: { ready: boolean; reason: string | null }
  /** 播放器现在的画面（场次时间） */
  currentMs: () => number
  playable: boolean
}) {
  return (
    <SideSheet
      visible={target !== null}
      onCancel={onClose}
      title={
        target
          ? target.batch
            ? `集中发布 ${target.clips.length} 个切片`
            : `发布「${target.clips[0].title || `未命名切片 #${target.clips[0].id}`}」`
          : '发布'
      }
      width={560}
      bodyStyle={{ padding: 0 }}
      closeOnEsc
    >
      {target ? (
        <DrawerBody
          key={target.clips.map((c) => c.id).join(',')}
          sessionId={sessionId}
          target={target}
          onClose={onClose}
          canSubmit={canSubmit}
          canEdit={canEdit}
          ffmpeg={ffmpeg}
          currentMs={currentMs}
          playable={playable}
        />
      ) : null}
    </SideSheet>
  )
}

function DrawerBody({
  sessionId,
  target,
  onClose,
  canSubmit,
  canEdit,
  ffmpeg,
  currentMs,
  playable,
}: {
  sessionId: number
  target: PublishTarget
  onClose: () => void
  canSubmit: boolean
  canEdit: boolean
  ffmpeg: { ready: boolean; reason: string | null }
  currentMs: () => number
  playable: boolean
}) {
  const { Text } = Typography
  const first = target.clips[0]
  const [combine, setCombine] = useState(false)
  /** 每个切片一个稿件、又选了好几个：标题等按各切片自己存着的设置，这里只能换模板 */
  const perClip = target.batch && !combine && target.clips.length > 1
  const [templateId, setTemplateId] = useState<number | null | undefined>(target.batch ? undefined : first.template_id)
  const [form, setForm] = useState<Form>(() => (target.batch ? formOf(undefined) : formOf(first.studio_override)))
  const [coverNonce, setCoverNonce] = useState(() => Date.now())
  const [coverBusy, setCoverBusy] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }))

  const { data: templates } = useSWR<StudioEntity[]>('/v1/upload/streamers', fetcher)
  const { typeTree, isError: typeTreeError } = useTypeTree()

  const tooMany = target.clips.length > (combine ? MAX_PARTS : MAX_BATCH)
  const problem = dtimeProblem(form)
  const body: PublishBody = useMemo(() => {
    const b: PublishBody = { clip_ids: target.clips.map((c) => c.id) }
    if (target.batch) b.combine = combine
    if (templateId !== undefined) b.template_id = templateId
    if (!perClip) b.studio_override = overrideOf(form)
    return b
  }, [target, combine, templateId, perClip, form])

  const [preview, setPreview] = useState<{ archives: PreviewArchive[] | null; error: string | null; loading: boolean }>({
    archives: null,
    error: null,
    loading: true,
  })
  const bodyKey = JSON.stringify(body)
  useEffect(() => {
    if (tooMany || problem) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setPreview((p) => ({ ...p, loading: true }))
      previewPublish(JSON.parse(bodyKey))
        .then((archives) => !cancelled && setPreview({ archives, error: null, loading: false }))
        .catch((e) => !cancelled && setPreview({ archives: null, error: errorText(e), loading: false }))
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [bodyKey, tooMany, problem])

  const archives = preview.archives ?? []
  const firstRendered = archives[0]?.rendered ?? null
  const blocking = archives.find((a) => a.problem)?.problem ?? null

  /** 合成多 P 时封面存在第一个切片上 */
  const coverClip = first
  const setCover = async (label: string, run: () => Promise<StudioOverride | void>) => {
    setCoverBusy(label)
    try {
      const over = await run()
      patch({ cover: over?.cover ?? null })
      setCoverNonce(Date.now())
    } catch (e) {
      if (!(e instanceof ReportedError)) Toast.error({ content: `换封面失败：${errorText(e)}`, duration: 5 })
    } finally {
      setCoverBusy(null)
    }
  }
  const frameReason = !canEdit
    ? '改封面需要 clip.edit 权限'
    : !ffmpeg.ready
      ? `取帧要用服务器上的 ffmpeg：${ffmpeg.reason ?? '不可用'}。可以改用直播间封面或上传图片`
      : !playable
        ? '这一场没有能播放的录像'
        : null
  const pickFile = (file: File | undefined) => {
    if (!file) return
    if (!COVER_TYPES.includes(file.type)) {
      Toast.warning({ content: '只支持 JPEG、PNG、WebP 图片', duration: 4 })
      return
    }
    if (file.size > MAX_COVER_BYTES) {
      Toast.warning({ content: '封面图片最大 5 MB，压缩一下再传', duration: 4 })
      return
    }
    void setCover('upload', () => coverFromFile(coverClip, file))
  }

  const localReason = !canSubmit
    ? '发布需要 upload.submit 权限，请让管理员把你的角色改成操作员'
    : tooMany
      ? combine
        ? `一个稿件最多 ${MAX_PARTS} 个分 P`
        : `一次最多发布 ${MAX_BATCH} 个切片`
      : problem
  const submitReason =
    localReason ?? (preview.loading ? null : (blocking ?? (preview.error ? `预览失败：${preview.error}` : null)))

  const publish = async () => {
    setPublishing(true)
    try {
      const jobs = target.batch
        ? await publishBatch(sessionId, body)
        : await publishClip(first, { template_id: body.template_id, studio_override: body.studio_override })
      Toast.success({
        content:
          jobs.length > 1
            ? `已把 ${jobs.length} 个稿件排进发布队列，一次传一个`
            : '已排进发布队列：需要时先导出，再上传、投稿，进度在切片列表里',
        duration: 4,
      })
      onClose()
    } catch (e) {
      if (!(e instanceof ReportedError)) Toast.error({ content: `没能发布：${errorText(e)}`, duration: 6 })
    } finally {
      setPublishing(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await updateClip(first, { template_id: templateId ?? null, studio_override: overrideOf(form) })
      Toast.success({ content: '发布设置已保存', duration: 2 })
      onClose()
    } catch (e) {
      if (!(e instanceof ReportedError)) Toast.error({ content: `保存失败：${errorText(e)}`, duration: 5 })
    } finally {
      setSaving(false)
    }
  }

  const templateOptions = [
    { value: STREAMER_TEMPLATE, label: '主播绑定的模板' },
    ...(templates ?? []).map((t) => ({ value: t.id, label: t.template_name })),
  ]
  const tree: { label: string; value: number; children: { label: string; value: number }[] }[] | undefined = typeTree?.map((type: { label: string; value: number; children: { id: number; name: string }[] }) => ({
    label: type.label,
    value: type.value,
    children: type.children.map((c) => ({ label: c.name, value: c.id })),
  }))

  return (
    <div className={styles.drawer}>
      <div className={styles.drawerScroll}>
        {target.batch ? (
          <Field
            label="怎么发"
            hint={
              combine
                ? `按时间顺序合成一个稿件，每个切片一个分 P（最多 ${MAX_PARTS} 个）`
                : '每个切片单独一个稿件，排队依次上传'
            }
          >
            <RadioGroup
              type="button"
              value={combine ? 'combine' : 'each'}
              onChange={(e) => setCombine(e.target.value === 'combine')}
              aria-label="发布方式"
            >
              <Radio value="each">每个切片一个稿件</Radio>
              <Radio value="combine">合成一个多 P 稿件</Radio>
            </RadioGroup>
          </Field>
        ) : null}

        <Field
          label="上传模板"
          hint={
            templateId === undefined && target.batch
              ? '不改：每个切片用自己选过的模板，没选过的用主播绑定的'
              : firstRendered
                ? `现在用「${firstRendered.template_name}」的账号、分区、标签等`
                : '账号、分区、标签等默认取自模板'
          }
        >
          <Select
            value={templateId === undefined ? undefined : (templateId ?? STREAMER_TEMPLATE)}
            placeholder={target.batch ? '不改（各切片自己的设置）' : '主播绑定的模板'}
            optionList={templateOptions}
            onChange={(v) => setTemplateId(v === STREAMER_TEMPLATE ? null : (v as number))}
            style={{ width: '100%' }}
            aria-label="上传模板"
            showClear={target.batch}
            onClear={() => setTemplateId(undefined)}
          />
        </Field>

        {perClip ? (
          <Banner
            type="info"
            closeIcon={null}
            description="每个切片一个稿件时，标题、简介、封面等按各个切片自己的发布设置（在切片的「发布」里改）。要统一填写，请选「合成一个多 P 稿件」。"
          />
        ) : (
          <>
            <Field
              label="稿件标题"
              hint={
                <>
                  {form.title.trim()
                    ? '留空用模板的标题（没有切片变量时用切片标题）'
                    : `留空用默认：${firstRendered ? `「${firstRendered.title}」` : '切片标题'}`}
                  。可用变量 {'{clip_title}'} 切片标题、
                  {'{clip_time}'} 切片开始的时间、{'{streamer}'} 主播、{'{title}'} 直播标题
                </>
              }
            >
              <Input
                value={form.title}
                maxLength={MAX_ARCHIVE_TITLE}
                showClear
                placeholder={firstRendered?.title ?? ''}
                onChange={(v) => patch({ title: v })}
                aria-label="稿件标题"
              />
            </Field>
            <Field label="简介" hint="留空用模板的简介；变量同上，{url} 是直播间地址">
              <TextArea
                value={form.desc}
                maxCount={MAX_DESC}
                autosize={{ minRows: 2, maxRows: 6 }}
                placeholder={firstRendered?.desc || '（模板没有简介）'}
                onChange={(v) => patch({ desc: v })}
                aria-label="简介"
              />
            </Field>
            <Field label="标签" hint={`留空用模板的标签；最多 ${MAX_TAGS} 个，每个最多 ${MAX_TAG_CHARS} 个字，回车或逗号分隔`}>
              <TagInput
                value={form.tags}
                max={MAX_TAGS}
                maxLength={MAX_TAG_CHARS}
                separator={[',', '，']}
                addOnBlur
                allowDuplicates={false}
                placeholder={firstRendered?.tags.join('、') || '（模板没有标签，至少填一个）'}
                onChange={(v) => patch({ tags: v })}
                aria-label="标签"
              />
            </Field>
            <Field
              label="分区"
              hint={typeTree || !typeTreeError ? '留空用模板的分区' : '读不到 B 站的分区列表（检查投稿账号登录状态），先沿用模板的分区'}
            >
              <Cascader
                value={tidPath(tree, form.tid)}
                treeData={tree}
                placeholder={typeTree ? '沿用模板' : typeTreeError ? '沿用模板' : '正在读取 B 站分区…'}
                disabled={!typeTree}
                showClear
                onChange={(v) => {
                  const value = Array.isArray(v) ? v[v.length - 1] : v
                  patch({ tid: typeof value === 'number' ? value : null, tidV2: null })
                }}
                style={{ width: '100%' }}
                aria-label="分区"
              />
            </Field>
            <Field
              label="发布时间"
              hint={
                form.dtimeMode === 'at'
                  ? (problem ?? `到 ${form.dtimeAt?.toLocaleString('zh-CN', { hour12: false })} 自动公开`)
                  : form.dtimeMode === 'now'
                    ? '审核通过后立即公开（不用模板里的定时）'
                    : firstRendered?.dtime
                      ? `模板设了定时：${localTime(firstRendered.dtime)} 公开`
                      : '模板没设定时：审核通过后立即公开'
              }
            >
              <RadioGroup
                type="button"
                value={form.dtimeMode}
                onChange={(e) => patch({ dtimeMode: e.target.value as DtimeMode })}
                aria-label="发布时间"
              >
                <Radio value="template">跟随模板</Radio>
                <Radio value="now">立即</Radio>
                <Radio value="at">定时</Radio>
              </RadioGroup>
              {form.dtimeMode === 'at' ? (
                <DatePicker
                  type="dateTime"
                  value={form.dtimeAt ?? undefined}
                  onChange={(d) => patch({ dtimeAt: d instanceof Date ? d : null })}
                  disabledDate={(d) =>
                    !!d &&
                    (d.getTime() < Date.now() - 86_400_000 || d.getTime() > Date.now() + DTIME_MAX_DAYS * 86_400_000)
                  }
                  format="yyyy-MM-dd HH:mm"
                  style={{ width: '100%', marginTop: 6 }}
                  aria-label="定时发布的时间"
                />
              ) : null}
            </Field>
            <Field
              label="封面"
              hint={combine ? `合集的封面存在第一个切片上。现在：${coverText(form.cover)}` : `现在：${coverText(form.cover)}`}
            >
              <div className={styles.coverRow}>
                <div className={styles.coverBox}>
                  {form.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverUrl(coverClip.id, coverNonce)} alt="切片封面" />
                  ) : (
                    <span>模板封面</span>
                  )}
                  {coverBusy ? <Spin size="small" wrapperClassName={styles.coverSpin} /> : null}
                </div>
                <div className={styles.coverActions}>
                  <Tooltip content={frameReason ?? '取播放器现在这一帧（先在左边把画面停在想要的位置）'}>
                    <span className={styles.inlineWrap}>
                      <Button
                        size="small"
                        icon={<IconImage />}
                        disabled={frameReason !== null || coverBusy !== null}
                        loading={coverBusy === 'frame'}
                        onClick={() => setCover('frame', () => coverFromFrame(coverClip, currentMs()))}
                      >
                        用当前画面
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip content={canEdit ? '开播时记下的直播间封面' : '改封面需要 clip.edit 权限'}>
                    <span className={styles.inlineWrap}>
                      <Button
                        size="small"
                        icon={<IconLive />}
                        disabled={!canEdit || coverBusy !== null}
                        loading={coverBusy === 'live'}
                        onClick={() => setCover('live', () => coverFromLive(coverClip))}
                      >
                        直播间封面
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip content={canEdit ? 'JPEG / PNG / WebP，最大 5 MB' : '改封面需要 clip.edit 权限'}>
                    <span className={styles.inlineWrap}>
                      <Button
                        size="small"
                        icon={<IconUpload />}
                        disabled={!canEdit || coverBusy !== null}
                        loading={coverBusy === 'upload'}
                        onClick={() => fileRef.current?.click()}
                      >
                        上传图片
                      </Button>
                    </span>
                  </Tooltip>
                  {form.cover ? (
                    <Button
                      size="small"
                      theme="borderless"
                      type="tertiary"
                      icon={<IconDelete />}
                      disabled={!canEdit || coverBusy !== null}
                      onClick={() => setCover('remove', () => removeCover(coverClip))}
                    >
                      改回模板封面
                    </Button>
                  ) : null}
                  <input
                    ref={fileRef}
                    type="file"
                    accept={COVER_TYPES.join(',')}
                    hidden
                    onChange={(e) => {
                      pickFile(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </div>
              </div>
            </Field>
          </>
        )}

        <div className={styles.reprint} role="note">
          <strong>版权：转载</strong>
          <span>
            切片是直播内容的片段，一律按转载投稿，来源
            {firstRendered ? `：${firstRendered.source}` : '默认是直播间地址'}
            {firstRendered?.template_self_made ? '（模板里选的是自制，切片不跟随）' : ''}
          </span>
        </div>

        <section className={styles.previewBox} aria-label="稿件预览" aria-busy={preview.loading}>
          <div className={styles.previewHead}>
            <strong>预览</strong>
            {preview.loading ? <Spin size="small" /> : null}
          </div>
          {preview.error ? <Text type="danger">{preview.error}</Text> : null}
          {archives.map((a, i) => (
            <div key={a.clip_ids.join(',')} className={styles.previewItem}>
              {archives.length > 1 ? <span className={styles.rowMeta}>稿件 {i + 1}</span> : null}
              {a.rendered ? (
                <>
                  <span className={styles.previewTitle}>{a.rendered.title || '（标题是空的）'}</span>
                  <span className={styles.rowMeta}>
                    {a.rendered.tags.join('、') || '没有标签'} · 分区 {a.rendered.tid ?? '模板未设'} ·{' '}
                    {a.rendered.dtime ? `定时 ${localTime(a.rendered.dtime)}` : '立即公开'}
                  </span>
                  {a.rendered.part_titles.length > 1 ? (
                    <ol className={styles.partList}>
                      {a.rendered.part_titles.map((t, j) => (
                        <li key={j}>{t}</li>
                      ))}
                    </ol>
                  ) : null}
                </>
              ) : null}
              {a.problem ? (
                <Text type="danger" size="small">
                  {a.problem}
                </Text>
              ) : null}
            </div>
          ))}
        </section>
      </div>

      <footer className={styles.drawerFoot}>
        {submitReason ? (
          <Text type="danger" size="small" className={styles.drawerReason}>
            {submitReason}
          </Text>
        ) : (
          <Text type="tertiary" size="small" className={styles.drawerReason}>
            还没导出的切片会先快速剪，再上传、投稿；同一时间只传一个稿件
          </Text>
        )}
        {!target.batch ? (
          <Tooltip content={canEdit ? '只存设置，不发布' : '保存设置需要 clip.edit 权限'}>
            <span className={styles.inlineWrap}>
              <Button disabled={!canEdit || !!problem || publishing} loading={saving} onClick={save}>
                只保存
              </Button>
            </span>
          </Tooltip>
        ) : null}
        <Button
          theme="solid"
          icon={<IconSend />}
          disabled={submitReason !== null || preview.loading || saving}
          loading={publishing}
          onClick={publish}
        >
          {combine ? '发布多 P 稿件' : target.clips.length > 1 ? `发布 ${target.clips.length} 个稿件` : '发布'}
        </Button>
      </footer>
    </div>
  )
}
