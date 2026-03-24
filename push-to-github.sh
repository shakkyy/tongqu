#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d .git ]]; then
  git init
  git branch -M main
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/shakkyy/tongqu.git"
else
  git remote add origin "https://github.com/shakkyy/tongqu.git"
fi

git add -A
git status

if git diff --cached --quiet && git diff --quiet; then
  echo "Nothing to commit."
else
  git commit -m "chore: initial import — 童趣绘梦 (frontend + agent backend)" || true
fi

git push -u origin main

echo "Done. If push failed, run: gh auth login  or configure SSH, then retry."
