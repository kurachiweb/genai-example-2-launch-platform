import { RocketIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';

type Props = { loggedIn: boolean };

// 一覧の末尾に控えめに置くローンチ予約への導線
export function LaunchCta({ loggedIn }: Props) {
  return (
    <section
      aria-labelledby="launch-cta-heading"
      className="mt-12 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-6 py-8 text-center"
    >
      <h2 id="launch-cta-heading" className="font-bold">
        あなたのプロダクトもここに並べましょう。
      </h2>
      <p className="text-sm text-muted-foreground">
        ローンチ日の予選マッチに勝利すると、ディレクトリに掲載されます。
      </p>
      <Button className="mt-2" asChild>
        <a href="#">
          <RocketIcon aria-hidden="true" />
          {loggedIn ? 'ローンチを予約🚀' : 'ログインしてローンチを予約🚀'}
        </a>
      </Button>
    </section>
  );
}
