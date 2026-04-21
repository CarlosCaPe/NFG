#!/usr/bin/env bash
# migrate-local.sh — Run Flyway against dev DB from windows365 CPC.
# The privatelink host is only reachable from inside Azure network.
#
# Usage:
#   ./scripts/migrate-local.sh            # applies pending migrations
#   ./scripts/migrate-local.sh info       # shows migration status
#   ./scripts/migrate-local.sh validate   # checks checksums
#   ./scripts/migrate-local.sh repair     # fixes failed migrations
#
# Requires: flyway CLI on PATH, .env file in project root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  echo "ERROR: .env not found at $PROJECT_ROOT/.env"
  echo "       Copy .env.example and fill in credentials."
  exit 1
fi

# shellcheck disable=SC1091
source "$PROJECT_ROOT/.env"

FLYWAY_CMD="${1:-migrate}"

flyway \
  -url="jdbc:postgresql://${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}" \
  -user="${DB_MIGRATIONS_USER}" \
  -password="${DB_MIGRATIONS_PASSWORD}" \
  -configFiles="$PROJECT_ROOT/db/flyway.conf" \
  -locations="filesystem:$PROJECT_ROOT/db/migrations" \
  "$FLYWAY_CMD"
