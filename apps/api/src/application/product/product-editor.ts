import { inject, injectable } from 'inversify';

import {
  isReservedHandle,
  isSameHandle,
} from '../../../common-lib/handles/handle-rules.ts';
import {
  checkScreenshotTotals,
  PRODUCT_HANDLE_RULE,
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_PURPOSE,
} from '../../../common-lib/product/product-input-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AppError } from '../../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { checkLaunchDate } from '../../domain/product/launch-date-rules.ts';
import {
  LAUNCH_PLAN_MESSAGES,
  type LaunchPlan,
} from '../../domain/product/launch-plan.ts';
import {
  type ProductEditPlan,
  planProductEdit,
} from '../../domain/product/product-edit-plan.ts';
import { toMyProductView } from './my-product-view.ts';
import type {
  MyProductView,
  ProductFieldsInput,
  ProductSaveInput,
  ProductSaveResult,
  ProductSnapshot,
  ProductStore,
} from './ports.ts';
import {
  launchDateUnavailableError,
  productError,
  relaunchBlockedError,
} from './product-errors.ts';
import type {
  ProductState,
  ProductStateEvaluator,
} from './product-state-evaluator.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export interface ProductUpdateInput extends ProductFieldsInput {
  // 編集画面を開いたハンドル
  readonly productHandle: string;
  readonly expectedVersion: number;
  // nullはローンチを変えない
  readonly launchDate: BusinessDate | null;
}

export interface ProductEditor {
  update(user: CurrentUser, input: ProductUpdateInput): Promise<MyProductView>;
}

const logger = getAppLogger(['api', 'application', 'product']);

const SAVE_FAILURES: Readonly<
  Record<Exclude<ProductSaveResult, 'saved'>, () => AppError>
> = Object.freeze({
  conflict: () => productError('product_update_conflict'),
  'handle-unavailable': () => productError('handle_unavailable'),
  locked: () => productError('product_locked'),
  // 書き込みの時点で非公開化されていた次回の予約は、判定の時点の拒否と同じ文言にする
  hidden: () =>
    relaunchBlockedError({
      code: 'product_hidden',
      message: LAUNCH_PLAN_MESSAGES.product_hidden,
      releaseAt: null,
    }),
  'account-unavailable': () => productError('account_unavailable'),
  'not-found': () => productError('product_not_found'),
});

const launchNotAllowedError = (plan: LaunchPlan): AppError => {
  const [block] = plan.mode === 'blocked' ? plan.blocks : [];
  return block === undefined
    ? productError('decision_unavailable')
    : relaunchBlockedError(block);
};

// 利用者が停止中・退会済みでないことはリゾルバが確かめ、書き込みの時点の投稿者の状態はストアの一括の書き込みが条件にする
@injectable()
export class StoreProductEditor implements ProductEditor {
  constructor(
    @inject(PRODUCT_TYPES.ProductStore) private readonly store: ProductStore,
    @inject(PRODUCT_TYPES.ProductStateEvaluator)
    private readonly evaluator: ProductStateEvaluator,
    @inject(MEDIA_TYPES.MediaFiles) private readonly media: MediaFiles,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async update(
    user: CurrentUser,
    input: ProductUpdateInput,
  ): Promise<MyProductView> {
    const userId = user.user.id;
    const now = this.clock.now();
    const snapshot = await this.store.findForOwner(
      userId,
      input.productHandle,
      now,
    );
    if (snapshot === undefined) {
      throw productError('product_not_found');
    }
    if (snapshot.version !== input.expectedVersion) {
      throw productError('product_update_conflict');
    }
    const state = await this.#evaluate(snapshot, now);
    const plan = this.#planOf(snapshot, input, state, now);
    await this.#assertHandleAvailable(snapshot, plan);
    await this.#claimImages(userId, plan);
    const result = await this.store.save(
      this.#saveInputOf(snapshot, input, plan, now),
    );
    if (result !== 'saved') {
      throw SAVE_FAILURES[result]();
    }
    await this.#discardPreviousImages(plan);
    const saved = await this.store.findForOwner(userId, input.handle, now);
    if (saved === undefined) {
      throw productError('product_not_found');
    }
    return toMyProductView(saved, await this.#evaluate(saved, now), user.user);
  }

  async #evaluate(snapshot: ProductSnapshot, now: Date): Promise<ProductState> {
    const states = await this.evaluator.evaluate({
      ownerUserId: snapshot.ownerUserId,
      products: [
        {
          productId: snapshot.productId,
          hidden: snapshot.hidden,
          launches: snapshot.launches,
        },
      ],
      at: now,
    });
    const state = states.get(snapshot.productId);
    if (state === undefined) {
      throw new Error('編集するプロダクトの状態を判定できませんでした');
    }
    return state;
  }

  // ローンチの計画→固定→ローンチ日の順に確かめる
  #planOf(
    snapshot: ProductSnapshot,
    input: ProductUpdateInput,
    state: ProductState,
    now: Date,
  ): ProductEditPlan {
    const plan = planProductEdit(
      {
        handle: snapshot.handle,
        logoFileId: snapshot.logoFileId,
        screenshotFileIds: snapshot.screenshotFileIds,
        categoryId: snapshot.category.id,
      },
      input,
      state.plan,
    );
    if ('error' in plan) {
      throw launchNotAllowedError(state.plan);
    }
    const { launch } = plan;
    if (plan.categoryChanged || launch.kind !== 'none') {
      if (state.locks.locked) {
        throw productError('product_locked');
      }
      if (state.locks.unknown) {
        throw productError('decision_unavailable');
      }
    }
    if (launch.kind === 'none') {
      return plan;
    }
    if (state.window === null) {
      throw productError('decision_unavailable');
    }
    const checked = checkLaunchDate(state.window, launch.date);
    if (!checked.ok) {
      throw launchDateUnavailableError(checked, now);
    }
    return plan;
  }

  async #assertHandleAvailable(
    snapshot: ProductSnapshot,
    plan: ProductEditPlan,
  ): Promise<void> {
    const { handle } = plan;
    if (handle.kind !== 'changed') {
      return;
    }
    // 自分が保持する旧ハンドルは、他のプロダクトが現在のハンドルにすると保持から外れるため、保持していれば使える
    if (
      snapshot.previousHandle !== null &&
      isSameHandle(snapshot.previousHandle, handle.next)
    ) {
      return;
    }
    if (isReservedHandle(handle.next, PRODUCT_HANDLE_RULE)) {
      throw productError('handle_unavailable');
    }
    if (await this.store.isHandleOccupied(handle.next, snapshot.productId)) {
      throw productError('handle_unavailable');
    }
  }

  async #claimImages(userId: string, plan: ProductEditPlan): Promise<void> {
    const owner = { kind: 'user', id: userId } as const;
    if (plan.logo.kind === 'replace') {
      const logo = await this.media.claim({
        fileIds: [plan.logo.fileId],
        purpose: PRODUCT_LOGO_PURPOSE,
        owner,
      });
      if (!logo.ok) {
        throw productError('invalid_upload');
      }
    }
    const { added, order } = plan.screenshots;
    // 取り除く・並べ替えるだけなら枚数も合計も増えない
    if (added.length === 0) {
      return;
    }
    const screenshots = await this.media.claim({
      fileIds: added,
      purpose: PRODUCT_SCREENSHOT_PURPOSE,
      owner,
    });
    if (!screenshots.ok) {
      throw productError('invalid_upload');
    }
    const files = await this.media.findMany(order);
    const sizes = order.flatMap((fileId) => {
      const file = files.get(fileId);
      return file === undefined ? [] : [file.byteSize];
    });
    if (sizes.length !== order.length) {
      throw productError('invalid_upload');
    }
    if (checkScreenshotTotals(sizes) !== 'ok') {
      throw productError('screenshot_limit_exceeded');
    }
  }

  #saveInputOf(
    snapshot: ProductSnapshot,
    input: ProductUpdateInput,
    plan: ProductEditPlan,
    now: Date,
  ): ProductSaveInput {
    return {
      productId: snapshot.productId,
      expectedVersion: input.expectedVersion,
      fields: {
        name: input.name,
        tagline: input.tagline,
        categoryId: input.categoryId,
        handle: input.handle,
        websiteUrl: input.websiteUrl,
        descriptionMarkdown: input.descriptionMarkdown,
        logoFileId: input.logoFileId,
        screenshotFileIds: input.screenshotFileIds,
      },
      plan,
      previousHandleId: this.ids.generate(),
      newLaunchId: this.ids.generate(),
      screenshotIds: plan.screenshots.order.map(() => this.ids.generate()),
      now,
    };
  }

  // 保存を確定した後の後始末のため、失敗しても保存の結果を変えない。削除はmedia-pipelineの日次のバッチが完了させる
  async #discardPreviousImages(plan: ProductEditPlan): Promise<void> {
    if (plan.logo.kind === 'replace') {
      const fileId = plan.logo.replaced;
      try {
        await this.media.eraseNow([fileId]);
      } catch {
        logger.warning('差し替えた以前のロゴを削除できませんでした', {
          fileId,
        });
      }
    }
    const { removed } = plan.screenshots;
    if (removed.length === 0) {
      return;
    }
    try {
      await this.media.markDeleted(removed);
    } catch {
      logger.warning(
        '取り除いたスクリーンショットの削除を依頼できませんでした',
        { fileIds: removed },
      );
    }
  }
}
