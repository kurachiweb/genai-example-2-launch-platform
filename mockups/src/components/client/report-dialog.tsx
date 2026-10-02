import { useId, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group';
import { Textarea } from '#/components/ui/textarea';
import { cn } from '#/lib/utils';

import { countGraphemes } from './comment-tree';
import type { ReportTarget } from './page-context';
import { usePageContext } from './page-context';

type Props = {
  target: ReportTarget | null;
  onClose: () => void;
};

// 通報カテゴリのマスタ(FR-ADMCF-015)の仮データ
const CATEGORIES = [
  { value: 'spam', label: 'スパム・宣伝目的' },
  { value: 'inappropriate', label: '不適切なコンテンツ' },
  { value: 'rights', label: '権利侵害' },
  { value: 'impersonation', label: 'なりすまし' },
  { value: 'other', label: 'その他' },
];
const REASON_MAX = 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ReportDialog({ target, onClose }: Props) {
  const { role } = usePageContext();
  const formId = useId();
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState({ reason: false, email: false });
  const needsEmail = role === 'guest' && category === 'rights';
  const reasonLength = countGraphemes(reason);
  const reasonError =
    reason.trim() === ''
      ? '理由を入力してください。'
      : reasonLength > REASON_MAX
        ? '理由は1,000文字以内で入力してください。'
        : null;
  const emailError =
    needsEmail && !EMAIL_PATTERN.test(email)
      ? '連絡先メールアドレスを入力してください。'
      : null;
  const valid = category !== '' && !reasonError && !emailError;

  const reset = () => {
    setCategory('');
    setReason('');
    setEmail('');
    setTouched({ reason: false, email: false });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched({ reason: true, email: true });
    if (!valid) return;
    toast.success('通報を受け付けました。ご協力ありがとうございます。');
    reset();
    onClose();
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target?.label}を通報</DialogTitle>
          <DialogDescription>
            通報内容は運営チームが確認します。通報者の情報が投稿者に伝わることはありません。
          </DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit} className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-bold">カテゴリ</legend>
            <RadioGroup
              value={category}
              onValueChange={setCategory}
              className="gap-2"
            >
              {CATEGORIES.map((item) => (
                <div key={item.value} className="flex items-center gap-2">
                  <RadioGroupItem
                    id={`${formId}-${item.value}`}
                    value={item.value}
                  />
                  <Label
                    htmlFor={`${formId}-${item.value}`}
                    className="font-normal"
                  >
                    {item.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          {needsEmail && (
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-email`}>
                連絡先メールアドレス(必須)
              </Label>
              <Input
                id={`${formId}-email`}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                aria-invalid={touched.email && emailError !== null}
                aria-describedby={`${formId}-email-help`}
              />
              <p
                id={`${formId}-email-help`}
                className={cn(
                  'text-xs',
                  touched.email && emailError
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                {touched.email && emailError
                  ? emailError
                  : '権利侵害の申出への対応結果をお知らせするために使います。'}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor={`${formId}-reason`}>理由(必須)</Label>
              <span
                className={cn(
                  'scoreboard-digits text-xs',
                  reasonLength > REASON_MAX
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                {reasonLength.toLocaleString()} / {REASON_MAX.toLocaleString()}
              </span>
            </div>
            <Textarea
              id={`${formId}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, reason: true }))}
              aria-invalid={touched.reason && reasonError !== null}
              aria-describedby={
                touched.reason && reasonError
                  ? `${formId}-reason-error`
                  : undefined
              }
              className="min-h-28"
            />
            {touched.reason && reasonError && (
              <p
                id={`${formId}-reason-error`}
                className="text-xs text-destructive"
              >
                {reasonError}
              </p>
            )}
          </div>
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            キャンセル
          </Button>
          <Button type="submit" form={formId} disabled={category === ''}>
            通報する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
