import { MailWarningIcon, MessageSquareIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '#/components/ui/button';
import { UNVERIFIED_MESSAGE } from '#/lib/messages';

import { usePageContext } from './page-context';

// コメントを投稿できない閲覧者向けに、投稿欄の代わりに理由と次の行動を示す
export function CommentGate() {
  const { role, requireLogin } = usePageContext();

  if (role === 'unverified') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
        <MailWarningIcon
          className="size-5 shrink-0 text-warning-strong"
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1">{UNVERIFIED_MESSAGE}</p>
        <Button
          size="sm"
          variant="outline"
          className="bg-card"
          onClick={() => toast.success('確認メールを再送しました。')}
        >
          確認メールを再送
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm">
      <MessageSquareIcon
        className="size-5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1">
        ログインすると、コメントや返信を投稿できます。
      </p>
      <Button size="sm" onClick={() => requireLogin('comment')}>
        ログインしてコメント
      </Button>
    </div>
  );
}
