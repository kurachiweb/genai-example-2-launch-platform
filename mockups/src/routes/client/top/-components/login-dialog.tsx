import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function LoginDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upvoteにはログインが必要です</DialogTitle>
          <DialogDescription>
            ログインすると、1マッチにつき1回Upvoteできます。Upvoteはマッチ中いつでも取り消せます。
          </DialogDescription>
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
