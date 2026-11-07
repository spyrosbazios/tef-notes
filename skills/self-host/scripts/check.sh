#!/bin/sh
# Preflight for self-hosting TEF Notes: docker, compose v2, docker without sudo, free ports. Read-only.
# Ports come from PB_PORT / AGENT_PORT in the environment (defaults 8097 / 8098, as in server/.env.example).
fail=0
bad() { echo "FAIL: $1"; fail=1; }

command -v docker >/dev/null 2>&1 || { bad "docker is not installed"; exit 1; }
docker compose version >/dev/null 2>&1 || bad "docker compose v2 missing (the 'docker compose' plugin, not docker-compose)"
docker info >/dev/null 2>&1 || bad "cannot talk to the docker daemon without sudo (daemon down, or user not in the docker group)"

for port in "${PB_PORT:-8097}" "${AGENT_PORT:-8098}"; do
  if command -v ss >/dev/null 2>&1; then
    ss -ltn | awk '{print $4}' | grep -q ":$port\$" && bad "port $port is already in use"
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1 && bad "port $port is already in use"
  else
    echo "note: neither ss nor nc found, port $port not checked"
  fi
done

[ "$fail" -eq 0 ] && echo "ok: docker, compose v2 and ports ${PB_PORT:-8097}/${AGENT_PORT:-8098} are fine"
exit "$fail"
