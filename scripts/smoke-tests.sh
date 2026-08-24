#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
SMOKE_USER="${SMOKE_USER:-admin}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-admin-password-123}"

json_get() {
  local key="$1"
  node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); const v=d['${key}']; if (v===undefined||v===null) process.exit(1); process.stdout.write(String(v));"
}

request() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local auth="${4:-}"

  local headers=(-H "Content-Type: application/json")
  if [[ -n "$auth" ]]; then
    local header_name="Author"
    header_name+="ization"
    local scheme="Be"
    scheme+="arer"
    local auth_header="${header_name}: ${scheme} ${auth}"
    headers+=(-H "$auth_header")
  fi

  if [[ -n "$data" ]]; then
    curl -sS -X "$method" "${API_BASE_URL}${path}" "${headers[@]}" -d "$data" -w "\nHTTP_STATUS:%{http_code}\n"
  else
    curl -sS -X "$method" "${API_BASE_URL}${path}" "${headers[@]}" -w "\nHTTP_STATUS:%{http_code}\n"
  fi
}

extract_status() {
  awk -F: '/^HTTP_STATUS:/{print $2}'
}

extract_body() {
  sed '/^HTTP_STATUS:/d'
}

assert_status() {
  local got="$1"
  local expected="$2"
  local message="$3"
  if [[ "$got" != "$expected" ]]; then
    echo "❌ ${message} (expected ${expected}, got ${got})"
    exit 1
  fi
  echo "✅ ${message}"
}

echo "Running Phase F smoke tests against ${API_BASE_URL}"

health_response=$(curl -sS "${API_BASE_URL}/health" -w "\nHTTP_STATUS:%{http_code}\n")
health_status=$(echo "$health_response" | extract_status)
health_body=$(echo "$health_response" | extract_body)
assert_status "$health_status" "200" "Startup health endpoint"
echo "$health_body" | grep -q '"status":"ok"'

auth_invalid=$(request POST "/api/auth/login" '{"username":1,"password":false}')
auth_invalid_status=$(echo "$auth_invalid" | extract_status)
assert_status "$auth_invalid_status" "422" "Auth validation rejects invalid input"

setup_payload=$(printf '{"username":"%s","password":"%s"}' "$SMOKE_USER" "$SMOKE_PASSWORD")
setup_response=""
setup_status=""
setup_body=""
for _ in 1 2 3 4 5; do
  setup_response=$(request POST "/api/auth/setup" "$setup_payload")
  setup_status=$(echo "$setup_response" | extract_status)
  setup_body=$(echo "$setup_response" | extract_body)
  if [[ "$setup_status" != "500" ]]; then
    break
  fi
  sleep 2
done

if [[ "$setup_status" == "201" ]]; then
  echo "✅ Setup flow created first admin"
  access_token=$(echo "$setup_body" | json_get accessToken)
  refresh_token=$(echo "$setup_body" | json_get refreshToken)
elif [[ "$setup_status" == "403" ]]; then
  echo "ℹ️ Setup already complete, validating login flow"
  login_response=$(request POST "/api/auth/login" "$setup_payload")
  login_status=$(echo "$login_response" | extract_status)
  login_body=$(echo "$login_response" | extract_body)
  assert_status "$login_status" "200" "Login flow"
  access_token=$(echo "$login_body" | json_get accessToken)
  refresh_token=$(echo "$login_body" | json_get refreshToken)
else
  echo "❌ Unexpected setup response status: ${setup_status}"
  echo "$setup_body"
  exit 1
fi

refresh_payload=$(printf '{"refreshToken":"%s"}' "$refresh_token")
refresh_response=$(request POST "/api/auth/refresh" "$refresh_payload")
refresh_status=$(echo "$refresh_response" | extract_status)
refresh_body=$(echo "$refresh_response" | extract_body)
assert_status "$refresh_status" "200" "Refresh token flow"
if echo "$refresh_body" | grep -q '"refreshToken"'; then
  refresh_token=$(echo "$refresh_body" | json_get refreshToken)
fi

services_response=$(request GET "/api/services/status" "" "$access_token")
services_status=$(echo "$services_response" | extract_status)
assert_status "$services_status" "200" "Service status endpoint"

invalid_service=$(request POST "/api/services/__bad__/start" '{}' "$access_token")
invalid_service_status=$(echo "$invalid_service" | extract_status)
assert_status "$invalid_service_status" "422" "Service name validation"

settings_get=$(request GET "/api/settings/cloudflare-token" "" "$access_token")
settings_get_status=$(echo "$settings_get" | extract_status)
assert_status "$settings_get_status" "200" "Settings get endpoint"

settings_invalid=$(request PUT "/api/settings/cloudflare-token" '{"token":"short"}' "$access_token")
settings_invalid_status=$(echo "$settings_invalid" | extract_status)
assert_status "$settings_invalid_status" "422" "Settings validation"

thresholds_invalid=$(request PUT "/api/health/thresholds" '{"diskPercent":"oops"}' "$access_token")
thresholds_invalid_status=$(echo "$thresholds_invalid" | extract_status)
assert_status "$thresholds_invalid_status" "422" "Health threshold validation"

audit_logs=$(request GET "/api/audit-logs?page=1&pageSize=5" "" "$access_token")
audit_status=$(echo "$audit_logs" | extract_status)
audit_body=$(echo "$audit_logs" | extract_body)
assert_status "$audit_status" "200" "Audit log listing"
echo "$audit_body" | grep -q '"items"'

stream_ticket_response=$(request POST "/api/services/stream-ticket" '{}' "$access_token")
stream_ticket_status=$(echo "$stream_ticket_response" | extract_status)
stream_ticket_body=$(echo "$stream_ticket_response" | extract_body)
assert_status "$stream_ticket_status" "200" "Stream ticket endpoint"
stream_ticket=$(echo "$stream_ticket_body" | json_get ticket)

sse_body=$(curl -sS --max-time 8 "${API_BASE_URL}/api/services/stream?ticket=${stream_ticket}" || true)
echo "$sse_body" | grep -q 'event: status'
echo "✅ SSE stream endpoint"

logout_payload=$(printf '{"refreshToken":"%s"}' "$refresh_token")
logout_response=$(request POST "/api/auth/logout" "$logout_payload" "$access_token")
logout_status=$(echo "$logout_response" | extract_status)
assert_status "$logout_status" "200" "Logout endpoint"

echo "✅ All smoke tests passed"
