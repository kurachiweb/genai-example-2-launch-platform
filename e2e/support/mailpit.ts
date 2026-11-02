import { setTimeout as sleep } from 'node:timers/promises';

export interface MailpitMessage {
  readonly id: string;
  readonly subject: string;
  readonly receivedAt: Date;
  readonly text: string;
  readonly links: readonly string[];
}

export interface LatestEmailQuery {
  readonly to: string;
  readonly receivedAfter?: Date;
}

export interface EmailLinkQuery extends LatestEmailQuery {
  readonly linkPath: string;
}

export interface MailpitWaitOptions {
  readonly origin?: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

interface MessageSummary {
  readonly id: string;
  readonly recipients: readonly string[];
  readonly receivedAt: Date;
}

const DEFAULT_MAILPIT_ORIGIN = 'http://localhost:48041';

const MAILPIT_ORIGIN_ENV_KEY = 'E2E_MAILPIT_URL';

// 送信の要求はQueueを経てイベントサーバーが送るため、開発サーバーの初回の変換の遅れを含めても届く長さにする
const DEFAULT_TIMEOUT_MS = 20_000;

const DEFAULT_INTERVAL_MS = 250;

const SEARCH_LIMIT = 50;

const LINK_PATTERN = /https?:\/\/[^\s<>"'()]+/gu;

// 空文字を設定しても空のURLで要求しないよう、未設定と同じく既定のオリジンを使う
export function resolveMailpitOrigin(
  env: Readonly<Record<string, string | undefined>>,
): string {
  return env[MAILPIT_ORIGIN_ENV_KEY] || DEFAULT_MAILPIT_ORIGIN;
}

export function extractLinks(text: string): readonly string[] {
  return text.match(LINK_PATTERN) ?? [];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const stringField = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string => {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new TypeError(`Mailpitの応答の${key}が文字列ではありません`);
  }
  return value;
};

const recipientsOf = (record: Readonly<Record<string, unknown>>): string[] => {
  const to = record.To;
  return Array.isArray(to)
    ? to
        .filter(isRecord)
        .map((recipient) => recipient.Address)
        .filter((address): address is string => typeof address === 'string')
    : [];
};

const toSummary = (value: unknown): MessageSummary => {
  if (!isRecord(value)) {
    throw new TypeError(
      'Mailpitの応答のメッセージがオブジェクトではありません',
    );
  }
  return {
    id: stringField(value, 'ID'),
    recipients: recipientsOf(value),
    receivedAt: new Date(stringField(value, 'Created')),
  };
};

async function requestJson(
  url: URL,
): Promise<Readonly<Record<string, unknown>>> {
  const response = await fetch(url);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Mailpitの要求が失敗しました: 状態コード${String(response.status)} ${url.href}`,
    );
  }
  const body: unknown = await response.json();
  if (!isRecord(body)) {
    throw new TypeError(
      `Mailpitの応答がオブジェクトではありません: ${url.href}`,
    );
  }
  return body;
}

const sameAddress = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

// 検索の`to:`は部分一致のため、宛先の完全一致と受信の時刻で絞り、新しい順に並べる
async function searchMessages(
  origin: string,
  { to, receivedAfter }: LatestEmailQuery,
): Promise<readonly MessageSummary[]> {
  const url = new URL('/api/v1/search', origin);
  url.searchParams.set('query', `to:"${to}"`);
  url.searchParams.set('limit', String(SEARCH_LIMIT));
  const body = await requestJson(url);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages
    .map(toSummary)
    .filter(
      ({ recipients, receivedAt }) =>
        recipients.some((recipient) => sameAddress(recipient, to)) &&
        (receivedAfter === undefined || receivedAt > receivedAfter),
    )
    .toSorted(
      (left, right) => right.receivedAt.getTime() - left.receivedAt.getTime(),
    );
}

async function readMessage(
  origin: string,
  summary: MessageSummary,
): Promise<MailpitMessage> {
  const body = await requestJson(
    new URL(`/api/v1/message/${encodeURIComponent(summary.id)}`, origin),
  );
  const text = stringField(body, 'Text');
  return {
    id: summary.id,
    subject: stringField(body, 'Subject'),
    receivedAt: summary.receivedAt,
    text,
    links: extractLinks(text),
  };
}

// 新しい順に本文を読み、条件に合う最初のメールを返す。同じメールの本文は2回読まない
async function pollMessages<T>(
  query: LatestEmailQuery,
  options: MailpitWaitOptions,
  pick: (message: MailpitMessage) => T | undefined,
  describeMissing: (timeoutMs: number) => string,
): Promise<T> {
  const origin = options.origin ?? resolveMailpitOrigin(process.env);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  const read = new Map<string, MailpitMessage>();
  for (;;) {
    for (const summary of await searchMessages(origin, query)) {
      const message =
        read.get(summary.id) ?? (await readMessage(origin, summary));
      read.set(summary.id, message);
      const picked = pick(message);
      if (picked !== undefined) {
        return picked;
      }
    }
    if (Date.now() + intervalMs > deadline) {
      throw new Error(describeMissing(timeoutMs));
    }
    await sleep(intervalMs);
  }
}

export async function waitForLatestEmail(
  query: LatestEmailQuery,
  options: MailpitWaitOptions = {},
): Promise<MailpitMessage> {
  return pollMessages(
    query,
    options,
    (message) => message,
    (timeoutMs) =>
      `${query.to}へのメールが${String(timeoutMs)}ミリ秒以内に届きませんでした`,
  );
}

const linkWithPath = (
  links: readonly string[],
  linkPath: string,
): string | undefined =>
  links.find((link) => new URL(link).pathname === linkPath);

export async function waitForEmailLink(
  query: EmailLinkQuery,
  options: MailpitWaitOptions = {},
): Promise<string> {
  return pollMessages(
    query,
    options,
    (message) => linkWithPath(message.links, query.linkPath),
    (timeoutMs) =>
      `${query.to}へ${query.linkPath}のリンクを含むメールが${String(timeoutMs)}ミリ秒以内に届きませんでした`,
  );
}
