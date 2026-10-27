import type { FrontendAppProfile } from '../entry/app-profile.ts';
import {
  MAX_SESSION_MAX_AGE_SECONDS,
  SESSION_CLEAR_VALUE,
  SESSION_INSTRUCTION_HEADERS,
  SESSION_TOKEN_PATTERN,
} from './relay-contract.ts';

export type SessionCookieName = FrontendAppProfile['sessionCookieName'];

export type SessionInstruction =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'issue';
      readonly token: string;
      readonly maxAgeSeconds: number;
    }
  | { readonly kind: 'clear' };

export interface SessionCookieLogger {
  warn(message: string, properties: Readonly<Record<string, unknown>>): void;
}

const NO_INSTRUCTION: SessionInstruction = Object.freeze({ kind: 'none' });

const MAX_AGE_PATTERN = /^[1-9][0-9]*$/;

const COOKIE_ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Lax';

const INVALID_ISSUE_MESSAGE =
  'セッションの発行の指示の形式が不正なため無視しました';

const isValidMaxAge = (seconds: number): boolean =>
  Number.isInteger(seconds) &&
  seconds >= 1 &&
  seconds <= MAX_SESSION_MAX_AGE_SECONDS;

const parseMaxAge = (value: string | null): number | undefined => {
  if (value === null || !MAX_AGE_PATTERN.test(value)) {
    return undefined;
  }
  const seconds = Number(value);
  return isValidMaxAge(seconds) ? seconds : undefined;
};

const firstCookieValue = (
  cookieHeader: string,
  cookieName: string,
): string | undefined => {
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator !== -1 && pair.slice(0, separator).trim() === cookieName) {
      return pair.slice(separator + 1).trim();
    }
  }
  return undefined;
};

export function readSessionToken(
  request: Request,
  cookieName: SessionCookieName,
): string | undefined {
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader === null) {
    return undefined;
  }
  const value = firstCookieValue(cookieHeader, cookieName);
  return value !== undefined && SESSION_TOKEN_PATTERN.test(value)
    ? value
    : undefined;
}

const readIssueInstruction = (
  upstream: Headers,
  token: string,
  logger: SessionCookieLogger,
): SessionInstruction => {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    logger.warn(INVALID_ISSUE_MESSAGE, { reason: 'invalid_token' });
    return NO_INSTRUCTION;
  }
  const maxAgeSeconds = parseMaxAge(
    upstream.get(SESSION_INSTRUCTION_HEADERS.maxAge),
  );
  if (maxAgeSeconds === undefined) {
    logger.warn(INVALID_ISSUE_MESSAGE, { reason: 'invalid_max_age' });
    return NO_INSTRUCTION;
  }
  return { kind: 'issue', token, maxAgeSeconds };
};

export function readSessionInstruction(
  upstream: Headers,
  logger: SessionCookieLogger,
): SessionInstruction {
  const issue = upstream.get(SESSION_INSTRUCTION_HEADERS.issue);
  const clear = upstream.get(SESSION_INSTRUCTION_HEADERS.clear);
  if (issue !== null && clear !== null) {
    // 契約では同時に付かない。どちらが正しいか分からないため、古いセッションを残さない削除の側に倒す
    logger.warn(
      'セッションの発行と削除の指示が同時に付いていたため削除しました',
      { reason: 'conflicting_instructions' },
    );
    return { kind: 'clear' };
  }
  if (issue !== null) {
    return readIssueInstruction(upstream, issue, logger);
  }
  if (clear === null) {
    return NO_INSTRUCTION;
  }
  if (clear !== SESSION_CLEAR_VALUE) {
    logger.warn('セッションの削除の指示の形式が不正なため無視しました', {
      reason: 'invalid_clear',
    });
    return NO_INSTRUCTION;
  }
  return { kind: 'clear' };
}

export function buildSessionSetCookie(
  cookieName: SessionCookieName,
  instruction: SessionInstruction,
): string | undefined {
  switch (instruction.kind) {
    case 'none':
      return undefined;
    case 'clear':
      return `${cookieName}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`;
    case 'issue':
      // 値をそのままSet-Cookieへ書くため、属性の注入を防ぐ。例外のメッセージに値を含めない
      if (!SESSION_TOKEN_PATTERN.test(instruction.token)) {
        throw new RangeError('セッション識別子の形式が不正です');
      }
      if (!isValidMaxAge(instruction.maxAgeSeconds)) {
        throw new RangeError('セッションの有効期間が範囲外です');
      }
      return `${cookieName}=${instruction.token}; Max-Age=${String(instruction.maxAgeSeconds)}; ${COOKIE_ATTRIBUTES}`;
  }
}

export function toBrowserResponse(
  upstream: Response,
  cookieName: SessionCookieName,
  logger: SessionCookieLogger,
): Response {
  const instruction = readSessionInstruction(upstream.headers, logger);
  const headers = new Headers(upstream.headers);
  headers.delete('Set-Cookie');
  for (const name of Object.values(SESSION_INSTRUCTION_HEADERS)) {
    headers.delete(name);
  }
  const setCookie = buildSessionSetCookie(cookieName, instruction);
  if (setCookie !== undefined) {
    headers.append('Set-Cookie', setCookie);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

// 描画中に複数の取得がセッションを指示しても、ブラウザへは最後に届いた指示だけを渡す
export function mergeSessionSetCookies(
  existing: readonly string[],
  incoming: readonly string[],
  cookieName: SessionCookieName,
): string[] {
  const isSessionCookie = (setCookie: string): boolean =>
    setCookie.startsWith(`${cookieName}=`);
  return [
    ...existing.filter((setCookie) => !isSessionCookie(setCookie)),
    ...incoming.filter(isSessionCookie),
  ];
}
