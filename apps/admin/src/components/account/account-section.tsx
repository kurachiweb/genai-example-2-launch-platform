import { type ReactNode, type RefObject, useId } from 'react';

export interface AccountSectionProps {
  readonly title: string;
  readonly description: string;
  // 押した送信ボタンが入力の初期化で無効になる操作で、ダイアログを閉じた後のフォーカスの移り先にする見出し
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly children: ReactNode;
}

export function AccountSection({
  title,
  description,
  headingRef,
  children,
}: AccountSectionProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
    >
      <div className="flex flex-col gap-2">
        <h2
          id={headingId}
          className="rounded-sm text-lg font-bold"
          {...(headingRef === undefined
            ? {}
            : { ref: headingRef, tabIndex: -1 })}
        >
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
