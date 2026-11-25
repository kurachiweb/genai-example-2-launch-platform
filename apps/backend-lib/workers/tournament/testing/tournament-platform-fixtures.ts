import {
  insertLaunch,
  insertProduct,
  insertUser,
} from '../../product/testing/product-fixtures.ts';
import {
  bracketIdOf,
  bracketMatchIdOf,
  clearBracketTables,
  entryRefOf,
  insertBracketMatches,
  insertBrackets,
  insertParticipants,
  tournamentIdOf,
} from './bracket-fixtures.ts';

export const SAMPLE_BRACKET_ID = bracketIdOf(1);
export const SAMPLE_TOURNAMENT_ID = tournamentIdOf(1);
export const SAMPLE_MATCH_ID = bracketMatchIdOf(1);
export const SAMPLE_ENTRY_REFS = [entryRefOf(1), entryRefOf(2)] as const;

// 利用者1のプロダクト1と利用者2のプロダクト2が、Weekのブラケット1の決勝で対戦する
export async function seedTournamentPlatformSample(): Promise<void> {
  await clearBracketTables();
  await insertUser(1);
  await insertUser(2);
  for (const index of [1, 2]) {
    await insertProduct(index, index);
    await insertLaunch(index, index);
  }
  await insertBrackets([{ index: 1, participantCount: 2 }]);
  await insertParticipants(
    [1, 2].map((index) => ({
      index,
      bracket: 1,
      participantNo: index,
      entry: index,
      launch: index,
      product: index,
      owner: index,
    })),
  );
  await insertBracketMatches([
    { index: 1, bracket: 1, round: 1, position: 1, participantNos: [1, 2] },
  ]);
}
