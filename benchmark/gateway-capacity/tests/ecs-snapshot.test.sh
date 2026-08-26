#!/usr/bin/env bash
set -u

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
snapshot="${script_dir}/../monitor/ecs-snapshot.sh"
bash_bin="$(command -v bash)"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/gateway-capacity-snapshot-test.XXXXXX")"
trap 'rm -rf "${tmp_dir}"' EXIT

failures=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

fake_bin="${tmp_dir}/bin"
mkdir -p "${fake_bin}"
docker_calls="${tmp_dir}/docker-calls"
: >"${docker_calls}"

container_args=(
  --container metis-ai-cloud-app-1
  --container postgres-1
  --container redis-1
  --container gateway-capacity_mock-2
)

write_command() {
  local name="$1"
  local body="$2"
  printf '%s\n' '#!/bin/bash' "${body}" >"${fake_bin}/${name}"
  chmod 700 "${fake_bin}/${name}"
}

write_command date 'printf "%s\\n" "2026-08-26T00:00:00Z"'
write_command hostname 'printf "%s\\n" "ecs-test-host"'
write_command uptime 'printf "%s\\n" "00:00:00 up 3 days,  load average: 0.42, 0.31, 0.20"'
write_command nproc 'printf "%s\\n" "8"'
write_command free 'printf "%s\\n" "Mem: 16000 8000 8000 0 0 8000"'
write_command df 'printf "%s\\n" "Filesystem  Size  Used Avail Use%% Mounted on" "overlay 100G 40G 60G 40%% /"'
write_command vmstat 'printf "%s\\n" "procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----" " r  b   swpd   free  buff  cache   si   so    bi    bo   in   cs us sy id wa st" " 1  0      0 8000000 1000 2000000    0    0     0     0  100  200  5  2 92  1  0"'
# shellcheck disable=SC2016
write_command ip '
if [[ "$1" == "route" ]]; then
  printf "%s\\n" "default via 10.0.0.1 dev eth0 proto dhcp"
else
  printf "%s\\n" "2: eth0: <BROADCAST,UP> mtu 1500" "    RX: bytes  packets errors dropped  missed   mcast" "    1000 10 0 0 0 0" "    TX: bytes  packets errors dropped carrier collsns" "    2000 20 0 0 0 0"
fi'
# shellcheck disable=SC2016
write_command docker '
printf "%s\\n" "$*" >>"${FAKE_DOCKER_CALLS}"
if [[ "$1" == "ps" ]]; then
  filter_value=""
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      -a) shift ;;
      --filter)
        filter_value="$2"
        shift 2
        ;;
      --format) shift 2 ;;
      *)
        printf "%s\\n" "POSITIONAL_ARGUMENT_REJECTED: $1"
        exit 2
        ;;
    esac
  done
  case "${filter_value}" in
    name=^/*\$) ;;
    *)
      printf "%s\\n" "EXACT_NAME_FILTER_REQUIRED: ${filter_value}"
      exit 2
      ;;
  esac
  container="${filter_value#name=^/}"
  container="${container%\$}"
  printf "%s\\n" "c-${container}\\t${container}"
elif [[ "$1 $2" == "stats --no-stream" ]]; then
    printf "%s\\n" "NAME CPU%% MEM USAGE / LIMIT MEM%% NET I/O BLOCK I/O PIDS" "metis-ai-cloud-app 2.00%% 100MiB / 1GiB 10%% 1kB / 2kB 0B / 0B 12"
elif [[ "$1" == "inspect" ]]; then
    if [[ "$*" != *"--format"* ]]; then
      printf "%s\\n" "SECRET_INSPECT_JSON_MUST_NOT_BE_READ"
      exit 1
    fi
    container="${*: -1}"
    printf "%s\\n" "/${container} 0 false healthy running"
else
  exit 1
fi'

output="$(PATH="${fake_bin}" FAKE_DOCKER_CALLS="${docker_calls}" "${bash_bin}" "${snapshot}" --stdout "${container_args[@]}" 2>&1)"
status=$?
if (( status != 0 )); then
  fail "stdout snapshot should exit successfully (status ${status}): ${output}"
fi

for expected in \
  "timestamp_utc: 2026-08-26T00:00:00Z" \
  "host: ecs-test-host" \
  "[host.cpu]" \
  "[host.memory]" \
  "[host.disk]" \
  "[host.load]" \
  "[docker.ps]" \
  "[docker.stats]" \
  "[docker.health]" \
  "gateway-capacity_mock-2" \
  "[host.vmstat]" \
  "[network.ss]" \
  "unavailable: command not found (ss)" \
  "[network.default_route_link]" \
  "dev eth0" \
  "monitor_command_timeout: unavailable"; do
  if [[ "${output}" != *"${expected}"* ]]; then
    fail "snapshot output should include ${expected}"
  fi
done

if [[ "${output}" == *"SECRET_INSPECT_JSON_MUST_NOT_BE_READ"* ]]; then
  fail "snapshot must not read complete docker inspect JSON"
fi

for expected_container in metis-ai-cloud-app-1 postgres-1 redis-1 gateway-capacity_mock-2; do
  if ! grep -Fq -- "${expected_container}" "${docker_calls}"; then
    fail "explicit container ${expected_container} should be passed to fake docker"
  fi
  if ! grep -Fq -- "ps -a --filter name=^/${expected_container}$" "${docker_calls}"; then
    fail "docker ps should use an exact name filter for ${expected_container}"
  fi
done
if grep -Fq -- "POSITIONAL_ARGUMENT_REJECTED" "${docker_calls}" || \
  grep -Fq -- "EXACT_NAME_FILTER_REQUIRED" "${docker_calls}"; then
  fail "docker ps must not use positional container arguments or non-exact filters"
fi
if ! grep -Fq -- "stats --no-stream" "${docker_calls}" || \
  ! grep -Fq -- "inspect --format" "${docker_calls}"; then
  fail "explicit containers should be used for docker stats and inspect"
fi
if [[ "${output}" == *"Authorization"* || "${output}" == *"Bearer"* || "${output}" == *"prompt"* || "${output}" == *"API_KEY"* ]]; then
  fail "snapshot output must not expose request credentials or prompt fields"
fi

unsafe_output="${tmp_dir}/-bad"
if PATH="${fake_bin}" "${bash_bin}" "${snapshot}" --output-dir "${unsafe_output}" "${container_args[@]}" >/dev/null 2>&1; then
  fail "output path beginning with a dash must be rejected"
fi

no_container_output=""
no_container_status=0
if no_container_output="$(PATH="${fake_bin}" "${bash_bin}" "${snapshot}" --stdout 2>&1)"; then
  no_container_status=0
else
  no_container_status=$?
fi
if (( no_container_status == 0 )); then
  fail "snapshot without --container must not be treated as a normal collection"
fi
if [[ "${no_container_output}" != *"未配置 --container"* ]]; then
  fail "snapshot without --container should explain the missing explicit container configuration"
fi

for invalid_container in 'bad name' 'bad/name' 'bad;rm' $'bad\nname'; do
  invalid_container_output=""
  if invalid_container_output="$(PATH="${fake_bin}" "${bash_bin}" "${snapshot}" --stdout --container "${invalid_container}" 2>&1)"; then
    fail "invalid container name should be rejected: ${invalid_container}"
  fi
  if [[ "${invalid_container_output}" != *"容器名称不符合安全字符规则"* ]]; then
    fail "invalid container name rejection should identify the safe-name rule: ${invalid_container}"
  fi
done

result_dir="${tmp_dir}/result"
mkdir -p "${result_dir}"
output_with_file="$(PATH="${fake_bin}:/bin" FAKE_DOCKER_CALLS="${docker_calls}" "${bash_bin}" "${snapshot}" --output-dir "${result_dir}" "${container_args[@]}" 2>&1)"
status=$?
if (( status != 0 )); then
  fail "output-dir snapshot should exit successfully (status ${status}): ${output_with_file}"
fi
result_file="$(find "${result_dir}" -type f -name 'ecs-snapshot-*.txt' -print -quit)"
if [[ -z "${result_file}" || ! -s "${result_file}" ]]; then
  fail "output-dir snapshot should create a non-empty snapshot file"
elif ! grep -Fq "[docker.health]" "${result_file}"; then
  fail "snapshot file should contain the same monitoring sections"
fi

if (( failures > 0 )); then
  printf '%d test(s) failed.\n' "${failures}" >&2
  exit 1
fi

printf 'All ECS snapshot behavior tests passed.\n'
