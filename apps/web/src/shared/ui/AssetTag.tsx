import { Tag } from 'antd';

// Визуальный стикер для позиций документа c item_kind='asset' (ОС).
// Используется в таблицах позиций приёмки/отгрузки рядом с наименованием.
export function AssetTag() {
  return <Tag color="purple">ОС</Tag>;
}
