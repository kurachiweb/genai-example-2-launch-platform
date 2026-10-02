import { Link, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/client/')({ component: ClientHome });

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
          <Link
            to="/client/p/$handle"
            params={{ handle: 'pitch-notes' }}
            className="underline"
          >
            プロダクト詳細ページ
          </Link>
        </li>
      </ul>
    </div>
  );
}
