import { MailWarningIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '#/components/ui/button';

// メールアドレス未確認のユーザーに、制限される操作と確認メールの再送導線を示す(FR-USER-005・FR-USER-006)
export function VerifyEmailBanner() {
  return (
    <div
      role="status"
      className="border-b border-warning/50 bg-warning/15 text-foreground"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
        <MailWarningIcon
          className="size-5 shrink-0 text-warning-strong"
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1">
          メールアドレスの確認が完了していません。評価・コメント・フォロー・Upvoteには確認が必要です。
        </p>
        <Button
          size="sm"
          variant="outline"
          className="bg-card"
          onClick={() => toast.success('確認メールを再送しました。')}
        >
          確認メールを再送
        </Button>
      </div>
    </div>
  );
}
