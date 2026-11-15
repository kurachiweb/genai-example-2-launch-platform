import { useRouter } from '@tanstack/react-router';
import { LinkIcon } from 'lucide-react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Tooltip } from '../../../lib/components/ui/tooltip/tooltip.tsx';
import { TooltipContent } from '../../../lib/components/ui/tooltip/tooltip-content.tsx';
import { TooltipTrigger } from '../../../lib/components/ui/tooltip/tooltip-trigger.tsx';
import { appRuntimeOf } from '../../../lib/start/router-context.ts';
import { writeToClipboard } from '../../../lib/utilities/clipboard/write-to-clipboard.ts';
import {
  COPY_LINK_LABEL,
  LINK_COPIED,
  LINK_COPY_FAILED,
} from './copy-link-messages.ts';

export interface CopyLinkButtonProps {
  // 利用者側のオリジンからのパス
  readonly path: string;
  // 渡せばアイコンと文言のボタンにする。省けばアイコンだけで、名前とツールチップを「リンクをコピー」にする
  readonly label?: string;
  readonly className?: string;
}

// 共有されるリンクに表示中のURLのクエリや旧ハンドルを含めないよう、利用者側のオリジンとパスから正規のURLを作って写す
export function CopyLinkButton({
  path,
  label,
  className,
}: CopyLinkButtonProps) {
  const router = useRouter();
  const siteOrigin = appRuntimeOf(router.options.context).publicConfig
    .clientSiteOrigin;

  const copy = async () => {
    const copied = await writeToClipboard(new URL(path, siteOrigin).href);
    if (copied) {
      notify.success(LINK_COPIED);
    } else {
      notify.error(LINK_COPY_FAILED);
    }
  };

  if (label !== undefined) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        onClick={() => {
          void copy();
        }}
      >
        <LinkIcon aria-hidden="true" />
        {label}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={COPY_LINK_LABEL}
          className={className}
          onClick={() => {
            void copy();
          }}
        >
          <LinkIcon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{COPY_LINK_LABEL}</TooltipContent>
    </Tooltip>
  );
}
