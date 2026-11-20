import { createContext, use } from 'react';

import type { ModerationDialogCopy } from './moderation-messages.ts';
import type { ModerationOperation } from './moderation-operations.ts';

export interface ModerationDialogRequest {
  readonly operation: ModerationOperation;
  readonly targetId: string;
  // 閉じる間に取り直した状態で題名や操作が替わらないよう、開いた時の文言を渡す
  readonly copy: ModerationDialogCopy;
}

export type OpenModerationDialog = (request: ModerationDialogRequest) => void;

export const ModerationDialogContext =
  createContext<OpenModerationDialog | null>(null);

export function useOpenModerationDialog(): OpenModerationDialog {
  const open = use(ModerationDialogContext);
  if (open === null) {
    throw new Error(
      '措置の操作は一覧の単位の確認のダイアログ(ModerationDialogHost)の内側に置いてください。',
    );
  }
  return open;
}
