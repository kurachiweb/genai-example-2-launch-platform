#!/bin/sh
# ローカル開発用コンテナの常駐プロセス(Mailpit)を起動する。
# 単一コンテナ構成のため、DockerfileのCMDから読み込まれる。
#
# このスクリプトはCMDのshに`.`(source)で読み込ませる前提である。
# 別プロセスとして実行すると、ここで登録したtrapと各プロセスの親子関係がスクリプト終了時に失われ、停止時にMailpitへSIGTERMを転送できなくなるため。

# DockerfileのRUN命令でホストに存在しないディレクトリを作成しても、bindマウントによって隠れてしまう。
# ここはホストからのbindマウント後に実行されるため、確実にコンテナ内でディレクトリにアクセスできる。
mkdir -p /workspace/apps/email

# Dockerのポートフォワーディングが機能するよう0.0.0.0で待ち受ける(既定の127.0.0.1待受だとホストから48041へ到達できない)。
mailpit \
  --listen 0.0.0.0:48041 \
  --smtp 0.0.0.0:1025 \
  >/workspace/apps/email/mailpit.log 2>&1 &
mailpit_pid=$!

# `docker compose down`のSIGTERMはPID1のshにしか届かないため、trapで子プロセスへ転送する。
trap 'kill -TERM $mailpit_pid 2>/dev/null; wait $mailpit_pid 2>/dev/null' TERM INT
