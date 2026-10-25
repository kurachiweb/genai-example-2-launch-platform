import type {
  Breadcrumb,
  ErrorEvent,
  Event,
  EventHint,
  Exception,
  RequestEventData,
  SpanJSON,
  TransactionEvent,
  User,
} from '@sentry/core';

import { AppError } from '../errors/app-error.ts';
import { REDACTION_PATTERNS } from '../logging/redaction.ts';

type LogEntry = NonNullable<Event['logentry']>;
type Contexts = NonNullable<Event['contexts']>;

const REMOVED_USER_FIELDS: ReadonlySet<string> = new Set([
  'ip_address',
  'email',
]);

const REMOVED_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  'cookies',
  'data',
  'query_string',
]);

// Sentryが利用者のIPアドレスの取得に使う12種のヘッダー(@sentry/coreのgetClientIPAddress)を全て含める
const REMOVED_HEADER_NAMES: ReadonlySet<string> = new Set([
  'cookie',
  'authorization',
  'x-client-ip',
  'x-forwarded-for',
  'fly-client-ip',
  'cf-connecting-ip',
  'fastly-client-ip',
  'true-client-ip',
  'x-real-ip',
  'x-cluster-client-ip',
  'x-forwarded',
  'forwarded-for',
  'forwarded',
  'x-vercel-forwarded-for',
]);

// Sentryの正規化が循環参照に付ける印と同じ表記にする
const CIRCULAR_REFERENCE_MARKER = '[Circular ~]';

function redactText(text: string): string {
  return REDACTION_PATTERNS.reduce(
    (current, { pattern, replacement }) =>
      typeof replacement === 'string'
        ? current.replaceAll(pattern, replacement)
        : current.replaceAll(pattern, replacement),
    text,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// logentryのparamsはSentryの正規化の対象外で循環参照を含み得るため、祖先にあるオブジェクトを印に置き換えて再帰を打ち切る
function redactValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return value;
  }
  if (ancestors.has(value)) {
    return CIRCULAR_REFERENCE_MARKER;
  }
  ancestors.add(value);
  const redacted = Array.isArray(value)
    ? value.map((item) => redactValue(item, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          redactValue(item, ancestors),
        ]),
      );
  ancestors.delete(value);
  return redacted;
}

function redactDeep<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T;
}

function redactTextFields<T extends object>(
  object: T,
  keys: readonly (keyof T & string)[],
): T {
  const targetKeys: ReadonlySet<string> = new Set(keys);
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [
      key,
      targetKeys.has(key) && typeof value === 'string'
        ? redactText(value)
        : value,
    ]),
  ) as T;
}

function omitFields<T extends object>(
  object: T,
  isRemoved: (key: string) => boolean,
): T {
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => !isRemoved(key)),
  ) as T;
}

function scrubUser(user: User): User {
  return omitFields(user, (key) => REMOVED_USER_FIELDS.has(key));
}

function scrubRequest(request: RequestEventData): RequestEventData {
  const { headers } = request;
  return {
    ...omitFields(redactTextFields(request, ['url']), (key) =>
      REMOVED_REQUEST_FIELDS.has(key),
    ),
    ...(headers && {
      headers: omitFields(headers, (name) =>
        REMOVED_HEADER_NAMES.has(name.toLowerCase()),
      ),
    }),
  };
}

function scrubUserAndRequest(event: Event): Pick<Event, 'user' | 'request'> {
  const { user, request } = event;
  return {
    ...(user && { user: scrubUser(user) }),
    ...(request && { request: scrubRequest(request) }),
  };
}

function scrubException(exception: Exception): Exception {
  return redactTextFields(exception, ['type', 'value']);
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const { data } = breadcrumb;
  return {
    ...redactTextFields(breadcrumb, ['message']),
    ...(data && { data: redactDeep(data) }),
  };
}

// 型はformattedを持たないが、イベントの形式がformattedを定めていて付け得るため、文字列の項目を全て対象にする
function scrubLogEntry(logentry: LogEntry): LogEntry {
  return redactDeep(logentry);
}

function scrubSpan(span: SpanJSON): SpanJSON {
  return {
    ...redactTextFields(span, ['description']),
    data: redactDeep(span.data),
  };
}

function scrubTraceContextData(contexts: Contexts): Contexts {
  const { trace } = contexts;
  if (trace?.data === undefined) {
    return contexts;
  }
  return { ...contexts, trace: { ...trace, data: redactDeep(trace.data) } };
}

export function scrubEvent(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  if (hint.originalException instanceof AppError) {
    return null;
  }
  const { exception, logentry, breadcrumbs } = event;
  return {
    ...redactTextFields(event, ['message', 'transaction']),
    ...scrubUserAndRequest(event),
    ...(exception && {
      exception: {
        ...exception,
        ...(exception.values && {
          values: exception.values.map(scrubException),
        }),
      },
    }),
    ...(logentry && { logentry: scrubLogEntry(logentry) }),
    ...(breadcrumbs && { breadcrumbs: breadcrumbs.map(scrubBreadcrumb) }),
  };
}

export function scrubTransaction(event: TransactionEvent): TransactionEvent {
  const { spans, contexts } = event;
  return {
    ...redactTextFields(event, ['transaction']),
    ...scrubUserAndRequest(event),
    ...(spans && { spans: spans.map(scrubSpan) }),
    ...(contexts && { contexts: scrubTraceContextData(contexts) }),
  };
}
