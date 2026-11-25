import type {
  ClientMySponsorshipsQuery,
  SponsorshipRefundStatus,
} from '../../graphql/generated/graphql.ts';

export type MySponsorshipNode =
  ClientMySponsorshipsQuery['mySponsorships']['nodes'][number];

export type MySponsorshipRefund = NonNullable<
  MySponsorshipNode['terminationRefund']
>;

// 東京の2026年11月18日の正午。今年の掲載期間は月日だけで示す
export const MY_SPONSORSHIPS_NOW = new Date('2026-11-18T03:00:00.000Z');

// 業務日付の2026年11月19日の0:00(UTC-08:00)
export const MY_SPONSORSHIPS_NEXT_DAY_STARTS_AT = '2026-11-19T08:00:00.000Z';

export const SPONSORED_PRODUCT = Object.freeze({
  handle: 'pitch_notes',
  name: 'Pitch Notes',
  listed: true,
  logo: null,
});

// 決済済みで掲載中のGoldの広告。各テストが状態ごとの値で上書きする
export const mySponsorshipOf = (
  n: number,
  overrides: Partial<MySponsorshipNode> = {},
): MySponsorshipNode => ({
  id: `01JSPONSORSHIP${String(n).padStart(12, '0')}`,
  product: SPONSORED_PRODUCT,
  tier: 'GOLD',
  startsOn: '2026-11-10',
  endsOn: '2026-11-23',
  days: 14,
  amountPaid: { amount: 16_800, currency: 'usd' },
  status: 'ACTIVE',
  terminatedOn: null,
  terminationReason: null,
  terminationRefund: null,
  displayStopRefund: null,
  canResume: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

export const mySponsorshipsOf = (
  from: number,
  count: number,
): MySponsorshipNode[] =>
  Array.from({ length: count }, (_, index) =>
    mySponsorshipOf(from + index, {
      product: {
        ...SPONSORED_PRODUCT,
        name: `Product ${String(from + index)}`,
      },
    }),
  );

export const refundOf = (
  status: SponsorshipRefundStatus,
  days: number,
  amount: number | null,
): MySponsorshipRefund => ({
  days,
  status,
  amount: amount === null ? null : { amount, currency: 'usd' },
});

export const mySponsorshipsResult = (
  nodes: readonly MySponsorshipNode[],
  {
    endCursor = null,
    nextDayStartsAt = MY_SPONSORSHIPS_NEXT_DAY_STARTS_AT,
  }: {
    readonly endCursor?: string | null;
    readonly nextDayStartsAt?: string;
  } = {},
) => ({
  ok: true as const,
  data: {
    mySponsorships: {
      nodes: [...nodes],
      pageInfo: { endCursor, hasNextPage: endCursor !== null },
      nextDayStartsAt,
    },
  } satisfies ClientMySponsorshipsQuery,
});
