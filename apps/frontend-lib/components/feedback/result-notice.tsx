import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

export interface ResultNoticeProps {
  readonly tone: 'success' | 'error';
  readonly message: string;
  readonly children?: ReactNode;
}

// 確定のボタンやフォームに代えて描くため、押したボタンとともに失われるフォーカスを結果の文言へ移す
export function ResultNotice({ tone, message, children }: ResultNoticeProps) {
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    noticeRef.current?.focus();
  }, []);

  const Icon = tone === 'success' ? CircleCheckIcon : CircleAlertIcon;

  return (
    <div
      ref={noticeRef}
      role={tone === 'success' ? 'status' : 'alert'}
      tabIndex={-1}
      className="flex flex-col gap-4 rounded-md"
    >
      <p className="flex items-start gap-2 font-medium">
        <Icon
          aria-hidden="true"
          className={
            tone === 'success'
              ? 'mt-0.5 size-5 shrink-0 text-primary'
              : 'mt-0.5 size-5 shrink-0 text-destructive'
          }
        />
        <span>{message}</span>
      </p>
      {children === undefined ? null : (
        <div className="text-sm">{children}</div>
      )}
    </div>
  );
}
