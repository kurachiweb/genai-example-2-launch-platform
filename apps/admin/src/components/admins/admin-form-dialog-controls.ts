import { createContext, use } from 'react';

export interface AdminFormDialogControls {
  readonly pending: boolean;
  // 処理の間は閉じる要求を受け付けず、成功したら閉じる。失敗は投げ直してフォームの失敗の表示に任せる
  readonly run: (action: () => Promise<void>) => Promise<void>;
  readonly cancel: () => void;
}

export const AdminFormDialogControlsContext =
  createContext<AdminFormDialogControls | null>(null);

export function useAdminFormDialogControls(): AdminFormDialogControls {
  const controls = use(AdminFormDialogControlsContext);
  if (controls === null) {
    throw new Error(
      'ダイアログの操作はAdminFormDialogの内側で読んでください。',
    );
  }
  return controls;
}
