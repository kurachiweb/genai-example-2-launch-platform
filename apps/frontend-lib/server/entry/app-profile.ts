import type { AppEnvironment } from '../../utilities/system/system-status-availability.ts';

export type { AppEnvironment };

export type CallerKind = 'client' | 'admin';

export interface FrontendAppProfile {
  // ログのカテゴリの先頭に使う。中継先の入口はWrangler設定のService Bindingsのentrypointで決まる
  readonly caller: CallerKind;
  readonly sessionCookieName: `__Host-${string}`;
  readonly indexable: (environment: AppEnvironment) => boolean;
  readonly webAnalytics: boolean;
}
