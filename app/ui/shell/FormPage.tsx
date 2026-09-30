'use client'
import { IconArrowLeft } from '@douyinfe/semi-icons'
import Link from 'next/link'
import { useSyncExternalStore, type ReactNode } from 'react'
import PageHeader from '@/app/(app)/components/PageHeader'
import ShellFooter, { type ShellActions } from './ShellFooter'
import styles from './shell.module.scss'

export type FormPageProps = ShellActions & {
  title: ReactNode
  description?: ReactNode
  /** 返回哪一页：页头左侧的返回按钮与「取消」都回到这里 */
  back: { href: string; label: string }
  /** 页头右侧的次要操作；主操作固定在底栏右侧 */
  headerExtra?: ReactNode
  children?: ReactNode
}

/** 表单页：页头（返回 + 标题）、居中的内容列、吸底的操作栏 */
export default function FormPage({ title, description, back, headerExtra, children, ...actions }: FormPageProps) {
  return (
    <>
      <PageHeader
        icon={
          <Link
            href={back.href}
            prefetch={false}
            className={styles.pageBack}
            aria-label={`返回${back.label}`}
            title={`返回${back.label}`}
          >
            <IconArrowLeft size="large" />
          </Link>
        }
        title={title}
        description={description}
        actions={headerExtra}
      />
      <div className={styles.pageBody}>
        <div className={styles.pageCard}>{children}</div>
      </div>
      <div className={styles.pageFoot}>
        <div className={styles.pageFootInner}>
          <ShellFooter {...actions} />
        </div>
      </div>
    </>
  )
}

const WIDE_FORM = '(min-width: 1024px)'

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(WIDE_FORM)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** 表单页的标签位置：宽屏在左、窄屏在上。抽屉与弹窗一律在上 */
export function usePageLabelPosition(): 'left' | 'top' {
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE_FORM).matches,
    () => false,
  )
  return wide ? 'left' : 'top'
}
