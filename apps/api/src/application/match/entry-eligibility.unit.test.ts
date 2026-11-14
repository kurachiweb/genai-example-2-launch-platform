import { describe, expect, test } from 'bun:test';

import { DirectoryEntryEligibilityChecker } from './entry-eligibility.ts';
import type { DueKickoff, KickoffEntry } from './ports.ts';
import {
  createFakeKickoffProductDirectory,
  KICKOFF_AT,
  launchRecordOf,
  productSummaryOf,
} from './testing/kickoff-fakes.ts';

function entryOf(
  id: string,
  overrides: Partial<KickoffEntry> = {},
): KickoffEntry {
  return {
    entryId: `entry-${id}`,
    launchId: `launch-${id}`,
    productId: `product-${id}`,
    forfeited: false,
    ...overrides,
  };
}

function itemOf(
  entries: readonly KickoffEntry[],
  kind: DueKickoff['kind'] = 'qualifier',
): Pick<DueKickoff, 'kind' | 'entries'> {
  return { kind, entries };
}

// 可視のプロダクトと取消でない予選のローンチを持つ側
function activeDirectoryFor(ids: readonly string[]) {
  return {
    summaries: ids.map((id) => productSummaryOf(`product-${id}`)),
    launches: ids.map((id) => launchRecordOf(`launch-${id}`, `product-${id}`)),
  };
}

describe('DirectoryEntryEligibilityChecker.forfeitedEntries', () => {
  test('可視のプロダクトと取消でない予選のローンチを持つ側は該当しない', async () => {
    const { summaries, launches } = activeDirectoryFor(['a', 'b']);
    const checker = new DirectoryEntryEligibilityChecker(
      createFakeKickoffProductDirectory(summaries, launches),
    );

    const forfeited = await checker.forfeitedEntries(
      [itemOf([entryOf('a'), entryOf('b')])],
      KICKOFF_AT,
    );

    expect([...forfeited]).toEqual([]);
  });

  test('該当が記録された側は、プロダクトとローンチの今の状態によらず該当のままにする(停止の解除・復元の後)', async () => {
    const { summaries, launches } = activeDirectoryFor(['a', 'b']);
    const checker = new DirectoryEntryEligibilityChecker(
      createFakeKickoffProductDirectory(summaries, launches),
    );

    const forfeited = await checker.forfeitedEntries(
      [itemOf([entryOf('a', { forfeited: true }), entryOf('b')])],
      KICKOFF_AT,
    );

    expect([...forfeited]).toEqual(['entry-a']);
  });

  test('プロダクトの紐付けが無い側・論理削除済みで見つからない側・可視でない側を該当とする', async () => {
    const { summaries, launches } = activeDirectoryFor(['a']);
    const checker = new DirectoryEntryEligibilityChecker(
      createFakeKickoffProductDirectory(
        [
          ...summaries,
          productSummaryOf('product-hidden', { hidden: true, visible: false }),
          productSummaryOf('product-suspended', { visible: false }),
        ],
        [
          ...launches,
          launchRecordOf('launch-hidden', 'product-hidden'),
          launchRecordOf('launch-suspended', 'product-suspended'),
          launchRecordOf('launch-deleted', 'product-deleted'),
        ],
      ),
    );

    const forfeited = await checker.forfeitedEntries(
      [
        itemOf([entryOf('a'), entryOf('unlinked', { productId: null })]),
        itemOf([entryOf('hidden'), entryOf('suspended')]),
        itemOf([entryOf('deleted')]),
      ],
      KICKOFF_AT,
    );

    expect([...forfeited].toSorted()).toEqual([
      'entry-deleted',
      'entry-hidden',
      'entry-suspended',
      'entry-unlinked',
    ]);
  });

  test('予選では、ローンチが取消・プロダクトのローンチに無い・紐付けが無い側を該当とする', async () => {
    const { summaries, launches } = activeDirectoryFor(['a']);
    const checker = new DirectoryEntryEligibilityChecker(
      createFakeKickoffProductDirectory(
        [
          ...summaries,
          productSummaryOf('product-canceled'),
          productSummaryOf('product-missing'),
          productSummaryOf('product-no-launch'),
        ],
        [
          ...launches,
          launchRecordOf('launch-canceled', 'product-canceled', {
            status: 'canceled',
            number: 0,
          }),
          launchRecordOf('launch-other', 'product-missing'),
        ],
      ),
    );

    const forfeited = await checker.forfeitedEntries(
      [
        itemOf([entryOf('a'), entryOf('canceled')]),
        itemOf([entryOf('missing'), entryOf('no-launch', { launchId: null })]),
      ],
      KICKOFF_AT,
    );

    expect([...forfeited].toSorted()).toEqual([
      'entry-canceled',
      'entry-missing',
      'entry-no-launch',
    ]);
  });

  test('トーナメントの側はローンチを確かめず、プロダクトの可視だけで判定する', async () => {
    const directory = createFakeKickoffProductDirectory(
      [productSummaryOf('product-w1'), productSummaryOf('product-w2')],
      [],
    );
    const checker = new DirectoryEntryEligibilityChecker(directory);

    const forfeited = await checker.forfeitedEntries(
      [itemOf([entryOf('w1'), entryOf('w2', { launchId: null })], 'week')],
      KICKOFF_AT,
    );

    expect([...forfeited]).toEqual([]);
    expect(directory.launchReads).toEqual([]);
  });

  test('プロダクトの要約は論理削除済みを除く範囲で、予選の側のローンチは開始の時刻で、それぞれ1回に読む', async () => {
    const { summaries, launches } = activeDirectoryFor(['a', 'b', 'c']);
    const directory = createFakeKickoffProductDirectory(summaries, launches);
    const checker = new DirectoryEntryEligibilityChecker(directory);

    await checker.forfeitedEntries(
      [
        itemOf([entryOf('a'), entryOf('b')]),
        itemOf([entryOf('c')]),
        itemOf([entryOf('w')], 'year'),
        itemOf([entryOf('recorded', { forfeited: true })]),
      ],
      KICKOFF_AT,
    );

    expect(directory.summaryReads).toEqual([
      {
        productIds: ['product-a', 'product-b', 'product-c', 'product-w'],
        scope: 'not-deleted',
      },
    ]);
    expect(directory.launchReads).toEqual([
      {
        productIds: ['product-a', 'product-b', 'product-c'],
        now: KICKOFF_AT,
      },
    ]);
  });

  test('確かめる側が無ければプロダクトもローンチも読まない', async () => {
    const directory = createFakeKickoffProductDirectory([], []);
    const checker = new DirectoryEntryEligibilityChecker(directory);

    const forfeited = await checker.forfeitedEntries(
      [
        itemOf([
          entryOf('recorded', { forfeited: true }),
          entryOf('unlinked', { productId: null }),
        ]),
      ],
      KICKOFF_AT,
    );

    expect([...forfeited].toSorted()).toEqual([
      'entry-recorded',
      'entry-unlinked',
    ]);
    expect(directory.summaryReads).toEqual([]);
    expect(directory.launchReads).toEqual([]);
  });
});
