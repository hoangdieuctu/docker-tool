#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/docker-tool"
PORT=3000
SERVICE="docker-tool"

echo "==> Pulling latest code..."
sudo git -C "$APP_DIR" pull

echo "==> Installing dependencies..."
sudo npm install --prefix "$APP_DIR" --omit=dev

echo "==> Writing systemd service..."
sudo tee /etc/systemd/system/${SERVICE}.service > /dev/null <<EOF
[Unit]
Description=Docker Tool
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(which node) $APP_DIR/server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT

[Install]
WantedBy=multi-user.target
EOF

echo "==> Enabling and starting service..."
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE"
sudo systemctl restart "$SERVICE"

echo ""
echo "Done. docker-tool is running on port $PORT."
echo "To check status: systemctl status $SERVICE"
echo "To view logs:    journalctl -u $SERVICE -f"
echo ""
echo "To redeploy later, just run this script again — it will git pull and restart."
