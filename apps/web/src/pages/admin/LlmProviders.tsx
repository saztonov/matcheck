import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LlmProviderDto, LlmProviderUpsert } from '@matcheck/contracts';
import { api } from '../../services/api';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';

const KIND_DEFAULTS: Record<string, { apiBaseUrl: string; model: string }> = {
  openrouter: { apiBaseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5' },
  google_ai_studio: {
    apiBaseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
  },
  qwen_self_hosted: { apiBaseUrl: 'https://your-qwen-host/v1', model: 'qwen2.5-72b-instruct' },
  vertex: { apiBaseUrl: 'https://us-central1-aiplatform.googleapis.com', model: 'gemini-2.5-pro' },
};

const NEW_DEFAULTS: Partial<LlmProviderUpsert> = {
  kind: 'openrouter',
  ...KIND_DEFAULTS.openrouter,
  temperature: '0.2',
  maxTokens: 4096,
  isDefault: false,
  isActive: true,
};

export default function AdminLlmProvidersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LlmProviderDto | null>(null);
  const [form] = Form.useForm<LlmProviderUpsert>();

  const list = useQuery({
    queryKey: ['admin', 'llm-providers'],
    queryFn: () => api.get<LlmProviderDto[]>('/admin/llm-providers'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'llm-providers'] });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (editing) {
      form.setFieldsValue({
        name: editing.name,
        kind: editing.kind,
        apiBaseUrl: editing.apiBaseUrl,
        model: editing.model,
        temperature: editing.temperature,
        maxTokens: editing.maxTokens,
        isDefault: editing.isDefault,
        isActive: editing.isActive,
      });
    } else {
      form.setFieldsValue(NEW_DEFAULTS);
    }
  }, [open, editing, form]);

  const closeDrawer = () => {
    setOpen(false);
    setEditing(null);
  };

  const create = useMutation({
    mutationFn: (body: LlmProviderUpsert) => api.post('/admin/llm-providers', body),
    onSuccess: () => {
      message.success('Провайдер добавлен');
      closeDrawer();
      void invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<LlmProviderUpsert> }) =>
      api.patch(`/admin/llm-providers/${id}`, body),
    onSuccess: () => {
      message.success('Сохранено');
      closeDrawer();
      void invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<LlmProviderUpsert> }) =>
      api.patch(`/admin/llm-providers/${id}`, body),
    onSuccess: () => void invalidate(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/llm-providers/${id}`),
    onSuccess: () => {
      message.success('Удалён');
      void invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const test = useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: boolean; output?: string; error?: string; durationMs: number }>(
        `/admin/llm-providers/${id}/test`,
      ),
    onSuccess: (r) => {
      if (r.ok) message.success(`OK (${r.durationMs} мс): ${r.output ?? ''}`);
      else message.error(`Ошибка: ${r.error}`);
    },
    onError: (err: Error) => message.error(err.message),
  });

  const onSubmit = (v: LlmProviderUpsert) => {
    if (editing) {
      const { apiKey, ...rest } = v;
      const body: Partial<LlmProviderUpsert> = apiKey ? { ...rest, apiKey } : rest;
      update.mutate({ id: editing.id, body });
    } else {
      create.mutate(v);
    }
  };

  const openEdit = (r: LlmProviderDto) => {
    setEditing(r);
    setOpen(true);
  };

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          LLM провайдеры
        </Typography.Title>
        <Button type="primary" onClick={openCreate}>
          Добавить
        </Button>
      </Space>
      <ResponsiveTable<LlmProviderDto>
        items={list.data ?? []}
        loading={list.isLoading}
        rowKey="id"
        columns={[
          {
            title: 'Имя',
            dataIndex: 'name',
            render: (n: string, r: LlmProviderDto) => (
              <Space>
                <span>{n}</span>
                {r.isDefault && <Tag color="purple">default</Tag>}
                {!r.isActive && <Tag>не активен</Tag>}
              </Space>
            ),
          },
          { title: 'Kind', dataIndex: 'kind' },
          { title: 'Модель', dataIndex: 'model' },
          {
            title: 'Действия',
            key: 'a',
            render: (_: unknown, r: LlmProviderDto) => (
              <Space wrap>
                <Button size="small" onClick={() => openEdit(r)}>
                  Редактировать
                </Button>
                <Button size="small" onClick={() => test.mutate(r.id)} loading={test.isPending}>
                  Тест
                </Button>
                <Button
                  size="small"
                  onClick={() => patch.mutate({ id: r.id, body: { isDefault: true } })}
                >
                  Сделать default
                </Button>
                <Switch
                  checked={r.isActive}
                  onChange={(v) => patch.mutate({ id: r.id, body: { isActive: v } })}
                />
                <Popconfirm
                  title="Удалить провайдера?"
                  okText="Удалить"
                  cancelText="Отмена"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => remove.mutate(r.id)}
                >
                  <Button size="small" danger>
                    Удалить
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        cardRender={(r) => (
          <Card style={{ width: '100%' }} size="small">
            <Space direction="vertical">
              <Space>
                <Typography.Text strong>{r.name}</Typography.Text>
                {r.isDefault && <Tag color="purple">default</Tag>}
                {!r.isActive && <Tag>не активен</Tag>}
              </Space>
              <Typography.Text type="secondary">
                {r.kind} · {r.model}
              </Typography.Text>
              <Space wrap>
                <Button size="small" onClick={() => openEdit(r)}>
                  Редактировать
                </Button>
                <Button size="small" onClick={() => test.mutate(r.id)}>
                  Тест
                </Button>
                <Button
                  size="small"
                  onClick={() => patch.mutate({ id: r.id, body: { isDefault: true } })}
                >
                  Default
                </Button>
                <Popconfirm
                  title="Удалить провайдера?"
                  okText="Удалить"
                  cancelText="Отмена"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => remove.mutate(r.id)}
                >
                  <Button size="small" danger>
                    Удалить
                  </Button>
                </Popconfirm>
              </Space>
            </Space>
          </Card>
        )}
      />
      <Drawer
        open={open}
        onClose={closeDrawer}
        title={editing ? `Редактирование: ${editing.name}` : 'Новый LLM провайдер'}
        width={520}
        destroyOnClose
      >
        <Form<LlmProviderUpsert>
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          onValuesChange={(changed, all) => {
            if (editing) return;
            if (changed.kind && all.kind && KIND_DEFAULTS[all.kind]) {
              form.setFieldsValue(KIND_DEFAULTS[all.kind]);
            }
          }}
        >
          <Form.Item name="name" label="Имя" rules={[{ required: true }]}>
            <Input placeholder="Claude Sonnet через OpenRouter" />
          </Form.Item>
          <Form.Item name="kind" label="Тип" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'openrouter', label: 'OpenRouter' },
                { value: 'google_ai_studio', label: 'Google AI Studio (Gemini)' },
                { value: 'qwen_self_hosted', label: 'Qwen (self-hosted, OpenAI-compat)' },
                { value: 'vertex', label: 'Vertex AI' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="apiBaseUrl"
            label="API base URL"
            rules={[{ required: true, type: 'url' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="model" label="Модель" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label={editing ? 'API key (новый)' : 'API key'}
            rules={editing ? [] : [{ required: true }]}
            extra={editing ? 'Оставьте пустым, чтобы не менять текущий ключ' : undefined}
          >
            <Input.Password
              placeholder={editing ? 'Оставьте пустым, чтобы не менять' : undefined}
              autoComplete="new-password"
            />
          </Form.Item>
          <Space>
            <Form.Item name="temperature" label="Temperature">
              <Input />
            </Form.Item>
            <Form.Item name="maxTokens" label="Max tokens">
              <InputNumber min={1} />
            </Form.Item>
          </Space>
          <Form.Item name="isDefault" valuePropName="checked" label="По умолчанию">
            <Switch />
          </Form.Item>
          <Form.Item name="isActive" valuePropName="checked" label="Активен">
            <Switch />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            size="large"
            loading={create.isPending || update.isPending}
          >
            Сохранить
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
