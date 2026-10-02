import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';

export type LoginPurpose = 'upvote' | 'rating' | 'comment' | 'follow';

const CONTENT: Record<LoginPurpose, { title: string; description: string }> = {
  upvote: {
    title: 'Upvoteにはログインが必要です',
    description:
      'ログインすると、1マッチにつき1回Upvoteできます。Upvoteはマッチ中いつでも取り消せます。',
  },
  rating: {
    title: '評価にはログインが必要です',
    description:
      'ログインすると、プロダクトを5段階で評価できます。評価は後から変更・取り消しできます。',
  },
  comment: {
    title: 'コメントにはログインが必要です',
    description: 'ログインすると、ローンチごとにコメントや返信を投稿できます。',
  },
  follow: {
    title: 'フォローにはログインが必要です',
    description:
      'ログインすると、フォローしたユーザーのプロダクトがキックオフする日にメールでお知らせします。',
  },
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purpose?: LoginPurpose;
};

export function LoginDialog({ open, onOpenChange, purpose = 'upvote' }: Props) {
  const { title, description } = CONTENT[purpose];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            登録
          </Button>
          <Button onClick={() => onOpenChange(false)}>ログイン</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
