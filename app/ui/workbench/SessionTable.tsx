'use client'
import { Button, Table, Tag, Typography } from '@douyinfe/semi-ui'
import { IconScissors } from '@douyinfe/semi-icons'
import Link from 'next/link'
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/app/lib/api-streamer'
import { formatSize } from '@/app/lib/use-dashboard'
import { humDate } from '@/app/lib/utils'
import { formatSpan, type SessionPage, type SessionSummary } from '@/app/lib/sessions'

const PAGE_SIZE = 20

/** 按场次列出录像；每一场都能进剪辑台 */
export default function SessionTable() {
  const { Text } = Typography
  const [page, setPage] = useState(1)
  const { data, error, isLoading } = useSWR<SessionPage>(
    `/v1/sessions?page=${page}&page_size=${PAGE_SIZE}`,
    fetcher,
    { refreshInterval: 10_000, keepPreviousData: true },
  )

  const columns = [
    {
      title: '主播',
      dataIndex: 'streamer_name',
      render: (name: string) => <Text strong>{name || '未知主播'}</Text>,
    },
    {
      title: '标题',
      dataIndex: 'title',
      render: (title: string) => (
        <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 320 }}>
          {title || '（无标题）'}
        </Text>
      ),
    },
    {
      title: '开始',
      dataIndex: 'started_at',
      render: (ms: number) => humDate(ms / 1000),
    },
    {
      title: '时长',
      dataIndex: 'duration_ms',
      render: (ms: number, row: SessionSummary) =>
        row.recording ? `${formatSpan(ms)} 起` : formatSpan(ms),
    },
    { title: '分段', dataIndex: 'segment_count' },
    {
      title: '大小',
      dataIndex: 'bytes',
      render: (bytes: number) => formatSize(bytes || 0),
    },
    {
      title: '状态',
      dataIndex: 'recording',
      render: (recording: boolean) =>
        recording ? (
          <Tag color="red" size="small">
            录制中
          </Tag>
        ) : (
          <Tag size="small">已结束</Tag>
        ),
    },
    {
      title: '',
      dataIndex: 'id',
      render: (id: number) => (
        <Link href={`/workbench?session=${id}`} prefetch={false}>
          <Button size="small" icon={<IconScissors />}>
            打开剪辑台
          </Button>
        </Link>
      ),
    },
  ]

  return (
    <Table
      size="small"
      rowKey="id"
      scroll={{ x: 'max-content' }}
      columns={columns}
      dataSource={data?.items}
      loading={isLoading}
      empty={error ? '加载失败，请检查后端连接' : '还没有录过的场次'}
      pagination={
        data && data.total > PAGE_SIZE
          ? {
              currentPage: page,
              pageSize: PAGE_SIZE,
              total: data.total,
              onPageChange: setPage,
            }
          : false
      }
    />
  )
}
