#!/bin/bash
set -euo pipefail

# `/home/bun/.local`は名前付きボリュームで永続化されており、コンテナ起動のたびにCMDから実行することでClaude Code・RTKを最新版へ更新する。
# 必要な時にコンテナ内で手動実行することも可能。
# ネットワーク不調などで更新に失敗してもコンテナ起動を継続できるよう、各インストーラの失敗はここでメッセージ出力のみに留める。

curl -fsSL https://claude.ai/install.sh | bash \
  || echo '[entrypoint] Claude Codeの更新に失敗しました' >&2
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | bash \
  || echo '[entrypoint] RTKの更新に失敗しました' >&2

if command -v claude >/dev/null 2>&1; then
  echo "Claude Code $(claude --version)"
fi
if command -v rtk >/dev/null 2>&1; then
  echo "RTK $(rtk --version)"
fi

exit 0
