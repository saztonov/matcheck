import { useState } from 'react';
import {
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Space,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import { CameraOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  Delivery,
  DeliveryUpsert,
  SourceDocument,
  SourceDocumentDetail,
  SourceDocumentListResponseSchema,
} from '@matcheck/contracts';
import type { z } from 'zod';
import { api } from '../../services/api';
import { capturePhoto } from '../../services/photoPipeline';

type DraftItem = {
  lineNo: number;
  nameRaw: string;
  qtyPlanned: string | null;
  qtyActual: string | null;
  unit: string;
  materialId: string | null;
};

type SourceList = z.infer<typeof SourceDocumentListResponseSchema>;

export default function KppPage() {
  const [items, setItems] = useState<DraftItem[]>([]);
  const [plate, setPlate] = useState('');
  const [comment, setComment] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [updQuery, setUpdQuery] = useState('');
  const [selectedUpd, setSelectedUpd] = useState<SourceDocument | null>(null);

  const updSuggestions = useQuery({
    queryKey: ['source-documents', 'unaccepted-upd', updQuery],
    queryFn: () =>
      api.get<SourceList>(
        `/source-documents?kind=upd&unaccepted=true${
          updQuery ? `&q=${encodeURIComponent(updQuery)}` : ''
        }&limit=20`,
      ),
    enabled: !savedId,
  });

  const loadDetail = useMutation({
    mutationFn: (id: string) => api.get<SourceDocumentDetail>(`/source-documents/${id}`),
    onSuccess: (detail) => {
      setSelectedUpd(detail);
      setItems(
        detail.items.map((it, idx) => ({
          lineNo: idx + 1,
          nameRaw: it.nameRaw,
          qtyPlanned: it.qty,
          qtyActual: it.qty,
          unit: it.unit,
          materialId: it.materialId,
        })),
      );
    },
    onError: (err: Error) => message.error(`Не удалось загрузить УПД: ${err.message}`),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload: DeliveryUpsert = {
        status: 'verified',
        supplierId: selectedUpd?.supplierId ?? null,
        vehiclePlate: plate || null,
        arrivedAt: new Date().toISOString(),
        comment: comment || null,
        sourceDocumentIds: selectedUpd ? [selectedUpd.id] : [],
        items: items
          .filter((i) => i.nameRaw.trim().length > 0)
          .map((i) => ({
            lineNo: i.lineNo,
            nameRaw: i.nameRaw,
            qtyPlanned: i.qtyPlanned,
            qtyActual: i.qtyActual,
            unit: i.unit,
            materialId: i.materialId,
          })),
      };
      return api.post<Delivery>('/deliveries', payload);
    },
    onSuccess: (d) => {
      setSavedId(d.id);
      message.success('Приёмка сохранена');
    },
    onError: (err: Error) => message.error(err.message),
  });

  const photoProps: UploadProps = {
    accept: 'image/*',
    showUploadList: false,
    beforeUpload: async (file) => {
      if (!savedId) {
        message.warning('Сначала сохраните приёмку — фото привязываются к ней.');
        return false;
      }
      try {
        await capturePhoto(savedId, file, 'cargo');
        message.success('Фото добавлено');
      } catch (err) {
        message.error(`Не удалось добавить фото: ${(err as Error).message}`);
      }
      return false;
    },
  };

  const updateItem = (idx: number, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        lineNo: prev.length + 1,
        nameRaw: '',
        qtyPlanned: null,
        qtyActual: null,
        unit: 'шт',
        materialId: null,
      },
    ]);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, lineNo: i + 1 })));
  };

  const updOptions = (updSuggestions.data?.items ?? []).map((sd) => ({
    value: sd.id,
    label: `${sd.docNumber ?? '— без номера —'}${sd.docDate ? ` от ${sd.docDate}` : ''}${
      sd.totalSum ? ` · ${sd.totalSum} ₽` : ''
    }`,
  }));

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%', paddingBottom: 96 }}>
      <Typography.Title level={3}>КПП</Typography.Title>
      <Card title="Транспорт" size="small">
        <Form layout="vertical">
          <Form.Item label="Госномер">
            <Input
              size="large"
              placeholder="А123ВВ77"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              inputMode="text"
              autoCapitalize="characters"
              style={{ fontSize: 18 }}
            />
          </Form.Item>
        </Form>
      </Card>
      <Card title="УПД" size="small">
        {selectedUpd ? (
          <Space wrap>
            <Tag color="blue">{selectedUpd.docNumber ?? '— без номера —'}</Tag>
            <Typography.Text type="secondary">
              {selectedUpd.docDate ?? '—'} · {selectedUpd.totalSum ?? '—'} ₽
            </Typography.Text>
            <Button
              size="small"
              onClick={() => {
                setSelectedUpd(null);
                setItems([]);
              }}
              disabled={!!savedId}
            >
              Сменить
            </Button>
          </Space>
        ) : (
          <AutoComplete
            size="large"
            style={{ width: '100%' }}
            placeholder="Введите номер УПД для поиска"
            value={updQuery}
            onChange={(v) => setUpdQuery(v)}
            onSelect={(value) => {
              loadDetail.mutate(value);
              setUpdQuery('');
            }}
            options={updOptions}
            notFoundContent={updSuggestions.isLoading ? 'Поиск…' : 'Ничего не найдено'}
            filterOption={false}
          />
        )}
      </Card>
      <Card
        title={`Позиции${items.length ? ` (${items.length})` : ''}`}
        size="small"
        extra={
          <Button size="large" onClick={addItem}>
            + Позиция
          </Button>
        }
      >
        {items.length === 0 && (
          <Typography.Text type="secondary">
            Выберите УПД выше — позиции подтянутся автоматически. Или добавьте строки вручную.
          </Typography.Text>
        )}
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {items.map((it, idx) => (
            <Card
              key={idx}
              size="small"
              type="inner"
              title={`№ ${it.lineNo}`}
              extra={
                <Button size="small" danger onClick={() => removeItem(idx)}>
                  ×
                </Button>
              }
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input
                  size="large"
                  placeholder="Наименование материала"
                  value={it.nameRaw}
                  onChange={(e) => updateItem(idx, { nameRaw: e.target.value })}
                />
                <Space wrap>
                  <span>План:</span>
                  <InputNumber
                    size="large"
                    min={0}
                    style={{ width: 120 }}
                    value={it.qtyPlanned !== null ? Number(it.qtyPlanned) : null}
                    onChange={(v) => updateItem(idx, { qtyPlanned: v !== null ? String(v) : null })}
                    disabled={!!it.materialId}
                  />
                  <span>Факт:</span>
                  <InputNumber
                    size="large"
                    min={0}
                    style={{ width: 120 }}
                    value={it.qtyActual !== null ? Number(it.qtyActual) : null}
                    onChange={(v) => updateItem(idx, { qtyActual: v !== null ? String(v) : null })}
                  />
                  <Input
                    size="large"
                    style={{ width: 80 }}
                    value={it.unit}
                    onChange={(e) => updateItem(idx, { unit: e.target.value })}
                  />
                </Space>
              </Space>
            </Card>
          ))}
        </Space>
      </Card>
      <Card title="Комментарий" size="small">
        <Input.TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Card>
      <Card title="Фото" size="small">
        <Space wrap>
          <Upload {...photoProps}>
            <Button size="large" icon={<CameraOutlined />}>
              Снять фото
            </Button>
          </Upload>
          {savedId && (
            <Tag color="green">Приёмка #{savedId.slice(0, 8)} сохранена — можно добавлять фото</Tag>
          )}
        </Space>
      </Card>
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          padding: 12,
          background: '#fff',
          borderTop: '1px solid #f0f0f0',
          zIndex: 100,
        }}
      >
        <Button
          type="primary"
          size="large"
          icon={<SaveOutlined />}
          block
          loading={save.isPending}
          onClick={() => save.mutate()}
          disabled={!plate || items.every((i) => !i.nameRaw.trim()) || !!savedId}
          style={{ height: 56, fontSize: 18 }}
        >
          {savedId ? 'Приёмка сохранена' : 'Сохранить приёмку'}
        </Button>
      </div>
      <Modal open={false} onCancel={() => undefined} title="Установить приложение" footer={null}>
        Используйте «Добавить на главный экран» в браузере для офлайн-работы.
      </Modal>
    </Space>
  );
}
