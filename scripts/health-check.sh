#!/usr/bin/env bash
# Health check for the local content-intelligence-platform stack.
# Usage: bash scripts/health-check.sh [--watch]
# --watch: keep checking every 10s until everything is healthy.

check() {
  local ok=1

  echo "=== Docker Desktop ==="
  if docker ps >/dev/null 2>&1; then
    echo "[OK] Docker daemon respondendo"
  else
    local svc_status
    svc_status=$(powershell.exe -NoProfile -Command "(Get-Service -Name 'com.docker.service' -ErrorAction SilentlyContinue).Status" 2>/dev/null | tr -d '\r')
    echo "[FALHA] Docker daemon nao responde (servico com.docker.service: ${svc_status:-desconhecido})"
    if [ "$svc_status" = "Stopped" ]; then
      echo "        -> precisa iniciar o servico com privilegio de administrador (abra 'Docker Desktop' como administrador uma vez, ou rode 'services.msc' e inicie 'Docker Desktop Service')"
    fi
    ok=0
  fi

  echo ""
  echo "=== Containers (postgres/redis) ==="
  if docker ps >/dev/null 2>&1; then
    local ps_out
    ps_out=$(docker compose -f "$(dirname "$0")/../docker-compose.yml" ps 2>&1)
    echo "$ps_out"
    echo "$ps_out" | grep -q "postgres.*Up" || { echo "[FALHA] postgres nao esta Up"; ok=0; }
    echo "$ps_out" | grep -q "redis.*Up" || { echo "[FALHA] redis nao esta Up"; ok=0; }
  else
    echo "(pulado - docker daemon indisponivel)"
    ok=0
  fi

  echo ""
  echo "=== Backend (localhost:4000) ==="
  if curl -s -m 3 -o /dev/null -w "HTTP_STATUS:%{http_code}\n" http://localhost:4000/health 2>&1 | grep -q "HTTP_STATUS:200"; then
    echo "[OK] /health respondeu 200"
  else
    echo "[FALHA] backend nao respondeu em localhost:4000/health"
    ok=0
  fi

  echo ""
  echo "=== Frontend (localhost:3000) ==="
  if curl -s -m 3 -o /dev/null -w "HTTP_STATUS:%{http_code}\n" http://localhost:3000/ 2>&1 | grep -qE "HTTP_STATUS:(200|30[0-9])"; then
    echo "[OK] frontend respondeu"
  else
    echo "[FALHA] frontend nao respondeu em localhost:3000"
    ok=0
  fi

  echo ""
  if [ "$ok" = "1" ]; then
    echo "RESULTADO: tudo saudavel"
  else
    echo "RESULTADO: algo precisa de atencao (veja FALHAs acima)"
  fi
  return $((1 - ok))
}

if [ "$1" = "--watch" ]; then
  while true; do
    clear
    date
    check
    if [ $? -eq 0 ]; then
      echo ""
      echo "Tudo pronto. Encerrando watch."
      break
    fi
    sleep 10
  done
else
  check
fi
