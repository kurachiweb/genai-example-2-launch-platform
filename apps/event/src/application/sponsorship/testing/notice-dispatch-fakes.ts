import type { EmailSender } from '../../../../lib/core/email/ports.ts';
import type { SponsorshipRequestBody } from '../../../../lib/core/messaging/contracts/sponsorship.ts';
import type {
  MessageHandler,
  MessageMeta,
} from '../../../../lib/core/messaging/message-contract.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../../../lib/core/identity/ports.ts';
import type {
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../../lib/core/product/ports.ts';
import type {
  SponsorshipRecord,
  SponsorshipRefundRecord,
} from '../../../../lib/core/sponsorship/ports.ts';
import { parseBusinessDate } from '../../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import { NoticeDispatchHandler } from '../notice-dispatch-handler.ts';
import type {
  NoticeClaimStore,
  PendingSponsorshipNotice,
  SponsorshipNoticeClaim,
} from '../ports.ts';

// 基準時刻(UTC-08:00)の2026-11-25 0:07
export const NOW = new Date('2026-11-25T08:07:00.000Z');

export const CLIENT_SITE_ORIGIN = 'https://client.example';

export const OWNER_ID = '01JD0VSER00000000000000001';

export const PRODUCT_ID = '01JD0PR0DVCT00000000000001';

export const PRODUCT_NAME = 'Pitch Notes';

export const CONTACT: UserContact = Object.freeze({
  userId: OWNER_ID,
  email: 'owner@mail.example',
  nickname: '山田 はなこ',
  emailVerified: true,
});

export const NO_REFUND: SponsorshipRefundRecord = Object.freeze({
  status: 'none',
  days: null,
  amount: null,
  refundRequestId: null,
});

export function sponsorshipIdOf(index: number): string {
  return `01JD0SP0NS${String(index).padStart(16, '0')}`;
}

export function noticeOf(
  index: number,
  kind: PendingSponsorshipNotice['kind'],
): PendingSponsorshipNotice {
  return { sponsorshipId: sponsorshipIdOf(index), kind };
}

export function keyOf(notice: PendingSponsorshipNotice): string {
  return `${notice.sponsorshipId}:${notice.kind}`;
}

export function recordOf(
  index: number,
  overrides: Partial<SponsorshipRecord> = {},
): SponsorshipRecord {
  return {
    id: sponsorshipIdOf(index),
    userId: OWNER_ID,
    productId: PRODUCT_ID,
    tier: 'gold',
    startsOn: parseBusinessDate('2026-11-25'),
    endsOn: parseBusinessDate('2026-12-01'),
    days: 7,
    state: 'paid',
    purchaseId: `01JD0SPVRCH${String(index).padStart(15, '0')}`,
    paymentRecordId: `01JD0SPREC${String(index).padStart(16, '0')}`,
    amountTotal: 7_000,
    paidAt: new Date('2026-11-20T00:00:00.000Z'),
    terminatedAt: null,
    terminationReason: null,
    productDeletedAt: null,
    terminationRefund: NO_REFUND,
    stopRefund: NO_REFUND,
    createdAt: new Date('2026-11-20T00:00:00.000Z'),
    ...overrides,
  };
}

export type ProductState = 'visible' | 'hidden';

export interface DispatchScenario {
  readonly pending: readonly PendingSponsorshipNotice[];
  // 申込IDごとの記録。無い申込の通知は取れない(他の処理が先に取った)
  readonly records?: readonly SponsorshipRecord[];
  readonly deleted?: readonly string[];
  // 無いプロダクトは論理削除済み
  readonly products?: Readonly<Record<string, ProductState>>;
  readonly contacts?: readonly UserContact[];
  readonly sendFailure?: Error;
  readonly claimFailure?: Error;
  readonly productFailure?: Error;
}

export type DispatchCall =
  | { readonly op: 'listPending'; readonly limit: number }
  | { readonly op: 'claim'; readonly key: string; readonly at: Date }
  | { readonly op: 'markSkipped'; readonly key: string; readonly at: Date }
  | { readonly op: 'release'; readonly key: string; readonly at: Date }
  | {
      readonly op: 'findSummaries';
      readonly productIds: readonly string[];
      readonly scope: ProductLookupScope;
    }
  | { readonly op: 'findContact'; readonly userId: string }
  | {
      readonly op: 'send';
      readonly kind: string;
      readonly to: string;
      readonly input: unknown;
    };

export interface DispatchHarness {
  // メッセージの処理の一覧と同じく、契約の型を通して呼ぶ
  readonly handler: MessageHandler<SponsorshipRequestBody>;
  readonly calls: readonly DispatchCall[];
}

function notUsed(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

function summaryOf(
  productId: string,
  state: ProductState,
): ProductSummaryRecord {
  return {
    productId,
    ownerUserId: OWNER_ID,
    handle: 'pitch-notes',
    name: PRODUCT_NAME,
    tagline: 'タグライン',
    category: { id: 'category', name: 'その他', handle: 'other' },
    websiteUrl: 'https://pitch-notes.example/',
    logoFileId: 'logo',
    hidden: state === 'hidden',
    visible: state === 'visible',
    listed: false,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
  };
}

function createClaims(
  scenario: DispatchScenario,
  calls: DispatchCall[],
): NoticeClaimStore {
  const records = new Map(
    (scenario.records ?? []).map((record) => [record.id, record] as const),
  );
  const deleted = new Set(scenario.deleted ?? []);
  return {
    listPending: (limit) => {
      calls.push({ op: 'listPending', limit });
      return Promise.resolve(scenario.pending.slice(0, limit));
    },
    claim: (notice, at) => {
      calls.push({ op: 'claim', key: keyOf(notice), at });
      if (scenario.claimFailure !== undefined) {
        return Promise.reject(scenario.claimFailure);
      }
      if (deleted.has(notice.sponsorshipId)) {
        return Promise.resolve<SponsorshipNoticeClaim>({ kind: 'deleted' });
      }
      const record = records.get(notice.sponsorshipId);
      return Promise.resolve<SponsorshipNoticeClaim | undefined>(
        record === undefined ? undefined : { kind: 'claimed', record },
      );
    },
    markSkipped: (notice, at) => {
      calls.push({ op: 'markSkipped', key: keyOf(notice), at });
      return Promise.resolve();
    },
    release: (notice, at) => {
      calls.push({ op: 'release', key: keyOf(notice), at });
      return Promise.resolve();
    },
  };
}

function createProducts(
  scenario: DispatchScenario,
  calls: DispatchCall[],
): ProductDirectory {
  const products = scenario.products ?? { [PRODUCT_ID]: 'visible' };
  return {
    findSummaries: (productIds, scope) => {
      calls.push({ op: 'findSummaries', productIds, scope });
      if (scenario.productFailure !== undefined) {
        return Promise.reject(scenario.productFailure);
      }
      return Promise.resolve(
        new Map(
          productIds.flatMap((productId) => {
            const state = products[productId];
            if (state === undefined) {
              return [];
            }
            if (scope === 'visible' && state !== 'visible') {
              return [];
            }
            return [[productId, summaryOf(productId, state)] as const];
          }),
        ),
      );
    },
    resolveHandle: notUsed,
    findDetail: notUsed,
    listLaunches: notUsed,
  };
}

function createContacts(
  scenario: DispatchScenario,
  calls: DispatchCall[],
): UserContactDirectory {
  const contacts = new Map(
    (scenario.contacts ?? [CONTACT]).map(
      (contact) => [contact.userId, contact] as const,
    ),
  );
  return {
    findContact: (userId) => {
      calls.push({ op: 'findContact', userId });
      return Promise.resolve(contacts.get(userId));
    },
  };
}

function createEmails(
  scenario: DispatchScenario,
  calls: DispatchCall[],
): EmailSender {
  let sequence = 0;
  return {
    send: (request) => {
      calls.push({
        op: 'send',
        kind: request.kind.name,
        to: request.to,
        input: request.input,
      });
      if (scenario.sendFailure !== undefined) {
        return Promise.reject(scenario.sendFailure);
      }
      sequence += 1;
      return Promise.resolve(`email-request-${String(sequence)}`);
    },
  };
}

export function createDispatchHarness(
  scenario: DispatchScenario,
): DispatchHarness {
  const calls: DispatchCall[] = [];
  const clock: Clock = { now: () => NOW };
  return {
    calls,
    handler: new NoticeDispatchHandler({
      claims: createClaims(scenario, calls),
      contacts: createContacts(scenario, calls),
      products: createProducts(scenario, calls),
      emails: createEmails(scenario, calls),
      clock,
      clientSiteOrigin: CLIENT_SITE_ORIGIN,
    }),
  };
}

export const MESSAGE_META: MessageMeta = Object.freeze({
  id: '01JD0SPMSG0000000000000001',
  type: 'sponsorship.dispatch-notices',
  attempts: 1,
  sentAt: NOW,
});

export const REQUEST_BODY: SponsorshipRequestBody = Object.freeze({
  requestedAt: NOW.toISOString(),
});
