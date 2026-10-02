import { CircleDashedIcon, SettingsIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';

const MISSING_FIELDS = [
  'プロフィール画像',
  'ヘッドライン',
  '自己紹介',
  '外部Webサイト',
];

// 必須項目のみ入力した本人に、任意項目の入力を促す
export function ProfileCompletion() {
  return (
    <section
      aria-labelledby="profile-completion-heading"
      className="mt-5 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4"
    >
      <h2 id="profile-completion-heading" className="text-sm font-bold">
        プロフィールを充実させましょう
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        次の項目はまだ設定されていません。設定すると、このページを訪れた人にあなたのことが伝わります。
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {MISSING_FIELDS.map((field) => (
          <li key={field} className="flex items-center gap-1.5">
            <CircleDashedIcon
              className="size-3.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            {field}
          </li>
        ))}
      </ul>
      <Button size="sm" className="mt-4 w-full" asChild>
        <a href="#">
          <SettingsIcon aria-hidden="true" />
          プロフィールを設定
        </a>
      </Button>
    </section>
  );
}
