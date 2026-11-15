import { describe, expect, expectTypeOf, test } from 'bun:test';

import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matchEvents } from '../../../db/schema/match/match-events.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import {
  MATCH_EVENT_STATUSES,
  MATCH_EVENT_TYPES,
  type MatchEventStatus,
  type MatchEventType,
} from '../../core/match/match-events.ts';
import {
  ENTRY_RESULTS,
  type EntryResult,
  MATCH_DECISIONS,
  MATCH_KINDS,
  MATCH_STAGES,
  type MatchDecision,
  type MatchKind,
  type MatchStage,
} from '../../core/match/match-model.ts';

// coreはDBディレクトリを読み込めないため、テーブル定義に直書きした値の一覧とcoreの型の一致をここで確かめる
describe('マッチのテーブル定義の値の一覧', () => {
  test('マッチの種別の列の値がcoreの種別の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof matches.kind.enumValues)[number]
    >().toEqualTypeOf<MatchKind>();
    expect([...matches.kind.enumValues]).toEqual([...MATCH_KINDS]);
  });

  test('側とイベントの種別の列の値もcoreの種別の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof matchEntries.matchKind.enumValues)[number]
    >().toEqualTypeOf<MatchKind>();
    expectTypeOf<
      (typeof matchEvents.matchKind.enumValues)[number]
    >().toEqualTypeOf<MatchKind>();
    expect([...matchEntries.matchKind.enumValues]).toEqual([...MATCH_KINDS]);
    expect([...matchEvents.matchKind.enumValues]).toEqual([...MATCH_KINDS]);
  });

  test('マッチの段階の列の値がcoreの段階の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof matches.stage.enumValues)[number]
    >().toEqualTypeOf<MatchStage>();
    expect([...matches.stage.enumValues]).toEqual([...MATCH_STAGES]);
  });

  test('マッチの決着の列の値がcoreの決着の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof matches.decision.enumValues)[number]
    >().toEqualTypeOf<MatchDecision>();
    expect([...matches.decision.enumValues]).toEqual([...MATCH_DECISIONS]);
  });

  test('側の結果の列の値がcoreの側の結果の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof matchEntries.result.enumValues)[number]
    >().toEqualTypeOf<EntryResult>();
    expect([...matchEntries.result.enumValues]).toEqual([...ENTRY_RESULTS]);
  });

  test('イベントの種類の列の値がcoreのイベントの種類の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof matchEvents.type.enumValues)[number]
    >().toEqualTypeOf<MatchEventType>();
    expect([...matchEvents.type.enumValues]).toEqual([...MATCH_EVENT_TYPES]);
  });

  test('イベントの状態の列の値がcoreのイベントの状態の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof matchEvents.status.enumValues)[number]
    >().toEqualTypeOf<MatchEventStatus>();
    expect([...matchEvents.status.enumValues]).toEqual([
      ...MATCH_EVENT_STATUSES,
    ]);
  });
});
