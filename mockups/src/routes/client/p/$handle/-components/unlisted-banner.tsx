import { EyeOffIcon } from 'lucide-react';

// 未掲載(予選前・予選敗北のみ)のプロダクトを投稿者本人が閲覧している場合の案内
export function UnlistedBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/8 px-4 py-3 text-sm"
    >
      <EyeOffIcon
        className="mt-0.5 size-5 shrink-0 text-primary"
        aria-hidden="true"
      />
      <p>
        <strong className="font-bold">
          このページはあなたにだけ表示されています。
        </strong>
        予選で勝利するとディレクトリに掲載され、誰でも見られるようになります。
      </p>
    </div>
  );
}
