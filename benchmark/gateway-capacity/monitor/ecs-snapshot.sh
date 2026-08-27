#!/usr/bin/env bash
set -euo pipefail
umask 077

script_name="${BASH_SOURCE[0]##*/}"
output_mode="stdout"
output_dir=""
container_names=()
readonly monitor_timeout_seconds=5

usage() {
  cat <<EOF
用法：${script_name} [--stdout | --output-dir DIR] --container NAME [--container NAME ...]

默认把一次只读快照输出到 stdout；--output-dir 会在指定目录写入
ecs-snapshot-<UTC时间>-<进程号>.txt。目录只用于写快照，不会删除或修改其他文件。
容器必须通过 --container 显式指定；名称只允许 128 位安全字符：
  [A-Za-z0-9][A-Za-z0-9_.-]{0,127}
EOF
}

reject() {
  printf '拒绝运行：%s\n' "$1" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stdout)
      [[ "${output_mode}" == "stdout" && -z "${output_dir}" ]] || reject "--stdout 与 --output-dir 不能同时使用。"
      output_mode="stdout"
      shift
      ;;
    --output-dir)
      [[ "${output_mode}" == "stdout" && -z "${output_dir}" ]] || reject "--stdout 与 --output-dir 不能同时使用。"
      [[ $# -ge 2 ]] || reject "--output-dir 需要目录参数。"
      output_dir="$2"
      output_mode="file"
      shift 2
      ;;
    --container)
      [[ $# -ge 2 ]] || reject "--container 需要容器名称。"
      container_name="$2"
      [[ "${container_name}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || reject "容器名称不符合安全字符规则：${container_name}。"
      already_added=0
      if (( ${#container_names[@]} > 0 )); then
        for existing_container in "${container_names[@]}"; do
          if [[ "${existing_container}" == "${container_name}" ]]; then
            already_added=1
            break
          fi
        done
      fi
      if (( already_added == 0 )); then
        container_names+=("${container_name}")
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      reject "未知参数：$1。"
      ;;
  esac
done

(( ${#container_names[@]} > 0 )) || reject "未配置 --container；请先根据 ECS Preflight 显式指定目标容器。"

if [[ "${output_mode}" == "file" ]]; then
  [[ -n "${output_dir}" ]] || reject "输出目录不能为空。"
  case "${output_dir}" in
    -*|*[$'\n\r']*) reject "输出目录不得以短横线开头或包含换行。" ;;
  esac
  command -v mkdir >/dev/null 2>&1 || reject "mkdir 命令不可用，无法创建输出目录。"
  mkdir -p -- "${output_dir}" || reject "无法创建输出目录：${output_dir}。"
fi

capture_output=""
capture_status=0
capture_command() {
  if capture_output="$("$@")"; then
    capture_status=0
  else
    capture_status=$?
  fi
}

capture_monitored_command() {
  local command_name="$1"
  shift
  case "${command_name}" in
    docker|vmstat|ss|ip)
      if [[ -n "${monitor_timeout_bin}" ]]; then
        capture_command "${monitor_timeout_bin}" "${monitor_timeout_seconds}" "$@"
      else
        capture_command "$@"
      fi
      ;;
    *)
      capture_command "$@"
      ;;
  esac
}

if command -v date >/dev/null 2>&1; then
  capture_command date -u '+%Y-%m-%dT%H:%M:%SZ'
else
  capture_output=""
  capture_status=127
fi
timestamp_utc="${capture_output%%$'\n'*}"
if [[ "${capture_status}" -ne 0 || ! "${timestamp_utc}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
  timestamp_utc="unavailable"
  file_stamp="unknown"
else
  file_stamp="${timestamp_utc//:/}"
fi

if [[ "${output_mode}" == "file" ]]; then
  snapshot_file="${output_dir%/}/ecs-snapshot-${file_stamp}-${$}.txt"
  : >"${snapshot_file}" || reject "无法写入快照文件：${snapshot_file}。"
else
  snapshot_file=""
fi

emit() {
  if [[ "${output_mode}" == "file" ]]; then
    printf '%s\n' "$*" >>"${snapshot_file}"
  else
    printf '%s\n' "$*"
  fi
}

emit_command_result() {
  local command_name="$1"
  if [[ -n "${capture_output}" ]]; then
    emit "${capture_output}"
  fi
  if (( capture_status != 0 )); then
    emit "unavailable: command failed (${command_name}, exit ${capture_status})"
  fi
}

run_section() {
  local title="$1"
  local command_name="$2"
  shift 2
  emit "[${title}]"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    emit "unavailable: command not found (${command_name})"
    emit ""
    return 0
  fi
  capture_monitored_command "${command_name}" "$@"
  emit_command_result "${command_name}"
  emit ""
}

emit "Gateway Capacity ECS read-only snapshot"
emit "timestamp_utc: ${timestamp_utc}"
if command -v timeout >/dev/null 2>&1; then
  monitor_timeout_bin="$(command -v timeout)"
  emit "monitor_command_timeout: enabled (${monitor_timeout_seconds}s for docker/vmstat/ss/ip)"
else
  monitor_timeout_bin=""
  emit "monitor_command_timeout: unavailable (commands run without timeout wrapper)"
fi
emit ""

if command -v hostname >/dev/null 2>&1; then
  capture_command hostname
  if [[ "${capture_status}" -eq 0 && -n "${capture_output}" ]]; then
    emit "host: ${capture_output}"
  else
    emit "host: unavailable"
  fi
else
  emit "host: unavailable (command not found: hostname)"
fi
emit ""

run_section "host.cpu" nproc nproc
run_section "host.memory" free free -h
run_section "host.disk" df df -hP
run_section "host.load" uptime uptime

if ! command -v docker >/dev/null 2>&1; then
  emit "[docker.ps]"
  emit "unavailable: command not found (docker)"
  emit ""
  emit "[docker.stats]"
  emit "unavailable: command not found (docker)"
  emit ""
  emit "[docker.health]"
  emit "unavailable: command not found (docker)"
  emit ""
else
  emit "[docker.ps]"
  for container_name in "${container_names[@]}"; do
    capture_monitored_command docker docker ps -a --filter "name=^/${container_name}$" --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'
    emit "container: ${container_name}"
    emit_command_result "docker ps ${container_name}"
  done
  emit ""

  emit "[docker.stats]"
  capture_monitored_command docker docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}' "${container_names[@]}"
  emit_command_result "docker stats"
  emit ""

  emit "[docker.health]"
  emit "container_name\trestart_count\toom_killed\thealth\tstatus"
  for container_name in "${container_names[@]}"; do
    capture_monitored_command docker docker inspect --format '{{.Name}}\t{{.RestartCount}}\t{{.State.OOMKilled}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\t{{.State.Status}}' "${container_name}"
    emit_command_result "docker inspect --format"
  done
  emit ""
fi

run_section "host.vmstat" vmstat vmstat 1 2
run_section "network.ss" ss ss -s

emit "[network.default_route_link]"
if ! command -v ip >/dev/null 2>&1; then
  emit "unavailable: command not found (ip)"
else
  capture_monitored_command ip ip route show default
  emit_command_result "ip route"
  default_route="${capture_output}"
  route_interface=""
  previous_token=""
  while IFS= read -r route_line; do
    for route_token in ${route_line}; do
      if [[ "${previous_token}" == "dev" ]]; then
        route_interface="${route_token}"
        break 2
      fi
      previous_token="${route_token}"
    done
  done <<<"${default_route}"

  if [[ -z "${route_interface}" ]]; then
    emit "unavailable: default route interface not found"
  else
    emit "default_route_interface: ${route_interface}"
    capture_monitored_command ip ip -s link show dev "${route_interface}"
    emit_command_result "ip -s link"
  fi
fi
emit ""

if [[ "${output_mode}" == "file" ]]; then
  printf '快照文件：%s\n' "${snapshot_file}"
fi
