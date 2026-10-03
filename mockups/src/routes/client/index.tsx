import { Link, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/client/')({ component: ClientHome });

// ハンドルで仮データのユーザーを選ぶ。ニックネームの種類による表示の違いを確認できるユーザーを並べる
const PROFILE_SAMPLES = [
  { handle: 'KurachiWeb', label: '他の画面でログイン中の仮ユーザー' },
  { handle: 'kitsune_makes', label: '絵文字で始まるニックネーム' },
  { handle: 'hubert', label: '区切りの無い25文字のニックネーム' },
];

function ClientHome() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">利用者側画面のモックアップ</h1>
      <ul className="mt-4 list-disc space-y-2 pl-6 text-lg">
        <li>
          <Link to="/client/top" className="underline">
            トップページ
          </Link>
        </li>
        <li>
          <Link to="/client/p" className="underline">
            ディレクトリ
          </Link>
        </li>
        <li>
          <Link
            to="/client/p/$handle"
            params={{ handle: 'pitch-notes' }}
            className="underline"
          >
            プロダクト詳細ページ
          </Link>
        </li>
        <li>
          <Link
            to="/client/@{$handle}"
            params={{ handle: 'jaw' }}
            className="underline"
          >
            ユーザー公開プロフィール
          </Link>
          <ul className="mt-1 list-[circle] space-y-1 pl-6 text-base">
            {PROFILE_SAMPLES.map(({ handle, label }) => (
              <li key={handle}>
                <Link
                  to="/client/@{$handle}"
                  params={{ handle }}
                  className="underline"
                >
                  @{handle}
                </Link>
                ({label})
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </div>
  );
}
