import type { MouseEvent } from 'react';
import { Button, Card, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Counterparty, DeliveryListResponseSchema } from '@matcheck/contracts';
import type { z } from 'zod';
import { api } from '../../services/api';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';

type List = z.infer<typeof DeliveryListResponseSchema>;
type Row = List['items'][number];

export function DeliveriesHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => api.get<List>('/deliveries'),
  });

  const counterparties = useQuery({
    queryKey: ['counterparties'],
    queryFn: () =>
      api.get<{ items: Counterparty[]; total: number }>('/counterparties'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/deliveries/${id}`),
    onSuccess: async () => {
      message.success('Приёмка удалена');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
        queryClient.invalidateQueries({
          queryKey: ['source-documents', 'unaccepted-upd', 'list'],
        }),
      ]);
    },
    onError: (err: Error) => message.error(err.message),
  });

  const suppliersMap = new Map<string, string>();
  for (const c of counterparties.data?.items ?? []) {
    suppliersMap.set(c.id, c.name);
  }
  const supplierName = (id: string | null | undefined) =>
    id ? suppliersMap.get(id) ?? '—' : '—';

  const renderDeleteButton = (r: Row) => (
    <Popconfirm
      title="Удалить приёмку?"
      description="Запись, фото и связи с УПД будут удалены. УПД вернётся в «Ожидаемые»."
      okText="Да, удалить"
      cancelText="Нет"
      okButtonProps={{ danger: true }}
      onConfirm={() => del.mutate(r.id)}
    >
      <Button
        danger
        size="small"
        shape="circle"
        icon={<DeleteOutlined />}
        loading={del.isPending && del.variables === r.id}
        onClick={(e) => e.stopPropagation()}
      />
    </Popconfirm>
  );

  return (
    <ResponsiveTable<Row>
      items={list.data?.items ?? []}
      loading={list.isLoading}
      rowKey="id"
      onRowClick={(r) => onOpen(r.id)}
      emptyText="Нет приёмок"
      columns={[
        {
          title: 'Статус',
          key: 'status',
          render: (_: unknown, r: Row) => (
            <Tag color={r.status.color ?? 'default'}>{r.status.label}</Tag>
          ),
        },
        { title: 'Авто', dataIndex: 'vehiclePlate' },
        { title: 'Прибытие', dataIndex: 'arrivedAt' },
        {
          title: 'Поставщик',
          key: 'supplier',
          render: (_: unknown, r: Row) => supplierName(r.supplierId),
        },
        {
          title: 'Кол-во',
          key: 'itemsCount',
          render: (_: unknown, r: Row) => r.items?.length ?? 0,
        },
        {
          title: '',
          key: 'actions',
          width: 56,
          align: 'right' as const,
          onCell: () => ({
            onClick: (e: MouseEvent) => e.stopPropagation(),
          }),
          render: (_: unknown, r: Row) => renderDeleteButton(r),
        },
      ]}
      cardRender={(r) => (
        <Card style={{ width: '100%' }} size="small">
          <Space
            direction="vertical"
            size={4}
            style={{ width: '100%', position: 'relative' }}
          >
            <Space>
              <Tag color={r.status.color ?? 'default'}>{r.status.label}</Tag>
              <Typography.Text strong>{r.vehiclePlate ?? 'Без номера'}</Typography.Text>
            </Space>
            <Typography.Text type="secondary">
              {supplierName(r.supplierId)} · {r.items?.length ?? 0} стр.
            </Typography.Text>
            <Typography.Text type="secondary">{r.arrivedAt ?? '—'}</Typography.Text>
            <div
              style={{ position: 'absolute', top: 0, right: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              {renderDeleteButton(r)}
            </div>
          </Space>
        </Card>
      )}
    />
  );
}
