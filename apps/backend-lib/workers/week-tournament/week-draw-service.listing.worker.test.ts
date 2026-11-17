import { asc } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import type {
  DirectoryListingInput,
  DirectoryListingPage,
} from '../../core/directory/ports.ts';
import { D1DirectoryListing } from '../directory/d1-directory-listing.ts';
import {
  insertQualifiers,
  qualifierLaunchOf,
  winOf,
} from '../directory/testing/directory-listing-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProducts,
  insertUser,
  launchIdOf,
  productIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  createDrawService,
  DRAW_AT,
  ENTITLED_BY_PAYMENT,
  PLAIN_OWNER,
  readEntry,
  readEntryByLaunch,
} from './testing/draw-service-fixtures.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_WINDOW,
  weekEntryIdOf,
} from './testing/week-tournament-fixtures.ts';
import { D1WeekAwardExport } from './d1-week-award-export.ts';
import { D1WeekChampionDirectory } from './d1-week-champion-directory.ts';

const QUALIFIER_DATE = '2026-11-20';

const JUST_BEFORE_DRAW = new Date(DRAW_AT.getTime() - 60_000);

// 1: 決済せずに期限切れになる枠、2: 決済の後に喪失になる枠、3: 枠の無い勝利(組み合わせ決定の補完で作られ期限切れになる)
const UNPAID = 1;
const FORFEITED = 2;
const WITHOUT_ENTRY = 3;
const WINNERS = [UNPAID, FORFEITED, WITHOUT_ENTRY];

const LOSER_OFFSET = 90;

// 前の週(2026-W46)は、喪失になる側のプロダクトの別のローンチが優勝して終了済み
const PREVIOUS_WEEK = 2;
const PREVIOUS_WEEK_START = '2026-11-09';
const PREVIOUS_CHAMPION_ENTRY = 20;
const PREVIOUS_CHAMPION_LAUNCH = 200;
const PREVIOUS_AWARDED_AT = new Date('2026-11-23T07:45:00.000Z');

const AFTER_DRAW = new Date(DRAW_AT.getTime() + 600_000);

const NO_CONDITIONS: DirectoryListingInput = {
  matchExpression: undefined,
  categoryId: undefined,
  from: undefined,
  to: undefined,
  sort: 'newest',
  page: 1,
};

const listing = new D1DirectoryListing(db);

function directoryPage(): Promise<DirectoryListingPage> {
  return listing.page(NO_CONDITIONS);
}

const awardExport = new D1WeekAwardExport(db);

const champions = new D1WeekChampionDirectory(db);

function qualifierRecords() {
  return Promise.all([
    db.select().from(productLaunches).orderBy(asc(productLaunches.id)),
    db.select().from(matchEntries).orderBy(asc(matchEntries.id)),
  ]);
}

function awards() {
  return Promise.all([
    awardExport.listForLaunches(
      [
        PREVIOUS_CHAMPION_LAUNCH,
        ...WINNERS.map((index) => qualifierLaunchOf(index)),
      ].map(launchIdOf),
    ),
    champions.listChampions({ awardedFrom: null, awardedBefore: AFTER_DRAW }),
  ]);
}

beforeEach(async () => {
  recordLogs();
  installRecordingSentry();
  await clearWeekTournamentTables();
  await insertUser(PLAIN_OWNER);
  await insertProducts(
    WINNERS.flatMap((index) => [index, index + LOSER_OFFSET]),
    PLAIN_OWNER,
  );
  await insertQualifiers(
    WINNERS.map((index) =>
      winOf(index, {
        product: index,
        owner: PLAIN_OWNER,
        date: QUALIFIER_DATE,
        opponent: index + LOSER_OFFSET,
      }),
    ),
  );
  await insertLaunch(PREVIOUS_CHAMPION_LAUNCH, FORFEITED, {
    launchDate: '2026-11-13',
    outcome: 'won',
  });
  await insertWeekTournaments([
    { index: 1 },
    {
      index: PREVIOUS_WEEK,
      weekStart: PREVIOUS_WEEK_START,
      columns: {
        status: 'finished',
        drawStartedAt: PREVIOUS_AWARDED_AT,
        finishedAt: PREVIOUS_AWARDED_AT,
        outcome: 'awarded',
        championEntryId: weekEntryIdOf(PREVIOUS_CHAMPION_ENTRY),
        awardedAt: PREVIOUS_AWARDED_AT,
        updatedAt: PREVIOUS_AWARDED_AT,
      },
    },
  ]);
  await insertWeekEntries([
    {
      index: PREVIOUS_CHAMPION_ENTRY,
      tournament: PREVIOUS_WEEK,
      launch: PREVIOUS_CHAMPION_LAUNCH,
      product: FORFEITED,
      owner: PLAIN_OWNER,
      columns: {
        launchDate: '2026-11-13',
        status: 'drawn',
        entitlementSource: 'ultras',
        entitledAt: WEEK_WINDOW.deadlineAt,
      },
    },
    {
      index: UNPAID,
      tournament: 1,
      launch: qualifierLaunchOf(UNPAID),
      product: UNPAID,
      owner: PLAIN_OWNER,
    },
    {
      index: FORFEITED,
      tournament: 1,
      launch: qualifierLaunchOf(FORFEITED),
      product: FORFEITED,
      owner: PLAIN_OWNER,
      columns: ENTITLED_BY_PAYMENT,
    },
  ]);
});

afterEach(resetObservability);

describe('WeekTournamentDrawService.drawDue(ディレクトリの掲載・予選の勝利・受賞)', () => {
  test('参加の枠が期限切れ・喪失になっても、予選の勝利の記録・ディレクトリの掲載・既に授与した賞を変えない', async () => {
    const { service, store } = createDrawService();
    const pageBefore = await directoryPage();
    const recordsBefore = await qualifierRecords();
    const awardsBefore = await awards();

    await store.forfeitByProduct(
      productIdOf(FORFEITED),
      'deleted',
      JUST_BEFORE_DRAW,
    );
    await service.drawDue(DRAW_AT);

    await expect(readEntry(UNPAID)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'deadline',
    });
    await expect(readEntry(FORFEITED)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
    });
    await expect(
      readEntryByLaunch(qualifierLaunchOf(WITHOUT_ENTRY)),
    ).resolves.toMatchObject({ status: 'expired', closeReason: 'deadline' });
    expect(
      pageBefore.rows.map(({ productId }) => productId).toSorted(),
    ).toEqual(WINNERS.map(productIdOf).toSorted());
    await expect(directoryPage()).resolves.toEqual(pageBefore);
    await expect(qualifierRecords()).resolves.toEqual(recordsBefore);
    expect(awardsBefore).toEqual([
      new Map([
        [
          launchIdOf(PREVIOUS_CHAMPION_LAUNCH),
          [{ kind: 'product_of_the_week', period: '2026-W46' }],
        ],
      ]),
      [
        expect.objectContaining({
          productId: productIdOf(FORFEITED),
          launchId: launchIdOf(PREVIOUS_CHAMPION_LAUNCH),
          awardedAt: PREVIOUS_AWARDED_AT,
        }),
      ],
    ]);
    await expect(awards()).resolves.toEqual(awardsBefore);
  });
});
