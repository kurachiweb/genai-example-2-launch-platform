import { inject, injectable } from 'inversify';

import {
  INQUIRY_CATEGORY_CREATE_ACTION,
  INQUIRY_CATEGORY_DELETE_ACTION,
  INQUIRY_CATEGORY_RENAME_ACTION,
} from '../../../common-lib/admin/audit-actions/inquiry-chat.ts';
import { checkCategoryName } from '../../../common-lib/admin/admin-input-rules.ts';
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
import {
  checkCategoryEditable,
  sortCategories,
} from '../../domain/inquiry/inquiry-category-rules.ts';
import {
  inquiryCategoryNameRejectedError,
  inquiryCategoryNameTakenError,
  inquiryError,
} from './inquiry-errors.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type { InquiryCategoryRecord, InquiryCategoryStore } from './ports.ts';

export interface AdminInquiryCategoryView extends InquiryCategoryRecord {
  readonly linkedCount: number;
}

export interface InquiryCategoryCreateInput {
  readonly name: string;
  readonly reason?: string;
}

export interface InquiryCategoryRenameInput {
  readonly id: string;
  readonly name: string;
  readonly reason?: string;
}

export interface InquiryCategoryDeleteInput {
  readonly id: string;
  readonly reason?: string;
}

export interface InquiryCategoryDeleteResult {
  readonly reassignedCount: number;
}

export interface InquiryCategoryService {
  // 追加の順で、標準カテゴリを末尾に置く。利用者側の選択肢と送信時のカテゴリの確認が使い、認可を求めない
  list(): Promise<readonly InquiryCategoryRecord[]>;
  listForAdmin(): Promise<readonly AdminInquiryCategoryView[]>;
  // 追加・名前の変更・削除は、モデレーター以上の認可を通したリゾルバから呼ぶ
  create(
    current: CurrentAdmin,
    input: InquiryCategoryCreateInput,
  ): Promise<InquiryCategoryRecord>;
  rename(
    current: CurrentAdmin,
    input: InquiryCategoryRenameInput,
  ): Promise<InquiryCategoryRecord>;
  delete(
    current: CurrentAdmin,
    input: InquiryCategoryDeleteInput,
  ): Promise<InquiryCategoryDeleteResult>;
}

const validNameOf = (name: string): string => {
  const issue = checkCategoryName(name);
  if (issue !== undefined) {
    throw inquiryCategoryNameRejectedError(issue);
  }
  return trimWhiteSpace(name);
};

const reasonOf = (reason: string | undefined): { readonly reason?: string } =>
  reason === undefined ? {} : { reason };

@injectable()
export class StoreInquiryCategoryService implements InquiryCategoryService {
  constructor(
    @inject(INQUIRY_TYPES.InquiryCategoryStore)
    private readonly store: InquiryCategoryStore,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async list(): Promise<readonly InquiryCategoryRecord[]> {
    return sortCategories(await this.store.list());
  }

  async listForAdmin(): Promise<readonly AdminInquiryCategoryView[]> {
    const [categories, linkedCounts] = await Promise.all([
      this.list(),
      this.store.countLinkedByCategory(),
    ]);
    return categories.map((category) => ({
      ...category,
      linkedCount: linkedCounts.get(category.id) ?? 0,
    }));
  }

  async create(
    current: CurrentAdmin,
    input: InquiryCategoryCreateInput,
  ): Promise<InquiryCategoryRecord> {
    const name = validNameOf(input.name);
    const id = this.ids.generate();
    const at = this.clock.now();
    const audit = this.#prepare(
      current,
      INQUIRY_CATEGORY_CREATE_ACTION.name,
      id,
      input.reason,
      at,
    );
    const result = await this.store.insert({ id, name, at }, audit);
    if (result === 'name-taken') {
      throw inquiryCategoryNameTakenError();
    }
    return { id, name, systemDefault: false, createdAt: at };
  }

  async rename(
    current: CurrentAdmin,
    input: InquiryCategoryRenameInput,
  ): Promise<InquiryCategoryRecord> {
    const name = validNameOf(input.name);
    const category = await this.#requireEditable(input.id);
    const at = this.clock.now();
    const audit = this.#prepare(
      current,
      INQUIRY_CATEGORY_RENAME_ACTION.name,
      category.id,
      input.reason,
      at,
    );
    const result = await this.store.rename(category.id, name, at, audit);
    if (result === 'name-taken') {
      throw inquiryCategoryNameTakenError();
    }
    if (result === 'not-found') {
      throw inquiryError('inquiry_category_not_found');
    }
    return { ...category, name };
  }

  async delete(
    current: CurrentAdmin,
    input: InquiryCategoryDeleteInput,
  ): Promise<InquiryCategoryDeleteResult> {
    const category = await this.#requireEditable(input.id);
    // 監査ログの件数は削除の前に数えた表示用の値で、付け替えそのものはストアが条件付きの更新で行う
    const linkedCount = await this.store.countLinked(category.id);
    const audit = this.#prepare(
      current,
      INQUIRY_CATEGORY_DELETE_ACTION.name,
      category.id,
      input.reason,
      this.clock.now(),
      { reassignedCount: String(linkedCount) },
    );
    const deletion = await this.store.deleteAndReassign(category.id, audit);
    if (deletion.result === 'not-found') {
      throw inquiryError('inquiry_category_not_found');
    }
    return { reassignedCount: deletion.reassigned };
  }

  async #requireEditable(id: string): Promise<InquiryCategoryRecord> {
    const category = await this.store.findById(id);
    if (category === undefined) {
      throw inquiryError('inquiry_category_not_found');
    }
    if (checkCategoryEditable(category) !== undefined) {
      throw inquiryError('inquiry_category_protected');
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
      ...reasonOf(reason),
      ...(detail === undefined ? {} : { detail }),
      occurredAt,
    });
  }
}
