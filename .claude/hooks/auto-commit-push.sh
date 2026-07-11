#!/usr/bin/env bash
# Hook Stop : à la fin d'une tâche, committe les changements et pousse vers origin.
# Sans effet s'il n'y a rien à committer. Jamais bloquant (sort toujours 0).
set +e

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$dir" 2>/dev/null || exit 0

# Uniquement dans un dépôt git.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Rien à committer ? On sort silencieusement.
if [ -z "$(git status --porcelain)" ]; then
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
git add -A
git commit -q -m "Auto : sauvegarde de session ($(date '+%Y-%m-%d %H:%M'))" >/dev/null 2>&1

# Push best-effort : ne bloque jamais la fin de tâche si le réseau est absent.
push_out="$(git push origin "$branch" 2>&1)"
if [ $? -eq 0 ]; then
  echo "{\"systemMessage\": \"Auto-commit + push effectués sur '$branch'.\"}"
else
  echo "{\"systemMessage\": \"Auto-commit fait, mais le push a échoué (réseau ?). À pousser manuellement.\"}"
fi
exit 0
