#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/surveykit-ppt"
BACKUP_DIR="${BACKUP_DIR:-/opt/surveykit-ppt-backups}"
SERVICE_NAME="surveykit-ppt"
SERVER_NAME="${SERVER_NAME:-ppt-api.surveykit.cc}"
RELEASE_ID="${SURVEYKIT_RELEASE:-$(date -u +%Y%m%dT%H%M%SZ)}"
SOURCE_REVISION="${SURVEYKIT_COMMIT:-unknown}"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ ! "${RELEASE_ID}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "SURVEYKIT_RELEASE may only contain letters, digits, dot, underscore and hyphen."
  exit 1
fi
if [[ ! "${SOURCE_REVISION}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "SURVEYKIT_COMMIT may only contain letters, digits, dot, underscore and hyphen."
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this installer as root."
  exit 1
fi

if [[ ! -f "deploy/aliyun_api.py" || ! -d "pptx_report" ]]; then
  echo "Run this script from the extracted deployment package root."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3 python3-venv python3-pip nginx curl libreoffice-impress

mkdir -p "${APP_DIR}" "${BACKUP_DIR}"
BACKUP_PATH=""
if [[ -d "${APP_DIR}/deploy" && -d "${APP_DIR}/pptx_report" ]]; then
  BACKUP_PATH="${BACKUP_DIR}/$(date -u +%Y%m%dT%H%M%SZ)-before-${RELEASE_ID}.tar.gz"
  backup_items=(deploy pptx_report)
  if [[ -f "${APP_DIR}/RELEASE.json" ]]; then
    backup_items+=(RELEASE.json)
  fi
  tar -C "${APP_DIR}" -czf "${BACKUP_PATH}" "${backup_items[@]}"
  mapfile -t old_backups < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name '*.tar.gz' -printf '%T@ %p\n' | sort -rn | tail -n +6 | cut -d' ' -f2-)
  if (( ${#old_backups[@]} )); then
    rm -f -- "${old_backups[@]}"
  fi
fi

rm -rf "${APP_DIR}/deploy" "${APP_DIR}/pptx_report"
cp -a deploy "${APP_DIR}/"
cp -a pptx_report "${APP_DIR}/"

cat > "${APP_DIR}/RELEASE.json" <<EOF
{
  "version": "${RELEASE_ID}",
  "revision": "${SOURCE_REVISION}",
  "deployed_at": "${DEPLOYED_AT}"
}
EOF

python3 -m venv "${APP_DIR}/venv"
"${APP_DIR}/venv/bin/pip" install --upgrade pip wheel
"${APP_DIR}/venv/bin/pip" install -r "${APP_DIR}/deploy/requirements.txt"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=SurveyKit PPTX Report API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}/deploy
Environment=PYTHONUTF8=1
Environment=PYTHONUNBUFFERED=1
Environment=SURVEYKIT_RELEASE=${RELEASE_ID}
Environment=SURVEYKIT_COMMIT=${SOURCE_REVISION}
Environment=SURVEYKIT_DEPLOYED_AT=${DEPLOYED_AT}
ExecStart=${APP_DIR}/venv/bin/python -m uvicorn aliyun_api:app --host 127.0.0.1 --port 8000 --workers 2 --timeout-keep-alive 120
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

# OfficeCLI's HTML screenshot path launches Chromium with a relatively large
# thread/process tree.  The host's generic resource guard defaults to 128
# tasks, which can deadlock Chromium before the first preview frame is saved.
# Keep the existing memory/CPU and single-job guards, but provide enough task
# slots for one bounded preview render.
mkdir -p "/etc/systemd/system/${SERVICE_NAME}.service.d"
cat > "/etc/systemd/system/${SERVICE_NAME}.service.d/zz-officecli-preview.conf" <<EOF
[Service]
TasksMax=512
EOF

CERT_DIR="/etc/letsencrypt/live/${SERVER_NAME}"
if [[ -f "${CERT_DIR}/fullchain.pem" && -f "${CERT_DIR}/privkey.pem" ]]; then
cat > "/etc/nginx/sites-available/${SERVICE_NAME}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

    return 308 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${SERVER_NAME};

    ssl_certificate ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 26m;
    proxy_connect_timeout 30s;
    proxy_send_timeout 180s;
    proxy_read_timeout 180s;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
else
cat > "/etc/nginx/sites-available/${SERVICE_NAME}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

    client_max_body_size 26m;
    proxy_connect_timeout 30s;
    proxy_send_timeout 180s;
    proxy_read_timeout 180s;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
fi

ln -sfn "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo
echo "Local API check:"
api_ready=false
for attempt in $(seq 1 20); do
  if curl --fail --silent --show-error http://127.0.0.1:8000/healthz; then
    api_ready=true
    break
  fi
  sleep 1
done
if [[ "${api_ready}" != "true" ]]; then
  echo "PPTX API did not become ready within 20 seconds."
  exit 1
fi
echo
echo "Nginx check:"
if [[ -f "${CERT_DIR}/fullchain.pem" && -f "${CERT_DIR}/privkey.pem" ]]; then
  curl --fail --silent --show-error --resolve "${SERVER_NAME}:443:127.0.0.1" "https://${SERVER_NAME}/healthz"
else
  curl --fail --silent --show-error -H "Host: ${SERVER_NAME}" http://127.0.0.1/healthz
fi
echo
echo "Deployment completed."
echo "Release: ${RELEASE_ID} (${SOURCE_REVISION})"
if [[ -n "${BACKUP_PATH}" ]]; then
  echo "Rollback backup: ${BACKUP_PATH}"
fi
