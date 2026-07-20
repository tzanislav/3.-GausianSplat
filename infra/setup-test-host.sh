#!/usr/bin/env bash
set -euo pipefail

setup_dir=${1:?The remote setup directory is required.}
release_id=${2:?The release ID is required.}
root=/home/ubuntu/copyParty/gaussian-viewer
environment_file=/etc/gaussian-viewer.env

set_environment_value() {
  local key=$1
  local value=$2

  if sudo grep -q "^${key}=" "$environment_file"; then
    sudo sed -i "s|^${key}=.*|${key}=${value}|" "$environment_file"
  else
    printf '%s=%s\n' "$key" "$value" | sudo tee -a "$environment_file" >/dev/null
  fi
}

sudo install -o root -g root -m 600 "$setup_dir/.env" "$environment_file"
set_environment_value NODE_ENV production
set_environment_value PORT 3002
set_environment_value WEB_ORIGIN http://54.76.118.84:5173

sudo install -o root -g root -m 644 \
  "$setup_dir/gaussian-viewer-api.service" \
  /etc/systemd/system/gaussian-viewer-api.service
sudo install -o root -g root -m 644 \
  "$setup_dir/gaussian-viewer-test.conf" \
  /etc/nginx/sites-available/gaussian-viewer-test
sudo ln -sfn /etc/nginx/sites-available/gaussian-viewer-test \
  /etc/nginx/sites-enabled/gaussian-viewer-test

if [[ -e "$root/current" && ! -L "$root/current" ]]; then
  echo "Refusing to replace a non-symlink current path: $root/current" >&2
  exit 1
fi

ln -sfn "releases/$release_id" "$root/current"

sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now gaussian-viewer-api

for _ in {1..15}; do
  if curl --fail --silent --show-error http://127.0.0.1:3002/health; then
    break
  fi
  sleep 1
done

curl --fail --silent --show-error http://127.0.0.1:3002/health
sudo systemctl reload nginx
curl --fail --silent --show-error http://127.0.0.1:5173/api/health

rm -rf "$setup_dir"
echo "Test-host setup complete."
