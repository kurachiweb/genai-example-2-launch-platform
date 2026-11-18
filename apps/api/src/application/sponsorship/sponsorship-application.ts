import { inject, injectable } from 'inversify';

import {
  type PeriodViolations,
  validatePeriod,
} from '../../../common-lib/sponsorship/sponsorship-period.ts';
import type { SponsorshipTier } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { countBusinessDaysInclusive } from '../../../common-lib/time/business-date-arithmetic.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import type {
  EligibleProductReader,
  SponsorshipRecord,
  SponsorshipStore,
} from '../../../lib/core/sponsorship/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import type { CheckoutStarter } from '../payments/checkout-starter.ts';
import { API_PAYMENTS_TYPES } from '../payments/payments-types.ts';
import {
  sponsorshipError,
  sponsorshipPeriodValidationError,
} from './sponsorship-errors.ts';

export interface ApplySponsorshipInput {
  readonly productId: string;
  readonly tier: SponsorshipTier;
  readonly startsOn: string;
  readonly endsOn: string;
}

export interface SponsorshipApplication {
  // 利用者の状態の拒否はAccountGuard、bot判定の失敗はhumanCheck、決済の開始の失敗は決済の開始が投げるAppErrorをそのまま返す
  apply(input: {
    readonly session: SessionView;
    readonly fields: ApplySponsorshipInput;
    readonly humanCheck: () => Promise<void>;
    readonly now: Date;
  }): Promise<{ readonly purchaseId: string }>;
  resume(input: {
    readonly session: SessionView;
    readonly sponsorshipId: string;
    readonly humanCheck: () => Promise<void>;
    readonly now: Date;
  }): Promise<{ readonly purchaseId: string }>;
}

const logger = getAppLogger(['api', 'application', 'sponsorship']);

const hasViolation = (violations: PeriodViolations): boolean =>
  violations.startsOn !== undefined || violations.endsOn !== undefined;

@injectable()
export class DefaultSponsorshipApplication implements SponsorshipApplication {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)
    private readonly store: SponsorshipStore,
    @inject(SPONSORSHIP_PLATFORM_TYPES.EligibleProductReader)
    private readonly eligibleProducts: EligibleProductReader,
    @inject(API_PAYMENTS_TYPES.CheckoutStarter)
    private readonly starter: CheckoutStarter,
  ) {}

  async apply({
    session,
    fields,
    humanCheck,
    now,
  }: Parameters<SponsorshipApplication['apply']>[0]): Promise<{
    readonly purchaseId: string;
  }> {
    const { user } = await this.guard.requireVerifiedUser(session);
    // bot判定に通るまで申込を記録しないため、判定と記録より先に検証する
    await humanCheck();
    const today = toBusinessDateTime(now).date;
    const violations = validatePeriod({
      startsOn: fields.startsOn,
      endsOn: fields.endsOn,
      today,
    });
    if (hasViolation(violations)) {
      throw sponsorshipPeriodValidationError(violations);
    }
    const startsOn = parseBusinessDate(fields.startsOn);
    const endsOn = parseBusinessDate(fields.endsOn);
    if (
      !(await this.eligibleProducts.isEligible(user.id, fields.productId, now))
    ) {
      throw sponsorshipError('sponsorship_product_ineligible');
    }
    const overlaps = await this.store.hasPaidOverlap({
      productId: fields.productId,
      tier: fields.tier,
      startsOn,
      endsOn,
    });
    if (overlaps) {
      throw sponsorshipError('sponsorship_overlap');
    }
    const record = await this.store.create(
      {
        userId: user.id,
        productId: fields.productId,
        tier: fields.tier,
        startsOn,
        endsOn,
        days: countBusinessDaysInclusive(startsOn, endsOn),
      },
      now,
    );
    try {
      return await this.starter.start({
        session,
        kind: 'sponsorship',
        targetId: record.id,
      });
    } catch (error: unknown) {
      await this.#discardUnpaid(record);
      throw error;
    }
  }

  async resume({
    session,
    sponsorshipId,
    humanCheck,
    now,
  }: Parameters<SponsorshipApplication['resume']>[0]): Promise<{
    readonly purchaseId: string;
  }> {
    const { user } = await this.guard.requireVerifiedUser(session);
    await humanCheck();
    const record = await this.store.findById(sponsorshipId);
    if (record === undefined || record.userId !== user.id) {
      throw sponsorshipError('sponsorship_not_found');
    }
    if (!isResumable(record, toBusinessDateTime(now).date)) {
      throw sponsorshipError('sponsorship_not_payable');
    }
    // 対象・期間・重なりの判定は、決済の開始が購入の可否の口で行い直す
    return this.starter.start({
      session,
      kind: 'sponsorship',
      targetId: record.id,
    });
  }

  // 消せなかった未決済の申込は、開始日を過ぎた後の日次の処理が消す
  async #discardUnpaid(record: SponsorshipRecord): Promise<void> {
    try {
      await this.store.deleteUnpaid(record.id);
    } catch (error: unknown) {
      logger.warning('決済を開始できなかった申込を削除できませんでした', {
        sponsorshipId: record.id,
        error,
      });
    }
  }
}

const isResumable = (record: SponsorshipRecord, today: BusinessDate): boolean =>
  record.state === 'pending_payment' && record.startsOn >= today;
