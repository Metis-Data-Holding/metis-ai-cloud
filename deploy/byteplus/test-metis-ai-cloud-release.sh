#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_COMMAND="$SCRIPT_DIR/metis-ai-cloud-release"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_eq() {
  [[ "$1" == "$2" ]] || fail "expected '$2', got '$1'"
}

[[ -x "$RELEASE_COMMAND" ]] || fail "missing executable $RELEASE_COMMAND"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/metis-release-test.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

ROOT="$TEST_ROOT/data"
TEMPLATE="$TEST_ROOT/compose.yml"
FAKE_DOCKER="$TEST_ROOT/docker"
FAKE_CURL="$TEST_ROOT/curl"
DOCKER_LOG="$TEST_ROOT/docker.log"
DOCKER_STATE="$TEST_ROOT/docker-state"
FAKE_LEGACY_ID="sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

mkdir -p "$ROOT/releases"
printf 'name: metis-ai-cloud\nservices: {}\n' >"$TEMPLATE"

cat >"$FAKE_DOCKER" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >>"$FAKE_DOCKER_LOG"

case "${1:-}" in
  login)
    IFS= read -r _token
    ;;
  logout|pull)
    ;;
  image)
    if [[ "${3:-}" != "--format" ]]; then
      exit 0
    fi
    case "${4:-}" in
      *Architecture*) printf 'linux/amd64\n' ;;
      *revision*) printf '%s\n' "$FAKE_REVISION" ;;
      *'.Id'*) printf '%s\n' "$FAKE_LEGACY_ID" ;;
      *) exit 2 ;;
    esac
    ;;
  compose)
    env_file=""
    while (($#)); do
      if [[ "$1" == "--env-file" ]]; then
        env_file="$2"
        shift 2
        continue
      fi
      if [[ "$1" == "up" ]]; then
        grep '^METIS_IMAGE=' "$env_file" | cut -d= -f2- >"$FAKE_DOCKER_STATE"
        exit 0
      fi
      if [[ "$1" == "config" ]]; then
        exit 0
      fi
      if [[ "$1" == "ps" && "$2" == "-q" ]]; then
        printf '%s-cid\n' "$3"
        exit 0
      fi
      shift
    done
    exit 2
    ;;
  inspect)
    if [[ "$(cat "$FAKE_DOCKER_STATE" 2>/dev/null || true)" == "${FAKE_UNHEALTHY_IMAGE:-}" ]]; then
      printf 'unhealthy\n'
    else
      printf 'healthy\n'
    fi
    ;;
  *)
    exit 2
    ;;
esac
EOF
chmod +x "$FAKE_DOCKER"

cat >"$FAKE_CURL" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(cat "$FAKE_DOCKER_STATE")" != "${FAKE_UNHEALTHY_IMAGE:-}" ]]
EOF
chmod +x "$FAKE_CURL"

run_release() {
  env \
    FAKE_DOCKER_LOG="$DOCKER_LOG" \
    FAKE_DOCKER_STATE="$DOCKER_STATE" \
    FAKE_REVISION="${FAKE_REVISION:-}" \
    FAKE_LEGACY_ID="$FAKE_LEGACY_ID" \
    FAKE_UNHEALTHY_IMAGE="${FAKE_UNHEALTHY_IMAGE:-}" \
    METIS_ROOT="$ROOT" \
    METIS_COMPOSE_TEMPLATE="$TEMPLATE" \
    METIS_DOCKER="$FAKE_DOCKER" \
    METIS_CURL="$FAKE_CURL" \
    METIS_HEALTH_ATTEMPTS=2 \
    METIS_HEALTH_INTERVAL=0 \
    "$RELEASE_COMMAND" "$@"
}

create_release() {
  local commit="$1"
  local image="$2"
  local release="$ROOT/releases/$commit"
  mkdir -p "$release"
  cp "$TEMPLATE" "$release/compose.yml"
  printf 'METIS_IMAGE=%s\n' "$image" >"$release/.release.env"
  printf '%s\n' "$FAKE_LEGACY_ID" >"$release/image.sha256"
}

if printf 'token\n' | run_release deploy invalid ref actor >/dev/null 2>&1; then
  fail 'invalid commit was accepted'
fi

LOOKALIKE_IMAGE="ghcrXio/metis-data-holding/metis-ai-cloud@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
if printf 'token\n' | run_release deploy \
  1111111111111111111111111111111111111111 \
  "$LOOKALIKE_IMAGE" github-user >/dev/null 2>&1; then
  fail 'lookalike GHCR host was accepted'
fi

GOOD_COMMIT="1111111111111111111111111111111111111111"
GOOD_DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
GOOD_IMAGE="ghcr.io/metis-data-holding/metis-ai-cloud@$GOOD_DIGEST"
FAKE_REVISION="$GOOD_COMMIT"
printf 'token\n' | run_release deploy "$GOOD_COMMIT" "$GOOD_IMAGE" github-user >/dev/null
assert_eq "$(basename "$(readlink "$ROOT/current")")" "$GOOD_COMMIT"
assert_eq "$(cat "$ROOT/releases/$GOOD_COMMIT/.release.env")" "METIS_IMAGE=$GOOD_IMAGE"

REBUILT_DIGEST="sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
REBUILT_IMAGE="ghcr.io/metis-data-holding/metis-ai-cloud@$REBUILT_DIGEST"
printf 'token\n' | run_release deploy "$GOOD_COMMIT" "$REBUILT_IMAGE" github-user >/dev/null
assert_eq "$(basename "$(readlink "$ROOT/current")")" "$GOOD_COMMIT"
assert_eq "$(cat "$ROOT/releases/$GOOD_COMMIT/.release.env")" "METIS_IMAGE=$GOOD_IMAGE"
assert_eq "$(cat "$DOCKER_STATE")" "$GOOD_IMAGE"

BAD_COMMIT="2222222222222222222222222222222222222222"
BAD_DIGEST="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
BAD_IMAGE="ghcr.io/metis-data-holding/metis-ai-cloud@$BAD_DIGEST"
FAKE_REVISION="$BAD_COMMIT"
FAKE_UNHEALTHY_IMAGE="$BAD_IMAGE"
if printf 'token\n' | run_release deploy "$BAD_COMMIT" "$BAD_IMAGE" github-user >/dev/null 2>&1; then
  fail 'unhealthy release was accepted'
fi
assert_eq "$(basename "$(readlink "$ROOT/current")")" "$GOOD_COMMIT"
assert_eq "$(cat "$DOCKER_STATE")" "$GOOD_IMAGE"

ROLLBACK_COMMIT="3333333333333333333333333333333333333333"
ROLLBACK_IMAGE="metis-ai-cloud:$ROLLBACK_COMMIT"
create_release "$ROLLBACK_COMMIT" "$ROLLBACK_IMAGE"
FAKE_UNHEALTHY_IMAGE=""
printf 'token\n' | run_release rollback "$ROLLBACK_COMMIT" github-user >/dev/null
assert_eq "$(basename "$(readlink "$ROOT/current")")" "$ROLLBACK_COMMIT"
assert_eq "$(cat "$DOCKER_STATE")" "$ROLLBACK_IMAGE"

printf 'PASS: metis-ai-cloud release command\n'
