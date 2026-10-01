import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/')({ component: AdminHome })

function AdminHome() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">管理者側画面のモックアップ</h1>
      <p className="mt-4 text-lg">
        <code>src/routes/admin/</code>
        配下にデザイン案のルートを追加してください。
      </p>
    </div>
  )
}
