#!/bin/sh
# ローカル開発用コンテナのセットアップ(ディレクトリ作成・Chromium導入)と、常駐プロセス(Mailpit)の起動を行う。
# このスクリプトはCMDのshに`.`(source)で読み込ませる前提である。
# 別プロセスとして実行すると、ここで登録したtrapと各プロセスの親子関係がスクリプト終了時に失われ、停止時にMailpitへSIGTERMを転送できなくなるため。

# プロジェクトルートディレクトリの非所有者でもgitコマンドを実行できるよう、安全なディレクトリとして設定する。
git config --global --add safe.directory /workspace

# DockerfileのRUN命令でホストに存在しないディレクトリを作成しても、bindマウントによって隠れてしまう。
# ここはホストからのbindマウント後に実行されるため、確実にコンテナ内でディレクトリにアクセスできる。
mkdir -p /workspace/apps/email

# Chromiumをインストールする。
# ただし`bun install`前にコンテナが起動した場合はこのスクリプトがスキップされるので、後ほどクイックスタート手順(docs/onboardings/README.md参照)に従いそのスクリプトを手動実行する。
/workspace/scripts/setup-chromium.sh

# Dockerのポートフォワーディングが機能するよう0.0.0.0で待ち受ける(既定の127.0.0.1待受だとホストから48041へ到達できない)。
mailpit \
  --listen 0.0.0.0:48041 \
  --smtp 0.0.0.0:1025 \
  >/workspace/apps/email/mailpit.log 2>&1 &
mailpit_pid=$!
# Mailpitプロセスの不正終了(バイナリ不在やポート競合など)を検知するため、起動後に生存確認する。正常起動なら1秒程度では終了しない。
sleep 1
if ! kill -0 "$mailpit_pid" 2>/dev/null; then
  echo 'Mailpitの起動に失敗しました。ログ末尾:' >&2
  tail -n 20 /workspace/apps/email/mailpit.log >&2
fi

# `docker compose down`のSIGTERMはPID1(docker-init)の子であるshに転送されるがその子(mailpit)には届かないため、trapで子プロセスへ転送する。
trap 'kill -TERM $mailpit_pid 2>/dev/null; wait $mailpit_pid 2>/dev/null' TERM INT EXIT
