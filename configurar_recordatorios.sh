#!/bin/zsh
# Activa los recordatorios de las 13:45 y 20:45 (una vez por teléfono): guarda los dos secretos en GitHub
# y manda una notificación de prueba. Mientras espera, en el iPhone: Registro → Ajustes → Recordatorios
# (copia el código; llega al Mac por el portapapeles universal).
set -euo pipefail
REPO=kapsit0/registro

gh secret set VAPID_PRIVADA --repo $REPO < ~/.config/registro/vapid_privada
echo "En el iPhone: Registro → Ajustes → Recordatorios. Esperando el código (2 min)…"
valido() { pbpaste | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["endpoint"].startswith("https://") and d["keys"]["p256dh"] and d["keys"]["auth"]' 2>/dev/null; }
for _ in {1..120}; do valido && break; sleep 1; done
valido || { echo "No llegó el código: cópialo en el iPhone y vuelve a correr esto."; exit 1; }
pbpaste | gh secret set PUSH_SUB --repo $REPO
gh workflow run recordatorio.yml --repo $REPO -f tipo=almuerzo
echo "Listo: en 1–2 min debería llegar «¿Qué almorzaste?» o «Hoy vas en …» al iPhone."
