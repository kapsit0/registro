"""Envía el push de recordatorio a los teléfonos suscritos (GitHub Actions, .github/workflows/recordatorio.yml).

Secretos: PUSH_SUB (JSON de la suscripción, uno por línea si hay varios teléfonos) y VAPID_PRIVADA.
El texto lo arma el teléfono (recordatorio.js en el service worker); aquí solo va {"tipo": "almuerzo"|"cena"}.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

CHILE = ZoneInfo("America/Santiago")
HORAS = {13: "almuerzo", 20: "cena"}  # hora local de Chile → tipo


def tipo_programado(cron, ahora_utc):
    """Qué toca según el cron que disparó (no la hora real: GitHub puede partir con atraso).

    Hay crons para verano (UTC−3) e invierno (UTC−4); el que no cae a las 13 o 20 en Chile no envía nada.
    """
    minuto, hora = (int(x) for x in cron.split()[:2])
    previsto = ahora_utc.replace(hour=hora, minute=minuto, second=0, microsecond=0)
    if previsto > ahora_utc + timedelta(minutes=5):  # el atraso cruzó la medianoche UTC
        previsto -= timedelta(days=1)
    return HORAS.get(previsto.astimezone(CHILE).hour)


def main():
    tipo = os.environ.get("TIPO") or tipo_programado(os.environ.get("CRON", ""), datetime.now(timezone.utc))
    if not tipo:
        print("no toca a esta hora en Chile")
        return
    from pywebpush import WebPushException, webpush

    subs = [json.loads(l) for l in os.environ.get("PUSH_SUB", "").splitlines() if l.strip()]
    if not subs:
        print("sin PUSH_SUB: activa los recordatorios en la app y guarda el código como secreto")
        return
    errores = 0
    for sub in subs:
        try:
            r = webpush(sub, json.dumps({"tipo": tipo}), vapid_private_key=os.environ["VAPID_PRIVADA"],
                        vapid_claims={"sub": "https://kapsit0.github.io/registro/"}, ttl=3 * 3600)
            print(tipo, "→", r.status_code)
        except WebPushException as e:
            errores += 1
            print(tipo, "falló:", e.response.status_code if e.response is not None else e)
    sys.exit(1 if errores else 0)


if __name__ == "__main__":
    if sys.argv[1:] == ["--probar"]:
        u = lambda h, m=45, d=24: datetime(2026, 11, d, h, m, tzinfo=timezone.utc)  # noviembre: Chile UTC−3
        assert tipo_programado("45 16 * * *", u(16)) == "almuerzo"
        assert tipo_programado("45 16 * * *", u(17, 20)) == "almuerzo"  # con 35 min de atraso
        assert tipo_programado("45 17 * * *", u(17)) is None  # el cron de invierno no envía en verano
        assert tipo_programado("45 23 * * *", u(23)) == "cena"
        assert tipo_programado("45 23 * * *", u(0, 10, 25)) == "cena"  # atraso que cruza medianoche UTC
        assert tipo_programado("45 0 * * *", u(0, 50)) is None
        j = lambda h, m=45, d=24: datetime(2026, 6, d, h, m, tzinfo=timezone.utc)  # junio: Chile UTC−4
        assert tipo_programado("45 17 * * *", j(17)) == "almuerzo"
        assert tipo_programado("45 0 * * *", j(0, 50)) == "cena"
        assert tipo_programado("45 16 * * *", j(16)) is None
        print("enviar_recordatorio.py: ok")
    else:
        main()
