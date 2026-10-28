import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

// ブラウザ内の画面遷移では支援技術がページの移動に気付かないため、描画の後に移動先のタイトルを読み上げさせる。最初の表示はブラウザが通知するため除き、検索条件やフラグメントだけの変化はページの移動として扱わない
export function RouteAnnouncer() {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState('');

  useEffect(
    () =>
      router.subscribe('onRendered', ({ fromLocation, pathChanged }) => {
        if (fromLocation === undefined || !pathChanged) {
          return;
        }
        setAnnouncement(document.title);
      }),
    [router],
  );

  return (
    <div
      data-slot="route-announcer"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}
