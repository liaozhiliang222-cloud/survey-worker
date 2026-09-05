#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/surveykit-ppt"
BACKUP_DIR="${BACKUP_DIR:-/opt/surveykit-ppt-backups}"
SERVICE_NAME="surveykit-ppt"
BACKUP_PATH="${1:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this rollback script as root."
  exit 1
fi

if [[ -z "${BACKUP_PATH}" ]]; then
  BACKUP_PATH="$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name '*.tar.gz' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2-)"
fi

if [[ -z "${BACKUP_PATH}" || ! -f "${BACKUP_PATH}" ]]; then
  echo "No rollback backup found."
  exit 1
fi

resolved_backup="$(realpath "${BACKUP_PATH}")"
resolved_root="$(realpath "${BACKUP_DIR}")"
case "${resolved_backup}" in
  "${resolved_root}"/*.tar.gz) ;;
  *)
    echo "Backup must be a .tar.gz file inside ${resolved_root}."
    exit 1
    ;;
esac

archive_listing="$(tar -tzf "${resolved_backup}")"
if ! grep -qx 'deploy/aliyun_api.py' <<<"${archive_listing}"; then
  echo "Backup is invalid: deploy/aliyun_api.py is missing."
  exit 1
fi
if ! grep -q '^pptx_report/' <<<"${archive_listing}"; then
  echo "Backup is invalid: pptx_report is missing."
  exit 1
fi

echo "Rolling back from ${resolved_backup}"
systemctl disable --now "${SERVICE_NAME}-planning" 2>/dev/null || true
systemctl stop "${SERVICE_NAME}"
rm -rf "${APP_DIR}/deploy" "${APP_DIR}/pptx_report"
rm -f "${APP_DIR}/RELEASE.json"
tar -xzf "${resolved_backup}" -C "${APP_DIR}"
"${APP_DIR}/venv/bin/pip" install -r "${APP_DIR}/deploy/requirements.txt"
python3 - <<'PY'
import json
import re
from pathlib import Path
metadata = json.loads(Path('/opt/surveykit-ppt/RELEASE.json').read_text())
service = Path('/etc/systemd/system/surveykit-ppt.service')
text = service.read_text()
for name, key in [('SURVEYKIT_RELEASE', 'version'), ('SURVEYKIT_COMMIT', 'revision'), ('SURVEYKIT_DEPLOYED_AT', 'deployed_at')]:
    value = str(metadata.get(key) or 'unknown')
    if not re.fullmatch(r'[A-Za-z0-9._:+-]+', value):
        raise ValueError('Invalid release metadata: ' + key)
    text = re.sub(r'^Environment=' + name + r'=.*$', 'Environment=' + name + '=' + value, text, flags=re.MULTILINE)
service.write_text(text)
nginx = Path('/etc/nginx/sites-available/surveykit-ppt')
if nginx.exists():
    nginx.write_text(nginx.read_text().replace('http://127.0.0.1:8002', 'http://127.0.0.1:8000'))
PY
systemctl daemon-reload
systemctl start "${SERVICE_NAME}"
for attempt in $(seq 1 20); do
  if curl --fail --silent --show-error http://127.0.0.1:8000/healthz; then
    nginx -t
    systemctl reload nginx
    echo
    echo "Rollback completed."
    exit 0
  fi
  sleep 1
done
echo "Rollback health check failed."
exit 1
