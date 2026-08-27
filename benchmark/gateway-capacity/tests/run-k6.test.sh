#!/usr/bin/env bash
set -u

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runner="${script_dir}/../run-k6.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/gateway-capacity-runner-test.XXXXXX")"
trap 'rm -rf "${tmp_dir}"' EXIT

failures=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

expect_rejection() {
  local name="$1"
  local expected="$2"
  local mode="$3"
  shift 3
  local output
  if output="$(env "$@" bash "$runner" "${mode}" 2>&1)"; then
    fail "${name}: expected rejection"
    return
  fi
  if [[ "${output}" != *"${expected}"* ]]; then
    fail "${name}: expected ${expected}, got: ${output}"
  fi
}

write_env() {
  local path="$1"
  local target="${2:-https://gateway.example.test}"
  local model="${3:-mock-sleep-1s}"
  local key="${4:-secret-test-key}"
  cat >"${path}" <<EOF
GATEWAY_CAPACITY_TARGET=${target}
GATEWAY_CAPACITY_MODEL=${model}
GATEWAY_CAPACITY_API_KEY=${key}
EOF
}

missing_env="${tmp_dir}/missing.env"
expect_rejection "missing env file" "环境文件不存在" smoke \
  GATEWAY_CAPACITY_ENV_FILE="${missing_env}"

insecure_env="${tmp_dir}/insecure.env"
write_env "${insecure_env}"
chmod 644 "${insecure_env}"
expect_rejection "insecure env permissions" "文件权限必须为 600" smoke \
  GATEWAY_CAPACITY_ENV_FILE="${insecure_env}"

valid_env="${tmp_dir}/valid.env"
write_env "${valid_env}"
chmod 600 "${valid_env}"
cat >>"${valid_env}" <<EOF
MOCK_DELAY_MS=125
MOCK_TTFT_MS=25
MOCK_CHUNK_INTERVAL_MS=40
MOCK_CHUNK_COUNT=3
EOF
test_results_root="${tmp_dir}/results"
mkdir -p "${test_results_root}"

for metric in gateway_status_2xx gateway_status_429 gateway_status_502 gateway_status_503 \
  gateway_status_504 gateway_status_other_4xx gateway_status_other_5xx \
  gateway_status_transport_error; do
  if ! grep -Fq "new Counter('${metric}')" "${script_dir}/../k6/common.js"; then
    fail "common.js must expose ${metric}"
  fi
done
if ! grep -Fq "validateNonStreamResponse" "${script_dir}/../k6/common.js" || \
  ! grep -Fq "validateStreamingResponse" "${script_dir}/../k6/common.js"; then
  fail "common.js must use the Mock source validators"
fi
if ! grep -Fq "gateway_http_ttfb" "${script_dir}/../k6/common.js"; then
  fail "streaming metric must use the HTTP TTFB approximation name"
fi
if ! grep -Fq "gateway_overhead_duration_ms" "${script_dir}/../k6/common.js" || \
  ! grep -Fq "__ENV.MOCK_DELAY_MS" "${script_dir}/../k6/common.js"; then
  fail "non-stream metric must expose gateway overhead duration"
fi
if ! grep -Fq "fixed-vu-closed-loop" "${script_dir}/../k6/common.js"; then
  fail "load model must be explicitly named fixed-vu-closed-loop"
fi

expect_rejection "real model guard" "模型必须使用 mock- 前缀" smoke \
  GATEWAY_CAPACITY_ENV_FILE="${valid_env}" GATEWAY_CAPACITY_MODEL="google/gemma-4-31b"

http_env="${tmp_dir}/http.env"
write_env "${http_env}" "http://localhost:3000"
chmod 600 "${http_env}"
expect_rejection "https guard" "默认只允许 HTTPS" smoke \
  GATEWAY_CAPACITY_ENV_FILE="${http_env}"

query_env="${tmp_dir}/query.env"
write_env "${query_env}" "https://gateway.example.test/?token=do-not-use"
chmod 600 "${query_env}"
expect_rejection "query guard" "目标不得包含 query 或 fragment" smoke \
  GATEWAY_CAPACITY_ENV_FILE="${query_env}"

userinfo_env="${tmp_dir}/userinfo.env"
write_env "${userinfo_env}" "https://sentinel-key@gateway.example.test" mock-sleep-1s sentinel-key
chmod 600 "${userinfo_env}"
artifact_file_count_before="$(find "${test_results_root}" -type f -print 2>/dev/null | wc -l | tr -d ' ')"
expect_rejection "userinfo guard" "目标不得包含 userinfo" smoke \
  GATEWAY_CAPACITY_ENV_FILE="${userinfo_env}" GATEWAY_CAPACITY_RESULTS_ROOT="${test_results_root}"
artifact_file_count_after="$(find "${test_results_root}" -type f -print 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${artifact_file_count_after}" != "${artifact_file_count_before}" ]]; then
  fail "userinfo rejection must not create result metadata"
fi
if grep -R -Fq "sentinel-key" "${test_results_root}" 2>/dev/null; then
  fail "userinfo sentinel must not appear in benchmark artifacts"
fi

remote_http_env="${tmp_dir}/remote-http.env"
write_env "${remote_http_env}" "http://example.com"
chmod 600 "${remote_http_env}"
expect_rejection "remote HTTP guard" "HTTP 目标只允许本地" smoke \
  GATEWAY_CAPACITY_ENV_FILE="${remote_http_env}" GATEWAY_CAPACITY_ALLOW_HTTP_LOCAL=1

container_local_env="${tmp_dir}/container-local.env"
write_env "${container_local_env}" "http://127.0.0.1:3000"
chmod 600 "${container_local_env}"
expect_rejection "container localhost guard" "请改用 host.docker.internal" smoke \
  GATEWAY_CAPACITY_ENV_FILE="${container_local_env}" GATEWAY_CAPACITY_ALLOW_HTTP_LOCAL=1

container_ipv6_env="${tmp_dir}/container-ipv6.env"
write_env "${container_ipv6_env}" "http://[::1]:3000"
chmod 600 "${container_ipv6_env}"
expect_rejection "container IPv6 localhost guard" "请改用 host.docker.internal" smoke \
  GATEWAY_CAPACITY_ENV_FILE="${container_ipv6_env}" GATEWAY_CAPACITY_ALLOW_HTTP_LOCAL=1

expect_rejection "load acknowledgement" "必须设置 GATEWAY_CAPACITY_ALLOW_LOAD" non-stream \
  GATEWAY_CAPACITY_ENV_FILE="${valid_env}"
expect_rejection "VUS upper bound" "VUS 上限为 500" non-stream \
  GATEWAY_CAPACITY_ENV_FILE="${valid_env}" GATEWAY_CAPACITY_ALLOW_LOAD=I_UNDERSTAND_PUBLIC_LOAD VUS=501
expect_rejection "duration upper bound" "DURATION 上限为 30 分钟" non-stream \
  GATEWAY_CAPACITY_ENV_FILE="${valid_env}" GATEWAY_CAPACITY_ALLOW_LOAD=I_UNDERSTAND_PUBLIC_LOAD DURATION=31m
expect_rejection "timeout upper bound" "TIMEOUT 上限为 120 秒" non-stream \
  GATEWAY_CAPACITY_ENV_FILE="${valid_env}" GATEWAY_CAPACITY_ALLOW_LOAD=I_UNDERSTAND_PUBLIC_LOAD TIMEOUT=121s

expect_rejection "mode allowlist" "模式必须是 smoke、non-stream 或 streaming" unsupported \
  GATEWAY_CAPACITY_ENV_FILE="${valid_env}"

fake_bin="${tmp_dir}/bin"
mkdir -p "${fake_bin}"
docker_args="${tmp_dir}/docker.args"
cat >"${fake_bin}/docker" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == "image" && "\$2" == "inspect" ]]; then
  printf 'grafana/k6@sha256:fake-digest\\n'
  exit 0
fi
printf '%s\\n' "\$@" >> "${docker_args}"
exit 0
EOF
chmod 700 "${fake_bin}/docker"

if ! PATH="${fake_bin}:${PATH}" GATEWAY_CAPACITY_ENV_FILE="${valid_env}" \
  GATEWAY_CAPACITY_RESULTS_ROOT="${test_results_root}" \
  bash "${runner}" smoke >"${tmp_dir}/smoke.out" 2>"${tmp_dir}/smoke.err"; then
  fail "smoke should be runnable with a Docker-compatible runtime"
else
  if grep -Fq "secret-test-key" "${docker_args}" "${tmp_dir}/smoke.out" "${tmp_dir}/smoke.err"; then
    fail "API key must not appear in Docker args or runner output"
  fi
  if ! grep -Fxq -- "GATEWAY_CAPACITY_API_KEY" "${docker_args}"; then
    fail "Docker invocation must pass the API key by inherited environment name"
  fi
  result_dir="$(sed -n 's/^结果目录：//p' "${tmp_dir}/smoke.out" | tail -n 1)"
  if [[ -z "${result_dir}" || ! -f "${result_dir}/metadata.txt" ]]; then
    fail "smoke should write metadata to the ignored result directory"
  elif grep -Fq "secret-test-key" "${result_dir}/metadata.txt"; then
    fail "API key must not appear in result metadata"
  fi
  if ! grep -Fxq -- "k6_image_repo_digest=grafana/k6@sha256:fake-digest" "${result_dir}/metadata.txt"; then
    fail "metadata should record the k6 image digest when inspect can provide it"
  fi
  for expected in \
    "load_model=fixed-vu-closed-loop" \
    "mock_delay_ms=125" \
    "mock_ttft_ms=25" \
    "chunk_interval_ms=40" \
    "chunk_count=3"; do
    if ! grep -Fxq -- "${expected}" "${result_dir}/metadata.txt"; then
      fail "metadata must record ${expected}"
    fi
  done
  for variable in MOCK_DELAY_MS MOCK_TTFT_MS MOCK_CHUNK_INTERVAL_MS MOCK_CHUNK_COUNT; do
    if ! grep -Fxq -- "${variable}" "${docker_args}"; then
      fail "Docker invocation must pass ${variable} by inherited environment name"
    fi
  done
fi

local_valid_env="${tmp_dir}/local-valid.env"
write_env "${local_valid_env}" "http://host.docker.internal:3000"
chmod 600 "${local_valid_env}"
: >"${docker_args}"
if ! PATH="${fake_bin}:${PATH}" GATEWAY_CAPACITY_ENV_FILE="${local_valid_env}" \
  GATEWAY_CAPACITY_ALLOW_HTTP_LOCAL=1 GATEWAY_CAPACITY_RESULTS_ROOT="${test_results_root}" \
  bash "${runner}" smoke >"${tmp_dir}/local-smoke.out" 2>"${tmp_dir}/local-smoke.err"; then
  fail "local host.docker.internal smoke should be runnable with a Docker-compatible runtime"
elif ! grep -Fxq -- "--add-host=host.docker.internal:host-gateway" "${docker_args}"; then
  fail "local HTTP Docker invocation must add host.docker.internal"
fi

if (( failures > 0 )); then
  printf '%d test(s) failed.\n' "${failures}" >&2
  exit 1
fi

printf 'All gateway capacity runner security tests passed.\n'
