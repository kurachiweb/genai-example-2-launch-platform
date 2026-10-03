import { Link } from '@tanstack/react-router';

import { Button } from '#/components/ui/button';

// 存在しない・非公開・未掲載など理由を問わず同一の表示にし、存在や非公開の理由を推測させない
export function NotFound() {
  return (
    <section
      aria-labelledby="not-found-heading"
      className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-24 text-center"
    >
      <p className="scoreboard-digits text-6xl text-muted-foreground">404</p>
      <h1
        id="not-found-heading"
        className="mt-4 text-2xl font-extrabold tracking-tight"
      >
        ページが見つかりません。
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        お探しのページは見つかりませんでした。URLをご確認ください。
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link to="/client/top">トップページへ</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/client/p">ディレクトリを見る</Link>
        </Button>
      </div>
    </section>
  );
}
