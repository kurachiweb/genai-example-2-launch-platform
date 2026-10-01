import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">Launch Stadium 画面デザイン案</h1>
      <ul className="mt-4 list-disc space-y-2 pl-6 text-lg">
        <li>
          <Link to="/client" className="underline">
            利用者側画面
          </Link>
        </li>
        <li>
          <Link to="/admin" className="underline">
            管理者側画面
          </Link>
        </li>
      </ul>
    </div>
  )
}
