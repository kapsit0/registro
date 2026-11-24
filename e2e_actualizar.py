# MOTOR=chrome|webkit python e2e_actualizar.py <carpeta app>
"""¿Aparece «Versión nueva lista · Actualizar» cuando se publica otro sw.js? (sin IA)"""
import functools, http.server, os, shutil, sys, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

copia = Path(tempfile.mkdtemp())
for f in Path(sys.argv[1]).iterdir():
    if f.is_file():
        shutil.copy(f, copia)
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(copia))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    motor = os.environ.get("MOTOR", "chrome")
    nav = p.webkit.launch() if motor == "webkit" else p.chromium.launch(channel="chrome")
    pg = nav.new_page()
    pg.goto(f"http://127.0.0.1:{srv.server_port}/")
    pg.evaluate("navigator.serviceWorker.ready")
    pg.reload()
    assert pg.evaluate("!!navigator.serviceWorker.controller")
    expect(pg.locator("#aviso")).not_to_contain_text("Versión nueva")
    sw = copia / "sw.js"  # «publicar» otra versión
    sw.write_text(sw.read_text().replace("registro-", "registro-x"))
    os.utime(sw, (os.path.getmtime(sw) + 10,) * 2)  # http.server compara la fecha por segundos: si cae en el mismo, responde 304
    pg.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
    expect(pg.locator("#aviso")).to_contain_text("Versión nueva lista", timeout=15000)
    with pg.expect_navigation():
        pg.click("#aviso button")
    nav.close()
print(f"actualizar ({motor}): ok")
