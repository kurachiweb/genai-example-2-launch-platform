import { CircleAlertIcon, RotateCwIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';

type Props = { onRetry: () => void };

// 取得エラー。技術的な詳細は出さず、再試行と問い合わせへの導線を示す
export function PageError({ onRetry }: Props) {
  return (
    <section
      role="alert"
      aria-labelledby="page-error-heading"
      className="mx-auto mt-10 flex max-w-xl flex-col items-center rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm"
    >
      <CircleAlertIcon
        className="size-10 text-destructive"
        aria-hidden="true"
      />
      <h1 id="page-error-heading" className="mt-4 text-xl font-extrabold">
        プロダクト情報を読み込めませんでした。
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        時間をおいて再度お試しください。解決しない場合はお問い合わせください。
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button onClick={onRetry}>
          <RotateCwIcon aria-hidden="true" />
          再試行
        </Button>
        <Button variant="outline" asChild>
          <a href="#">お問い合わせ</a>
        </Button>
      </div>
    </section>
  );
}
