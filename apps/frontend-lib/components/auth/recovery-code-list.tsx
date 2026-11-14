import { CopyIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../../utilities/class-names.ts';
import { writeToClipboard } from '../../utilities/clipboard/write-to-clipboard.ts';
import {
  COPY_ALL_RECOVERY_CODES_LABEL,
  RECOVERY_CODES_COPIED,
  RECOVERY_CODES_COPY_FAILED,
  RECOVERY_CODES_LABEL,
  RECOVERY_CODES_STORAGE_NOTICE,
} from '../../utilities/messages/auth-messages.ts';
import { Button } from '../ui/button/button.tsx';

export interface RecoveryCodeListProps {
  readonly codes: readonly string[];
  readonly className?: string;
}

type CopyResult = 'copied' | 'failed' | undefined;

const codesKeyOf = (codes: readonly string[]): string => JSON.stringify(codes);

export function RecoveryCodeList({ codes, className }: RecoveryCodeListProps) {
  const codesKey = codesKeyOf(codes);
  const [resultKey, setResultKey] = useState(codesKey);
  const [result, setResult] = useState<CopyResult>();

  // 再発行などでコードが変わった時は、前のコードのコピーの結果を残さない
  if (codesKey !== resultKey) {
    setResultKey(codesKey);
    setResult(undefined);
  }

  const copyAll = async () => {
    setResult(undefined);
    const copied = await writeToClipboard(codes.join('\n'));
    setResult(copied ? 'copied' : 'failed');
  };

  return (
    <div
      data-slot="recovery-code-list"
      className={cn('flex min-w-0 flex-col gap-4', className)}
    >
      <ul
        aria-label={RECOVERY_CODES_LABEL}
        translate="no"
        className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border border-border bg-muted p-4 font-mono text-sm text-foreground xs:grid-cols-2"
      >
        {codes.map((code, index) => (
          <li
            // 同じ文字列のコードが並んでも並びの位置で区別する
            key={`${String(index)}:${code}`}
            className="break-all"
          >
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void copyAll();
          }}
        >
          <CopyIcon aria-hidden="true" />
          {COPY_ALL_RECOVERY_CODES_LABEL}
        </Button>
        <p role="status" className="min-w-0 text-sm text-muted-foreground">
          {result === 'copied' ? RECOVERY_CODES_COPIED : null}
        </p>
      </div>
      {result === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          {RECOVERY_CODES_COPY_FAILED}
        </p>
      ) : null}
      <p className="flex min-w-0 items-start gap-2 text-sm">
        <TriangleAlertIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0"
        />
        <span className="min-w-0">{RECOVERY_CODES_STORAGE_NOTICE}</span>
      </p>
    </div>
  );
}
