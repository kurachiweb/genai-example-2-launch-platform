import { cn } from '#/lib/utils';

// gold: 受賞、primary: ディレクトリ掲載・キックオフ予定、live: マッチ中・参加受付中、muted: 敗北・敗退
export type HighlightTone = 'gold' | 'primary' | 'muted' | 'live';

const TONE_CLASSES: Record<HighlightTone, string> = {
  gold: 'gold-gradient text-gold-foreground',
  primary: 'bg-primary/12 text-primary',
  live: 'bg-primary text-primary-foreground',
  muted: 'bg-muted text-defeat',
};

type Props = {
  label: string;
  tone: HighlightTone;
  as?: 'span' | 'li';
  className?: string;
};

// ローンチの結果の要約(Product of the Week・ディレクトリ掲載・予選敗北・Week準決勝敗退など)
export function LaunchHighlightChip({
  label,
  tone,
  as: Element = 'span',
  className,
}: Props) {
  return (
    <Element
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
        TONE_CLASSES[tone],
        className,
      )}
      translate={tone === 'gold' ? 'no' : undefined}
    >
      {label}
    </Element>
  );
}
