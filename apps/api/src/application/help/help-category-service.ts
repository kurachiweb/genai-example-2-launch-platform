import { inject, injectable } from 'inversify';

import { checkCategoryName } from '../../../common-lib/admin/admin-input-rules.ts';
import {
  HELP_CATEGORY_CREATE_ACTION,
  HELP_CATEGORY_DELETE_ACTION,
  HELP_CATEGORY_RENAME_ACTION,
  HELP_CATEGORY_REORDER_ACTION,
} from '../../../common-lib/admin/audit-actions/help-center.ts';
import { sortHelpCategories } from '../../../common-lib/help/help-ordering.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { checkHelpCategoryEditable } from '../../domain/help/help-category-rules.ts';
import { helpCategoryNameRejectedError, helpError } from './help-errors.ts';
import { HELP_TYPES } from './help-types.ts';
import type { HelpCategoryRecord, HelpCategoryStore } from './ports.ts';

export interface HelpCategoryDeleteResult {
  readonly id: string;
  readonly reassignedCount: number;
}

// カテゴリのマスタの編集部品が理由の入力欄を持たないため、どの操作も理由を受け取らず、監査ログの理由は空になる
export interface HelpCategoryService {
  // 管理者が指定した並び順の順。管理画面の区画・並べ替えの部品と記事のカテゴリの選択肢が使う
  list(): Promise<readonly HelpCategoryRecord[]>;
  // 追加・名前の変更・削除・並べ替えは、モデレーター以上の認可を通したリゾルバから呼ぶ
  create(
    current: CurrentAdmin,
    input: { readonly name: string },
  ): Promise<HelpCategoryRecord>;
  rename(
    current: CurrentAdmin,
    input: { readonly id: string; readonly name: string },
  ): Promise<HelpCategoryRecord>;
  delete(
    current: CurrentAdmin,
    input: { readonly id: string },
  ): Promise<HelpCategoryDeleteResult>;
  // 標準カテゴリを含む全カテゴリのIDを並べたい順で渡し、並べ替えた後の一覧を返す
  reorder(
    current: CurrentAdmin,
    input: { readonly orderedIds: readonly string[] },
  ): Promise<readonly HelpCategoryRecord[]>;
}

const validNameOf = (name: string): string => {
  const issue = checkCategoryName(name);
  if (issue !== undefined) {
    throw helpCategoryNameRejectedError(issue);
  }
  return trimWhiteSpace(name);
};

@injectable()
export class StoreHelpCategoryService implements HelpCategoryService {
  constructor(
    @inject(HELP_TYPES.HelpCategoryStore)
    private readonly store: HelpCategoryStore,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async list(): Promise<readonly HelpCategoryRecord[]> {
    return sortHelpCategories(await this.store.list());
  }

  async create(
    current: CurrentAdmin,
    input: { readonly name: string },
  ): Promise<HelpCategoryRecord> {
    const name = validNameOf(input.name);
    const id = this.ids.generate();
    const now = this.clock.now();
    const audit = this.#prepare(current, {
      action: HELP_CATEGORY_CREATE_ACTION.name,
      targetIds: [id],
      occurredAt: now,
    });
    const result = await this.store.create({ id, name, now, audit });
    if (result === 'name-taken') {
      throw helpError('help_category_name_taken');
    }
    // 並び順の末尾の値は書き込みの時点でストアが決めるため、保存した行を読み直して返す
    const created = await this.store.findById(id);
    if (created === undefined) {
      throw helpError('help_category_not_found');
    }
    return created;
  }

  async rename(
    current: CurrentAdmin,
    input: { readonly id: string; readonly name: string },
  ): Promise<HelpCategoryRecord> {
    const name = validNameOf(input.name);
    const category = await this.#requireEditable(input.id);
    const now = this.clock.now();
    const audit = this.#prepare(current, {
      action: HELP_CATEGORY_RENAME_ACTION.name,
      targetIds: [category.id],
      occurredAt: now,
    });
    const result = await this.store.rename({
      id: category.id,
      name,
      now,
      audit,
    });
    if (result === 'name-taken') {
      throw helpError('help_category_name_taken');
    }
    if (result === 'not-found') {
      throw helpError('help_category_not_found');
    }
    return { ...category, name };
  }

  async delete(
    current: CurrentAdmin,
    input: { readonly id: string },
  ): Promise<HelpCategoryDeleteResult> {
    const category = await this.#requireEditable(input.id);
    // 監査ログと戻り値の件数は削除の前に数えた表示用の値で、付け替えそのものはストアが書き込みの時点で紐付く全ての記事に行う
    const reassignedCount = category.articleCount;
    const audit = this.#prepare(current, {
      action: HELP_CATEGORY_DELETE_ACTION.name,
      targetIds: [category.id],
      detail: { reassignedCount: String(reassignedCount) },
      occurredAt: this.clock.now(),
    });
    const result = await this.store.deleteAndReassign({
      id: category.id,
      audit,
    });
    if (result === 'not-found') {
      throw helpError('help_category_not_found');
    }
    return { id: category.id, reassignedCount };
  }

  async reorder(
    current: CurrentAdmin,
    input: { readonly orderedIds: readonly string[] },
  ): Promise<readonly HelpCategoryRecord[]> {
    const audit = this.#prepare(current, {
      action: HELP_CATEGORY_REORDER_ACTION.name,
      targetIds: [],
      detail: { count: String(input.orderedIds.length) },
      occurredAt: this.clock.now(),
    });
    const result = await this.store.reorder({
      orderedIds: input.orderedIds,
      audit,
    });
    if (result === 'outdated') {
      throw helpError('help_order_outdated');
    }
    return this.list();
  }

  async #requireEditable(id: string): Promise<HelpCategoryRecord> {
    const category = await this.store.findById(id);
    if (category === undefined) {
      throw helpError('help_category_not_found');
    }
    if (checkHelpCategoryEditable(category) !== undefined) {
      throw helpError('help_category_protected');
    }
    return category;
  }

  #prepare(
    current: CurrentAdmin,
    entry: Omit<AuditEntryInput, 'operatorAdminId'>,
  ): PreparedAuditEntry {
    return this.auditLog.prepare({ operatorAdminId: current.id, ...entry });
  }
}
