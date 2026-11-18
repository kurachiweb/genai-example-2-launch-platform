import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';

import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { adminYearFinalDateSettingsQueryOptions } from '../../graphql/admin-year-final-date.ts';
import { FinalDateForm } from './final-date-form.tsx';
import {
  FINAL_DATE_SECTION_DESCRIPTION,
  FINAL_DATE_SECTION_TITLE,
} from './final-date-labels.ts';
import { FinalDateYearCard } from './final-date-year-card.tsx';

// 設定のページの決勝実施日の区画。現在の年と翌年のカードを並べ、最上位管理者が変更期限より前の年だけを変更できる
export function FinalDateSection() {
  const headingId = useId();
  const { data } = useQuery({
    ...adminYearFinalDateSettingsQueryOptions(),
    // 値が無ければ区画を使えないため、最初の取得の失敗だけを区画のエラーの境界へ渡し、取り直しの失敗では表示中の値を残す
    throwOnError: (_error, query) => query.state.data === undefined,
  });
  const settings = data?.yearFinalDateSettings.settings;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 再試行の後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {FINAL_DATE_SECTION_TITLE}
      </h2>
      <p className="text-sm text-muted-foreground">
        {FINAL_DATE_SECTION_DESCRIPTION}
      </p>
      {settings === undefined ? (
        <LoadingSkeleton />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {settings.map((setting) => (
            <FinalDateYearCard key={setting.year} setting={setting}>
              <FinalDateForm setting={setting} />
            </FinalDateYearCard>
          ))}
        </div>
      )}
    </section>
  );
}
