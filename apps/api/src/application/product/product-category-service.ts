import { inject, injectable } from 'inversify';

import {
  PRODUCT_CATEGORY_CREATE_ACTION,
  PRODUCT_CATEGORY_DELETE_ACTION,
  PRODUCT_CATEGORY_UPDATE_ACTION,
} from '../../../common-lib/admin/audit-actions/product-launch.ts';
import {
  CATEGORY_NAME_MESSAGES,
  checkCategoryName,
} from '../../../common-lib/admin/admin-input-rules.ts';
import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import {
  PRODUCT_CATEGORY_HANDLE_MESSAGES,
  PRODUCT_CATEGORY_HANDLE_RULE,
} from '../../../common-lib/product/product-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type {
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  AppError,
  FieldErrorDetail,
} from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { ProductCategoryRecord } from '../../../lib/core/product/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  ProductCategoryDeleteResult,
  ProductCategoryStore,
  ProductCategoryUpdateResult,
} from './ports.ts';
import {
  productCategoryInputRejectedError,
  productCategoryNotFoundError,
  productError,
} from './product-errors.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export interface ProductCategoryInput {
  readonly name: string;
  readonly handle: string;
}

export interface ProductCategoryService {
  // 追加の順で、標準カテゴリ「その他」を末尾に置く
  list(): Promise<readonly ProductCategoryRecord[]>;
  // 追加・変更・削除は、モデレーター以上の認可を通したリゾルバから呼ぶ
  create(
    admin: CurrentAdmin,
    input: ProductCategoryInput,
    reason: string | undefined,
  ): Promise<ProductCategoryRecord>;
  update(
    admin: CurrentAdmin,
    id: string,
    input: ProductCategoryInput,
    reason: string | undefined,
  ): Promise<ProductCategoryRecord>;
  delete(
    admin: CurrentAdmin,
    id: string,
    reason: string | undefined,
  ): Promise<void>;
}

// 名前は前後の空白を除いた値を保存し、ハンドルは保存する表記のまま保って空白を含む値を形式の違反にする
function validInputOf(input: ProductCategoryInput): ProductCategoryInput {
  const details: FieldErrorDetail[] = [];
  const nameIssue = checkCategoryName(input.name);
  if (nameIssue !== undefined) {
    details.push({
      field: 'name',
      code: nameIssue,
      message: CATEGORY_NAME_MESSAGES[nameIssue],
    });
  }
  const handleCheck = checkHandleFormat(
    input.handle,
    PRODUCT_CATEGORY_HANDLE_RULE,
  );
  const handleMessage = PRODUCT_CATEGORY_HANDLE_MESSAGES[handleCheck];
  if (handleMessage !== undefined) {
    details.push({
      field: 'handle',
      code: handleCheck,
      message: handleMessage,
    });
  }
  if (details.length > 0) {
    throw productCategoryInputRejectedError(details);
  }
  return { name: trimWhiteSpace(input.name), handle: input.handle };
}

const UPDATE_REJECTIONS: Readonly<
  Record<Exclude<ProductCategoryUpdateResult, 'updated'>, () => AppError>
> = Object.freeze({
  'name-taken': () => productError('product_category_name_taken'),
  'handle-taken': () => productError('product_category_handle_taken'),
  'not-found': productCategoryNotFoundError,
  protected: () => productError('product_category_protected'),
});

const DELETE_REJECTIONS: Readonly<
  Record<Exclude<ProductCategoryDeleteResult, 'deleted'>, () => AppError>
> = Object.freeze({
  'in-use': () => productError('product_category_in_use'),
  'not-found': productCategoryNotFoundError,
  protected: () => productError('product_category_protected'),
});

@injectable()
export class StoreProductCategoryService implements ProductCategoryService {
  constructor(
    @inject(PRODUCT_TYPES.ProductCategoryStore)
    private readonly store: ProductCategoryStore,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async list(): Promise<readonly ProductCategoryRecord[]> {
    return this.store.list();
  }

  async create(
    admin: CurrentAdmin,
    input: ProductCategoryInput,
    reason: string | undefined,
  ): Promise<ProductCategoryRecord> {
    const { name, handle } = validInputOf(input);
    const id = this.ids.generate();
    const at = this.clock.now();
    const audit = this.#prepare(
      admin,
      PRODUCT_CATEGORY_CREATE_ACTION.name,
      id,
      reason,
      at,
    );
    const result = await this.store.insert({ id, name, handle, at }, audit);
    if (result === 'name-taken') {
      throw productError('product_category_name_taken');
    }
    if (result === 'handle-taken') {
      throw productError('product_category_handle_taken');
    }
    return { id, name, handle, systemDefault: false, createdAt: at };
  }

  async update(
    admin: CurrentAdmin,
    id: string,
    input: ProductCategoryInput,
    reason: string | undefined,
  ): Promise<ProductCategoryRecord> {
    const { name, handle } = validInputOf(input);
    const category = await this.#requireEditable(id);
    const at = this.clock.now();
    const audit = this.#prepare(
      admin,
      PRODUCT_CATEGORY_UPDATE_ACTION.name,
      category.id,
      reason,
      at,
    );
    const result = await this.store.update(
      { id: category.id, name, handle, at },
      audit,
    );
    if (result !== 'updated') {
      throw UPDATE_REJECTIONS[result]();
    }
    return { ...category, name, handle };
  }

  async delete(
    admin: CurrentAdmin,
    id: string,
    reason: string | undefined,
  ): Promise<void> {
    const category = await this.#requireEditable(id);
    const audit = this.#prepare(
      admin,
      PRODUCT_CATEGORY_DELETE_ACTION.name,
      category.id,
      reason,
      this.clock.now(),
    );
    const result = await this.store.delete(category.id, audit);
    if (result !== 'deleted') {
      throw DELETE_REJECTIONS[result]();
    }
  }

  // 書き込みの時点の状態はストアが条件で確かめるため、ここでは記録の準備の前に分かる拒否だけを返す
  async #requireEditable(id: string): Promise<ProductCategoryRecord> {
    const category = await this.store.findById(id);
    if (category === undefined) {
      throw productCategoryNotFoundError();
    }
    if (category.systemDefault) {
      throw productError('product_category_protected');
    }
    return category;
  }

  #prepare(
    admin: CurrentAdmin,
    action: string,
    categoryId: string,
    reason: string | undefined,
    occurredAt: Date,
  ): PreparedAuditEntry {
    return this.auditLog.prepare({
      operatorAdminId: admin.id,
      action,
      targetIds: [categoryId],
      ...(reason === undefined ? {} : { reason }),
      occurredAt,
    });
  }
}
