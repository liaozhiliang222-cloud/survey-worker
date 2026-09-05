#!/usr/bin/env bash
set -euo pipefail
test "${EUID}" -eq 0
test -s /etc/surveykit-data.env
test -f lib/data-jobs.mjs
ROOT=/opt/surveykit-data
NODE_VERSION=24.17.0
NODE_NAME="node-v${NODE_VERSION}-linux-x64"
mkdir -p "${ROOT}"
if [[ ! -x "${ROOT}/${NODE_NAME}/bin/node" ]]; then
  stage=$(mktemp -d /tmp/surveykit-node.XXXXXX)
  curl --fail --silent --show-error --retry 2 "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_NAME}.tar.xz" -o "${stage}/${NODE_NAME}.tar.xz"
  curl --fail --silent --show-error --retry 2 "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "${stage}/SHASUMS256.txt"
  (cd "${stage}" && grep " ${NODE_NAME}.tar.xz$" SHASUMS256.txt | sha256sum --check -)
  tar -xJf "${stage}/${NODE_NAME}.tar.xz" -C "${ROOT}"
fi
export PATH="${ROOT}/${NODE_NAME}/bin:${PATH}"
revision="${SURVEYKIT_COMMIT:?Missing release revision}"
[[ "${revision}" =~ ^[a-f0-9]{40}$ ]]
release="${ROOT}/releases/${revision}"
mkdir -p "${release}/deploy" "${release}/src"
cp -a lib "${release}/"
cp -a src/shared "${release}/src/"
cp package.json package-lock.json "${release}/"
cp deploy/data-executor.mjs deploy/data-executor-child.mjs "${release}/deploy/"
(cd "${release}" && npm ci --omit=dev --ignore-scripts)
if [[ -L "${ROOT}/current" ]]; then readlink "${ROOT}/current" > "${ROOT}/previous-release"; fi
ln -sfn "${release}" "${ROOT}/current"
chmod 600 /etc/surveykit-data.env
cat > /etc/systemd/system/surveykit-data.service <<EOF
[Unit]
Description=SurveyKit durable data executor
After=network-online.target
Wants=network-online.target
[Service]
WorkingDirectory=${ROOT}/current
EnvironmentFile=/etc/surveykit-data.env
Environment=SURVEYKIT_COMMIT=${revision}
Environment=SURVEYKIT_HEAVY_LOCK=/tmp/surveykit-heavy.lock
ExecStart=${ROOT}/${NODE_NAME}/bin/node deploy/data-executor.mjs
Restart=always
RestartSec=5
MemoryMax=512M
MemorySwapMax=0
CPUQuota=80%
TasksMax=64
KillMode=control-group
TimeoutStopSec=10
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/tmp
PrivateTmp=false
[Install]
WantedBy=multi-user.target
EOF
mkdir -p /etc/systemd/system/surveykit-ppt.service.d
cat > /etc/systemd/system/surveykit-ppt.service.d/zzz-heavy-lock.conf <<EOF
[Service]
Environment=SURVEYKIT_HEAVY_LOCK=/tmp/surveykit-heavy.lock
PrivateTmp=false
EOF
systemctl daemon-reload
systemctl enable --now surveykit-data
systemctl restart surveykit-data
echo 'Data executor installed; HTTP and queue verification must follow Pages activation.'
