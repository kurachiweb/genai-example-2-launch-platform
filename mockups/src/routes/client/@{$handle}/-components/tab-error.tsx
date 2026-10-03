import { CircleAlertIcon, RotateCwIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';

type Props = {
  // 「ローンチしたプロダクトを読み込めませんでした。」のように読み込めなかった対象を示す
  title: string;
  onRetry: () => void;
};

// タブの内容だけの取得エラー。ヘッダーと自己紹介は保ち、技術的な詳細は出さない
export function TabError({ title, onRetry }: Props) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-12 text-center shadow-xs"
    >
      <CircleAlertIcon className="size-9 text-destructive" aria-hidden="true" />
      <p className="mt-3 font-extrabold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        時間をおいて再度お試しください。
      </p>
      <Button className="mt-5" onClick={onRetry}>
        <RotateCwIcon aria-hidden="true" />
        再試行
      </Button>
    </div>
  );
}
