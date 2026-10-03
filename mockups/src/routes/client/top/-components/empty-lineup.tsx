import { RocketIcon } from 'lucide-react';

import { StadiumPitch } from '#/components/client/stadium-pitch/stadium-pitch';
import { Button } from '#/components/ui/button';
import type { User } from '#/lib/mock-data';

type Props = { user: User | null };

export function EmptyLineup({ user }: Props) {
  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="absolute inset-0 opacity-70">
        <div className="hidden h-full w-full sm:block">
          <StadiumPitch
            orientation="horizontal"
            leftVotes={0}
            rightVotes={0}
            leftColors={['transparent', 'transparent']}
            rightColors={['transparent', 'transparent']}
            deserted
            finishedWinner="none"
          />
        </div>
        <div className="h-full w-full bg-(--stand-base) sm:hidden">
          <StadiumPitch
            orientation="vertical"
            leftVotes={0}
            rightVotes={0}
            leftColors={['transparent', 'transparent']}
            rightColors={['transparent', 'transparent']}
            deserted
            finishedWinner="none"
          />
        </div>
      </div>
      <div className="relative flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="rounded-xl bg-card/90 px-5 py-3 text-base font-semibold backdrop-blur">
          本日のマッチはありません。ローンチを予約しましょう。
        </p>
        <Button size="lg">
          <RocketIcon aria-hidden="true" />
          {user ? 'ローンチを予約🚀' : 'ログインしてローンチを予約🚀'}
        </Button>
      </div>
    </div>
  );
}
