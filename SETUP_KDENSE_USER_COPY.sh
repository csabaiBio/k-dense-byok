#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
PARENT=$(dirname -- "$SCRIPT_DIR")
BASE="$PARENT/k-dense-byok-0.15.0_base"
SHARED="$PARENT/k-dense-byok-0.15.0-root"

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[[ ${NB_USER:-} =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || fail "NB_USER must be a nonempty username without path separators."
[[ -d $BASE ]] || fail "Base repository not found: $BASE"
[[ -d $SHARED ]] || fail "Shared installation not found: $SHARED"
[[ -f $BASE/.env && ! -L $BASE/.env ]] || fail "The base .env must be a regular file."
[[ -d ${HOME:-} && -w $HOME ]] || fail "HOME must be a writable directory."
command -v flock >/dev/null || fail "flock is required to serialize startup setup."

USER_REPO="$PARENT/k-dense-byok-0.15.0-$NB_USER"
[[ $USER_REPO != "$SHARED" ]] || fail "NB_USER cannot be root."
umask 077
lock_dir="$HOME/.kdense-user-setup"
mkdir -m 700 -- "$lock_dir" 2>/dev/null || [[ -d $lock_dir && ! -L $lock_dir && -O $lock_dir ]] ||
  fail "Cannot create a private setup lock directory: $lock_dir"
[[ ! -L $lock_dir/lock ]] || fail "Setup lock must not be a symbolic link."
exec 9>"$lock_dir/lock"
flock -x 9

for dir in server web; do
  [[ -x $SHARED/$dir/node_modules/.bin/$([[ $dir == server ]] && echo tsx || echo next) ]] ||
    fail "Shared $dir dependencies are missing or inaccessible."
done

temp=
cleanup() {
  if [[ -n $temp && -d $temp ]]; then rm -rf -- "$temp"; fi
}
trap cleanup EXIT

if [[ ! -e $USER_REPO && ! -L $USER_REPO ]]; then
  temp=$(mktemp -d "$PARENT/.kdense-user-${NB_USER}.XXXXXXXX")
  cp -a --no-preserve=ownership -- "$BASE" "$temp/repo"
  chmod 700 "$temp/repo"
  chmod 600 "$temp/repo/.env"
  target="$temp/repo"
else
  [[ -d $USER_REPO && ! -L $USER_REPO && -O $USER_REPO ]] ||
    fail "Existing user path must be a directory owned by the current user: $USER_REPO"
  target=$USER_REPO
fi

for dir in server web; do
  [[ -d $target/$dir && ! -L $target/$dir ]] || fail "Invalid $dir directory in $target."
  for file in package.json package-lock.json; do
    cmp -s -- "$target/$dir/$file" "$SHARED/$dir/$file" ||
      fail "$dir/$file differs from the shared installation; resolve the mismatch without overwriting user changes."
  done
  link="$target/$dir/node_modules"
  if [[ -L $link ]]; then
    [[ $(readlink -f -- "$link") == "$(readlink -f -- "$SHARED/$dir/node_modules")" ]] ||
      fail "Existing dependency link points elsewhere: $link"
  elif [[ -e $link ]]; then
    fail "Refusing to replace existing dependencies: $link"
  fi
done

if [[ -e $target/.env || -L $target/.env ]]; then
  [[ -f $target/.env && ! -L $target/.env ]] || fail "User .env must be a regular file."
  chmod 600 "$target/.env"
fi

for dir in server web; do
  link="$target/$dir/node_modules"
  [[ -L $link ]] || ln -s -- "$SHARED/$dir/node_modules" "$link"
done

if [[ -n $temp ]]; then
  [[ ! -e $USER_REPO && ! -L $USER_REPO ]] || fail "User path appeared during setup: $USER_REPO"
  mv -T -n -- "$target" "$USER_REPO"
  [[ ! -e $target ]] || fail "User path appeared during setup: $USER_REPO"
  rmdir -- "$temp"
  temp=
fi
printf 'User copy ready: %s\n' "$USER_REPO"
