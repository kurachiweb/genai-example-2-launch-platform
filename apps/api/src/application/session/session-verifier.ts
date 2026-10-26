export type SessionSubjectKind = 'user' | 'admin';

export interface AuthenticatedPrincipal {
  readonly kind: 'authenticated';
  readonly subjectKind: SessionSubjectKind;
  readonly subjectId: string;
  // 保存済みセッションのレコードのIDで、セッション識別子そのものではない
  readonly sessionId: string;
}

export type Principal = { readonly kind: 'anonymous' } | AuthenticatedPrincipal;

export interface SessionIssue {
  readonly token: string;
  readonly maxAgeSeconds: number;
}

export type SessionVerification =
  | {
      readonly status: 'valid';
      readonly principal: AuthenticatedPrincipal;
      readonly renewal?: SessionIssue;
    }
  | { readonly status: 'invalid' };

export interface SessionVerifier {
  verify(input: {
    readonly subjectKind: SessionSubjectKind;
    readonly token: string;
  }): Promise<SessionVerification>;
}

const SessionVerifier: unique symbol = Symbol.for('session.SessionVerifier');

export const SESSION_TYPES = Object.freeze({
  SessionVerifier,
});

// 32バイトの乱数をパディング無しのbase64urlにした43文字
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
