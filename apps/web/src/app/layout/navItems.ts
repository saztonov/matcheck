import type { UserRole } from '@matcheck/contracts';

export type NavItem = {
  key: string;
  label: string;
  path: string;
  roles: UserRole[];
};

export const navItems: NavItem[] = [
  { key: 'kpp', label: 'КПП', path: '/kpp', roles: ['admin', 'manager', 'inspector_kpp'] },
  { key: 'documents', label: 'Документы', path: '/documents', roles: ['admin', 'manager'] },
  {
    key: 'materials',
    label: 'Материалы',
    path: '/materials',
    roles: ['admin', 'manager', 'inspector_kpp'],
  },
  {
    key: 'deliveries',
    label: 'Приёмки',
    path: '/deliveries',
    roles: ['admin', 'manager', 'inspector_kpp'],
  },
  {
    key: 'counterparties',
    label: 'Контрагенты',
    path: '/references/counterparties',
    roles: ['admin', 'manager'],
  },
  {
    key: 'materials-ref',
    label: 'Справочник материалов',
    path: '/references/materials',
    roles: ['admin', 'manager'],
  },
  { key: 'admin', label: 'Администрирование', path: '/admin', roles: ['admin'] },
  {
    key: 'settings',
    label: 'Настройки',
    path: '/settings',
    roles: ['manager', 'inspector_kpp'],
  },
];

export function filterByRole(role: UserRole): NavItem[] {
  return navItems.filter((n) => n.roles.includes(role));
}
