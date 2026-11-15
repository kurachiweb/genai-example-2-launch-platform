import { inject, injectable } from 'inversify';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  LaunchRecord,
  ProductDirectory,
} from '../../../lib/core/product/ports.ts';
import { resolveProductPage } from './product-page-resolution.ts';

export interface LiveMatchView {
  // 照会の時点の時刻。画面の残り時間の補正に使う
  readonly serverTime: Date;
  // マッチ中・集計中の最も新しいマッチ
  readonly matchId: string | null;
  // 集計中のマッチがある、またはキックオフ済みのローンチの予選マッチが未作成・開始の時刻を過ぎて未開始
  readonly awaitingChange: boolean;
}

export interface LiveMatchReadInput {
  readonly productHandle: string;
  readonly viewer: CurrentUser | undefined;
  readonly now: Date;
}

export interface LiveMatchReader {
  // 表示できないプロダクトと旧ハンドルはnull(旧ハンドルの転送は詳細ページの取得が行う)
  read(input: LiveMatchReadInput): Promise<LiveMatchView | null>;
}

const isHeld = ({ phase }: MatchRecord): boolean =>
  phase === 'live' || phase === 'tallying';

const compareNewestFirst = (first: MatchRecord, second: MatchRecord): number =>
  second.startsAt.getTime() - first.startsAt.getTime() ||
  second.matchId.localeCompare(first.matchId);

// 開始と予選の組み合わせは日次のジョブが行うため、時刻を過ぎてもジョブの完了までは前の状態が残る
function isAwaitingChange(
  launches: readonly LaunchRecord[],
  matchesByLaunch: ReadonlyMap<string, readonly MatchRecord[]>,
  now: Date,
): boolean {
  const matches = [...matchesByLaunch.values()].flat();
  return (
    matches.some(({ phase }) => phase === 'tallying') ||
    matches.some(
      ({ phase, startsAt }) =>
        phase === 'scheduled' && startsAt.getTime() <= now.getTime(),
    ) ||
    launches.some(
      ({ launchId, status }) =>
        status === 'in_progress' &&
        !(matchesByLaunch.get(launchId) ?? []).some(
          ({ kind }) => kind === 'qualifier',
        ),
    )
  );
}

@injectable()
export class DirectoryLiveMatchReader implements LiveMatchReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
  ) {}

  async read(input: LiveMatchReadInput): Promise<LiveMatchView | null> {
    const { now } = input;
    const resolution = await resolveProductPage(
      this.products,
      input.productHandle,
      input.viewer,
    );
    if (resolution.kind !== 'render') {
      return null;
    }
    const { productId } = resolution.product;
    const launchesByProduct = await this.products.listLaunches(
      [productId],
      now,
    );
    const launches = (launchesByProduct.get(productId) ?? []).filter(
      ({ status }) => status !== 'canceled',
    );
    const matchesByLaunch: ReadonlyMap<string, readonly MatchRecord[]> =
      launches.length === 0
        ? new Map()
        : await this.matches.listByLaunches(
            launches.map(({ launchId }) => launchId),
            now,
          );
    const held = [...matchesByLaunch.values()]
      .flat()
      .filter(isHeld)
      .toSorted(compareNewestFirst);
    return {
      serverTime: now,
      matchId: held[0]?.matchId ?? null,
      awaitingChange: isAwaitingChange(launches, matchesByLaunch, now),
    };
  }
}
