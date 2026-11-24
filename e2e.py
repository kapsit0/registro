# Prueba de punta a punta: MOTOR=chrome|webkit uv run --with playwright --with pillow --with python-barcode python e2e.py <carpeta app> <carpeta capturas>
"""Prueba de punta a punta de Registro en Chrome (390 px): gasto, comida texto y foto con IA real, offline, edición, export."""
from datetime import datetime, timedelta
import re
import http.server, json, os, sys, threading, functools, time
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright, expect

APP = Path(sys.argv[1])
OUT = Path(sys.argv[2]); OUT.mkdir(exist_ok=True)
CLAVE = (Path.home() / ".config/comida/clave_openrouter").read_text().strip()

h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(APP))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_port}/"

# foto de prueba: una lata con texto legible
foto = OUT / "lata.jpg"
im = Image.new("RGB", (1600, 1200), "#c8102e"); d = ImageDraw.Draw(im)
f = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 150)
d.text((120, 400), "Coca-Cola", fill="white", font=f); d.text((120, 620), "lata 350 ml", fill="white", font=f)
im.save(foto, quality=90)

# foto de un código de barras solo (Coca-Cola lata Chile): sin OFF, la IA inventaba el producto
import barcode, io
from barcode.writer import ImageWriter
buf = io.BytesIO(); barcode.get("ean13", "780161000119", writer=ImageWriter()).write(buf)
barras = OUT / "barras.jpg"
lienzo = Image.new("RGB", (1400, 1000), "#d9d2c3"); lienzo.paste(Image.open(buf).convert("RGB"), (300, 380))
lienzo.rotate(6, fillcolor="#d9d2c3").save(barras, quality=80)

errores = []
with sync_playwright() as p:
    MOTOR = os.environ.get("MOTOR", "chrome")  # chrome | webkit (motor de Safari, emulando iPhone)
    if MOTOR == "webkit":
        nav = p.webkit.launch(headless=True)
        ctx = nav.new_context(**{**p.devices["iPhone 15"], "accept_downloads": True})
    else:
        nav = p.chromium.launch(channel="chrome", headless=True)
        ctx = nav.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, accept_downloads=True, has_touch=True)
    ctx.add_init_script("delete Navigator.prototype.canShare; delete Navigator.prototype.share")  # Chrome Mac sí tiene hoja de compartir; aquí probamos la descarga
    pg = ctx.new_page()
    pg.on("response", lambda r: r.status >= 400 and print("404:", r.url))
    pg.on("pageerror", lambda e: errores.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errores.append(m.text))
    pg.goto(URL)
    pg.evaluate("c => localStorage.setItem('cfg', JSON.stringify({presupuesto: 30000, categorias: ['Comida','Combustible','Super','Hogar','Misc'], clave: c}))", CLAVE)
    pg.evaluate("navigator.serviceWorker.ready")
    pg.reload()
    assert pg.evaluate("!!navigator.serviceWorker.controller"), "service worker no controla la página"

    # comida por texto (IA real)
    pg.fill("#c-texto", "1 plátano"); pg.press("#c-texto", "Enter")
    expect(pg.locator("#c-lista li[data-id] .num").first).not_to_have_text("…", timeout=30000)
    k1 = int(pg.text_content("#c-kcal").replace(".", ""))
    assert 60 < k1 < 200, k1

    # comida por foto (IA real, pasa por achicar → dataURL)
    pg.set_input_files("#c-foto", str(foto))
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(2)
    expect(pg.locator("#c-lista li[data-id] .num").nth(1)).not_to_have_text("…", timeout=30000)
    k2 = int(pg.text_content("#c-kcal").replace(".", "")) - k1
    assert 100 < k2 < 250, k2
    print("foto:", pg.locator("#c-lista li[data-id]").nth(1).locator("b").inner_text(), k2, "kcal")
    pg.screenshot(path=OUT / "comida-claro.png")

    # gasto
    pg.click("[data-tab=gasto]")
    pg.fill("#g-monto", "4500"); pg.fill("#g-detalle", "almuerzo"); pg.click("[data-cat=Comida]")
    expect(pg.locator("#g-quedan")).to_have_text("$ 25.500")
    pg.fill("#g-monto", "2000"); pg.click("[data-cat='Hogar']")
    expect(pg.locator("#g-quedan")).to_have_text("$ 23.500")
    dias = 7 - datetime.now().weekday()  # v16: cuánto queda por día (hoy incluido)
    if dias > 1:
        expect(pg.locator("#g-de")).to_contain_text("$ " + f"{round(23500 / dias):,}".replace(",", ".") + "/día")
    pg.screenshot(path=OUT / "gasto-claro.png")

    # offline: recarga desde la caché, anota igual, estima al volver
    ctx.set_offline(True)
    pg.reload()
    expect(pg.locator("#g-quedan")).to_have_text("$ 23.500")
    pg.click("[data-tab=comida]")
    pg.fill("#c-texto", "un yogurt natural"); pg.press("#c-texto", "Enter")
    expect(pg.locator("#c-lista li[data-id]").nth(2)).to_contain_text("sin conexión")
    pg.screenshot(path=OUT / "offline.png")
    ctx.set_offline(False)
    expect(pg.locator("#c-lista li[data-id] .num").nth(2)).not_to_have_text("…", timeout=40000)

    # editar a mano
    pg.click("#c-lista li[data-id] >> nth=0")
    pg.fill("#editar [name=kcal]", "100"); pg.click("#editar button[value=guardar]")
    expect(pg.locator("#c-lista li[data-id] .num").first).to_have_text("100")

    # persistencia en IndexedDB
    pg.reload()
    assert pg.locator("#c-lista li[data-id]").count() == 3

    # foto que no se puede abrir: la fila debe aparecer igual y terminar con un estado visible
    malo = OUT / "mala.jpg"; malo.write_bytes(b"esto no es una imagen")
    pg.set_input_files("#c-foto", str(malo))
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(4)
    expect(pg.locator("#c-lista li[data-id]").nth(3)).not_to_contain_text("preparando", timeout=30000)
    expect(pg.locator("#c-lista li[data-id]").nth(3)).not_to_contain_text("estimando", timeout=45000)
    print("foto mala:", pg.locator("#c-lista li[data-id]").nth(3).inner_text().replace("\n", " | "))
    expect(pg.locator("#c-lista li[data-id]").nth(3)).to_contain_text(re.compile(r"error 4\d\d · \S"))  # v24: con el motivo
    expect(pg.locator("#c-lista li[data-id]").nth(3).locator("img")).to_have_count(0)  # v20: sin miniatura rota
    pg.screenshot(path=OUT / "foto-mala.png")
    tipos = pg.evaluate("""() => new Promise(ok => { const r = indexedDB.open('registro'); r.onsuccess = () => {
      const q = r.result.transaction('items').objectStore('items').getAll(); q.onsuccess = () => ok(q.result.filter(i => i.foto).map(i => typeof i.foto)); }; })""")
    assert tipos == ["string"], f"foto guardada como {tipos} (debe ser texto, no Blob)"

    # punto de recordatorio: cambios sin guardar y lo último guardado hace más de 3 días
    pg.evaluate("localStorage.setItem('guardado', new Date(Date.now() - 5 * 864e5).toISOString())")
    pg.reload()
    expect(pg.locator("#abrir-ajustes")).to_have_class(re.compile("punto"))
    expect(pg.locator("#en-safari")).to_be_visible() if MOTOR == "webkit" else expect(pg.locator("#en-safari")).to_be_hidden()

    # Guardar en iCloud: gastos para el Excel + respaldo (en el Mac no hay hoja de compartir → 2 descargas)
    pg.click("#abrir-ajustes")
    expect(pg.locator("#version")).to_contain_text("guardado hace 5 días")
    expect(pg.locator("#saldo")).to_contain_text("Saldo OpenRouter: US$ ", timeout=10000)
    descargas = []
    pg.on("download", lambda d: descargas.append(d))
    pg.click("#guardar-icloud")
    pg.wait_for_timeout(2000)
    archivos = {d.suggested_filename: Path(d.path()).read_text() for d in descargas}
    assert sorted(archivos) == ["gastos_app.txt", "registro-respaldo.txt"], sorted(archivos)
    lineas = archivos["gastos_app.txt"].strip().split("\n")
    assert len(lineas) == 2 and lineas[0].endswith(";4500;Comida;almuerzo") and lineas[1].endswith(";2000;Hogar;"), lineas
    respaldo = json.loads(archivos["registro-respaldo.txt"])
    assert len(respaldo) == 6 and not any("foto" in i for i in respaldo), [(i["tipo"], "foto" in i) for i in respaldo]
    expect(pg.locator("#version")).to_contain_text("guardado hoy")
    expect(pg.locator("#abrir-ajustes")).not_to_have_class(re.compile("punto"))
    respaldo_ruta = OUT / "respaldo.txt"; respaldo_ruta.write_text(archivos["registro-respaldo.txt"])
    pg.set_input_files("#restaurar", str(respaldo_ruta))
    expect(pg.locator("#aviso")).to_contain_text("0 restaurados")  # ya estaban todos
    pg.click("#ajustes button[value=ok]")
    pg.click("[data-tab=gasto]")
    expect(pg.locator("#g-por-cat")).to_have_text("Comida $ 4.500 · Hogar $ 2.000")
    pg.click("[data-tab=comida]")

    # porciones sin escribir: ½ del plato y menos de un alimento
    pg.fill("#c-texto", "arroz con pollo"); pg.press("#c-texto", "Enter")
    fila = pg.locator("#c-lista li[data-id]", has_text="ollo")
    expect(fila.locator(".num")).not_to_have_text("…", timeout=30000)
    total = int(fila.locator(".num").inner_text().replace(".", ""))
    fila.click()
    assert pg.locator("#editar .alimentos li").count() >= 2, "no separó alimentos"
    pg.click("#editar [data-porc='0.5']")
    medio = int(pg.input_value("#editar [name=kcal]"))
    assert abs(medio - total / 2) <= 1, (total, medio)
    pg.locator("#editar .alimentos li").first.locator("button[data-d='-1']").click()
    expect(pg.locator("#editar .alimentos li").first.locator(".paso b")).to_have_text("¾")
    final = int(pg.input_value("#editar [name=kcal]"))
    assert final < medio, (medio, final)
    pg.screenshot(path=OUT / "porciones.png")
    pg.click("#editar button[value=guardar]")
    expect(fila).to_contain_text("½ porción")
    assert int(fila.locator(".num").inner_text().replace(".", "")) == final
    print(f"porciones: {total} → ½ {medio} → primer alimento ¾ {final}")

    # clave mala → "clave inválida"; al pegar la buena (con texto alrededor) se reintenta sola
    pg.click("#abrir-ajustes"); pg.fill("#ajustes [name=clave]", "sk-or-v1-malo"); pg.click("#ajustes button[value=ok]")
    pg.fill("#c-texto", "1 manzana"); pg.press("#c-texto", "Enter")
    fila = pg.locator("#c-lista li[data-id]", has_text="manzana")
    expect(fila).to_contain_text("clave inválida", timeout=30000)
    pg.click("#abrir-ajustes"); pg.fill("#ajustes [name=clave]", "Clave OpenRouter: " + CLAVE + " "); pg.click("#ajustes button[value=ok]")
    expect(pg.locator("#c-lista li[data-id]", has_text="anzana").locator(".num")).not_to_have_text("…", timeout=30000)
    assert pg.evaluate("JSON.parse(localStorage.cfg).clave") == CLAVE
    print("clave nueva: reintentó solo")

    # v6: recientes sin internet + deshacer, galería, borrar con deshacer, meta, mover a ayer
    ctx.set_offline(True)
    pg.click("[data-tab=comida]")
    n0 = pg.locator("#c-lista li[data-id]").count()
    k0 = int(pg.text_content("#c-kcal").replace(".", ""))
    chip = pg.locator("#c-recientes button", has_text="látano")
    expect(chip).to_have_count(1)
    chip.click()
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n0 + 1)
    assert int(pg.text_content("#c-kcal").replace(".", "")) > k0
    pg.click("#aviso button")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n0)
    os.utime(foto)  # de la galería cuenta la fecha del archivo (v21): que sea la de ahora
    pg.set_input_files("#c-foto-galeria", str(foto))
    expect(pg.locator("#c-lista li[data-id]").nth(n0)).to_contain_text("sin conexión")
    expect(pg.locator("#c-lista li[data-id]").nth(n0).locator("img.miniatura")).to_have_count(1)
    pg.locator("#c-lista li[data-id]").nth(n0).click(); pg.click("#editar button[value=borrar]")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n0)
    pg.click("#aviso button")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n0 + 1)
    pg.locator("#c-lista li[data-id]").nth(n0).click(); pg.click("#editar button[value=borrar]")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n0)
    ctx.set_offline(False)
    pg.click("#abrir-ajustes"); pg.fill("#ajustes [name=meta]", "2000"); pg.click("#ajustes button[value=ok]")
    expect(pg.locator("#c-barra")).to_be_visible()
    expect(pg.locator("#c-macros")).to_contain_text("quedan")
    pg.screenshot(path=OUT / "v6-comida.png")
    pg.locator("#c-lista li[data-id]", has_text="ogurt").click()
    pg.fill("#editar [name=t]", (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%dT08:00"))
    pg.click("#editar button[value=guardar]")
    expect(pg.locator("#c-lista li[data-id]", has_text="ogurt")).to_have_count(0)
    pg.click("[data-dia='-1']")
    expect(pg.locator("#c-lista li[data-id]", has_text="ogurt")).to_contain_text("08:00")
    pg.click("[data-dia='1']")
    print("v6: recientes, galería, deshacer, meta y hora ok")

    # v7: franja semanal, volver a hoy, gasto frecuente con deshacer
    expect(pg.locator("#c-semana button")).to_have_count(7)
    expect(pg.locator("#c-semana button.sel")).to_have_class(re.compile("con"))
    pg.click("[data-dia='-1']")
    expect(pg.locator("#c-semana button.sel")).to_have_class(re.compile("con"))  # ayer tiene el yogurt
    pg.click("#c-dia")
    expect(pg.locator("#c-dia")).to_have_text("Hoy")
    pg.click("[data-tab=gasto]")
    q0 = pg.text_content("#g-quedan")
    pg.locator("#g-recientes button", has_text="almuerzo").click()
    expect(pg.locator("#g-quedan")).not_to_have_text(q0)
    pg.click("#aviso button")
    expect(pg.locator("#g-quedan")).to_have_text(q0)
    pg.screenshot(path=OUT / "v7-gasto.png")
    pg.click("[data-tab=comida]")
    pg.screenshot(path=OUT / "v7-comida.png")
    print("v7: semana, hoy y gasto frecuente ok")

    # v13: al escribir se busca lo ya anotado (sin IA), Intro en editar = Guardar (antes tocaba Borrar)
    n0 = pg.locator("#c-lista li[data-id]").count()
    pg.fill("#c-texto", "PLATANO")
    expect(pg.locator("#c-recientes button")).to_have_count(1)
    pg.click("#c-recientes button")
    expect(pg.locator("#c-texto")).to_have_value("")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n0 + 1)
    pg.click("#aviso button")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n0)
    # v19: escribir tal cual algo ya anotado lo repite sin IA (sin internet queda listo al tiro, no «sin conexión»)
    ctx.set_offline(True)
    pg.fill("#c-texto", " 1 PLÁTANO"); pg.press("#c-texto", "Enter")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n0 + 1)
    expect(pg.locator("#c-lista li[data-id] .num").last).not_to_have_text("…")
    expect(pg.locator("#c-texto")).to_have_value("")
    pg.click("#aviso button")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n0)
    ctx.set_offline(False)
    pg.click("[data-tab=gasto]")
    # v22: Guardar un gasto exportado sin cambiarlo no toca su hora (antes perdía los segundos y el Excel lo duplicaba)
    horas = "() => new Promise(ok => { const r = indexedDB.open('registro'); r.onsuccess = () => { const q = r.result.transaction('items').objectStore('items').getAll(); q.onsuccess = () => ok(q.result.filter(i => i.tipo === 'gasto').map(i => i.t).sort()); }; })"
    antes = pg.evaluate(horas)
    pg.locator("#g-lista li[data-id]", has_text="almuerzo").click(); pg.click("#editar button[value=guardar]")
    expect(pg.locator("#aviso")).not_to_contain_text("Excel")
    assert pg.evaluate(horas) == antes, (antes, pg.evaluate(horas))
    pg.locator("#g-lista li[data-id]", has_text="Hogar").click()
    pg.fill("#editar [name=detalle]", "ampolleta"); pg.press("#editar [name=detalle]", "Enter")
    expect(pg.locator("#g-lista li[data-id]", has_text="ampolleta")).to_have_count(1)
    expect(pg.locator("#aviso")).to_contain_text("En el Excel, borra la fila anterior")  # v18: ya se había exportado
    pg.screenshot(path=OUT / "v18-aviso-excel.png")
    pg.click("[data-tab=comida]")
    if MOTOR == "chrome":  # deslizar: toques por DevTools
        cdp_t = ctx.new_cdp_session(pg)
        def deslizar(x0, x1, y=600):
            cdp_t.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y}]})
            for x in range(x0, x1, (x1 - x0) // 5):
                cdp_t.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
            cdp_t.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        deslizar(60, 330); expect(pg.locator("#c-dia")).to_have_text("Ayer")
        deslizar(330, 60); expect(pg.locator("#c-dia")).to_have_text("Hoy")
        deslizar(330, 60); expect(pg.locator("#c-dia")).to_have_text("Hoy")  # no pasa de hoy
    print("v13: buscar, Intro y deslizar ok")

    # v15: repetir en otro día lo dice; al volver a la app tras >5 min, vuelve a Hoy
    pg.click("[data-dia='-1']"); expect(pg.locator("#c-dia")).to_have_text("Ayer")
    expect(pg.locator("#c-texto")).to_have_attribute("placeholder", "¿Qué comiste ayer?")  # v16
    pg.locator("#c-recientes button").first.click()
    expect(pg.locator("#aviso")).to_contain_text("· ayer")
    pg.click("#aviso button")
    pg.evaluate("""() => { const real = Date.now; const oculta = (v) => Object.defineProperty(document, 'hidden', { value: v, configurable: true });
      oculta(true); document.dispatchEvent(new Event('visibilitychange'));
      Date.now = () => real() + 6 * 60e3; oculta(false); document.dispatchEvent(new Event('visibilitychange'));
      Date.now = real; delete document.hidden; }""")
    expect(pg.locator("#c-dia")).to_have_text("Hoy")
    expect(pg.locator("#c-texto")).to_have_attribute("placeholder", "¿Qué comiste?")
    # abrir un registro o Ajustes no enfoca un campo (en el iPhone abría el teclado encima de las porciones)
    pg.locator("#c-lista li[data-id]").first.click()
    assert pg.evaluate("document.activeElement.tagName") == "FORM"
    pg.keyboard.press("Escape")
    pg.click("#abrir-ajustes")
    assert pg.evaluate("document.activeElement.tagName") == "FORM"
    pg.keyboard.press("Escape")
    print("v15: otro día avisado, vuelta a hoy y sin teclado al abrir ok")

    # v14: código de barras → Open Food Facts (154 kcal la lata de 350 ml)
    pg.set_input_files("#c-foto", str(barras))
    fila = pg.locator("#c-lista li[data-id]").last  # la más nueva (la lata de la primera foto también dice Coca)
    expect(fila.locator(".num")).to_have_text("154", timeout=40000)
    expect(fila).to_contain_text("Coca-Cola")
    print("v14: código de barras →", fila.inner_text().replace("\n", " | "))

    # v17: varias fotos de la galería, cada una a la hora en que se sacó (EXIF de hoy o ayer); sin internet = sin IA
    def foto_exif(nombre, cuando, color):
        ex = Image.Exif(); ex.get_ifd(0x8769)[0x9003] = cuando.strftime("%Y:%m:%d %H:%M:%S")
        ruta = OUT / nombre; Image.new("RGB", (900, 700), color).save(ruta, exif=ex); return str(ruta)
    ayer = datetime.now() - timedelta(days=1)
    dos = [foto_exif("exif1.jpg", ayer.replace(hour=13, minute=10), "#c9a36b"), foto_exif("exif2.jpg", ayer.replace(hour=8, minute=5), "#8fb36b")]
    vieja = foto_exif("vieja.jpg", datetime.now() - timedelta(days=5), "#6b8fb3")  # más vieja que ayer: se anota hoy
    ctx.set_offline(True)
    pg.click("[data-dia='-1']"); n_ayer = pg.locator("#c-lista li[data-id]").count()
    pg.click("#c-dia"); n_hoy = pg.locator("#c-lista li[data-id]").count()
    pg.set_input_files("#c-foto-galeria", dos)
    expect(pg.locator("#c-dia")).to_have_text("Ayer")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n_ayer + 2)
    for hh in ["13:10", "08:05"]:
        f = pg.locator("#c-lista li[data-id]", has_text=hh)
        expect(f).to_contain_text("sin conexión")
        f.click(); pg.click("#editar button[value=borrar]")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n_ayer)
    # sin EXIF: la fecha del archivo (de ayer); una recién creada (= momento de elegirla) no cuenta
    sin_exif = OUT / "sin_exif.jpg"; Image.new("RGB", (900, 700), "#b36b8f").save(sin_exif)
    t_ayer = ayer.replace(hour=19, minute=40).timestamp(); os.utime(sin_exif, (t_ayer, t_ayer))
    pg.click("#c-dia")
    pg.set_input_files("#c-foto-galeria", str(sin_exif))
    expect(pg.locator("#c-dia")).to_have_text("Ayer")
    f = pg.locator("#c-lista li[data-id]", has_text="19:40"); expect(f).to_have_count(1)
    f.click(); pg.click("#editar button[value=borrar]")
    pg.click("#c-dia")
    pg.set_input_files("#c-foto-galeria", vieja)
    expect(pg.locator("#c-dia")).to_have_text("Hoy")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n_hoy + 1)
    pg.locator("#c-lista li[data-id]").last.click(); pg.click("#editar button[value=borrar]")
    expect(pg.locator("#c-lista li[data-id]")).to_have_count(n_hoy)
    ctx.set_offline(False)
    print("v17: fotos de la galería a su hora ok")

    # v23: 402 «in_flight» (hay saldo, pero no para varias a la vez) se reintenta solo: no queda en rojo ni dice «sin saldo»
    # solo Chrome: en WebKit, con el service worker activo, page.route no alcanza la llamada a OpenRouter
    if MOTOR == "chrome":
        API = "https://openrouter.ai/api/v1/chat/completions"
        cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST"}
        def en_vuelo(route):
            if route.request.method == "OPTIONS": return route.fulfill(status=204, headers=cors)
            route.fulfill(status=402, headers=cors, content_type="application/json",
                          body=json.dumps({"error": {"code": 402, "message": "in flight", "metadata": {"reason": "in_flight_budget_exhausted"}}}))
        pg.route(API, en_vuelo)
        pg.fill("#c-texto", "1 kiwi"); pg.press("#c-texto", "Enter")
        fila = pg.locator("#c-lista li[data-id]", has_text="kiwi")
        expect(fila).to_contain_text("reintentando")
        expect(fila).not_to_have_class(re.compile("error"))
        pg.unroute(API)
        pg.evaluate("dispatchEvent(new Event('online'))")
        expect(fila.locator(".num")).not_to_have_text("…", timeout=30000)
        print("v23: 402 in_flight se reintenta solo ok")

    # push de recordatorio (solo Chrome: entrega el push por DevTools y revisa la notificación)
    if MOTOR == "chrome":
        ctx.grant_permissions(["notifications"], origin=URL.rstrip("/"))
        cdp = ctx.new_cdp_session(pg)
        regs = []
        cdp.on("ServiceWorker.workerRegistrationUpdated", lambda e: regs.extend(e["registrations"]))
        cdp.send("ServiceWorker.enable")
        pg.wait_for_timeout(800)
        reg_id = next(r["registrationId"] for r in regs if r["scopeURL"].startswith(URL) and not r["isDeleted"])
        cdp.send("ServiceWorker.deliverPushMessage", {"origin": URL.rstrip("/"), "registrationId": reg_id, "data": json.dumps({"tipo": "cena"})})
        pg.wait_for_timeout(2000)
        notis = pg.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.map(n => [n.title, n.body]))")
        assert notis and "kcal" in notis[-1][0] + notis[-1][1] and "esta semana" in notis[-1][1], notis
        print("push:", notis[-1])

    # modo oscuro
    pg.emulate_media(color_scheme="dark")
    pg.screenshot(path=OUT / "comida-oscuro.png")
    pg.click("#c-lista li[data-id] >> nth=1")
    pg.screenshot(path=OUT / "editar-oscuro.png")
    pg.keyboard.press("Escape")
    pg.click("[data-tab=gasto]")
    pg.screenshot(path=OUT / "gasto-oscuro.png")
    nav.close()

print("export:", lineas)
errores = [e for e in errores if not any(f"status of {c}" in e for c in (400, 401, 402))]  # foto mala, clave mala y 402 simulado: esperados
assert not errores, errores
print("e2e: ok")
