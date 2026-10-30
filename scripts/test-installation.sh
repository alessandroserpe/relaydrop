#!/usr/bin/env bash
# Destructive fixture paths are restricted to a disposable GitHub-hosted Linux runner.
set -euo pipefail
set +x
if [[ ${GITHUB_ACTIONS:-} != true || ${RUNNER_ENVIRONMENT:-} != github-hosted || $(uname -s) != Linux ]]; then
  echo 'Run this installation fixture only on a disposable GitHub-hosted Linux runner.' >&2
  exit 1
fi
repo=$PWD
fixture_root=$(mktemp -d)
service=relaydrop-install-check
code=/opt/relaydrop-install-check
secrets=/etc/relaydrop-install-check
data=/var/lib/relaydrop-install-check
container=relaydrop-install-check
origin=https://127.0.0.1:9443
node_bin=$(command -v node)
caddy_pid=
test ! -e "$code" && test ! -e "$secrets" && test ! -e "$data"
cleanup() {
  docker stop --time 20 "$container" >/dev/null 2>&1 || true
  sudo systemctl stop "$service" >/dev/null 2>&1 || true
  if [[ -n $caddy_pid ]]; then kill "$caddy_pid" 2>/dev/null || true; wait "$caddy_pid" 2>/dev/null || true; fi
  sudo rm -f "/etc/systemd/system/$service.service"
  sudo systemctl daemon-reload
  sudo rm -rf "$code" "$secrets" "$data"
  sudo userdel "$service" >/dev/null 2>&1 || true
  rm -rf "$fixture_root"
}
trap cleanup EXIT

# Install the same source/unit as the guide, with fixture-only paths and account.
sudo useradd --system --user-group --home-dir "$data" --shell /usr/sbin/nologin "$service"
sudo install -d -m 755 "$code"
git archive HEAD | sudo tar -x -C "$code"
sudo env "PATH=$(dirname "$node_bin"):/usr/bin:/bin" npm ci --prefix "$code" --omit=dev --ignore-scripts
sudo install -d -m 700 -o "$service" -g "$service" "$secrets"
sudo -u "$service" "$node_bin" "$code/src/cli.mjs" init --token-file "$secrets/admin-token"
for identity in me agent; do
  role=recipient; [[ $identity != agent ]] || role=uploader
  sudo -u "$service" "$node_bin" "$code/src/cli.mjs" identity-add "$identity" --name "$identity" --role "$role" --registry-file "$secrets/identities.json" --token-file "$secrets/$identity-token"
done
sudo -u "$service" "$node_bin" "$code/scripts/init-web-push.mjs" "$secrets/web-push.json"
sed -e "s|/usr/bin/node|$node_bin|g" -e "s|/opt/relaydrop|$code|g" \
  -e "s|/etc/relaydrop|$secrets|g" -e "s|/var/lib/relaydrop|$data|g" \
  -e "s|https://files.example.com|$origin|g" \
  -e "s|^User=relaydrop$|User=$service|" -e "s|^Group=relaydrop$|Group=$service|" \
  -e "s|^StateDirectory=relaydrop$|StateDirectory=$service|" \
  deploy/relaydrop.service > "$fixture_root/unit"
sudo install -m 644 "$fixture_root/unit" "/etc/systemd/system/$service.service"
sudo systemd-analyze verify "/etc/systemd/system/$service.service"
sudo systemctl daemon-reload
sudo systemctl start "$service"
sudo systemctl is-active --quiet "$service"

# Test HTTPS with an isolated CA. Never install it into system trust or disable TLS verification.
caddy_version=2.11.7
archive="caddy_${caddy_version}_linux_amd64.tar.gz"
curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${caddy_version}/$archive" -o "$fixture_root/$archive"
curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${caddy_version}/caddy_${caddy_version}_checksums.txt" -o "$fixture_root/checksums"
(cd "$fixture_root" && sha512sum --check --ignore-missing checksums && tar -xzf "$archive" caddy)
export XDG_DATA_HOME="$fixture_root/caddy-data" XDG_CONFIG_HOME="$fixture_root/caddy-config"
"$fixture_root/caddy" validate --config "$repo/deploy/Caddyfile" --adapter caddyfile
{
  printf '{\n admin off\n skip_install_trust\n auto_https disable_redirects\n}\n'
  sed -e "s|files.example.com {|$origin {|" -e '/^https:/a\    tls internal\n    bind 127.0.0.1' deploy/Caddyfile
} > "$fixture_root/Caddyfile"
"$fixture_root/caddy" run --config "$fixture_root/Caddyfile" --adapter caddyfile > "$fixture_root/caddy.log" 2>&1 &
caddy_pid=$!
export NODE_EXTRA_CA_CERTS="$XDG_DATA_HOME/caddy/pki/authorities/local/root.crt"
ready() {
  for attempt in $(seq 1 100); do
    if [[ -f $NODE_EXTRA_CA_CERTS ]] && curl -fsS --cacert "$NODE_EXTRA_CA_CERTS" "$origin/healthz" >/dev/null 2>&1; then return; fi
    sleep .2
  done
  echo 'Disposable HTTPS fixture failed to become ready.' >&2
  cat "$fixture_root/caddy.log" >&2
  return 1
}
ready
mkdir -m 700 "$fixture_root/systemd-secrets"
for identity in admin me agent; do sudo install -m 600 -o "$(id -u)" -g "$(id -g)" "$secrets/$identity-token" "$fixture_root/systemd-secrets/"; done
node scripts/verify-installation.mjs --server "$origin" --secrets "$fixture_root/systemd-secrets" --cli "$code/src/cli.mjs"
sudo systemctl restart "$service"
ready
node scripts/verify-installation.mjs --phase resume --server "$origin" --secrets "$fixture_root/systemd-secrets" --cli "$code/src/cli.mjs"
sudo systemctl stop "$service"
test "$(sudo stat -c %a "$data")" = 700
test "$(sudo stat -c %a "$secrets/admin-token")" = 600
test "$(sudo stat -c %a "$secrets/web-push.json")" = 600

# Docker bootstrap starts without any host node_modules in its working directory.
docker build -t relaydrop:install-check .
mkdir "$fixture_root/docker"
(cd "$fixture_root/docker" && sh "$repo/deploy/bootstrap-container.sh" relaydrop:install-check)
test ! -d "$fixture_root/docker/node_modules"
if (cd "$fixture_root/docker" && sh "$repo/deploy/bootstrap-container.sh" relaydrop:install-check); then
  echo 'Bootstrap incorrectly allowed overwriting an existing configuration.' >&2; exit 1
fi
for file in admin-token me-token agent-token identities.json web-push.json; do
  test "$(stat -c %a "$fixture_root/docker/.secrets/$file")" = 600
done
start_container() {
  docker run -d --rm --name "$container" --stop-timeout 20 --user "$(id -u):$(id -g)" \
    --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --pids-limit 128 \
    -p 127.0.0.1:8787:8787 -e "RELAYDROP_URL=$origin" \
    -e RELAYDROP_TOKEN_FILE=/run/secrets/admin-token \
    -e RELAYDROP_IDENTITIES_FILE=/run/secrets/identities.json \
    -e RELAYDROP_WEB_PUSH_FILE=/run/secrets/web-push.json \
    -v "$fixture_root/docker/.secrets:/run/secrets:ro" -v "$fixture_root/docker/data:/data" \
    relaydrop:install-check >/dev/null
}
start_container
ready
node scripts/verify-installation.mjs --server "$origin" --secrets "$fixture_root/docker/.secrets" --cli "$code/src/cli.mjs"
docker stop --time 20 "$container" >/dev/null
start_container
ready
node scripts/verify-installation.mjs --phase resume --server "$origin" --secrets "$fixture_root/docker/.secrets" --cli "$code/src/cli.mjs"
echo 'Installation checks passed: systemd, Docker, verified HTTPS, credentials, encrypted transfer and restart persistence.'
