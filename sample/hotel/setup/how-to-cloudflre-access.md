# Cloudflare Tunnel Access for App, phpMyAdmin, and Mailpit

## Short answer
Yes. I can set this up by API call, but I need your Cloudflare account and domain details first.

## Data I need from you
Provide these values:

1. CLOUDFLARE_API_TOKEN
- Must have these permissions:
  - Account: Cloudflare Tunnel Edit
  - Account: Cloudflare Tunnel Read
  - Zone: DNS Edit
  - Zone: Zone Read

2. CLOUDFLARE_ACCOUNT_ID
- Cloudflare account ID where the tunnel will be created.

3. CLOUDFLARE_ZONE_ID
- Zone ID for the domain that will host the public names.

4. BASE_DOMAIN
- Example: example.com

5. Public hostnames you want
- APP_HOSTNAME (example: app.example.com)
- PHPMYADMIN_HOSTNAME (example: dbadmin.example.com)
- MAILPIT_HOSTNAME (example: mail.example.com)

6. Tunnel name
- Fixed value: pi-srv-live-01

## Local services this repo exposes
Current host ports from compose.yaml are:

- App: http://localhost:9201
- phpMyAdmin: http://localhost:9202
- Mailpit UI: http://localhost:9104

## API workflow
The workflow is:

1. Create tunnel
2. Configure tunnel ingress rules for 3 hostnames
3. Create DNS CNAME records to the tunnel
4. Run cloudflared with the tunnel token

## API calls
Set variables first:

```bash
export CF_API_TOKEN="replace_me"
export CF_ACCOUNT_ID="replace_me"
export CF_ZONE_ID="replace_me"

export TUNNEL_NAME="pi-srv-live-01"
export APP_HOSTNAME="app.example.com"
export PHPMYADMIN_HOSTNAME="dbadmin.example.com"
export MAILPIT_HOSTNAME="mail.example.com"
```

### 1) Use existing tunnel or create it once

```bash
TUNNEL_LOOKUP=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel?name=${TUNNEL_NAME}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

export TUNNEL_ID=$(echo "$TUNNEL_LOOKUP" | jq -r '.result[0].id // empty')

if [ -z "$TUNNEL_ID" ]; then
  CREATE_TUNNEL_RESPONSE=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"name\":\"${TUNNEL_NAME}\",\"config_src\":\"cloudflare\"}")

  echo "$CREATE_TUNNEL_RESPONSE"
  export TUNNEL_ID=$(echo "$CREATE_TUNNEL_RESPONSE" | jq -r '.result.id')
  export TUNNEL_TOKEN=$(echo "$CREATE_TUNNEL_RESPONSE" | jq -r '.result.token')
else
  echo "Using existing tunnel: ${TUNNEL_NAME} (${TUNNEL_ID})"
  echo "To run cloudflared, create a fresh tunnel token from Cloudflare Zero Trust for this tunnel."
fi
```

When a tunnel is newly created, you will receive TUNNEL_TOKEN in the response.

### 2) Configure ingress for app, phpMyAdmin, mailpit (merge-safe)

```bash
CURRENT_CONFIG_JSON=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

CURRENT_INGRESS=$(echo "$CURRENT_CONFIG_JSON" | jq '.result.config.ingress // []')

DESIRED_INGRESS=$(jq -n \
  --arg app "$APP_HOSTNAME" \
  --arg pma "$PHPMYADMIN_HOSTNAME" \
  --arg mail "$MAILPIT_HOSTNAME" \
  '[
    {"hostname": $app, "service": "http://localhost:9201"},
    {"hostname": $pma, "service": "http://localhost:9202"},
    {"hostname": $mail, "service": "http://localhost:9104"}
  ]')

MERGED_INGRESS=$(jq -n \
  --argjson current "$CURRENT_INGRESS" \
  --argjson desired "$DESIRED_INGRESS" \
  '
  ($current | map(select(
    .hostname != $desired[0].hostname and
    .hostname != $desired[1].hostname and
    .hostname != $desired[2].hostname and
    .service != "http_status:404"
  ))) + $desired + [{"service":"http_status:404"}]
  ')

PAYLOAD=$(jq -n --argjson ingress "$MERGED_INGRESS" '{"config": {"ingress": $ingress}}')

curl -sS -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$PAYLOAD"
```

This updates only the three hostnames for this app and keeps unrelated ingress rules already present in the tunnel.

### 3) Create DNS records for each hostname
Each record should point to:

- ${TUNNEL_ID}.cfargotunnel.com

Create APP hostname:

```bash
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"type\":\"CNAME\",\"name\":\"${APP_HOSTNAME}\",\"content\":\"${TUNNEL_ID}.cfargotunnel.com\",\"proxied\":true}"
```

Create phpMyAdmin hostname:

```bash
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"type\":\"CNAME\",\"name\":\"${PHPMYADMIN_HOSTNAME}\",\"content\":\"${TUNNEL_ID}.cfargotunnel.com\",\"proxied\":true}"
```

Create Mailpit hostname:

```bash
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"type\":\"CNAME\",\"name\":\"${MAILPIT_HOSTNAME}\",\"content\":\"${TUNNEL_ID}.cfargotunnel.com\",\"proxied\":true}"
```

### 4) Run tunnel connector
Run cloudflared with token:

```bash
cloudflared tunnel run --token "${TUNNEL_TOKEN}"
```

## Verify token permissions

Do not save real token values in this file. Export them in your shell only.

```bash
export CF_API_TOKEN="replace_me"

VERIFY_JSON=$(curl -sS "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

echo "$VERIFY_JSON" | jq

TOKEN_ID=$(echo "$VERIFY_JSON" | jq -r '.result.id')

DETAIL_JSON=$(curl -sS "https://api.cloudflare.com/client/v4/user/tokens/${TOKEN_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

echo "$DETAIL_JSON" | jq '.result.policies'
```

Required permission groups:

1. Cloudflare Tunnel Edit
2. Cloudflare Tunnel Read
3. DNS Edit
4. Zone Read

Required scope:

1. The target account for tunnel creation
2. The target zone for DNS record changes

## Optional: run cloudflared in Docker

```bash
docker run -d --name cloudflared \
  --restart unless-stopped \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate run --token "${TUNNEL_TOKEN}"
```

## Security recommendations

1. Protect phpMyAdmin and Mailpit with Cloudflare Access policies before exposing publicly.
2. Restrict who can reach these hostnames by email domain or identity provider groups.
3. Rotate API token and tunnel token if shared.

## What I can do next
After you provide the required values, I can execute these API calls and give you a ready-to-run result set (tunnel id, DNS records, and verification steps).
