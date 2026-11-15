import type { TeamColorPair } from '../match/team-colors.ts';
import { StadiumPitch } from '../match/stadium-pitch.tsx';
import { ReserveLaunchLink } from '../product/reserve-launch-link.tsx';
import { EMPTY_LINEUP_MESSAGE } from './qualifier-section-messages.ts';

export interface EmptyLineupProps {
  readonly signedIn: boolean;
}

const NO_TEAM_COLORS: TeamColorPair = ['transparent', 'transparent'];

const DESERTED_PITCH = {
  leftVotes: 0,
  rightVotes: 0,
  leftColors: NO_TEAM_COLORS,
  rightColors: NO_TEAM_COLORS,
  finishedWinner: 'none',
  isDeserted: true,
} as const;

export function EmptyLineup({ signedIn }: EmptyLineupProps) {
  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="absolute inset-0 opacity-70">
        <div className="hidden size-full sm:block">
          <StadiumPitch orientation="horizontal" {...DESERTED_PITCH} />
        </div>
        <div className="size-full bg-(--stand-base) sm:hidden">
          <StadiumPitch orientation="vertical" {...DESERTED_PITCH} />
        </div>
      </div>
      <div className="relative flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="rounded-xl bg-card/90 px-5 py-3 text-base font-semibold text-card-foreground backdrop-blur">
          {EMPTY_LINEUP_MESSAGE}
        </p>
        <ReserveLaunchLink signedIn={signedIn} size="lg" />
      </div>
    </div>
  );
}
