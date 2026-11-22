import { type ReactNode, type Ref, useId } from 'react';

export interface ReportCaseSectionProps {
  readonly title: string;
  // 確定の後などのフォーカスの移り先にする見出し
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly children: ReactNode;
}

// 案件の詳細の区画を、見出しで名前を付けた領域として同じ見た目で並べる
export function ReportCaseSection({
  title,
  headingRef,
  children,
}: ReportCaseSectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={headingRef === undefined ? undefined : -1}
        className="text-lg font-extrabold"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
