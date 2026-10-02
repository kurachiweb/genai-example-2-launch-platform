import { BanIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';

// 停止中のユーザー本人にだけ表示する。他のユーザーには同じプロフィールが404になる
export function SuspendedBanner() {
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-destructive/40 bg-destructive/8 px-4 py-3.5 sm:px-5"
    >
      <BanIcon
        className="size-6 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-sm leading-relaxed">
        このアカウントは停止されています。プロフィールとプロダクトは他のユーザーには表示されません。詳しくはお問い合わせください。
      </p>
      <Button size="sm" variant="outline" className="bg-card" asChild>
        <a href="#">お問い合わせ</a>
      </Button>
    </div>
  );
}
