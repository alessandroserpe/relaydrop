#!/bin/sh
# Run once from the repository root after building the image. No host Node/npm needed.
set -eu
image=${1:-relaydrop:local}
secrets="$PWD/.secrets"
if [ -e "$secrets/admin-token" ] || [ -e "$secrets/identities.json" ] || [ -e "$secrets/web-push.json" ]; then
  echo 'Configuration already exists. Keep it for restarts; do not run bootstrap again.' >&2
  exit 1
fi
mkdir -p "$secrets" "$PWD/data"
chmod 700 "$secrets" "$PWD/data"
bootstrap() {
  docker run --rm --user "$(id -u):$(id -g)" \
    --read-only --cap-drop ALL --security-opt no-new-privileges \
    -v "$secrets:/secrets" --entrypoint node "$image" "$@"
}
bootstrap src/cli.mjs init --token-file /secrets/admin-token
bootstrap src/cli.mjs identity-add me --name Personale --role recipient \
  --registry-file /secrets/identities.json --token-file /secrets/me-token
bootstrap src/cli.mjs identity-add agent --name Agente --role uploader \
  --registry-file /secrets/identities.json --token-file /secrets/agent-token
bootstrap scripts/init-web-push.mjs /secrets/web-push.json
echo 'Configuration ready in .secrets/. Save the credentials privately; use me-token on your devices.'
