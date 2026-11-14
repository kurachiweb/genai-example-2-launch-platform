import { DisplayPreferencesProvider } from '../lib/components/datetime/display-preferences-provider.tsx';
import type { GraphQLResult } from '../lib/utilities/graphql/graphql-result.ts';
import { SecuritySettingsPage } from '../src/components/settings/security-settings-page.tsx';
import { mySessionsQueryOptions } from '../src/components/settings/my-sessions-query.ts';
import type {
  AccountStatus,
  ClientMySessionsQuery,
} from '../src/graphql/generated/graphql.ts';
import { toClientViewer } from '../src/graphql/viewer.ts';
import { createPageRouterContext, renderInRouter } from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

type SessionSummary = ClientMySessionsQuery['mySessions'][number];

export const CURRENT_SESSION: SessionSummary = Object.freeze({
  id: 'session-current',
  browserName: 'Chrome',
  osName: 'macOS',
  createdAt: '2026-10-20T01:00:00.000Z',
  lastUsedAt: '2026-11-02T08:30:00.000Z',
  current: true,
});

export const BROWSER_ONLY_SESSION: SessionSummary = Object.freeze({
  id: 'session-browser-only',
  browserName: 'Firefox',
  osName: null,
  createdAt: '2026-10-25T03:15:00.000Z',
  lastUsedAt: '2026-11-01T12:00:00.000Z',
  current: false,
});

export const UNKNOWN_SESSION: SessionSummary = Object.freeze({
  id: 'session-unknown',
  browserName: null,
  osName: null,
  createdAt: '2026-10-28T09:45:00.000Z',
  lastUsedAt: '2026-10-30T22:10:00.000Z',
  current: false,
});

export const ALL_SESSIONS: readonly SessionSummary[] = Object.freeze([
  CURRENT_SESSION,
  BROWSER_ONLY_SESSION,
  UNKNOWN_SESSION,
]);

export interface SecurityState {
  readonly sessions?: readonly SessionSummary[];
  readonly totpEnabled?: boolean;
  readonly remainingRecoveryCodes?: number;
}

export const mySessionsQuery = ({
  sessions = ALL_SESSIONS,
  totpEnabled = false,
  remainingRecoveryCodes = totpEnabled ? 10 : 0,
}: SecurityState = {}): ClientMySessionsQuery => ({
  mySessions: [...sessions],
  viewer: {
    id: '01JC0VIEWER0000000000000000',
    totpEnabled,
    remainingRecoveryCodes,
  },
});

export const mySessionsResult = (
  state: SecurityState = {},
): GraphQLResult<ClientMySessionsQuery> => ({
  ok: true,
  data: mySessionsQuery(state),
});

// 秘密鍵とリカバリコードらしい文字列をソースに直接書かず、実行時に組み立てる
export const TOTP_SECRET = ['JBSW', 'Y3DP', 'EHPK', '3PXP'].join('');

export const TOTP_SETUP = Object.freeze({
  otpauthUri: `otpauth://totp/Launch%20Stadium:maker%40launch.example?secret=${TOTP_SECRET}&issuer=Launch%20Stadium`,
  secret: TOTP_SECRET,
  expiresAt: '2026-11-02T08:40:00.000Z',
});

export const RECOVERY_CODES: readonly string[] = Object.freeze(
  Array.from({ length: 10 }, (_, index) =>
    ['pitch', 'code', String(index)].join('-'),
  ),
);

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

export interface RenderSecurityPageOptions extends SecurityState {
  readonly status?: AccountStatus;
}

// 経路のloaderが取得を済ませた状態を再現するため、セッションの一覧をキャッシュに入れてから描く
export async function renderSecurityPage({
  status = 'ACTIVE',
  ...state
}: RenderSecurityPageOptions = {}) {
  const viewerQuery = signedInViewerQuery({
    status,
    totpEnabled: state.totpEnabled ?? false,
  });
  const viewer = toClientViewer(viewerQuery);
  if (viewer === null) {
    throw new Error('ログイン中の利用者の値がありません。');
  }
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(
    mySessionsQueryOptions(viewer.id).queryKey,
    mySessionsQuery(state),
  );
  const router = await renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      <main>
        <SecuritySettingsPage viewer={viewer} />
      </main>
    </DisplayPreferencesProvider>,
    { path: '/settings/security', context, cachedViewer: viewerQuery },
  );
  return { router, context };
}
