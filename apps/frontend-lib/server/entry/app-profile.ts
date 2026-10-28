import type { AppEnvironment } from '../../utilities/system/system-status-availability.ts';

export type { AppEnvironment };

export type CallerKind = 'client' | 'admin';

export interface FrontendAppProfile {
  // ログのカテゴリの先頭に使う。中継先の入口はWrangler設定のService Bindingsのentrypointで決まる
  readonly caller: CallerKind;
  readonly sessionCookieName: `__Host-${string}`;
  readonly indexable: (environment: AppEnvironment) => boolean;
  readonly webAnalytics: boolean;
  // 問い合わせの画面への導線の有無の唯一の定義。静的な500の画面と、画面がerrorMessageOfで選ぶ失敗の文言が読む
  readonly contactAvailable: boolean;
}
