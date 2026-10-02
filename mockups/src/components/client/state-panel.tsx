import { useEffect, useState } from 'react';
import { SlidersHorizontalIcon, XIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { Label } from '#/components/ui/label';
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group';
import { Switch } from '#/components/ui/switch';
import { setMotion, useMotion } from '#/lib/preferences';
import { cn } from '#/lib/utils';

const OPEN_KEY = 'ls-state-panel-open';

export type StateOptionLabels<TKey extends string> = Record<
  TKey,
  { title: string; values: Record<string, string> }
>;

export type StateSection<TKey extends string> = {
  title?: string;
  keys: readonly TKey[];
};

type Props<TKey extends string> = {
  sections: readonly StateSection<TKey>[];
  options: Record<TKey, readonly string[]>;
  labels: StateOptionLabels<TKey>;
  values: Record<TKey, string>;
  onChange: (key: TKey, value: string) => void;
  // 他項目に合わせて自動で切り替えた内容の説明
  notice?: string | null;
  highlighted?: readonly TKey[];
};

export function StatePanel<TKey extends string>({
  sections,
  options,
  labels,
  values,
  onChange,
  notice = null,
  highlighted = [],
}: Props<TKey>) {
  const motion = useMotion();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === 'true');
    } catch {
      // 保存値が読めない場合は閉じた状態で開始する
    }
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, String(next));
    } catch {
      // 保存できなくても開閉は反映する
    }
  };

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 print:hidden">
      {open && (
        <section
          aria-label="表示状態の切り替え"
          className="max-h-[min(70vh,640px)] w-[min(92vw,320px)] overflow-y-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold">表示状態(モックアップ用)</p>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="閉じる"
              onClick={() => toggle(false)}
            >
              <XIcon />
            </Button>
          </div>

          <div className="mb-4 flex items-center justify-between rounded-lg bg-muted px-3 py-2">
            <Label htmlFor="motion-switch" className="text-sm">
              アニメーション演出
            </Label>
            <Switch
              id="motion-switch"
              checked={motion === 'on'}
              onCheckedChange={(checked) => setMotion(checked ? 'on' : 'off')}
            />
          </div>

          <p aria-live="polite" className="empty:hidden">
            {notice && (
              <span className="mb-4 block rounded-lg border border-warning/60 bg-warning/15 px-3 py-2 text-xs leading-relaxed text-foreground">
                {notice}
              </span>
            )}
          </p>

          <div className="space-y-5">
            {sections.map((section, index) => (
              <div key={section.title ?? index} className="space-y-4">
                {section.title && (
                  <p className="border-b border-border pb-1 text-xs font-extrabold tracking-wide text-foreground">
                    {section.title}
                  </p>
                )}
                {section.keys.map((key) => (
                  <fieldset
                    key={key}
                    className={cn(
                      '-mx-2 rounded-lg px-2 py-1 transition-colors duration-700',
                      highlighted.includes(key) && 'bg-warning/20',
                    )}
                  >
                    <legend className="mb-1.5 text-xs font-bold text-muted-foreground">
                      {labels[key].title}
                    </legend>
                    <RadioGroup
                      value={values[key]}
                      onValueChange={(value) => onChange(key, value)}
                      className="gap-1"
                    >
                      {options[key].map((value) => (
                        <div key={value} className="flex items-center gap-2">
                          <RadioGroupItem
                            id={`${key}-${value}`}
                            value={value}
                          />
                          <Label
                            htmlFor={`${key}-${value}`}
                            className="text-sm font-normal"
                          >
                            {labels[key].values[value]}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </fieldset>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
      <Button
        variant={open ? 'secondary' : 'default'}
        className="shadow-lg"
        aria-expanded={open}
        onClick={() => toggle(!open)}
      >
        <SlidersHorizontalIcon />
        表示状態
      </Button>
    </div>
  );
}
