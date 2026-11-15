import { inject, injectable } from 'inversify';

import { isReservedHandle } from '../../../common-lib/handles/handle-rules.ts';
import {
  checkScreenshotTotals,
  PRODUCT_HANDLE_RULE,
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_PURPOSE,
} from '../../../common-lib/product/product-input-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  checkLaunchDate,
  computeLaunchDateWindow,
} from '../../domain/product/launch-date-rules.ts';
import type {
  MyProductView,
  ProductFieldsInput,
  ProductInsertInput,
  ProductStore,
} from './ports.ts';
import { launchDateUnavailableError, productError } from './product-errors.ts';
import type { ProductStateEvaluator } from './product-state-evaluator.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export interface ProductRegistrationInput extends ProductFieldsInput {
  readonly launchDate: BusinessDate;
}

export interface ProductRegistration {
  register(
    user: CurrentUser,
    input: ProductRegistrationInput,
  ): Promise<MyProductView>;
}

const INSERT_FAILURES = {
  'handle-unavailable': 'handle_unavailable',
  'account-unavailable': 'account_unavailable',
} as const satisfies Readonly<
  Record<Exclude<Awaited<ReturnType<ProductStore['insert']>>, 'saved'>, string>
>;

// 確認済みの利用者であることはリゾルバが確かめ、書き込みの時点の投稿者の状態はストアの一括の書き込みが条件にする
@injectable()
export class StoreProductRegistration implements ProductRegistration {
  constructor(
    @inject(PRODUCT_TYPES.ProductStore) private readonly store: ProductStore,
    @inject(PRODUCT_TYPES.ProductStateEvaluator)
    private readonly evaluator: ProductStateEvaluator,
    @inject(MEDIA_TYPES.MediaFiles) private readonly media: MediaFiles,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async register(
    user: CurrentUser,
    input: ProductRegistrationInput,
  ): Promise<MyProductView> {
    const userId = user.user.id;
    const now = this.clock.now();
    if (!(await this.store.categoryExists(input.categoryId))) {
      throw productError('category_not_found');
    }
    await this.#assertHandleAvailable(input.handle);
    const window = computeLaunchDateWindow({
      now,
      basis: null,
      entitled: false,
    });
    const launchDate = checkLaunchDate(window, input.launchDate);
    if (!launchDate.ok) {
      throw launchDateUnavailableError(launchDate, now);
    }
    await this.#claimImages(userId, input);
    const insert = this.#insertInputOf(userId, input, now);
    const result = await this.store.insert(insert);
    if (result !== 'saved') {
      throw productError(INSERT_FAILURES[result]);
    }
    return this.#viewOf(userId, input.handle, now);
  }

  async #assertHandleAvailable(handle: string): Promise<void> {
    if (isReservedHandle(handle, PRODUCT_HANDLE_RULE)) {
      throw productError('handle_unavailable');
    }
    if (await this.store.isHandleOccupied(handle)) {
      throw productError('handle_unavailable');
    }
  }

  async #claimImages(
    userId: string,
    input: ProductRegistrationInput,
  ): Promise<void> {
    const owner = { kind: 'user', id: userId } as const;
    const logo = await this.media.claim({
      fileIds: [input.logoFileId],
      purpose: PRODUCT_LOGO_PURPOSE,
      owner,
    });
    if (!logo.ok) {
      throw productError('invalid_upload');
    }
    const fileIds = input.screenshotFileIds;
    if (fileIds.length === 0) {
      return;
    }
    const screenshots = await this.media.claim({
      fileIds,
      purpose: PRODUCT_SCREENSHOT_PURPOSE,
      owner,
    });
    if (!screenshots.ok) {
      throw productError('invalid_upload');
    }
    const files = await this.media.findMany(fileIds);
    const sizes = fileIds.flatMap((fileId) => {
      const file = files.get(fileId);
      return file === undefined ? [] : [file.byteSize];
    });
    if (sizes.length !== fileIds.length) {
      throw productError('invalid_upload');
    }
    if (checkScreenshotTotals(sizes) !== 'ok') {
      throw productError('screenshot_limit_exceeded');
    }
  }

  #insertInputOf(
    userId: string,
    input: ProductRegistrationInput,
    now: Date,
  ): ProductInsertInput {
    const { launchDate, ...fields } = input;
    return {
      productId: this.ids.generate(),
      launchId: this.ids.generate(),
      ownerUserId: userId,
      fields,
      launchDate,
      screenshotIds: fields.screenshotFileIds.map(() => this.ids.generate()),
      now,
    };
  }

  async #viewOf(
    userId: string,
    handle: string,
    now: Date,
  ): Promise<MyProductView> {
    const snapshot = await this.store.findForOwner(userId, handle, now);
    if (snapshot === undefined) {
      throw productError('product_not_found');
    }
    const { ownerUserId, launches, ...product } = snapshot;
    const states = await this.evaluator.evaluate({
      ownerUserId,
      products: [
        { productId: product.productId, hidden: product.hidden, launches },
      ],
      at: now,
    });
    const state = states.get(product.productId);
    if (state === undefined) {
      throw new Error('登録したプロダクトの状態を判定できませんでした');
    }
    // 掲載は予選で勝利したローンチがあることを要し、登録の直後のプロダクトには結果の出たローンチが無い
    return { ...product, listed: false, state };
  }
}
