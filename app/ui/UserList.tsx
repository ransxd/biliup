import React, { useCallback, useRef, useState } from 'react'
import { requestDelete, sendRequest } from '../lib/api-streamer'
import { Button, Empty, Form, List, Notification, Radio, RadioGroup, Spin, Toast, Typography } from '@douyinfe/semi-ui'
import AvatarCard from './AvatarCard'
import { IconPlusCircle } from '@douyinfe/semi-icons'
import { FormApi } from '@douyinfe/semi-ui/lib/es/form'
import useSWRMutation from 'swr/mutation'
import { useBiliUsers } from '../lib/use-streamers'
import QRcode from '@/app/ui/QRcode'
import PairAccountsHint from './PairAccountsHint'
import { FormSheet, ShellFooter } from './shell'

type UserListProps = {
  onCancel?: () => void
  visible?: boolean
}

type Method = 'qrcode' | 'cookie'

function errorText(e: any): string {
  const raw = e?.message ?? String(e)
  try {
    return JSON.parse(raw).error ?? JSON.parse(raw).message ?? raw
  } catch {
    return raw
  }
}

/** 投稿管理页的「B 站账号」：列表型抽屉，添加账号是同一抽屉里的第二层，不再叠弹窗 */
const UserList: React.FC<UserListProps> = ({ onCancel, visible }) => {
  const { trigger } = useSWRMutation('/v1/users', sendRequest)
  const { trigger: deleteUser } = useSWRMutation('/v1/users', requestDelete)
  const { biliUsers: list, isLoading } = useBiliUsers()
  const [adding, setAdding] = useState(false)
  const [method, setMethod] = useState<Method>('qrcode')
  const api = useRef<FormApi>(undefined)

  /** 成功返回 true；失败已弹出原因 */
  const addUser = useCallback(
    async (value: string) => {
      try {
        await trigger({ value })
        setAdding(false)
        Toast.success('账号已添加')
        return true
      } catch (e: any) {
        Notification.error({
          title: '添加失败',
          content: <Typography.Paragraph style={{ maxWidth: 450 }}>{errorText(e)}</Typography.Paragraph>,
          style: { width: 'min-content' },
        })
        return false
      }
    },
    [trigger],
  )

  const submitCookie = async () => {
    const values = await api.current?.validate()
    if (!(await addUser(values?.value?.trim()))) throw new Error('add failed')
  }

  const remove = async (id: number) => {
    try {
      await deleteUser(id)
      Toast.success('已删除')
    } catch (e: any) {
      Notification.error({
        title: '删除失败',
        content: <Typography.Paragraph style={{ maxWidth: 450 }}>{errorText(e)}</Typography.Paragraph>,
        style: { width: 'min-content' },
      })
    }
  }

  const close = () => {
    setAdding(false)
    onCancel?.()
  }

  const startAdding = () => {
    setMethod('qrcode')
    setAdding(true)
  }

  if (adding) {
    return (
      <FormSheet
        size="sm"
        visible={visible}
        title="添加 B 站账号"
        onBack={() => setAdding(false)}
        onCancel={close}
        footer={
          <ShellFooter
            onCancel={() => setAdding(false)}
            cancelText="返回列表"
            okText={method === 'cookie' ? '添加' : undefined}
            onOk={submitCookie}
            footerExtra={method === 'qrcode' ? '在 B 站 App 里扫码确认后自动添加' : undefined}
          />
        }
      >
        <RadioGroup
          type="button"
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
          aria-label="添加方式"
        >
          <Radio value="qrcode">扫码登录</Radio>
          <Radio value="cookie">Cookie 文件</Radio>
        </RadioGroup>
        {method === 'qrcode' ? (
          <QRcode onSuccess={addUser} />
        ) : (
          <Form getFormApi={(formApi) => (api.current = formApi)} onSubmit={submitCookie} style={{ marginTop: 12 }}>
            <Form.Input
              field="value"
              label="Cookie 文件路径"
              placeholder="cookies.json"
              trigger="blur"
              rules={[{ required: true, message: '填写 biliup 所在机器上的凭据文件路径' }]}
              extraText="biliup login 生成的凭据文件；相对路径从 biliup 的工作目录算起"
            />
          </Form>
        )}
      </FormSheet>
    )
  }

  return (
    <FormSheet
      size="sm"
      visible={visible}
      title="B 站账号"
      onCancel={close}
      headerExtra={
        list.length > 0 ? (
          <Button icon={<IconPlusCircle />} theme="light" type="primary" onClick={startAdding}>
            添加账号
          </Button>
        ) : null
      }
      footer={null}
    >
      <PairAccountsHint visible={visible} />
      {isLoading ? (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <Spin />
        </div>
      ) : list.length === 0 ? (
        <Empty
          title="还没有 B 站账号"
          description="投稿模板要选一个账号才能投稿"
          style={{ padding: '48px 0' }}
        >
          <Button icon={<IconPlusCircle />} theme="solid" onClick={startAdding}>
            添加账号
          </Button>
        </Empty>
      ) : (
        <List
          dataSource={list}
          split={false}
          size="small"
          renderItem={(item) => (
            <AvatarCard
              url={item.face}
              abbr={item.name}
              label={item.name}
              value={item.value}
              onRemove={async () => await remove(item.id)}
            />
          )}
        />
      )}
    </FormSheet>
  )
}

export default UserList
