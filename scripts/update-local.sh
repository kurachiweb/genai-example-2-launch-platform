#!/bin/bash
set -euo pipefail

# `/home/bun/.local`は名前付きボリュームで永続化されており、イメージの内容がコピーされるのはボリュームが空の初回マウント時のみである。
# そのためDockerfileを再ビルドしてもClaude Code・rtkは更新されないため、コンテナ内でこのスクリプトを実行して更新する。

curl -fsSL https://claude.ai/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | bash

echo "claude $(claude --version)"
echo "rtk $(rtk --version)"
