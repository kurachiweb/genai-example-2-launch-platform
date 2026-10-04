export type AppName = 'api' | 'event' | 'frontend-lib' | 'client' | 'admin';

export interface AppDefinition {
  readonly name: AppName;
  readonly dir: string;
}

export interface SharedDirMount {
  readonly consumer: AppName;
  readonly target: string;
}

export interface SharedDirDefinition {
  readonly source: string;
  readonly mounts: readonly SharedDirMount[];
  readonly checkedBy: AppName | 'self';
}

export const APPS: readonly AppDefinition[] = [
  { name: 'api', dir: 'apps/api' },
  { name: 'event', dir: 'apps/event' },
  { name: 'frontend-lib', dir: 'apps/frontend-lib' },
  { name: 'client', dir: 'apps/client' },
  { name: 'admin', dir: 'apps/admin' },
];

// 配置先は開発コンテナ(compose.yaml)のbind mount先と完全に一致させる
export const SHARED_DIRS: readonly SharedDirDefinition[] = [
  {
    source: 'apps/db',
    mounts: [
      { consumer: 'api', target: 'apps/api/db' },
      { consumer: 'event', target: 'apps/event/db' },
    ],
    checkedBy: 'api',
  },
  {
    source: 'apps/backend-lib',
    mounts: [
      { consumer: 'api', target: 'apps/api/lib' },
      { consumer: 'event', target: 'apps/event/lib' },
    ],
    checkedBy: 'api',
  },
  {
    source: 'apps/frontend-lib',
    mounts: [
      { consumer: 'client', target: 'apps/client/lib' },
      { consumer: 'admin', target: 'apps/admin/lib' },
    ],
    checkedBy: 'self',
  },
];

export const QUALITY_GATE_EXCLUDED_DIRS: readonly string[] = ['mockups'];
