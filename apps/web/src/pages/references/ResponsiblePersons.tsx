import { useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResponsiblePerson, ResponsiblePersonUpsert } from '@matcheck/contracts';
import { api } from '../../services/api';
import { ResponsiveTable } from '../../shared/ui/ResponsiveTable';

type List = { items: ResponsiblePerson[]; total: number };

export default function ResponsiblePersonsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [form] = Form.useForm<ResponsiblePersonUpsert>();

  const list = useQuery({
    queryKey: ['responsible-persons', search],
    queryFn: () =>
      api.get<List>(`/responsible-persons${search ? `?q=${encodeURIComponent(search)}` : ''}`),
  });

  const create = useMutation({
    mutationFn: (body: ResponsiblePersonUpsert) => api.post('/responsible-persons', body),
    onSuccess: () => {
      message.success('МОЛ создан');
      setOpen(false);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['responsible-persons'] });
    },
    onError: (err: Error) => message.error(err.message),
  });

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          МОЛ (материально-ответственные лица)
        </Typography.Title>
        <Space>
          <Input.Search placeholder="ФИО" allowClear onSearch={setSearch} />
          <Button type="primary" onClick={() => setOpen(true)}>
            Добавить
          </Button>
        </Space>
      </Space>
      <ResponsiveTable<ResponsiblePerson>
        items={list.data?.items ?? []}
        loading={list.isLoading}
        rowKey="id"
        columns={[
          { title: 'ФИО', dataIndex: 'fullName' },
          { title: 'Должность', dataIndex: 'position' },
          { title: 'Телефон', dataIndex: 'phone' },
          {
            title: 'Статус',
            key: 'status',
            render: (_: unknown, r: ResponsiblePerson) =>
              r.isActive ? (
                <Tag color="green">Активный</Tag>
              ) : (
                <Tag color="default">В архиве</Tag>
              ),
          },
        ]}
        cardRender={(r) => (
          <Card style={{ width: '100%' }} size="small">
            <Space direction="vertical" size={4}>
              <Typography.Text strong>{r.fullName}</Typography.Text>
              {r.position && (
                <Typography.Text type="secondary">{r.position}</Typography.Text>
              )}
              {r.phone && <Typography.Text type="secondary">{r.phone}</Typography.Text>}
              {!r.isActive && <Tag color="default">В архиве</Tag>}
            </Space>
          </Card>
        )}
      />
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Новый МОЛ"
        width={420}
        destroyOnClose
      >
        <Form<ResponsiblePersonUpsert>
          form={form}
          layout="vertical"
          initialValues={{ isActive: true }}
          onFinish={(values) => create.mutate(values)}
        >
          <Form.Item name="fullName" label="ФИО" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="position" label="Должность">
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Телефон">
            <Input inputMode="tel" />
          </Form.Item>
          <Form.Item name="isActive" label="Активный" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={create.isPending} block size="large">
            Сохранить
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
