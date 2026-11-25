import { inject, injectable } from 'inversify';

import { checkCategoryName } from '../../../common-lib/admin/admin-input-rules.ts';
import {
  REPORT_CATEGORY_CREATE_ACTION,
  REPORT_CATEGORY_DELETE_ACTION,
  REPORT_CATEGORY_RENAME_ACTION,
} from '../../../common-lib/admin/audit-actions/content-reporting.ts';
import {
  isInfringementCategory,
  sortReportCategories,
} from '../../../common-lib/reporting/report-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type {
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  ReportCategoryFormView,
  ReportCategoryRecord,
  ReportCategoryService,
  ReportCategoryStore,
  ReportCategoryView,
} from './ports.ts';
import {
  reportCategoryNameRejectedError,
  reportingError,
} from './reporting-errors.ts';
import { REPORTING_TYPES } from './reporting-types.ts';

const validNameOf = (name: string): string => {
  const issue = checkCategoryName(name);
  if (issue !== undefined) {
    throw reportCategoryNameRejectedError(issue);
  }
  return trimWhiteSpace(name);
};

const viewOf = (
  category: ReportCategoryRecord,
  reportCount: number,
): ReportCategoryView => ({
  id: category.id,
  name: category.name,
  systemDefault: category.systemDefault,
  infringement: isInfringementCategory(category.id),
  reportCount,
});

@injectable()
export class DefaultReportCategoryService implements ReportCategoryService {
  constructor(
    @inject(REPORTING_TYPES.ReportCategoryStore)
    private readonly store: ReportCategoryStore,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async listForForm(): Promise<readonly ReportCategoryFormView[]> {
    const categories = sortReportCategories(await this.store.list());
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      infringement: isInfringementCategory(category.id),
    }));
  }

  async listForAdmin(): Promise<readonly ReportCategoryView[]> {
    const categories = sortReportCategories(await this.store.list());
    return categories.map((category) => viewOf(category, category.reportCount));
  }

  async create(
    current: CurrentAdmin,
    input: { readonly name: string; readonly reason?: string },
  ): Promise<ReportCategoryView> {
    const name = validNameOf(input.name);
    const id = this.ids.generate();
    const at = this.clock.now();
    const audit = this.#prepare(
      current,
      REPORT_CATEGORY_CREATE_ACTION.name,
      id,
      input.reason,
      at,
    );
    const result = await this.store.insert({ id, name, at }, audit);
    if (result === 'name-taken') {
      throw reportingError('report_category_name_taken');
    }
    return viewOf({ id, name, systemDefault: false, createdAt: at }, 0);
  }

  async rename(
    current: CurrentAdmin,
    input: {
      readonly id: string;
      readonly name: string;
      readonly reason?: string;
    },
  ): Promise<ReportCategoryView> {
    const name = validNameOf(input.name);
    const category = await this.#requireEditable(input.id);
    const at = this.clock.now();
    const audit = this.#prepare(
      current,
      REPORT_CATEGORY_RENAME_ACTION.name,
      category.id,
      input.reason,
      at,
    );
    const result = await this.store.rename(category.id, name, at, audit);
    if (result === 'name-taken') {
      throw reportingError('report_category_name_taken');
    }
    if (result === 'not-found') {
      throw reportingError('report_category_not_found');
    }
    const reportCount = await this.store.countReports(category.id);
    return viewOf({ ...category, name }, reportCount);
  }

  async delete(
    current: CurrentAdmin,
    input: { readonly id: string; readonly reason?: string },
  ): Promise<{ readonly reassignedCount: number }> {
    const category = await this.#requireEditable(input.id);
    // ストアは付け替えた件数を返さないため、確認のダイアログと同じ範囲の件数を先に数えて監査ログと結果に使う
    const reassignedCount = await this.store.countReports(category.id);
    const at = this.clock.now();
    const audit = this.#prepare(
      current,
      REPORT_CATEGORY_DELETE_ACTION.name,
      category.id,
      input.reason,
      at,
      { reassignedCount: String(reassignedCount) },
    );
    const result = await this.store.deleteAndReassign(category.id, at, audit);
    if (result === 'not-found') {
      throw reportingError('report_category_not_found');
    }
    return { reassignedCount };
  }

  async #requireEditable(id: string): Promise<ReportCategoryRecord> {
    const category = await this.store.find(id);
    if (category === undefined) {
      throw reportingError('report_category_not_found');
    }
    if (category.systemDefault) {
      throw reportingError('report_category_protected');
    }
    return category;
  }

  #prepare(
    current: CurrentAdmin,
    action: string,
    categoryId: string,
    reason: string | undefined,
    occurredAt: Date,
    detail?: Readonly<Record<string, string>>,
  ): PreparedAuditEntry {
    return this.auditLog.prepare({
      operatorAdminId: current.id,
      action,
      targetIds: [categoryId],
      ...(reason === undefined ? {} : { reason }),
      ...(detail === undefined ? {} : { detail }),
      occurredAt,
    });
  }
}
