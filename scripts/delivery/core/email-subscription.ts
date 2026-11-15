import type { EmailSendingEvent } from '../catalog/resource-catalog.ts';

export interface DesiredSubscription {
  readonly name: string;
  readonly queue: string;
  readonly zoneId: string;
  readonly domain: string;
  readonly events: readonly EmailSendingEvent[];
}

export type SubscriptionState =
  | { readonly kind: 'present' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'mismatch'; readonly differences: readonly string[] };

export const EMAIL_SENDING_SOURCE = 'email.sending';

interface ListedSubscription {
  readonly name: string;
  readonly enabled: boolean;
  readonly sourceType: string;
  readonly zoneId: string | undefined;
  readonly domain: string;
  readonly events: readonly string[];
}

type Reading<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const parseJson = (json: string): Reading<unknown> => {
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch {
    return { ok: false, error: '購読の一覧をJSONとして読めません' };
  }
};

// 送信のイベント以外の送信元は比べないため、送信ドメインとゾーンは送信のイベントの購読でだけ読む
const subscriptionOf = (entry: unknown): ListedSubscription | undefined => {
  if (!isRecord(entry)) return undefined;
  const { name, enabled, source, events } = entry;
  if (typeof name !== 'string' || typeof enabled !== 'boolean') {
    return undefined;
  }
  if (!isRecord(source) || typeof source['type'] !== 'string') return undefined;
  if (!isStringArray(events)) return undefined;
  const { type, zone_id: zoneId, domain } = source;
  if (type !== EMAIL_SENDING_SOURCE) {
    return {
      name,
      enabled,
      sourceType: type,
      zoneId: undefined,
      domain: '',
      events,
    };
  }
  if (typeof domain !== 'string') return undefined;
  if (zoneId !== undefined && typeof zoneId !== 'string') return undefined;
  return { name, enabled, sourceType: type, zoneId, domain, events };
};

const parseSubscriptions = (
  listJson: string,
): Reading<readonly ListedSubscription[]> => {
  const json = parseJson(listJson);
  if (!json.ok) return json;
  if (json.value === null) return { ok: true, value: [] };
  if (!Array.isArray(json.value)) {
    return { ok: false, error: '購読の一覧が配列ではありません' };
  }
  const subscriptions: ListedSubscription[] = [];
  for (const [index, entry] of json.value.entries()) {
    const subscription = subscriptionOf(entry);
    if (subscription === undefined) {
      return {
        ok: false,
        error: `購読の一覧の${String(index + 1)}件目を読めません`,
      };
    }
    subscriptions.push(subscription);
  }
  return { ok: true, value: subscriptions };
};

const valueDifference = (
  label: string,
  expected: string,
  actual: string | undefined,
): readonly string[] =>
  actual === undefined || actual === expected
    ? []
    : [`${label}: 期待 ${expected}、実際 ${actual}`];

const eventDifferences = (
  expected: readonly string[],
  actual: readonly string[],
): readonly string[] => {
  const missing = expected.filter((event) => !actual.includes(event));
  const extra = actual.filter((event) => !expected.includes(event));
  return [
    ...(missing.length > 0
      ? [`不足しているイベント: ${missing.join(', ')}`]
      : []),
    ...(extra.length > 0 ? [`余分なイベント: ${extra.join(', ')}`] : []),
  ];
};

// 応答にゾーンが無い場合は、送信ドメインがゾーンを決めるため比べない
const differencesOf = (
  subscription: ListedSubscription,
  desired: DesiredSubscription,
): readonly string[] => [
  ...valueDifference('名前', desired.name, subscription.name),
  ...valueDifference('送信ドメイン', desired.domain, subscription.domain),
  ...valueDifference('ゾーン', desired.zoneId, subscription.zoneId),
  ...eventDifferences(desired.events, subscription.events),
  ...(subscription.enabled ? [] : ['購読が無効になっています']),
];

const stateOf = (differences: readonly string[]): SubscriptionState =>
  differences.length === 0
    ? { kind: 'present' }
    : { kind: 'mismatch', differences };

// 同じQueueに送信のイベントの購読が重なると配信不能イベントが重複して届くため、名前の違う購読も差分に含める
export function diffSubscription(
  listJson: string,
  desired: DesiredSubscription,
): SubscriptionState | { readonly error: string } {
  const parsed = parseSubscriptions(listJson);
  if (!parsed.ok) return { error: parsed.error };
  const candidates = parsed.value.filter(
    ({ sourceType }) => sourceType === EMAIL_SENDING_SOURCE,
  );
  if (candidates.length === 0) return { kind: 'absent' };
  const named = candidates.find(({ name }) => name === desired.name);
  const [only] = candidates;
  const target = named ?? (candidates.length === 1 ? only : undefined);
  if (target === undefined) {
    const names = candidates.map(({ name }) => name).join('・');
    return stateOf([
      `名前が${desired.name}の購読がありません(送信のイベントの購読: ${names})`,
    ]);
  }
  const others = candidates
    .filter((candidate) => candidate !== target)
    .map(
      ({ name, domain }) =>
        `ほかの送信のイベントの購読があります: ${name}(${domain})`,
    );
  return stateOf([...differencesOf(target, desired), ...others]);
}
