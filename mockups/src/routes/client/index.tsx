import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/client/')({ component: ClientHome })

function ClientHome() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">利用者側画面のモックアップ</h1>
      <p className="mt-4 text-lg">
        <code>src/routes/client/</code>
        配下にデザイン案のルートを追加してください。
      </p>
    </div>
  )
}
