import { inject, injectable } from 'inversify';

import {
  type AwardGroup,
  fallbackLaunchSummary,
  groupAwards,
  type LaunchSummaryView,
} from '../../../lib/core/product/launch-summary.ts';
import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import {
  callDecisionSources,
  type LaunchSummarySource,
  pickLaunchSummaries,
  type RegisteredDecisionSource,
} from '../product/decision-sources.ts';
import { PRODUCT_TYPES } from '../product/product-types.ts';

export interface LaunchHighlights {
  // launchId → 要約。渡した全てのローンチを持つ
  readonly summaries: ReadonlyMap<string, LaunchSummaryView>;
  // productId → Yearを先頭にまとめた受賞。渡したローンチの全てのプロダクトを持つ
  readonly awards: ReadonlyMap<string, readonly AwardGroup[]>;
}

export interface LaunchHighlightsReader {
  // 供給元の失敗は警告のログを残して除き、要約の無いローンチは予選の結果から要約する
  read(input: {
    readonly launches: readonly LaunchRecord[];
    readonly at: Date;
  }): Promise<LaunchHighlights>;
}

type SummaryResult = Awaited<ReturnType<LaunchSummarySource['summarize']>>;

@injectable()
export class SourcedLaunchHighlightsReader implements LaunchHighlightsReader {
  constructor(
    @inject(PRODUCT_TYPES.LaunchSummarySources)
    private readonly sources: readonly RegisteredDecisionSource<LaunchSummarySource>[],
  ) {}

  async read(input: {
    readonly launches: readonly LaunchRecord[];
    readonly at: Date;
  }): Promise<LaunchHighlights> {
    const { launches } = input;
    const results = await this.#summarize(launches, input.at);
    const picked = pickLaunchSummaries(
      results.flatMap((result) => result.launches),
    );
    const contributedAwards = Map.groupBy(
      results.flatMap((result) => result.awards),
      ({ productId }) => productId,
    );
    return {
      summaries: new Map(
        launches.map((launch) => {
          const contribution = picked.get(launch.launchId);
          return [
            launch.launchId,
            contribution === undefined
              ? fallbackLaunchSummary(launch)
              : { label: contribution.label, inMatch: contribution.inMatch },
          ];
        }),
      ),
      awards: new Map(
        launches.map(({ productId }) => [
          productId,
          groupAwards(contributedAwards.get(productId) ?? []),
        ]),
      ),
    };
  }

  async #summarize(
    launches: readonly LaunchRecord[],
    at: Date,
  ): Promise<readonly SummaryResult[]> {
    if (launches.length === 0 || this.sources.length === 0) {
      return [];
    }
    const { results } = await callDecisionSources(this.sources, (source) =>
      source.summarize({
        launches: launches.map(({ launchId, productId, outcome }) => ({
          launchId,
          productId,
          outcome,
        })),
        at,
      }),
    );
    return results;
  }
}
