#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
k6_image="grafana/k6:2.2.0"

usage() {
  cat >&2 <<'EOF'
用法：run-k6.sh <smoke|non-stream|streaming>

环境变量：
  GATEWAY_CAPACITY_ENV_FILE  可选，默认读取同目录 .env.local
  GATEWAY_CAPACITY_VUS       并发 VU，或使用 VUS
  GATEWAY_CAPACITY_DURATION  时长，或使用 DURATION，例如 30s、5m
  GATEWAY_CAPACITY_TIMEOUT   单请求超时，或使用 TIMEOUT，例如 30s
  MOCK_DELAY_MS              Mock 非流式等待，默认 1000，范围 0～30000
  MOCK_TTFT_MS               Mock 流式首包等待，默认 100，范围 0～10000
  MOCK_CHUNK_INTERVAL_MS    Mock 流式 chunk 间隔，默认 100，范围 0～10000
  MOCK_CHUNK_COUNT           Mock 流式 chunk 数，默认 4，范围 1～32
  GATEWAY_CAPACITY_ALLOW_HTTP_LOCAL=1  仅允许本地 HTTP 目标
  GATEWAY_CAPACITY_ALLOW_LOAD=I_UNDERSTAND_PUBLIC_LOAD  允许正式压测
EOF
  exit 2
}

reject() {
  echo "拒绝运行：$1" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
mode="$1"
case "${mode}" in
  smoke|non-stream|streaming) ;;
  *) reject "模式必须是 smoke、non-stream 或 streaming。" ;;
esac

env_file="${GATEWAY_CAPACITY_ENV_FILE:-${script_dir}/.env.local}"
if [[ -n "${GATEWAY_CAPACITY_ENV_FILE+x}" && ! -f "${env_file}" ]]; then
  reject "环境文件不存在：${env_file}。"
fi

trimmed_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

load_env_file() {
  local line key value first last
  [[ -f "${env_file}" ]] || return 0

  local file_mode
  if [[ "$(uname -s)" == "Darwin" ]]; then
    file_mode="$(stat -f '%Lp' "${env_file}" 2>/dev/null || true)"
  else
    file_mode="$(stat -c '%a' "${env_file}" 2>/dev/null || true)"
  fi
  [[ "${file_mode}" == "600" ]] || reject "文件权限必须为 600：${env_file}。"

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="$(trimmed_value "${line}")"
    [[ -z "${line}" || "${line:0:1}" == "#" ]] && continue
    [[ "${line}" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="$(trimmed_value "${value}")"
    if [[ ${#value} -ge 2 ]]; then
      first="${value:0:1}"
      last="${value:$((${#value} - 1)):1}"
      if [[ "${first}" == '"' && "${last}" == '"' ]] || [[ "${first}" == "'" && "${last}" == "'" ]]; then
        value="${value:1:$((${#value} - 2))}"
      fi
    fi
    # 当前环境优先于 .env.local，避免测试运行器悄悄覆盖调用方的显式选择。
    if [[ -z "${!key+x}" ]]; then
      export "${key}=${value}"
    fi
  done <"${env_file}"
}

load_env_file

: "${GATEWAY_CAPACITY_TARGET:?缺少 GATEWAY_CAPACITY_TARGET}"
: "${GATEWAY_CAPACITY_MODEL:?缺少 GATEWAY_CAPACITY_MODEL}"
: "${GATEWAY_CAPACITY_API_KEY:?缺少 GATEWAY_CAPACITY_API_KEY}"
target="${GATEWAY_CAPACITY_TARGET}"
model="${GATEWAY_CAPACITY_MODEL}"

[[ "${target}" != *\?* && "${target}" != *#* ]] || reject "目标不得包含 query 或 fragment，避免凭证进入请求 URL 和测试结果。"
target_authority="${target#*://}"
target_authority="${target_authority%%/*}"
[[ "${target_authority}" != *@* ]] || reject "目标不得包含 userinfo（@），避免凭证进入请求 URL 和测试结果。"

if [[ ! "${model}" =~ ^mock-[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$ ]]; then
  reject "模型必须使用 mock- 前缀（当前模型被拒绝）。"
fi

case "${target}" in
  https://[![:space:]]*) ;;
  http://[![:space:]]*)
    [[ "${GATEWAY_CAPACITY_ALLOW_HTTP_LOCAL:-}" == "1" ]] || reject "默认只允许 HTTPS；本地 HTTP 必须显式设置 GATEWAY_CAPACITY_ALLOW_HTTP_LOCAL=1。"
    local_target="${target#http://}"
    local_host="${local_target%%/*}"
    if [[ "${local_host}" == \[*\]* ]]; then
      local_host="${local_host%%]*}]"
    else
      local_host="${local_host%%:*}"
    fi
    case "${local_host}" in
      host.docker.internal) ;;
      localhost|127.0.0.1|"[::1]") reject "Docker 容器内 localhost/127.0.0.1/::1 指向容器自身，请改用 host.docker.internal。" ;;
      *) reject "HTTP 目标只允许本地 host.docker.internal；远程 HTTP 被拒绝。" ;;
    esac
    ;;
  *) reject "目标必须是 HTTPS URL；本地调试才可使用受控的 HTTP URL。" ;;
esac

if [[ "${mode}" != "smoke" && "${GATEWAY_CAPACITY_ALLOW_LOAD:-}" != "I_UNDERSTAND_PUBLIC_LOAD" ]]; then
  reject "non-stream/streaming 必须设置 GATEWAY_CAPACITY_ALLOW_LOAD=I_UNDERSTAND_PUBLIC_LOAD。"
fi

default_vus=1
default_duration=1s
if [[ "${mode}" == "non-stream" ]]; then
  default_vus=10
  default_duration=30s
elif [[ "${mode}" == "streaming" ]]; then
  default_vus=5
  default_duration=30s
fi

vus="${GATEWAY_CAPACITY_VUS:-${VUS:-${default_vus}}}"
duration="${GATEWAY_CAPACITY_DURATION:-${DURATION:-${default_duration}}}"
timeout="${GATEWAY_CAPACITY_TIMEOUT:-${TIMEOUT:-30s}}"

[[ "${vus}" =~ ^[1-9][0-9]*$ ]] || reject "VUS 必须是正整数。"
(( vus <= 500 )) || reject "VUS 上限为 500。"

duration_seconds() {
  local value="$1"
  local number suffix multiplier
  [[ "${value}" =~ ^([1-9][0-9]*)(s|m|h)$ ]] || return 1
  number="${BASH_REMATCH[1]}"
  suffix="${BASH_REMATCH[2]}"
  # 先限制位数，避免极大整数在 Bash 算术展开时溢出。
  (( ${#number} <= 6 )) || return 1
  case "${suffix}" in
    s) multiplier=1 ;;
    m) multiplier=60 ;;
    h) multiplier=3600 ;;
  esac
  printf '%s' "$((number * multiplier))"
}

duration_seconds_value="$(duration_seconds "${duration}" 2>/dev/null || true)"
[[ -n "${duration_seconds_value}" ]] || reject "DURATION 只支持正整数秒/分/时，例如 30s 或 5m。"
(( duration_seconds_value <= 1800 )) || reject "DURATION 上限为 30 分钟。"

timeout_seconds_value="$(duration_seconds "${timeout}" 2>/dev/null || true)"
[[ -n "${timeout_seconds_value}" ]] || reject "TIMEOUT 只支持正整数秒/分/时，例如 30s。"
(( timeout_seconds_value <= 120 )) || reject "TIMEOUT 上限为 120 秒。"

validate_bounded_integer() {
  local name="$1"
  local value="$2"
  local minimum="$3"
  local maximum="$4"
  [[ "${value}" =~ ^[0-9]+$ ]] || reject "${name} 必须是整数。"
  (( value >= minimum && value <= maximum )) || reject "${name} 必须在 ${minimum}～${maximum} 范围内。"
}

mock_delay_ms="${MOCK_DELAY_MS:-1000}"
mock_ttft_ms="${MOCK_TTFT_MS:-100}"
chunk_interval_ms="${MOCK_CHUNK_INTERVAL_MS:-100}"
chunk_count="${MOCK_CHUNK_COUNT:-4}"
validate_bounded_integer "MOCK_DELAY_MS" "${mock_delay_ms}" 0 30000
validate_bounded_integer "MOCK_TTFT_MS" "${mock_ttft_ms}" 0 10000
validate_bounded_integer "MOCK_CHUNK_INTERVAL_MS" "${chunk_interval_ms}" 0 10000
validate_bounded_integer "MOCK_CHUNK_COUNT" "${chunk_count}" 1 32

run_id="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
results_root="${GATEWAY_CAPACITY_RESULTS_ROOT:-${repo_root}/artifacts/benchmarks/gateway-capacity}"
result_dir="${results_root%/}/${run_id}"
mkdir -p "${result_dir}"

# 元数据不保存 API Key；URL 查询串也不写入结果，避免误把临时凭证带入证据。
target_for_metadata="${target%%\?*}"
{
  echo "mode=${mode}"
  echo "target=${target_for_metadata}"
  echo "model=${model}"
  echo "load_model=fixed-vu-closed-loop"
  echo "vus=${vus}"
  echo "duration=${duration}"
  echo "timeout=${timeout}"
  echo "mock_delay_ms=${mock_delay_ms}"
  echo "mock_ttft_ms=${mock_ttft_ms}"
  echo "chunk_interval_ms=${chunk_interval_ms}"
  echo "chunk_count=${chunk_count}"
  echo "k6_image=${k6_image}"
  echo "started_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} >"${result_dir}/metadata.txt"

export GATEWAY_CAPACITY_TARGET="${target}"
export GATEWAY_CAPACITY_MODEL="${model}"
export VUS="${vus}"
export DURATION="${duration}"
export TIMEOUT="${timeout}"
export MOCK_DELAY_MS="${mock_delay_ms}"
export MOCK_TTFT_MS="${mock_ttft_ms}"
export MOCK_CHUNK_INTERVAL_MS="${chunk_interval_ms}"
export MOCK_CHUNK_COUNT="${chunk_count}"
export LOAD_MODEL="fixed-vu-closed-loop"

docker_cmd="${DOCKER_BIN:-docker}"
docker_args=(
  run --rm --pull=missing
  -v "${script_dir}/k6:/scripts:ro"
  -v "${result_dir}:/results"
  --env GATEWAY_CAPACITY_TARGET
  --env GATEWAY_CAPACITY_MODEL
  --env GATEWAY_CAPACITY_API_KEY
  --env VUS
  --env DURATION
  --env TIMEOUT
  --env MOCK_DELAY_MS
  --env MOCK_TTFT_MS
  --env MOCK_CHUNK_INTERVAL_MS
  --env MOCK_CHUNK_COUNT
  --env LOAD_MODEL
)
if [[ "${target}" == http://host.docker.internal* ]]; then
  docker_args+=(--add-host=host.docker.internal:host-gateway)
fi
docker_args+=("${k6_image}" run --summary-export=/results/summary.json "/scripts/${mode}.js")
set +e
"${docker_cmd}" "${docker_args[@]}"
docker_status=$?
set -e

repo_digest="$("${docker_cmd}" image inspect --format '{{index .RepoDigests 0}}' "${k6_image}" 2>/dev/null || true)"
[[ -n "${repo_digest}" ]] || repo_digest="unavailable"
{
  echo "k6_image_repo_digest=${repo_digest}"
  echo "finished_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "exit_code=${docker_status}"
} >>"${result_dir}/metadata.txt"
echo "结果目录：${result_dir}"

if (( docker_status != 0 )); then
  echo "k6 运行失败，保留结果目录用于排查。" >&2
  exit "${docker_status}"
fi
