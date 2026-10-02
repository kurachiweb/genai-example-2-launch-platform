import { CircleAlertIcon, RotateCwIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';

type Props = { onRetry: () => void };

// 一覧部分だけのエラー。検索欄・絞り込み欄は残し、技術的な詳細は出さない
export function ListError({ onRetry }: Props) {
  return (
    <section
      role="alert"
      aria-labelledby="list-error-heading"
      className="flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm"
    >
      <CircleAlertIcon
        className="size-10 text-destructive"
        aria-hidden="true"
      />
      <h2 id="list-error-heading" className="mt-4 text-lg font-extrabold">
        プロダクト一覧を読み込めませんでした。
      </h2>
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
