import type { MouseEvent } from 'react';
import { Button, Card, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Counterparty,
  Shipment,
  ShipmentKind,
  ShipmentListResponseSchema,
  Site,
} from '@matcheck/contracts';
import type { z } from 'zod';
import { api } from '../../services/api';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';

type List = z.infer<typeof ShipmentListResponseSchema>;
type Row = List['items'][number];

const KIND_LABELS: Record<ShipmentKind, { label: string; color: string }> = {
  contractor: { label: 'Подрядчику', color: 'geekblue' },
  return: { label: 'Возврат', color: 'magenta' },
  transfer: { label: 'Перемещение', color: 'cyan' },
  writeoff: { label: 'Списание', color: 'volcano' },
};

export function ShipmentsHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['shipments'],
    queryFn: () => api.get<List>('/shipments'),
  });

  const counterparties = useQuery({
    queryKey: ['counterparties', 'all'],
    queryFn: () => api.get<{ items: Counterparty[]; total: number }>('/counterparties?limit=500'),
  });
  const sites = useQuery({
    queryKey: ['sites', 'all'],
    queryFn: () => api.get<{ items: Site[]; total: number }>('/sites?limit=500'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/shipments/${id}`),
    onSuccess: async () => {
      message.success('Отгрузка удалена');
      await queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  const counterpartiesMap = new Map<string, string>();
  for (const c of counterparties.data?.items ?? []) counterpartiesMap.set(c.id, c.name);
  const sitesMap = new Map<string, string>();
  for (const s of sites.data?.items ?? []) sitesMap.set(s.id, `${s.code} · ${s.name}`);

  const destinationLabel = (r: Shipment): string => {
    if (r.kind === 'contractor' || r.kind === 'return') {
      return r.receiverCounterpartyId
        ? counterpartiesMap.get(r.receiverCounterpartyId) ?? '—'
        : '—';
    }
    if (r.kind === 'transfer') {
      return r.destSiteId ? sitesMap.get(r.destSiteId) ?? '—' : '—';
    }
    return 'Списание';
  };

  const renderDeleteButton = (r: Row) => (
    <Popconfirm
      title="Удалить отгрузку?"
      description="Запись, фото и связи с документами будут удалены."
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
      emptyText="Нет отгрузок"
      columns={[
        {
          title: 'Статус',
          key: 'status',
          render: (_: unknown, r: Row) => (
            <Tag color={r.status.color ?? 'default'}>{r.status.label}</Tag>
          ),
        },
        {
          title: 'Вид',
          key: 'kind',
          render: (_: unknown, r: Row) => (
            <Tag color={KIND_LABELS[r.kind].color}>{KIND_LABELS[r.kind].label}</Tag>
          ),
        },
        {
          title: 'Откуда',
          key: 'site',
          render: (_: unknown, r: Row) => sitesMap.get(r.siteId) ?? '—',
        },
        {
          title: 'Куда',
          key: 'dest',
          render: (_: unknown, r: Row) => destinationLabel(r),
        },
        { title: 'Авто', dataIndex: 'vehiclePlate' },
        { title: 'Отгружено', dataIndex: 'shippedAt' },
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
          <Space direction="vertical" size={4} style={{ width: '100%', position: 'relative' }}>
            <Space wrap>
              <Tag color={r.status.color ?? 'default'}>{r.status.label}</Tag>
              <Tag color={KIND_LABELS[r.kind].color}>{KIND_LABELS[r.kind].label}</Tag>
              <Typography.Text strong>{r.vehiclePlate ?? 'Без номера'}</Typography.Text>
            </Space>
            <Typography.Text type="secondary">
              {sitesMap.get(r.siteId) ?? '—'} → {destinationLabel(r)}
            </Typography.Text>
            <Typography.Text type="secondary">
              {r.shippedAt ?? '—'} · {r.items?.length ?? 0} стр.
            </Typography.Text>
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
