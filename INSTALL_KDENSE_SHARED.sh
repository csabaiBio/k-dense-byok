#!/usr/bin/env bash
set -euo pipefail

BASE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
PARENT=$(dirname -- "$BASE")
SHARED="$PARENT/k-dense-byok-0.15.0-root"
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[[ ! -e $SHARED && ! -L $SHARED ]] ||
  fail "Shared installation already exists: $SHARED. It will not be overwritten."
command -v node >/dev/null || fail "Node.js 22 or newer is required."
command -v npm >/dev/null || fail "npm is required."
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' ||
  fail "Node.js 22 or newer is required."
for dir in server web; do
  [[ ! -e $BASE/$dir/node_modules && ! -L $BASE/$dir/node_modules ]] ||
    fail "Base $dir/node_modules must be absent."
done

umask 022
temp=$(mktemp -d "$PARENT/.kdense-shared.XXXXXXXX")
cleanup() {
  if [[ -n $temp && -d $temp ]]; then rm -rf -- "$temp"; fi
}
trap cleanup EXIT
cp -a --no-preserve=ownership -- "$BASE" "$temp/repo"
repo="$temp/repo"
if [[ -e $repo/.env || -L $repo/.env ]]; then
  [[ -f $repo/.env && ! -L $repo/.env ]] || fail "Base .env must be a regular file."
  chmod 600 "$repo/.env"
fi
for dir in server web; do
  printf 'Installing %s dependencies...\n' "$dir"
  (cd "$repo/$dir" && npm ci --no-audit --no-fund)
  chmod -R a+rX "$repo/$dir/node_modules"
done
[[ -x $repo/server/node_modules/.bin/tsx && -x $repo/web/node_modules/.bin/next ]] ||
  fail "Installed dependencies are missing required executables."
chmod -R go-w -- "$repo"
chmod 755 "$repo"
[[ ! -e $SHARED && ! -L $SHARED ]] || fail "Shared installation appeared during setup: $SHARED"
mv -T -n -- "$repo" "$SHARED"
[[ ! -e $repo ]] || fail "Shared installation appeared during setup: $SHARED"
rmdir -- "$temp"
temp=
printf 'Shared installation ready: %s\n' "$SHARED"
