import * as L from './logica.js';

const VERSION = '5';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- configuración (por dispositivo) ----------
const CFG_DEF = { presupuesto: 30000, categorias: ['Comida', 'Combustible', 'Super', 'Misc'], clave: '' };
let cfg = { ...CFG_DEF };
try { cfg = { ...CFG_DEF, ...JSON.parse(localStorage.getItem('cfg') || '{}') }; } catch {}
const guardarCfg = () => localStorage.setItem('cfg', JSON.stringify(cfg));

// ---------- datos: IndexedDB, todo queda en el teléfono ----------
const base = new Promise((ok, mal) => {
  const r = indexedDB.open('registro', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => mal(r.error);
});
async function tx(modo, f) {
  const db = await base;
  return new Promise((ok, mal) => {
    const t = db.transaction('items', modo);
    const r = f(t.objectStore('items'));
    t.oncomplete = () => ok(r.result);
    // el error de la operación viene en el evento; t.error sigue null hasta que la transacción aborta
    t.onerror = t.onabort = (ev) => mal(ev.target.error || t.error || new Error('base de datos'));
  });
}
let items = [];
async function guardar(it) {
  if (!items.includes(it)) items.push(it);
  try { await tx('readwrite', (s) => s.put(it)); } catch (e) { aviso('No se pudo guardar: ' + motivo(e), 8000); }
}
async function borrar(it) {
  items = items.filter((i) => i !== it);
  try { await tx('readwrite', (s) => s.delete(it.id)); } catch (e) { aviso('No se pudo borrar: ' + motivo(e), 8000); }
}

// ---------- estado de la vista ----------
let tab = localStorage.getItem('tab') || 'comida';
let diaOff = 0;
let semOff = 0;

function aviso(txt, ms = 2200) {
  const a = $('#aviso');
  a.textContent = txt;
  a.classList.add('ver');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => a.classList.remove('ver'), ms);
}
// errores inesperados a la vista (en el iPhone no hay consola)
addEventListener('error', (e) => aviso('Error: ' + motivo(e), 8000));
addEventListener('unhandledrejection', (e) => aviso('Error: ' + motivo(e.reason), 8000));
function motivo(e) { return (e && (e.message || e.name)) || String(e); }

function render() {
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', b.dataset.tab === tab);
  $('#comida').hidden = tab !== 'comida';
  $('#gasto').hidden = tab !== 'gasto';
  renderComida();
  renderGasto();
}

function diaVisto() {
  const d = new Date();
  d.setDate(d.getDate() + diaOff);
  return d;
}

function renderComida() {
  const d = diaVisto();
  const k = L.diaClave(d);
  const del = items.filter((i) => i.tipo === 'comida' && L.diaClave(new Date(i.t)) === k).sort((a, b) => (a.t < b.t ? -1 : 1));
  const ok = del.filter((i) => i.estado === 'ok');
  const pend = del.length - ok.length;
  $('#c-dia').textContent = L.etiquetaDia(d, new Date());
  $('#c-sig').disabled = diaOff >= 0;
  $('#c-kcal').textContent = L.miles(L.sumar(ok, 'kcal'));
  $('#c-macros').textContent = ok.length || pend
    ? `P ${L.sumar(ok, 'p')} · C ${L.sumar(ok, 'c')} · G ${L.sumar(ok, 'g')}` + (pend ? ` · ${pend} sin estimar` : '')
    : '';
  $('#c-lista').innerHTML = del.length
    ? del.map((i) => {
        const porc = i.porcion && i.porcion !== 1 ? ` · ${L.fraccion(i.porcion)} porción` : '';
        const sub = i.estado === 'ok' ? `P${i.p} C${i.c} G${i.g}${porc}` : i.nota || 'estimando';
        const clase = i.estado === 'ok' ? '' : i.estado === 'error' ? 'error' : 'pendiente';
        return `<li class="${clase}" data-id="${i.id}"><span class="hora">${L.hora(new Date(i.t))}</span>` +
          `<span class="txt"><b>${esc(i.nombre || i.texto || 'Foto')}</b><small>${esc(sub)}</small></span>` +
          `<span class="num">${i.estado === 'ok' ? L.miles(i.kcal) : '…'}</span></li>`;
      }).join('')
    : '<li class="vacio">Nada anotado</li>';
}

function renderGasto() {
  const ini = L.inicioSemana(new Date());
  ini.setDate(ini.getDate() + 7 * semOff);
  const fin = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 7);
  const sem = items
    .filter((i) => i.tipo === 'gasto' && new Date(i.t) >= ini && new Date(i.t) < fin)
    .sort((a, b) => (a.t > b.t ? -1 : 1));
  const gastado = L.sumar(sem, 'monto');
  const quedan = cfg.presupuesto - gastado;
  $('#g-semana').textContent = semOff === 0 ? 'Esta semana' : L.etiquetaSemana(ini);
  $('#g-sig').disabled = semOff >= 0;
  $('#g-quedan').textContent = L.pesos(quedan);
  $('#g-quedan').classList.toggle('negativo', quedan < 0);
  $('#g-barra').classList.toggle('negativo', quedan < 0);
  $('#g-barra i').style.width = Math.max(0, cfg.presupuesto ? (100 * quedan) / cfg.presupuesto : 0) + '%'; // se vacía al gastar
  $('#g-de').textContent = `quedan de ${L.pesos(cfg.presupuesto)}` + (semOff === 0 ? '' : ` · gastado ${L.pesos(gastado)}`);
  $('#g-cats').innerHTML = cfg.categorias.map((c) => `<button type="button" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $('#g-cats').classList.toggle('listo', L.leerMonto($('#g-monto').value) > 0);
  $('#g-lista').innerHTML = sem.length
    ? sem.map((i) => {
        const d = new Date(i.t);
        return `<li data-id="${i.id}"><span class="hora">${L.diaCorto(d)}</span>` +
          `<span class="txt"><b>${esc(i.cat)}</b><small>${esc(i.detalle || L.hora(d))}</small></span>` +
          `<span class="num">${L.pesos(i.monto)}</span></li>`;
      }).join('')
    : '<li class="vacio">Sin gastos</li>';
}

// ---------- estimación de calorías (cola: espera internet si no hay) ----------
const aDataURL = (blob) => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => mal(r.error);
  r.readAsDataURL(blob);
});

async function achicar(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    // onload en vez de img.decode(): decode() falla con fotos grandes en algunos Safari
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('no se pudo abrir la imagen'));
      i.src = url;
    });
    const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    // texto (data URL), no Blob: Safari en iPhone falla al guardar Blobs en IndexedDB
    const url64 = c.toDataURL('image/jpeg', 0.75);
    if (!url64.startsWith('data:image/jpeg')) throw new Error('no se pudo achicar');
    return url64;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function estimar(it) {
  const imagen = typeof it.foto === 'string' ? it.foto : it.foto ? await aDataURL(it.foto) : null; // Blob = versiones antiguas
  const anterior = it.kcal != null ? L.describir(it) : '';
  let r;
  try {
    r = await fetch(L.URL_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(L.cuerpoEstimacion({ texto: it.texto, imagen, anterior, correccion: it.correccion })),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw { nota: 'sin conexión' };
  }
  // 4xx = no sirve reintentar solo (clave, saldo, pedido): queda en rojo hasta que la persona toque Reintentar.
  if (r.status === 402) throw { nota: 'sin saldo en OpenRouter', final: true };
  if (r.status === 401 || r.status === 403) throw { nota: 'clave inválida', final: true };
  if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw { nota: `error ${r.status}`, final: true };
  if (!r.ok) throw { nota: 'reintentando' };
  try {
    return L.leerEstimacion(await r.json());
  } catch {
    throw { nota: 'respuesta inválida', final: true };
  }
}

let ocupado = false;
async function procesarCola() {
  if (ocupado) return;
  ocupado = true;
  const vistos = new Set();
  try {
    for (;;) { // vuelve a buscar en cada vuelta: toma lo que se anotó mientras otra estimaba
      const it = items.find((i) => i.tipo === 'comida' && i.estado === 'pendiente' && !vistos.has(i));
      if (!it) break;
      vistos.add(it);
      if (!it.foto && !it.texto && !it.correccion) { Object.assign(it, { estado: 'error', nota: 'sin foto ni texto' }); await guardar(it); continue; }
      if (!cfg.clave) { it.nota = 'falta la clave (ajustes)'; continue; }
      if (!navigator.onLine) { it.nota = 'sin conexión'; continue; }
      it.nota = 'estimando';
      render();
      try {
        Object.assign(it, await estimar(it), { estado: 'ok', nota: '' });
        delete it.foto; // la foto solo sirve para estimar; corregir usa la estimación anterior
        delete it.correccion;
        delete it.detalle; // formato antiguo: ahora va en alimentos
      } catch (e) {
        it.nota = e.nota || 'sin conexión';
        if (e.final) it.estado = 'error';
      }
      if (items.includes(it)) await guardar(it); // si la borraron mientras estimaba, no revivirla
    }
  } finally {
    ocupado = false;
    render();
  }
}

function nuevaHora() {
  const t = new Date();
  t.setDate(t.getDate() + diaOff); // anotar en el día que se está mirando
  return t.toISOString();
}

// ---------- eventos ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('button, li[data-id]');
  if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; localStorage.setItem('tab', tab); render(); }
  else if (b.dataset.dia) { diaOff = Math.min(0, diaOff + Number(b.dataset.dia)); render(); }
  else if (b.dataset.sem) { semOff = Math.min(0, semOff + Number(b.dataset.sem)); render(); }
  else if (b.dataset.cat) anotarGasto(b.dataset.cat);
  else if (b.dataset.id) abrirEditar(b.dataset.id);
});

$('#c-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('#c-texto').value.trim();
  if (!texto) return;
  $('#c-texto').value = '';
  await guardar({ id: crypto.randomUUID(), tipo: 'comida', t: nuevaHora(), texto, estado: 'pendiente', nota: 'estimando' });
  render();
  procesarCola();
});

$('#c-foto').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  // la fila aparece al tiro; 'preparando' no lo toma la cola hasta tener la foto
  const it = { id: crypto.randomUUID(), tipo: 'comida', t: nuevaHora(), estado: 'preparando', nota: 'preparando foto' };
  await guardar(it);
  render();
  try {
    it.foto = await achicar(archivo);
  } catch (err) {
    try { it.foto = await aDataURL(archivo); } // sin achicar: Gemini acepta la original (incluso HEIC), solo pesa más
    catch (err2) { Object.assign(it, { estado: 'error', nota: 'no se pudo leer la foto: ' + motivo(err2) }); await guardar(it); render(); return; }
    it.nota = 'foto original (' + err.message + ')';
  }
  e.target.value = ''; // recién ahora: en Safari limpiar antes puede invalidar el archivo de la cámara
  if (!items.includes(it)) return;
  Object.assign(it, { estado: 'pendiente', nota: 'estimando' });
  await guardar(it);
  render();
  procesarCola();
});

$('#g-monto').addEventListener('input', (e) => {
  const n = L.leerMonto(e.target.value);
  e.target.value = n ? L.miles(n) : '';
  $('#g-cats').classList.toggle('listo', n > 0);
});

async function anotarGasto(cat) {
  const monto = L.leerMonto($('#g-monto').value);
  if (!monto) { $('#g-monto').focus(); return; }
  await guardar({ id: crypto.randomUUID(), tipo: 'gasto', t: new Date().toISOString(), monto, cat, detalle: $('#g-detalle').value.trim() });
  $('#g-monto').value = '';
  $('#g-detalle').value = '';
  document.activeElement.blur();
  semOff = 0;
  render();
  aviso(`${L.pesos(monto)} · ${cat}`);
}

// ---------- editar ----------
function abrirEditar(id) {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  const dlg = $('#editar');
  const f = dlg.querySelector('form');
  const cats = [...new Set([...cfg.categorias, it.cat].filter(Boolean))];
  const listo = it.tipo === 'comida' && it.estado === 'ok';
  // borrador de porciones: se aplica solo al tocar Guardar
  const b = { alimentos: structuredClone(L.alimentosDe(it)), porcion: it.porcion || 1 };
  let manual = false; // escribió kcal/P/C/G a mano: esos números mandan
  f.innerHTML = it.tipo === 'comida'
    ? `<label>Comida<input name="nombre" value="${esc(it.nombre || it.texto || '')}"></label>
       ${listo ? `<div class="porcion"><span>Porción</span><div class="mini">${[0.25, 0.5, 0.75, 1, 1.5, 2]
         .map((x) => `<button type="button" data-porc="${x}">${L.fraccion(x)}</button>`).join('')}</div></div>
       <ul class="alimentos"></ul>` : ''}
       <div class="grid4">
         <label>kcal<input name="kcal" inputmode="numeric" value="${it.kcal ?? ''}"></label>
         <label>P<input name="p" inputmode="numeric" value="${it.p ?? ''}"></label>
         <label>C<input name="c" inputmode="numeric" value="${it.c ?? ''}"></label>
         <label>G<input name="g" inputmode="numeric" value="${it.g ?? ''}"></label>
       </div>
       <label>Corrección<input name="correccion" placeholder="ej. era otra cosa" autocomplete="off"></label>
       <div class="acciones"><button value="borrar" class="peligro">Borrar</button>
         <button value="corregir">${it.estado === 'ok' ? 'Corregir' : 'Reintentar'}</button>
         <button value="guardar" class="primario">Guardar</button></div>`
    : `<label>Monto<input name="monto" inputmode="numeric" value="${L.miles(it.monto)}"></label>
       <label>Categoría<select name="cat">${cats.map((c) => `<option${c === it.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
       <label>Detalle<input name="detalle" value="${esc(it.detalle || '')}" autocomplete="off"></label>
       <div class="acciones"><button value="borrar" class="peligro">Borrar</button>
         <button value="guardar" class="primario">Guardar</button></div>`;
  dlg.onclose = async () => {
    const v = Object.fromEntries(new FormData(f));
    const accion = dlg.returnValue;
    dlg.returnValue = '';
    if (accion === 'borrar') await borrar(it);
    else if (accion === 'guardar' && it.tipo === 'gasto') {
      it.monto = L.leerMonto(v.monto) || it.monto;
      it.cat = v.cat;
      it.detalle = v.detalle.trim();
      await guardar(it);
    } else if (accion === 'guardar') {
      it.nombre = v.nombre.trim() || it.nombre;
      if (manual && v.kcal !== '') {
        const n = L.leerMonto;
        Object.assign(it, { alimentos: [{ nombre: it.nombre, gramos: 0, kcal: n(v.kcal), p: n(v.p), c: n(v.c), g: n(v.g), q: 1 }], porcion: 1 });
      } else if (listo) Object.assign(it, b);
      if (it.alimentos) {
        Object.assign(it, L.totales(it), { estado: 'ok', nota: '' });
        delete it.foto;
        delete it.detalle;
      }
      await guardar(it);
    } else if (accion === 'corregir') {
      const c = v.correccion.trim();
      if (!c && it.estado === 'ok') return;
      if (c) it.correccion = c;
      Object.assign(it, { estado: 'pendiente', nota: 'estimando' });
      await guardar(it);
      procesarCola();
    }
    render();
  };
  if (it.tipo === 'comida') {
    const campo = (k) => f.elements.namedItem(k);
    const pintar = () => {
      const t = L.totales(b);
      if (!manual) for (const k of ['kcal', 'p', 'c', 'g']) campo(k).value = t[k];
      f.querySelectorAll('[data-porc]').forEach((x) => x.classList.toggle('sel', Number(x.dataset.porc) === b.porcion));
      f.querySelector('.alimentos').innerHTML = b.alimentos.map((a, i) => {
        const k = b.porcion * a.q;
        return `<li><span class="txt"><b>${esc(a.nombre)}</b><small>${a.gramos ? Math.round(a.gramos * k) + ' g · ' : ''}${Math.round(a.kcal * k)} kcal</small></span>` +
          (b.alimentos.length > 1 ? `<span class="paso"><button type="button" data-al="${i}" data-d="-1" aria-label="Menos ${esc(a.nombre)}">−</button>` +
            `<b>${L.fraccion(a.q)}</b><button type="button" data-al="${i}" data-d="1" aria-label="Más ${esc(a.nombre)}">+</button></span>` : '') +
          '</li>';
      }).join('');
    };
    f.onclick = (e) => {
      const x = e.target.closest('[data-porc], [data-al]');
      if (!x) return;
      if (x.dataset.porc) b.porcion = Number(x.dataset.porc);
      else { const a = b.alimentos[x.dataset.al]; a.q = L.paso(a.q, Number(x.dataset.d)); }
      manual = false;
      pintar();
    };
    f.querySelector('.grid4').oninput = () => { manual = true; };
    if (listo) pintar();
  } else f.onclick = null;
  dlg.showModal();
}

// ---------- ajustes, respaldo y Excel ----------
$('#abrir-ajustes').addEventListener('click', () => {
  const f = $('#ajustes form');
  f.presupuesto.value = L.miles(cfg.presupuesto);
  f.categorias.value = cfg.categorias.join(', ');
  f.clave.value = cfg.clave;
  $('#version').textContent = `v${VERSION} · ${items.length} registros`;
  $('#ajustes').showModal();
});
$('#ajustes').addEventListener('close', () => {
  const f = $('#ajustes form');
  const cats = f.categorias.value.split(',').map((s) => s.trim()).filter(Boolean);
  const pegada = f.clave.value.trim();
  const clave = (pegada.match(/sk-or-[\w-]+/) || [pegada])[0]; // por si se pegó con texto alrededor
  if (clave !== cfg.clave) // clave nueva: reintentar solas las que fallaron por clave
    for (const it of items.filter((i) => i.estado === 'error' && i.nota === 'clave inválida')) { it.estado = 'pendiente'; guardar(it); }
  cfg = { presupuesto: L.leerMonto(f.presupuesto.value), categorias: cats.length ? cats : CFG_DEF.categorias, clave };
  guardarCfg();
  render();
  procesarCola();
});

async function compartir(nombre, texto, tipo) {
  const archivo = new File([texto], nombre, { type: tipo });
  if (navigator.canShare?.({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo] }); } catch (e) { if (e.name !== 'AbortError') aviso('No se pudo compartir'); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(archivo);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Siempre el archivo completo: el importador de Finanzas descarta las líneas que ya importó.
$('#exportar-excel').addEventListener('click', () => {
  const gastos = items.filter((i) => i.tipo === 'gasto').sort((a, b) => (a.t < b.t ? -1 : 1));
  compartir('gastos_app.txt', gastos.map(L.lineaExcel).join('\n') + '\n', 'text/plain');
});
$('#respaldar').addEventListener('click', () => {
  const sinFotos = items.map(({ foto, ...resto }) => resto);
  compartir(`registro-${L.diaClave(new Date())}.json`, JSON.stringify(sinFotos), 'application/json');
});
$('#restaurar').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  e.target.value = '';
  if (!archivo) return;
  let lista;
  try { lista = JSON.parse(await archivo.text()); } catch { aviso('Archivo inválido'); return; }
  if (!Array.isArray(lista)) { aviso('Archivo inválido'); return; }
  const ids = new Set(items.map((i) => i.id));
  let n = 0;
  for (const it of lista) {
    if (!it || typeof it.id !== 'string' || !['comida', 'gasto'].includes(it.tipo) || isNaN(new Date(it.t))) continue;
    if (ids.has(it.id)) continue; // lo que ya está en el teléfono manda
    if (it.tipo === 'comida' && it.estado !== 'ok') it.estado = 'error'; // sin foto no se puede estimar sola
    await guardar(it);
    n++;
  }
  render();
  aviso(`${n} restaurados`);
});

// ---------- inicio ----------
addEventListener('online', procesarCola);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); procesarCola(); } });
setInterval(() => { if (items.some((i) => i.estado === 'pendiente')) procesarCola(); }, 20000);
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

try { items = await tx('readonly', (s) => s.getAll()); } catch (e) { aviso('No se pudieron leer los datos: ' + motivo(e), 8000); }
for (const it of items.filter((i) => i.estado === 'preparando')) { // la app se cerró a mitad de una foto
  Object.assign(it, { estado: 'error', nota: 'la foto no alcanzó a guardarse' });
  guardar(it);
}
render();
procesarCola();
