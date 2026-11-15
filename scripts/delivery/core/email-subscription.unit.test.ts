import { describe, expect, test } from 'bun:test';

import {
  type DesiredSubscription,
  diffSubscription,
} from './email-subscription.ts';

const ZONE_ID = 'fedcba9876543210fedcba9876543210';
const OTHER_ZONE_ID = '0123456789abcdef0123456789abcdef';
const QUEUE_ID = '00000000000000000000000000000001';

const DESIRED: DesiredSubscription = {
  name: 'app-email-events-staging',
  queue: 'app-email-events-staging',
  zoneId: ZONE_ID,
  domain: 'mail-staging.launch.example',
  events: [
    'message.bounced',
    'message.complained',
    'message.rejected',
    'message.failed',
  ],
};

interface SubscriptionPatch {
  readonly id?: string;
  readonly name?: string;
  readonly enabled?: boolean;
  readonly source?: Readonly<Record<string, unknown>>;
  readonly events?: readonly string[];
}

const subscriptionOf = (patch: SubscriptionPatch = {}) => ({
  id: patch.id ?? 'sub-0001',
  created_at: '2026-10-29T00:00:00.000Z',
  modified_at: '2026-10-29T00:00:00.000Z',
  name: patch.name ?? DESIRED.name,
  enabled: patch.enabled ?? true,
  source: patch.source ?? {
    type: 'email.sending',
    zone_id: ZONE_ID,
    domain: DESIRED.domain,
  },
  destination: { type: 'queues.queue', queue_id: QUEUE_ID },
  events: patch.events ?? DESIRED.events,
});

const listJsonOf = (subscriptions: readonly unknown[]): string =>
  JSON.stringify(subscriptions, null, 2);

const differencesOf = (
  state: ReturnType<typeof diffSubscription>,
): readonly string[] =>
  'kind' in state && state.kind === 'mismatch' ? state.differences : [];

describe('diffSubscription', () => {
  test('一覧が空なら、購読が無いと判定する', () => {
    expect(diffSubscription('[]', DESIRED)).toEqual({ kind: 'absent' });
  });

  test('一覧がnullでも、購読が無いと判定する', () => {
    expect(diffSubscription('null', DESIRED)).toEqual({ kind: 'absent' });
  });

  test('ほかの送信元の購読しか無ければ、購読が無いと判定する', () => {
    const listJson = listJsonOf([
      subscriptionOf({
        name: 'images',
        source: { type: 'r2' },
        events: ['object.create'],
      }),
    ]);

    expect(diffSubscription(listJson, DESIRED)).toEqual({ kind: 'absent' });
  });

  test('名前・送信ドメイン・ゾーン・イベントが同じで有効なら、同じと判定する', () => {
    const listJson = listJsonOf([subscriptionOf()]);

    expect(diffSubscription(listJson, DESIRED)).toEqual({ kind: 'present' });
  });

  test('イベントの並びが違うだけなら、同じと判定する', () => {
    const listJson = listJsonOf([
      subscriptionOf({ events: DESIRED.events.toReversed() }),
    ]);

    expect(diffSubscription(listJson, DESIRED)).toEqual({ kind: 'present' });
  });

  test('一覧に応答の余分な項目が無くても、同じ内容なら同じと判定する', () => {
    const listJson = listJsonOf([
      {
        name: DESIRED.name,
        enabled: true,
        source: { type: 'email.sending', domain: DESIRED.domain },
        events: DESIRED.events,
      },
    ]);

    expect(diffSubscription(listJson, DESIRED)).toEqual({ kind: 'present' });
  });

  test('イベントの不足と余分を、それぞれ差分として返す', () => {
    const listJson = listJsonOf([
      subscriptionOf({
        events: ['message.bounced', 'message.complained', 'message.delivered'],
      }),
    ]);

    expect(diffSubscription(listJson, DESIRED)).toEqual({
      kind: 'mismatch',
      differences: [
        '不足しているイベント: message.rejected, message.failed',
        '余分なイベント: message.delivered',
      ],
    });
  });

  test('送信ドメインとゾーンの違いを、期待と実際の値で差分として返す', () => {
    const listJson = listJsonOf([
      subscriptionOf({
        source: {
          type: 'email.sending',
          zone_id: OTHER_ZONE_ID,
          domain: 'mail.launch.example',
        },
      }),
    ]);

    expect(differencesOf(diffSubscription(listJson, DESIRED))).toEqual([
      '送信ドメイン: 期待 mail-staging.launch.example、実際 mail.launch.example',
      `ゾーン: 期待 ${ZONE_ID}、実際 ${OTHER_ZONE_ID}`,
    ]);
  });

  test('無効になっている購読を差分として返す', () => {
    const listJson = listJsonOf([subscriptionOf({ enabled: false })]);

    expect(differencesOf(diffSubscription(listJson, DESIRED))).toEqual([
      '購読が無効になっています',
    ]);
  });

  test('送信のイベントの購読が名前の違う1件だけなら、名前の違いを差分として返す', () => {
    const listJson = listJsonOf([subscriptionOf({ name: 'manual' })]);

    expect(differencesOf(diffSubscription(listJson, DESIRED))).toEqual([
      `名前: 期待 ${DESIRED.name}、実際 manual`,
    ]);
  });

  test('同じ名前の購読のほかに送信のイベントの購読があれば、その名前と送信ドメインを差分として返す', () => {
    const listJson = listJsonOf([
      subscriptionOf({ id: 'sub-0002', name: 'manual' }),
      subscriptionOf(),
    ]);

    expect(differencesOf(diffSubscription(listJson, DESIRED))).toEqual([
      `ほかの送信のイベントの購読があります: manual(${DESIRED.domain})`,
    ]);
  });

  test('名前の違う送信のイベントの購読が複数あれば、どれとも比べずに名前の一覧を差分として返す', () => {
    const listJson = listJsonOf([
      subscriptionOf({ id: 'sub-0002', name: 'manual-a' }),
      subscriptionOf({ id: 'sub-0003', name: 'manual-b' }),
    ]);

    expect(differencesOf(diffSubscription(listJson, DESIRED))).toEqual([
      `名前が${DESIRED.name}の購読がありません(送信のイベントの購読: manual-a・manual-b)`,
    ]);
  });

  test.each([
    [
      'JSONでない',
      'Event subscriptions for queue',
      '購読の一覧をJSONとして読めません',
    ],
    ['配列でない', '{"result":[]}', '購読の一覧が配列ではありません'],
    [
      '項目に名前が無い',
      listJsonOf([{ ...subscriptionOf(), name: undefined }]),
      '購読の一覧の1件目を読めません',
    ],
    [
      '送信のイベントの購読に送信ドメインが無い',
      listJsonOf([
        subscriptionOf(),
        subscriptionOf({ source: { type: 'email.sending', zone_id: ZONE_ID } }),
      ]),
      '購読の一覧の2件目を読めません',
    ],
    [
      'イベントが文字列の配列でない',
      listJsonOf([subscriptionOf({ events: [1] as unknown as string[] })]),
      '購読の一覧の1件目を読めません',
    ],
  ])('一覧が%sなら、読み取れない理由を返す', (_, listJson, error) => {
    expect(diffSubscription(listJson, DESIRED)).toEqual({ error });
  });
});
