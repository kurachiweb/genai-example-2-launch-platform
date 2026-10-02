import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { SlidersHorizontalIcon, XIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { Label } from '#/components/ui/label';
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group';
import { Switch } from '#/components/ui/switch';
import { setMotion, useMotion } from '#/lib/preferences';

import { OPTIONS, OPTION_LABELS } from '../-model';
import type { TopSearch } from '../-model';

const OPEN_KEY = 'ls-state-panel-open';

type Props = {
  search: TopSearch;
};

export function StatePanel({ search }: Props) {
  const navigate = useNavigate({ from: '/client/top/' });
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

  const update = (key: keyof TopSearch, value: string) => {
    navigate({
      search: (prev: TopSearch) => ({ ...prev, [key]: value }),
      replace: true,
      resetScroll: false,
    });
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

          <div className="space-y-4">
            {(Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]).map((key) => (
              <fieldset key={key}>
                <legend className="mb-1.5 text-xs font-bold text-muted-foreground">
                  {OPTION_LABELS[key].title}
                </legend>
                <RadioGroup
                  value={search[key]}
                  onValueChange={(value) => update(key, value)}
                  className="gap-1"
                >
                  {OPTIONS[key].map((value) => (
                    <div key={value} className="flex items-center gap-2">
                      <RadioGroupItem id={`${key}-${value}`} value={value} />
                      <Label
                        htmlFor={`${key}-${value}`}
                        className="text-sm font-normal"
                      >
                        {
                          (OPTION_LABELS[key].values as Record<string, string>)[
                            value
                          ]
                        }
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
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
