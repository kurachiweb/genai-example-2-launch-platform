import { useRouter } from '@tanstack/react-router';

export const CHECKOUT_HEADING_ID = 'checkout-heading';

// 再試行でloaderを実行し直すとエラーの画面が描き直されて押したボタンが消えるため、描き直した後のページの見出しへフォーカスを移して<body>へ落とさない
export function useCheckoutRetry(): () => void {
  const router = useRouter();
  return () => {
    void router.invalidate().then(() => {
      document.getElementById(CHECKOUT_HEADING_ID)?.focus();
    });
  };
}
