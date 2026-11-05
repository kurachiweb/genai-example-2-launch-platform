export type SessionSubjectKind = 'user' | 'admin';

export interface AuthenticatedPrincipal {
  readonly kind: 'authenticated';
  readonly subjectKind: SessionSubjectKind;
  readonly subjectId: string;
  // 保存済みセッションのレコードのIDで、セッション識別子そのものではない
  readonly sessionId: string;
}

export type Principal = { readonly kind: 'anonymous' } | AuthenticatedPrincipal;

// application層はpresentation層のセッションの読み書きを読み込めないため、同じ要求のセッションを読み取りだけの形で受け取る
export interface SessionView {
  principal(): Promise<Principal>;
}
