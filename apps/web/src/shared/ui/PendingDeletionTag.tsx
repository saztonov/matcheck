import { Tag, Tooltip } from 'antd';

export interface PendingDeletionTagProps {
  at: string | null;
  byEmail: string | null;
  reason: string | null;
}

/**
 * Маркер документа, помеченного на удаление.
 * Используется в списках (рядом со статус-бейджем) и на странице редактора.
 */
export function PendingDeletionTag({ at, byEmail, reason }: PendingDeletionTagProps) {
  const date = at ? new Date(at).toLocaleString('ru-RU') : '—';
  const author = byEmail ?? '—';
  const lines = [`Помечен: ${author}`, `Дата: ${date}`];
  if (reason) lines.push(`Причина: ${reason}`);
  return (
    <Tooltip title={lines.join('\n')} overlayInnerStyle={{ whiteSpace: 'pre-line' }}>
      <Tag color="volcano">На удалении</Tag>
    </Tooltip>
  );
}
