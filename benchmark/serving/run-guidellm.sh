#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${GUIDELLM_ENV_FILE:-${script_dir}/.env.local}"

if [[ -f "${env_file}" ]]; then
  file_mode="$(stat -f '%Lp' "${env_file}" 2>/dev/null || stat -c '%a' "${env_file}")"
  if [[ "${file_mode}" != "600" ]]; then
    echo "拒绝读取 ${env_file}：文件权限必须为 600。" >&2
    exit 2
  fi
  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
fi

: "${GUIDELLM__SPEC__BACKEND__TARGET:?缺少 GUIDELLM__SPEC__BACKEND__TARGET}"
: "${GUIDELLM__SPEC__BACKEND__MODEL:?缺少 GUIDELLM__SPEC__BACKEND__MODEL}"
: "${GUIDELLM__SPEC__BACKEND__API_KEY:?缺少 GUIDELLM__SPEC__BACKEND__API_KEY}"

if [[ "$(uname -s)" == "Darwin" ]]; then
  export GUIDELLM__MP_CONTEXT_TYPE="spawn"
fi

exec uvx --python 3.13 --from 'guidellm[recommended]==0.7.2' guidellm "$@"
