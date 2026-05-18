#!/bin/bash
# Build Astro website and deploy to gh-pages branch
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
WORKTREE=$(mktemp -d)
trap 'rm -rf "$WORKTREE"; git -C "$ROOT" worktree prune' EXIT

echo "Building website..."
cd "$ROOT/website"
npm run build

git fetch origin gh-pages 2>/dev/null || true

if git rev-parse --verify gh-pages >/dev/null 2>&1; then
  git -C "$ROOT" worktree add "$WORKTREE" gh-pages
  # Remove old files (except .git)
  find "$WORKTREE" -maxdepth 1 -not -name '.git' -not -name "$WORKTREE" -exec rm -rf {} + 2>/dev/null || true
else
  git -C "$ROOT" worktree add --orphan "$WORKTREE"
  git -C "$WORKTREE" checkout --orphan gh-pages
fi

# Copy Astro build output + .nojekyll
rsync -a "$ROOT/website/dist/" "$WORKTREE"/
touch "$WORKTREE/.nojekyll"

git -C "$WORKTREE" add -A
if git -C "$WORKTREE" diff --cached --quiet; then
  echo "No changes to deploy."
  exit 0
fi

git -C "$WORKTREE" commit -m "deploy: update website"
git -C "$WORKTREE" push origin gh-pages
echo "Deployed to https://lucas-lgm.github.io/lumiere/"
