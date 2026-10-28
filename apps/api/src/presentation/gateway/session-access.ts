import type { Context } from 'hono';
import type { Container } from 'inversify';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  type AuthenticatedPrincipal,
  MAX_SESSION_MAX_AGE_SECONDS,
  type Principal,
  SESSION_TOKEN_PATTERN,
  SESSION_TYPES,
  type SessionIssue,
  type SessionSubjectKind,
  type SessionVerifier,
} from '../../application/session/session-verifier.ts';
import {
  type CallerKind,
  SESSION_RESPONSE_HEADERS,
} from './gateway-headers.ts';

export interface SessionAccess {
  principal(): Promise<Principal>;
  requireAuthenticated(): Promise<AuthenticatedPrincipal>;
  issue(session: SessionIssue): void;
  clear(): void;
}

export interface SessionAccessInput {
  readonly container: Container;
  readonly caller: CallerKind;
  readonly token: string | undefined;
}

type SessionInstruction =
  | { readonly kind: 'issue'; readonly session: SessionIssue }
  | { readonly kind: 'clear' };

const SUBJECT_KIND_BY_CALLER: Readonly<Record<CallerKind, SessionSubjectKind>> =
  Object.freeze({ client: 'user', admin: 'admin' });

const ANONYMOUS: Principal = Object.freeze({ kind: 'anonymous' });

const CLEAR_INSTRUCTION: SessionInstruction = Object.freeze({ kind: 'clear' });

const CLEAR_HEADER_VALUE = '1';

const UNAUTHENTICATED_MESSAGE = 'ログインが必要です。';

class InvocationSessionAccess implements SessionAccess {
  readonly #input: SessionAccessInput;
  #verification: Promise<Principal> | undefined;
  #instruction: SessionInstruction | undefined;
  #instructedByResolver = false;

  constructor(input: SessionAccessInput) {
    this.#input = input;
  }

  static instructionOf(access: SessionAccess): SessionInstruction | undefined {
    if (!(#instruction in access)) {
      throw new TypeError(
        'createSessionAccessで作ったセッションの参照を渡してください',
      );
    }
    return access.#instruction;
  }

  principal(): Promise<Principal> {
    this.#verification ??= this.#verify();
    return this.#verification;
  }

  async requireAuthenticated(): Promise<AuthenticatedPrincipal> {
    const principal = await this.principal();
    if (principal.kind !== 'authenticated') {
      throw new AppError({
        kind: 'unauthenticated',
        code: 'unauthenticated',
        message: UNAUTHENTICATED_MESSAGE,
      });
    }
    return principal;
  }

  issue(session: SessionIssue): void {
    this.#instructByResolver({ kind: 'issue', session });
  }

  clear(): void {
    this.#instructByResolver(CLEAR_INSTRUCTION);
  }

  #instructByResolver(instruction: SessionInstruction): void {
    this.#instruction = instruction;
    this.#instructedByResolver = true;
  }

  // ログインやログアウトの直後に元のセッションを検証しても、リゾルバの指示を打ち消さない
  #instructByVerification(instruction: SessionInstruction): void {
    if (!this.#instructedByResolver) {
      this.#instruction = instruction;
    }
  }

  async #verify(): Promise<Principal> {
    const { container, caller, token } = this.#input;
    if (token === undefined || !SESSION_TOKEN_PATTERN.test(token)) {
      return ANONYMOUS;
    }
    const verifier = container.get<SessionVerifier>(
      SESSION_TYPES.SessionVerifier,
    );
    const verification = await verifier.verify({
      subjectKind: SUBJECT_KIND_BY_CALLER[caller],
      token,
    });
    if (verification.status === 'invalid') {
      this.#instructByVerification(CLEAR_INSTRUCTION);
      return ANONYMOUS;
    }
    if (verification.renewal !== undefined) {
      this.#instructByVerification({
        kind: 'issue',
        session: verification.renewal,
      });
    }
    return verification.principal;
  }
}

export function createSessionAccess(input: SessionAccessInput): SessionAccess {
  return new InvocationSessionAccess(input);
}

// 値をそのまま応答ヘッダーへ書くため、形式の合わない値は注入を防ぐよう設定せずに失敗させる。例外のメッセージに値を含めない
function assertIssuable(session: SessionIssue): void {
  if (!SESSION_TOKEN_PATTERN.test(session.token)) {
    throw new RangeError('発行するセッション識別子の形式が不正です');
  }
  if (
    !Number.isSafeInteger(session.maxAgeSeconds) ||
    session.maxAgeSeconds <= 0 ||
    session.maxAgeSeconds > MAX_SESSION_MAX_AGE_SECONDS
  ) {
    throw new RangeError(
      'セッションの有効期間が発行できる範囲の整数ではありません',
    );
  }
}

export function applySessionInstructions(
  access: SessionAccess,
  headers: Headers,
): void {
  const instruction = InvocationSessionAccess.instructionOf(access);
  if (instruction === undefined) {
    return;
  }
  if (instruction.kind === 'clear') {
    headers.delete(SESSION_RESPONSE_HEADERS.issue);
    headers.delete(SESSION_RESPONSE_HEADERS.maxAge);
    headers.set(SESSION_RESPONSE_HEADERS.clear, CLEAR_HEADER_VALUE);
    return;
  }
  assertIssuable(instruction.session);
  headers.delete(SESSION_RESPONSE_HEADERS.clear);
  headers.set(SESSION_RESPONSE_HEADERS.issue, instruction.session.token);
  headers.set(
    SESSION_RESPONSE_HEADERS.maxAge,
    String(instruction.session.maxAgeSeconds),
  );
}

// 書き換えられない応答に備え、複製したヘッダーで応答を作り直す。Honoは応答の代入時に前の応答のヘッダーを上書きで写すため、先に外して経路の応答のCache-Controlなどが後処理の値を戻さないようにする
export function finishSessionResponse(c: Context, access: SessionAccess): void {
  const headers = new Headers(c.res.headers);
  headers.set('Cache-Control', 'no-store');
  applySessionInstructions(access, headers);
  const response = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
  c.res = undefined;
  c.res = response;
}
