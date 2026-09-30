'use client'
import { Button, SideSheet } from '@douyinfe/semi-ui'
import { IconArrowLeft } from '@douyinfe/semi-icons'
import type { ReactNode } from 'react'
import { useIsMobile } from '@/app/lib/useIsMobile'
import ShellFooter, { type ShellActions } from './ShellFooter'
import { NARROW, SHEET_WIDTH, type SheetSize } from './sizes'
import styles from './shell.module.scss'

export type FormSheetProps = ShellActions & {
  title: ReactNode
  visible?: boolean
  size?: SheetSize
  /** 标题栏右侧、关闭按钮左边的次要操作，如列表型抽屉的「添加账号」 */
  headerExtra?: ReactNode
  /** 抽屉里的第二层（代替在抽屉上再叠一个弹窗）：标题左侧出返回箭头 */
  onBack?: () => void
  /** 省略时用统一底栏；null 为不要底栏 */
  footer?: ReactNode | null
  closable?: boolean
  children?: ReactNode
}

/** 右侧抽屉：列表里某一项的查看与编辑。窄屏下占满宽度 */
export default function FormSheet({
  title,
  visible = true,
  size = 'md',
  headerExtra,
  onBack,
  footer,
  closable = true,
  children,
  ...actions
}: FormSheetProps) {
  const isMobile = useIsMobile(NARROW)
  const onCancel = closable ? actions.onCancel : undefined
  return (
    <SideSheet
      visible={visible}
      width={isMobile ? '100%' : SHEET_WIDTH[size]}
      className={styles.sheet}
      closable={closable}
      closeOnEsc={closable}
      onCancel={onCancel}
      title={
        <div className={styles.sheetTitle}>
          {onBack ? (
            <Button
              theme="borderless"
              type="tertiary"
              icon={<IconArrowLeft />}
              aria-label="返回"
              className={styles.sheetBack}
              onClick={onBack}
            />
          ) : null}
          <span className={styles.sheetTitleText}>{title}</span>
          {headerExtra ? <div className={styles.sheetExtra}>{headerExtra}</div> : null}
        </div>
      }
      footer={footer === undefined ? <ShellFooter {...actions} onCancel={onCancel} /> : footer}
    >
      {children}
    </SideSheet>
  )
}
