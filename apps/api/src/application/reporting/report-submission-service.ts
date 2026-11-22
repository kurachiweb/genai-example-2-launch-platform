import { inject, injectable } from 'inversify';

import {
  isInfringementCategory,
  requiresContactEmail,
  type ReportTargetKind,
} from '../../../common-lib/reporting/report-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type {
  ReportCategoryStore,
  ReportRequestMeta,
  ReportSubmissionInput,
  ReportSubmissionRateLimit,
  ReportSubmissionService,
  ReportSubmissionStore,
  ReportSubmitter,
  ReportTargetResolver,
  ResolvedReportTarget,
} from './ports.ts';
import {
  reportCategoryMissingError,
  reportContactEmailRequiredError,
  reportingError,
} from './reporting-errors.ts';
import { REPORTING_TYPES } from './reporting-types.ts';

type SubmissionResult =
  'accepted' | 'category-missing' | 'target-not-found' | 'own-content';

interface SubmissionLogContext {
  readonly targetKind: ReportTargetKind;
  readonly categoryId: string;
  readonly submitterKind: ReportSubmitter['kind'];
}

const logger = getAppLogger(['api', 'reporting', 'submission']);

// 対象の参照はユーザーではハンドルのため、ログには解決した後のIDだけを出す
const logResult = (
  context: SubmissionLogContext,
  result: SubmissionResult,
  ids: { readonly reportId?: string; readonly targetId?: string } = {},
): void => {
  logger.info('通報の受け付けを終えました', {
    ...ids,
    ...context,
    result,
  });
};

// 停止中の利用者は通報者として記録しないためguestにする
const submitterOf = (current: CurrentUser | undefined): ReportSubmitter =>
  current?.user.status === 'active'
    ? { kind: 'member', userId: current.user.id }
    : { kind: 'guest' };

@injectable()
export class DefaultReportSubmissionService implements ReportSubmissionService {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(REPORTING_TYPES.ReportCategoryStore)
    private readonly categories: ReportCategoryStore,
    @inject(REPORTING_TYPES.ReportTargetResolver)
    private readonly targets: ReportTargetResolver,
    @inject(REPORTING_TYPES.ReportSubmissionRateLimit)
    private readonly rateLimit: ReportSubmissionRateLimit,
    @inject(REPORTING_TYPES.ReportSubmissionStore)
    private readonly store: ReportSubmissionStore,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async submit(
    session: SessionView,
    input: ReportSubmissionInput,
    meta: ReportRequestMeta,
  ): Promise<void> {
    // リゾルバの判定の後に停止・ログアウトで通報者の種類が変わり得るため、保存の前に確かめ直す
    const current = await this.guard.currentUser(session);
    const submitter = submitterOf(current);
    const contactEmail = this.contactEmailOf(submitter, input);
    const context: SubmissionLogContext = {
      targetKind: input.targetKind,
      categoryId: input.categoryId,
      submitterKind: submitter.kind,
    };
    const category = await this.categories.find(input.categoryId);
    if (category === undefined) {
      logResult(context, 'category-missing');
      throw reportCategoryMissingError();
    }
    const target = await this.resolveTarget(input, current, context);
    await this.rateLimit.consume(submitter, meta.clientIp, meta.now);
    const reportId = this.ids.generate();
    const result = await this.store.submit({
      reportId,
      newCaseId: this.ids.generate(),
      target,
      reporterUserId: submitter.kind === 'member' ? submitter.userId : null,
      contactEmail,
      categoryId: category.id,
      reason: input.reason,
      infringement: isInfringementCategory(category.id),
      at: meta.now,
    });
    logResult(context, result, { reportId, targetId: target.targetId });
    if (result === 'category-missing') {
      throw reportCategoryMissingError();
    }
  }

  private contactEmailOf(
    submitter: ReportSubmitter,
    input: ReportSubmissionInput,
  ): string | null {
    if (
      !requiresContactEmail({
        reporterKind: submitter.kind,
        categoryId: input.categoryId,
      })
    ) {
      return null;
    }
    if (input.contactEmail === undefined) {
      throw reportContactEmailRequiredError();
    }
    return input.contactEmail;
  }

  private async resolveTarget(
    input: ReportSubmissionInput,
    current: CurrentUser | undefined,
    context: SubmissionLogContext,
  ): Promise<ResolvedReportTarget> {
    const target = await this.targets.resolveForSubmission(
      input.targetKind,
      input.targetRef,
    );
    if (target === undefined) {
      logResult(context, 'target-not-found');
      throw reportingError('report_target_not_found');
    }
    // 停止中の利用者は通報者として記録しないが、自分のコンテンツの通報は拒否する
    if (current !== undefined && current.user.id === target.ownerUserId) {
      logResult(context, 'own-content', { targetId: target.targetId });
      throw reportingError('report_own_content');
    }
    return target;
  }
}
