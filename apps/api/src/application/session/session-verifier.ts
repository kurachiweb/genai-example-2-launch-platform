import type {
  AuthenticatedPrincipal,
  SessionSubjectKind,
} from '../../../lib/core/session/session-view.ts';

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

// ブラウザはCookieのMax-Ageを400日で切り詰め、フロントエンドサーバーはそれを超える指示を捨てるため、発行できる有効期間をそこまでに限る
export const MAX_SESSION_MAX_AGE_SECONDS = 34_560_000;
