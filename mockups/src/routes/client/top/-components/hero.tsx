import { RocketIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';

export function GuestHero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="rise-in relative mt-6 overflow-hidden rounded-2xl border border-primary/20 bg-primary text-primary-foreground"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, transparent 0 40px, rgba(255,255,255,0.35) 40px 80px)',
        }}
      />
      <div className="relative flex flex-wrap items-center gap-x-8 gap-y-4 px-6 py-6 sm:px-8">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold tracking-[0.2em] uppercase opacity-80">
            Launch Stadium
          </p>
          <p
            id="hero-heading"
            className="mt-1 text-2xl font-extrabold tracking-tight text-balance sm:text-3xl"
          >
            1対1のマッチでローンチ。必ず半分は勝者になる。
          </p>
          <p className="mt-2 max-w-xl text-sm opacity-90">
            同じカテゴリのプロダクトと1日限りの対戦。サポーターのUpvoteで勝てばディレクトリに掲載され、Product
            of the Weekへの道が開きます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="bg-card text-foreground hover:bg-card/90"
          >
            <RocketIcon aria-hidden="true" />
            登録してローンチする
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="border-primary-foreground/50 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            ログイン
          </Button>
        </div>
      </div>
    </section>
  );
}
