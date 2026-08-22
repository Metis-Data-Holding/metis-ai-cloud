#!/usr/bin/env bash

set -Eeuo pipefail

[[ "${EUID}" -eq 0 ]] || {
  printf 'ERROR: run this installer with sudo\n' >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

id github-runner >/dev/null
command -v /usr/bin/docker >/dev/null
command -v /usr/bin/curl >/dev/null
command -v /usr/bin/python3 >/dev/null
command -v visudo >/dev/null

for asset in \
  compose.yml \
  metis-ai-cloud-release \
  metis-ai-cloud-deploy.sudoers
do
  [[ -f "$SCRIPT_DIR/$asset" ]] || {
    printf 'ERROR: missing deployment asset: %s\n' "$asset" >&2
    exit 1
  }
done

visudo -cf "$SCRIPT_DIR/metis-ai-cloud-deploy.sudoers" >/dev/null

install -d -o root -g root -m 0755 /usr/local/lib/metis-ai-cloud
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/compose.yml" \
  /usr/local/lib/metis-ai-cloud/compose.yml
install -o root -g root -m 0755 \
  "$SCRIPT_DIR/metis-ai-cloud-release" \
  /usr/local/sbin/metis-ai-cloud-release
install -o root -g root -m 0440 \
  "$SCRIPT_DIR/metis-ai-cloud-deploy.sudoers" \
  /etc/sudoers.d/metis-ai-cloud-deploy

printf 'Metis AI Cloud Actions deployment assets installed. Runner registration was not changed.\n'
