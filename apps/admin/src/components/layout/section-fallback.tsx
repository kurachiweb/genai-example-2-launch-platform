import { type ReactNode, useId } from 'react';

export interface SectionFallbackProps {
  readonly title: string;
  readonly children: ReactNode;
}

// 登録箇所の区画の部品は自分の見出しを描くため、部品が描けない読み込み中と失敗の間だけ、区画の位置に題の見出しを補う
export function SectionFallback({ title, children }: SectionFallbackProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 再試行の後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
