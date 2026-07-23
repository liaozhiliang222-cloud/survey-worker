#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/surveykit-ppt"
SERVICE_NAME="surveykit-ppt"
SERVER_NAME="${SERVER_NAME:-ppt-api.surveykit.cc}"

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

mkdir -p "${APP_DIR}"
cp -a deploy "${APP_DIR}/"
cp -a pptx_report "${APP_DIR}/"

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
ExecStart=${APP_DIR}/venv/bin/python -m uvicorn aliyun_api:app --host 127.0.0.1 --port 8000 --workers 2 --timeout-keep-alive 120
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

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

ln -sfn "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo
echo "Local API check:"
curl --fail --silent --show-error http://127.0.0.1:8000/healthz
echo
echo "Nginx check:"
curl --fail --silent --show-error -H "Host: ${SERVER_NAME}" http://127.0.0.1/healthz
echo
echo "Deployment completed."
