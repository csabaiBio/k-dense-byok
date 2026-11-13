#!/usr/bin/env bash
set -euo pipefail

BASE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
PARENT=$(dirname -- "$BASE")
[[ ${NB_USER:-} =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ && $NB_USER != root ]] || {
  echo "Error: NB_USER must identify a non-root user without path separators." >&2; exit 1;
}
USER_REPO="$PARENT/k-dense-byok-0.15.0-$NB_USER"
[[ -d $USER_REPO && ! -L $USER_REPO && -O $USER_REPO ]] || {
  echo "Error: user copy is missing or not owned by the current user: $USER_REPO" >&2; exit 1;
}
: "${SERVERNAME:?SERVERNAME is required}"
: "${REPORT_URL:?REPORT_URL is required}"
: "${NB_URL:?NB_URL is required}"
command -v node >/dev/null || { echo "Error: Node.js is required." >&2; exit 1; }

export KADY_REPO_ROOT="$USER_REPO"
export KADY_PROJECTS_ROOT="$HOME/kdense-projects"
export KADY_ALLOWED_ORIGINS="https://${SERVERNAME}"
export KADY_BASE_PATH="/${REPORT_URL}"
export KADY_ALLOWED_HOSTS="$SERVERNAME"
export NEXT_PUBLIC_ADK_API_URL="https://${SERVERNAME}/${REPORT_URL}"
export NEXT_PUBLIC_BASE_PATH="/${NB_URL}/app"
mkdir -p -- "$KADY_PROJECTS_ROOT"
chmod 700 "$KADY_PROJECTS_ROOT"
cd -- "$USER_REPO"
exec node "$BASE/start.mjs" --launch-only --no-browser "$@"
