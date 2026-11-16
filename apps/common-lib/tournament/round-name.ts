export const TOURNAMENT_STAGES = Object.freeze([
  'quarterfinal',
  'semifinal',
  'final',
] as const);

export type TournamentStage = (typeof TOURNAMENT_STAGES)[number];

export interface RoundLabelInput {
  readonly round: number | null;
  readonly stage: TournamentStage | null;
}

export interface TournamentRoundNameInput {
  readonly round: number;
  readonly slotCount: number;
}

const STAGE_SLOT_COUNTS: ReadonlyMap<number, TournamentStage> = new Map([
  [8, 'quarterfinal'],
  [4, 'semifinal'],
  [2, 'final'],
]);

const STAGE_NAMES: Readonly<Record<TournamentStage, string>> = Object.freeze({
  quarterfinal: '準々決勝',
  semifinal: '準決勝',
  final: '決勝',
});

export function stageForSlotCount(slotCount: number): TournamentStage | null {
  return STAGE_SLOT_COUNTS.get(slotCount) ?? null;
}

export function roundLabel({ round, stage }: RoundLabelInput): string | null {
  if (stage !== null) {
    return STAGE_NAMES[stage];
  }
  if (round === null || !Number.isInteger(round) || round < 1) {
    return null;
  }
  return `${String(round)}回戦`;
}

export function tournamentRoundName({
  round,
  slotCount,
}: TournamentRoundNameInput): string {
  const label = roundLabel({ round, stage: stageForSlotCount(slotCount) });
  if (label === null) {
    throw new RangeError(
      `ラウンドは1以上の整数で指定してください: ${String(round)}`,
    );
  }
  return label;
}
