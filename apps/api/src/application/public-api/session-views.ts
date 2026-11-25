import type {
  AuthenticatedPrincipal,
  Principal,
  SessionView,
} from '../../../lib/core/session/session-view.ts';

const ANONYMOUS_PRINCIPAL: Principal = Object.freeze({ kind: 'anonymous' });

// 公開データの経路はキーの持ち主を閲覧者とせず、未ログインと同じ公開範囲で上流を呼ぶ
export const ANONYMOUS_SESSION_VIEW: SessionView = Object.freeze({
  principal: () => Promise.resolve(ANONYMOUS_PRINCIPAL),
});

const API_KEY_SESSION_ID_PREFIX = 'api-key:';

// APIキーの要求には保存済みのセッションが無いため、利用者の状態の判定へ渡す主体のセッションIDにキーのIDを入れる
export const apiKeySessionView = (input: {
  readonly userId: string;
  readonly keyId: string;
}): SessionView => {
  const principal: AuthenticatedPrincipal = Object.freeze({
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: input.userId,
    sessionId: `${API_KEY_SESSION_ID_PREFIX}${input.keyId}`,
  });
  return Object.freeze({ principal: () => Promise.resolve(principal) });
};
