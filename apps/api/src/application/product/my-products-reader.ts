import { inject, injectable } from 'inversify';

import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import { PRODUCT_HANDLE_RULE } from '../../../common-lib/product/product-input-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  computeLaunchDateWindow,
  type LaunchDateWindow,
} from '../../domain/product/launch-date-rules.ts';
import { toMyProductView } from './my-product-view.ts';
import {
  decodeMyProductsCursor,
  encodeMyProductsCursor,
} from './my-products-cursor.ts';
import type {
  MyProductView,
  ProductListPosition,
  ProductSnapshot,
  ProductStore,
} from './ports.ts';
import {
  PRODUCT_STATE_BATCH_MAX,
  type ProductState,
  type ProductStateEvaluator,
} from './product-state-evaluator.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export type MyProductLookup =
  | { readonly kind: 'product'; readonly product: MyProductView }
  // 自分のプロダクトの旧ハンドルで、転送先の現在のハンドル
  | { readonly kind: 'redirect'; readonly handle: string }
  | { readonly kind: 'not-found' };

export interface MyProductsPage {
  readonly nodes: readonly MyProductView[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface MyProductOwnerStatus {
  // 取消を除く直近のローンチ
  readonly latestLaunch: LaunchRecord | null;
  readonly state: ProductState;
}

// 対象は引数の利用者のプロダクトだけで、他人のプロダクトは指定できない
export interface MyProductsReader {
  // 論理削除していない自分のプロダクトを最新のローンチ日の新しい順に返す。firstは1〜20で、範囲外はRangeErrorのため呼び出し元の境界で検証する。カーソルの誤りはinvalid_cursor
  list(
    user: CurrentUser,
    page: { readonly first: number; readonly after: string | undefined },
  ): Promise<MyProductsPage>;
  // 他人・論理削除済み・不在はnot-found
  find(user: CurrentUser, handle: string): Promise<MyProductLookup>;
  // 登録画面の選べる日
  newProductWindow(user: CurrentUser, at: Date): LaunchDateWindow;
  // 現在のハンドルで本人のプロダクトだけ。それ以外はnull
  ownerStatus(
    user: CurrentUser,
    handle: string,
  ): Promise<MyProductOwnerStatus | null>;
}

const NOT_FOUND: MyProductLookup = Object.freeze({ kind: 'not-found' });

// 業務日付はYYYY-MM-DDの固定長のため、文字列の比較が日付の前後と一致する。一覧の並びの列と同じく取消を含めて最新の日を採る
function positionOf(snapshot: ProductSnapshot): ProductListPosition {
  const [first, ...rest] = snapshot.launches;
  if (first === undefined) {
    throw new Error(
      `ローンチの無いプロダクトの一覧の位置は求められません: ${snapshot.productId}`,
    );
  }
  const latestLaunchDate = rest.reduce(
    (latest, { launchDate }) => (launchDate > latest ? launchDate : latest),
    first.launchDate,
  );
  return { latestLaunchDate, id: snapshot.productId };
}

function stateOf(
  states: ReadonlyMap<string, ProductState>,
  snapshot: ProductSnapshot,
): ProductState {
  const state = states.get(snapshot.productId);
  if (state === undefined) {
    throw new Error(
      `プロダクトの状態を判定できませんでした: ${snapshot.productId}`,
    );
  }
  return state;
}

const isHandleFormat = (handle: string): boolean =>
  checkHandleFormat(handle, PRODUCT_HANDLE_RULE) === 'ok';

@injectable()
export class StoreMyProductsReader implements MyProductsReader {
  constructor(
    @inject(PRODUCT_TYPES.ProductStore) private readonly store: ProductStore,
    @inject(PRODUCT_TYPES.ProductStateEvaluator)
    private readonly evaluator: ProductStateEvaluator,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async list(
    user: CurrentUser,
    page: { readonly first: number; readonly after: string | undefined },
  ): Promise<MyProductsPage> {
    const { first } = page;
    if (
      !Number.isInteger(first) ||
      first < 1 ||
      first > PRODUCT_STATE_BATCH_MAX
    ) {
      throw new RangeError(
        `一覧の件数は1〜${String(PRODUCT_STATE_BATCH_MAX)}件で指定してください: ${String(first)}`,
      );
    }
    const before =
      page.after === undefined ? undefined : decodeMyProductsCursor(page.after);
    const now = this.clock.now();
    // 続きの有無を知るため1件多く読む
    const rows = await this.store.listForOwner({
      ownerUserId: user.user.id,
      limit: first + 1,
      before,
      now,
    });
    const snapshots = rows.slice(0, first);
    const states = await this.#evaluate(user.user.id, snapshots, now);
    const last = snapshots.at(-1);
    return {
      nodes: snapshots.map((snapshot) =>
        toMyProductView(snapshot, stateOf(states, snapshot), user.user),
      ),
      hasNextPage: rows.length > first,
      endCursor:
        last === undefined ? null : encodeMyProductsCursor(positionOf(last)),
    };
  }

  async find(user: CurrentUser, handle: string): Promise<MyProductLookup> {
    if (!isHandleFormat(handle)) {
      return NOT_FOUND;
    }
    const userId = user.user.id;
    const now = this.clock.now();
    const snapshot = await this.store.findForOwner(userId, handle, now);
    if (snapshot !== undefined) {
      const states = await this.#evaluate(userId, [snapshot], now);
      return {
        kind: 'product',
        product: toMyProductView(
          snapshot,
          stateOf(states, snapshot),
          user.user,
        ),
      };
    }
    const current = await this.store.resolveOwnPreviousHandle(userId, handle);
    return current === undefined
      ? NOT_FOUND
      : { kind: 'redirect', handle: current };
  }

  newProductWindow(_user: CurrentUser, at: Date): LaunchDateWindow {
    return computeLaunchDateWindow({ now: at, basis: null, entitled: false });
  }

  async ownerStatus(
    user: CurrentUser,
    handle: string,
  ): Promise<MyProductOwnerStatus | null> {
    if (!isHandleFormat(handle)) {
      return null;
    }
    const userId = user.user.id;
    const now = this.clock.now();
    const snapshot = await this.store.findForOwner(userId, handle, now);
    if (snapshot === undefined) {
      return null;
    }
    const states = await this.#evaluate(userId, [snapshot], now);
    const state = stateOf(states, snapshot);
    return { latestLaunch: state.latestLaunch, state };
  }

  #evaluate(
    ownerUserId: string,
    snapshots: readonly ProductSnapshot[],
    at: Date,
  ): Promise<ReadonlyMap<string, ProductState>> {
    return this.evaluator.evaluate({
      ownerUserId,
      products: snapshots.map(({ productId, hidden, launches }) => ({
        productId,
        hidden,
        launches,
      })),
      at,
    });
  }
}
