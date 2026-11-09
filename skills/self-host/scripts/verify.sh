#!/bin/sh
# Health checks for a running TEF Notes server, from server/README.md "Deploy and verify". Prints no secret.
# Usage: verify.sh [origin]   origin defaults to http://localhost:$PB_PORT; the agent is probed on localhost:$AGENT_PORT
# when no origin is given, else at <origin>/agent (use the proxy's origin to test the path clients take).
pb="${1:-http://localhost:${PB_PORT:-8097}}"
if [ -n "$1" ]; then agent="${1%/}/agent"; else agent="http://localhost:${AGENT_PORT:-8098}/agent"; fi
fail=0
ok() { echo "ok:   $1"; }
bad() { echo "FAIL: $1"; fail=1; }

curl -fsS "${pb%/}/api/health" >/dev/null 2>&1 && ok "PocketBase /api/health" || bad "PocketBase /api/health"
curl -fsS "${pb%/}/" 2>/dev/null | grep -q '<title>' && ok "web app served at /" || bad "web app at /"
models=$(curl -fsS "$agent/models" 2>/dev/null) || models=
if [ -z "$models" ]; then bad "agent $agent/models unreachable"
elif echo "$models" | grep -q '"available": *true'; then ok "agent up, model provider key read"
else ok "agent up, but \"available\" is not true: the model provider's key is missing or unreadable (chat is off)"; fi
# Voice input: an empty clip loads no model, so this is cheap. 200: on and the stt container reachable; 404: off; 502: stt down.
voice=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/octet-stream' --data-binary '' "$agent/transcribe" 2>/dev/null) || voice=
case "$voice" in
  200) ok "voice input on, stt reachable" ;;
  404) ok "voice input off (TEF_NOTES_STT is empty)" ;;
  502) bad "voice input on, but the agent cannot reach the stt container (docker compose logs stt)" ;;
  *) bad "voice input: $agent/transcribe answered '$voice'" ;;
esac
exit "$fail"
