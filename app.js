import * as L from './logica.js';

const VERSION = '22';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- configuración (por dispositivo) ----------
const CFG_DEF = { presupuesto: 30000, meta: 0, categorias: ['Comida', 'Combustible', 'Super', 'Misc'], clave: '' };
let cfg = { ...CFG_DEF };
try { cfg = { ...CFG_DEF, ...JSON.parse(localStorage.getItem('cfg') || '{}') }; } catch {}
const guardarCfg = () => { localStorage.setItem('cfg', JSON.stringify(cfg)); espejoAjustes(); };

// ---------- datos: IndexedDB, todo queda en el teléfono ----------
const base = new Promise((ok, mal) => {
  const r = indexedDB.open('registro', 2); // v2: + 'ajustes' (copia para el service worker, que no lee localStorage)
  r.onupgradeneeded = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('ajustes')) db.createObjectStore('ajustes');
  };
  r.onsuccess = () => {
    r.result.onversionchange = () => r.result.close();
    ok(r.result);
  };
  r.onerror = () => mal(r.error);
});
// meta y presupuesto para el texto del recordatorio (sw.js); la clave no hace falta allá
async function espejoAjustes() {
  try { (await base).transaction('ajustes', 'readwrite').objectStore('ajustes').put({ presupuesto: cfg.presupuesto, meta: cfg.meta }, 'cfg'); } catch {}
}
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
// try: el contador del recordatorio nunca debe impedir que se guarde un registro
const marcarCambio = () => { try { localStorage.setItem('cambios', (Number(localStorage.getItem('cambios')) || 0) + 1); } catch {} };
async function guardar(it) {
  if (!items.includes(it)) items.push(it);
  marcarCambio();
  try { await tx('readwrite', (s) => s.put(it)); } catch (e) { aviso('No se pudo guardar: ' + motivo(e), 8000); }
}
async function borrar(it) {
  items = items.filter((i) => i !== it);
  marcarCambio();
  try { await tx('readwrite', (s) => s.delete(it.id)); } catch (e) { aviso('No se pudo borrar: ' + motivo(e), 8000); }
}

// ---------- estado de la vista ----------
let tab = localStorage.getItem('tab') || 'comida';
let diaOff = 0;
let semOff = 0;

// accion = ['Deshacer', fn]: el aviso muestra un botón mientras se ve
function aviso(txt, ms = 2200, accion) {
  const a = $('#aviso');
  a.textContent = txt;
  if (accion) {
    const b = document.createElement('button');
    b.textContent = accion[0];
    b.onclick = () => { a.classList.remove('ver'); accion[1](); };
    a.append(b);
  }
  a.classList.toggle('con-accion', !!accion);
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
  pintarGuardado();
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
  $('#c-texto').placeholder = `¿Qué comiste${diaOff === 0 ? '' : diaOff === -1 ? ' ayer' : ' el ' + L.diaCorto(d)}?`; // lo escrito va a ese día
  $('#c-sig').disabled = diaOff >= 0;
  // franja lun–dom de la semana que se mira: punto = ese día tiene comidas
  const ini = L.inicioSemana(d);
  const kcalDia = new Map();
  for (const i of items) if (i.tipo === 'comida' && i.estado === 'ok') {
    const k = L.diaClave(new Date(i.t));
    kcalDia.set(k, (kcalDia.get(k) || 0) + i.kcal);
  }
  const dias = [...'LMMJVSD'].map((letra, n) => ({ letra, dia: new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + n) }));
  const ref = cfg.meta || Math.max(1, ...dias.map((x) => kcalDia.get(L.diaClave(x.dia)) || 0)); // barra llena = meta (o el día más alto)
  poner($('#c-semana'), dias.map(({ letra, dia }) => {
    const off = diaOff + Math.round((dia - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    const kc = kcalDia.get(L.diaClave(dia)) || 0;
    const clases = [kc ? 'con' : '', off === diaOff ? 'sel' : ''].join(' ');
    return `<button type="button" class="${clases}" data-ir="${off}" ${off > 0 ? 'disabled' : ''} aria-label="${L.etiquetaDia(dia, new Date())}${kc ? ' · ' + L.miles(kc) + ' kcal' : ''}">` +
      `${letra}<i style="height:${kc ? 7 + Math.round(15 * Math.min(1, kc / ref)) : 7}px"></i></button>`;
  }).join(''));
  const kcal = L.sumar(ok, 'kcal');
  $('#c-kcal').textContent = L.miles(kcal);
  $('#c-barra').hidden = !cfg.meta;
  if (cfg.meta) {
    $('#c-barra i').style.width = Math.min(100, (100 * kcal) / cfg.meta) + '%';
    $('#c-barra').classList.toggle('negativo', kcal > cfg.meta);
  }
  const resto = cfg.meta ? (kcal <= cfg.meta ? `quedan ${L.miles(cfg.meta - kcal)}` : `${L.miles(kcal - cfg.meta)} sobre la meta`) : '';
  $('#c-macros').textContent = [
    ok.length ? `P ${L.sumar(ok, 'p')} · C ${L.sumar(ok, 'c')} · G ${L.sumar(ok, 'g')}` : '',
    resto,
    pend ? `${pend} sin estimar` : '',
  ].filter(Boolean).join(' · ');
  pintarRecientes();
  let grupo = '';
  poner($('#c-lista'), del.length
    ? del.map((i) => {
        const m = L.momento(new Date(i.t));
        let cab = '';
        if (m !== grupo) { // cabecera con subtotal, como en las apps de calorías
          grupo = m;
          const del_m = ok.filter((x) => L.momento(new Date(x.t)) === m);
          cab = `<li class="grupo"><span>${m}</span><span>${L.miles(L.sumar(del_m, 'kcal'))}</span></li>`;
        }
        const porc = i.porcion && i.porcion !== 1 ? ` · ${L.fraccion(i.porcion)} porción` : '';
        const sub = i.estado === 'ok' ? `P${i.p} C${i.c} G${i.g}${porc}` : i.nota || 'estimando';
        const clase = i.estado === 'ok' ? '' : i.estado === 'error' ? 'error' : 'pendiente';
        const mini = typeof i.foto === 'string' ? `<img class="miniatura" src="${esc(i.foto)}" alt="" onerror="this.remove()">` : ''; // solo mientras no se estima; si no se puede mostrar, nada
        return cab + `<li class="${clase}" data-id="${i.id}"><span class="hora">${L.hora(new Date(i.t))}</span>${mini}` +
          `<span class="txt"><b>${esc(i.nombre || i.texto || 'Foto')}</b><small>${esc(sub)}</small></span>` +
          `<span class="num">${i.estado === 'ok' ? L.miles(i.kcal) : '…'}</span></li>`;
      }).join('')
    : '<li class="vacio">Nada anotado</li>');
}

// Cambia el contenido solo si cambió: un render en medio de un toque no reemplaza el botón (se perdía el toque).
const pintado = new WeakMap(); // no en un atributo: las miniaturas pesan cientos de KB
function poner(el, html) {
  if (pintado.get(el) === html) return false;
  pintado.set(el, html);
  el.innerHTML = html;
  return true;
}

// al escribir, las sugerencias pasan a ser lo ya anotado que coincide: repetirlo no gasta IA y anda sin internet
function pintarRecientes() {
  const el = $('#c-recientes');
  if (poner(el, L.recientes(items, new Date(), 8, 'comida', $('#c-texto').value)
    .map((i) => `<button type="button" data-rep="${i.id}"><span>${esc(i.nombre)}</span><small>${L.miles(i.kcal)}</small></button>`).join(''))) el.scrollLeft = 0;
}
$('#c-texto').addEventListener('input', pintarRecientes);

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
  const diasQuedan = 7 - ((new Date().getDay() + 6) % 7); // hoy incluido: lunes 7 … domingo 1
  $('#g-de').textContent = `quedan de ${L.pesos(cfg.presupuesto)}` +
    (semOff !== 0 ? ` · gastado ${L.pesos(gastado)}` : quedan > 0 && diasQuedan > 1 ? ` · ${L.pesos(quedan / diasQuedan)}/día` : '');
  poner($('#g-cats'), cfg.categorias.map((c) => `<button type="button" data-cat="${esc(c)}">${esc(c)}</button>`).join(''));
  const porCat = new Map();
  for (const i of sem) porCat.set(i.cat, (porCat.get(i.cat) || 0) + i.monto);
  $('#g-por-cat').textContent = [...porCat].sort((a, b) => b[1] - a[1]).map(([c, m]) => `${c} ${L.pesos(m)}`).join(' · ');
  $('#g-cats').classList.toggle('listo', L.leerMonto($('#g-monto').value) > 0);
  if (poner($('#g-recientes'), L.recientes(items, new Date(), 6, 'gasto')
    .map((i) => `<button type="button" data-repg="${i.id}"><span>${esc(i.detalle || i.cat)}</span><small>${L.pesos(i.monto)}</small></button>`).join(''))) $('#g-recientes').scrollLeft = 0;
  poner($('#g-lista'), sem.length
    ? sem.map((i) => {
        const d = new Date(i.t);
        return `<li data-id="${i.id}"><span class="hora">${L.diaCorto(d)}</span>` +
          `<span class="txt"><b>${esc(i.cat)}</b><small>${esc(i.detalle || L.hora(d))}</small></span>` +
          `<span class="num">${L.pesos(i.monto)}</span></li>`;
      }).join('')
    : '<li class="vacio">Sin gastos</li>');
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
  let est;
  try {
    est = L.leerEstimacion(await r.json());
  } catch {
    throw { nota: 'respuesta inválida', final: true };
  }
  if (!est.codigo) return est;
  try { // si Open Food Facts no responde o no tiene el producto, queda lo de la IA
    const off = await fetch(L.urlOFF(est.codigo), { signal: AbortSignal.timeout(8000) });
    return (off.ok && L.conOFF(est, await off.json())) || est;
  } catch {
    return est;
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
        const est = await estimar(it);
        if (it.estado !== 'pendiente') continue; // la persona la guardó a mano mientras estimaba: manda lo suyo
        Object.assign(it, est, { estado: 'ok', nota: '' });
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
  else if (b.dataset.rep) repetir(b.dataset.rep);
  else if (b.dataset.repg) repetirGasto(b.dataset.repg);
  else if (b.dataset.ir) { diaOff = Number(b.dataset.ir); render(); }
  else if (b.dataset.hoy) { if (b.dataset.hoy === 'c') diaOff = 0; else semOff = 0; render(); }
  else if (b.dataset.id) abrirEditar(b.dataset.id);
});

// deslizar hacia la derecha = día (o semana) anterior; las filas de sugerencias tienen su propio desplazamiento
let toque = null;
document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  toque = e.touches.length === 1 && !e.target.closest('.recientes, dialog, input') ? { x: t.clientX, y: t.clientY } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!toque) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - toque.x;
  const dy = t.clientY - toque.y;
  toque = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return;
  const antes = diaOff + semOff;
  if (tab === 'comida') diaOff = Math.min(0, diaOff + (dx > 0 ? -1 : 1));
  else semOff = Math.min(0, semOff + (dx > 0 ? -1 : 1));
  if (diaOff + semOff === antes) return; // ya en hoy: nada que mover
  render();
  // el contenido entra desde el lado hacia donde se deslizó, para que se note el cambio de día
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    $('#' + tab).animate([{ transform: `translateX(${dx > 0 ? -28 : 28}px)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'ease-out' });
});

$('#c-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('#c-texto').value.trim();
  if (!texto) return;
  const igual = L.yaAnotado(items, texto);
  if (igual) return repetir(igual.id); // ya se anotó tal cual: mismas cifras, al tiro y sin internet
  $('#c-texto').value = '';
  await guardar({ id: crypto.randomUUID(), tipo: 'comida', t: nuevaHora(), texto, estado: 'pendiente', nota: 'estimando' });
  render();
  procesarCola();
});

// Repetir una comida reciente: copia sus alimentos y porción, sin IA (funciona sin internet).
async function repetir(id) {
  const o = items.find((i) => i.id === id);
  if (!o) return;
  const it = { id: crypto.randomUUID(), tipo: 'comida', t: nuevaHora(), estado: 'ok', nota: '', nombre: o.nombre,
    alimentos: structuredClone(L.alimentosDe(o)), porcion: o.porcion || 1 };
  Object.assign(it, L.totales(it));
  $('#c-texto').value = ''; // si venía de buscar
  document.activeElement.blur();
  await guardar(it);
  render();
  const otroDia = diaOff ? ' · ' + L.etiquetaDia(new Date(it.t), new Date()).toLowerCase() : ''; // que no se anote en otro día sin notarlo
  aviso(`${it.nombre} · ${L.miles(it.kcal)} kcal${otroDia}`, 4000, ['Deshacer', async () => { await borrar(it); render(); }]);
}

async function repetirGasto(id) {
  const o = items.find((i) => i.id === id);
  if (!o) return;
  const g = { id: crypto.randomUUID(), tipo: 'gasto', t: new Date().toISOString(), monto: o.monto, cat: o.cat, detalle: o.detalle || '' };
  await guardar(g);
  semOff = 0;
  render();
  aviso(`${L.pesos(g.monto)} · ${g.cat}`, 4000, ['Deshacer', async () => { await borrar(g); render(); }]);
}

// Galería: varias fotos a la vez, cada una a la hora en que se sacó (para anotar el día completo en la noche).
async function fotoElegida(e) {
  const galeria = e.target.id === 'c-foto-galeria';
  const fotos = [];
  for (const archivo of e.target.files) fotos.push([archivo, galeria ? await horaDeFoto(archivo) : null]);
  const nueva = fotos.map((f) => f[1]).filter(Boolean).sort((a, b) => b - a)[0];
  if (nueva) { // mostrar el día de la foto más nueva
    const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    diaOff = Math.min(0, Math.round((dia(nueva) - dia(new Date())) / 864e5));
  }
  for (const [archivo, h] of fotos) await unaFoto(archivo, h ? h.toISOString() : nuevaHora());
  e.target.value = ''; // recién ahora: en Safari limpiar antes puede invalidar el archivo de la cámara
}

// Hora EXIF solo si es de hoy o ayer: una foto más vieja (una etiqueta de la semana pasada) se anota como siempre.
// Sin EXIF (iOS a veces lo borra al convertir HEIC), la fecha del archivo, si no es la de recién (= momento de elegirla).
async function horaDeFoto(archivo) {
  try {
    const mod = archivo.lastModified < Date.now() - 2 * 60e3 ? new Date(archivo.lastModified) : null;
    const h = L.horaExif(await archivo.slice(0, 1 << 17).arrayBuffer()) || mod;
    const ayer = new Date();
    ayer.setHours(0, 0, 0, 0);
    ayer.setDate(ayer.getDate() - 1);
    return h && h >= ayer && h <= Date.now() + 6e4 ? h : null;
  } catch {
    return null;
  }
}

async function unaFoto(archivo, t) {
  // la fila aparece al tiro; 'preparando' no lo toma la cola hasta tener la foto
  const it = { id: crypto.randomUUID(), tipo: 'comida', t, estado: 'preparando', nota: 'preparando foto' };
  await guardar(it);
  render();
  try {
    it.foto = await achicar(archivo);
  } catch (err) {
    try { it.foto = await aDataURL(archivo); } // sin achicar: Gemini acepta la original (incluso HEIC), solo pesa más
    catch (err2) { Object.assign(it, { estado: 'error', nota: 'no se pudo leer la foto: ' + motivo(err2) }); await guardar(it); render(); return; }
    it.nota = 'foto original (' + err.message + ')';
  }
  if (!items.includes(it)) return;
  Object.assign(it, { estado: 'pendiente', nota: 'estimando' });
  await guardar(it);
  render();
  procesarCola();
}
$('#c-foto').addEventListener('change', fotoElegida);
$('#c-foto-galeria').addEventListener('change', fotoElegida);

$('#g-monto').addEventListener('input', (e) => {
  const n = L.leerMonto(e.target.value);
  e.target.value = n ? L.miles(n) : '';
  $('#g-cats').classList.toggle('listo', n > 0);
});

async function anotarGasto(cat) {
  const monto = L.leerMonto($('#g-monto').value);
  if (!monto) { $('#g-monto').focus(); return; }
  const g = { id: crypto.randomUUID(), tipo: 'gasto', t: new Date().toISOString(), monto, cat, detalle: $('#g-detalle').value.trim() };
  $('#g-monto').value = ''; // antes de guardar: un doble toque no anota dos veces
  $('#g-detalle').value = '';
  document.activeElement.blur();
  await guardar(g);
  semOff = 0;
  render();
  aviso(`${L.pesos(monto)} · ${cat}`, 4000, ['Deshacer', async () => { await borrar(g); render(); }]);
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
  const dt = new Date(it.t);
  const horaVista = `${L.diaClave(dt)}T${L.hora(dt)}`;
  const campoHora = `<label>Fecha y hora<input type="datetime-local" name="t" value="${horaVista}"></label>`;
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
       ${campoHora}
       <label>Corrección<input name="correccion" placeholder="ej. era otra cosa" autocomplete="off"></label>
       <div class="acciones"><button value="borrar" class="peligro">Borrar</button>
         <button value="corregir">${it.estado === 'ok' ? 'Corregir' : 'Reintentar'}</button>
         <button value="guardar" class="primario">Guardar</button></div>`
    : `<label>Monto<input name="monto" inputmode="numeric" value="${L.miles(it.monto)}"></label>
       <label>Categoría<select name="cat">${cats.map((c) => `<option${c === it.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
       <label>Detalle<input name="detalle" value="${esc(it.detalle || '')}" autocomplete="off"></label>
       ${campoHora}
       <div class="acciones"><button value="borrar" class="peligro">Borrar</button>
         <button value="guardar" class="primario">Guardar</button></div>`;
  // Intro del teclado = Guardar (Corregir si se escribió una corrección); si no, el envío implícito toca el primer botón: Borrar
  f.onkeydown = (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    dlg.close(e.target.name === 'correccion' && e.target.value.trim() ? 'corregir' : 'guardar');
  };
  dlg.onclose = async () => {
    const v = Object.fromEntries(new FormData(f));
    const accion = dlg.returnValue;
    dlg.returnValue = '';
    // el importador de Finanzas solo agrega líneas: un gasto ya exportado que se cambia o borra hay que arreglarlo allá
    const enExcel = it.tipo === 'gasto' && exportados().includes(it.id);
    const lineaAntes = it.tipo === 'gasto' && L.lineaExcel(it);
    // solo si se cambió: el campo no tiene segundos, y reescribir la hora cambiaba la línea del Excel (el importador la duplicaba)
    if (accion === 'guardar' && v.t && v.t !== horaVista && !isNaN(new Date(v.t))) it.t = new Date(v.t).toISOString(); // datetime-local = hora local
    if (accion === 'borrar') {
      await borrar(it);
      aviso(enExcel ? 'Borrado aquí; en el Excel sigue' : 'Borrado', 5000, ['Deshacer', async () => { await guardar(it); render(); }]);
    } else if (accion === 'guardar' && it.tipo === 'gasto') {
      it.monto = L.leerMonto(v.monto) || it.monto;
      it.cat = v.cat;
      it.detalle = v.detalle.trim();
      await guardar(it);
      if (enExcel && L.lineaExcel(it) !== lineaAntes) aviso('En el Excel, borra la fila anterior', 6000);
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
  f.meta.value = cfg.meta ? L.miles(cfg.meta) : '';
  f.categorias.value = cfg.categorias.join(', ');
  f.clave.value = cfg.clave;
  pintarGuardado();
  $('#saldo').textContent = '';
  if (cfg.clave && navigator.onLine) // saldo de OpenRouter, para que «sin saldo» no pille por sorpresa
    fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${cfg.clave}` }, signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(({ data }) => { $('#saldo').textContent = `Saldo OpenRouter: US$ ${(data.total_credits - data.total_usage).toFixed(2).replace('.', ',')}`; })
      .catch(() => {});
  $('#ajustes').showModal();
});
$('#ajustes').addEventListener('close', () => {
  const f = $('#ajustes form');
  const cats = f.categorias.value.split(',').map((s) => s.trim()).filter(Boolean);
  const pegada = f.clave.value.trim();
  const clave = (pegada.match(/sk-or-[\w-]+/) || [pegada])[0]; // por si se pegó con texto alrededor
  if (clave !== cfg.clave) // clave nueva: reintentar solas las que fallaron por clave
    for (const it of items.filter((i) => i.estado === 'error' && i.nota === 'clave inválida')) { it.estado = 'pendiente'; guardar(it); }
  cfg = { presupuesto: L.leerMonto(f.presupuesto.value), meta: L.leerMonto(f.meta.value), categorias: cats.length ? cats : CFG_DEF.categorias, clave };
  guardarCfg();
  render();
  procesarCola();
});

// true = la persona completó la hoja de compartir (o se descargó, fuera del iPhone)
async function compartir(archivos) {
  if (navigator.canShare?.({ files: archivos })) {
    try { await navigator.share({ files: archivos }); return true; }
    catch (e) { if (e.name !== 'AbortError') aviso('No se pudo compartir: ' + motivo(e), 8000); return false; }
  }
  for (const f of archivos) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return true;
}

// Un solo botón: gastos para el Excel + respaldo de todo, juntos (Save to Files → iCloud Drive/Finanzas).
// Siempre completos: el importador de Finanzas descarta líneas ya importadas; el respaldo reemplaza al anterior.
// .txt también el respaldo: la hoja de compartir acepta texto en todos lados, JSON no siempre.
$('#guardar-icloud').addEventListener('click', async () => {
  const gastos = items.filter((i) => i.tipo === 'gasto').sort((a, b) => (a.t < b.t ? -1 : 1));
  const sinFotos = items.map(({ foto, ...resto }) => resto);
  const ok = await compartir([
    new File([gastos.map(L.lineaExcel).join('\n') + '\n'], 'gastos_app.txt', { type: 'text/plain' }),
    new File([JSON.stringify(sinFotos)], 'registro-respaldo.txt', { type: 'text/plain' }),
  ]);
  if (!ok) return;
  localStorage.setItem('guardado', new Date().toISOString());
  try { localStorage.setItem('exportados', JSON.stringify(gastos.map((g) => g.id))); } catch {}
  localStorage.setItem('cambios', '0');
  pintarGuardado();
});

// ids de los gastos que ya fueron al Excel (en el último «Guardar en iCloud»)
function exportados() {
  try { return JSON.parse(localStorage.getItem('exportados') || '[]'); } catch { return []; }
}

// Punto en Ajustes: hay cambios sin guardar y lo último guardado (o el dato más viejo) tiene más de 3 días.
function pintarGuardado() {
  const ult = localStorage.getItem('guardado');
  const cambios = Number(localStorage.getItem('cambios')) || 0;
  const desde = ult || items.reduce((m, i) => (i.t < m ? i.t : m), new Date().toISOString());
  $('#abrir-ajustes').classList.toggle('punto', cambios > 0 && Date.now() - new Date(desde) > 3 * 864e5);
  const dias = ult ? Math.floor((Date.now() - new Date(ult)) / 864e5) : -1;
  $('#version').textContent = `v${VERSION} · ${items.length} registros · ` +
    (dias < 0 ? 'nunca guardado' : dias === 0 ? 'guardado hoy' : dias === 1 ? 'guardado ayer' : `guardado hace ${dias} días`);
}
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

// ---------- recordatorios (push enviado por GitHub Actions a las 13:45 y 20:45) ----------
const VAPID = 'BE-d3Q5RdRNtI9LWObjRyObO2f_TXkd3g-SfoQbv3JC9VoE25Ga_DmniNE6l4_Gb_aKOy3QyxN0HlOkuKmiNrak'; // pública
const aBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
$('#recordatorios').addEventListener('click', async () => {
  try {
    if (!('PushManager' in window) || !('Notification' in window)) throw new Error('ábrela desde el ícono de inicio');
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('sin permiso para notificaciones');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(VAPID) }));
    const codigo = JSON.stringify(sub); // se guarda como secreto PUSH_SUB en GitHub (una vez por teléfono)
    const ta = $('#push-sub');
    ta.value = codigo;
    ta.hidden = false;
    ta.select();
    try { await navigator.clipboard.writeText(codigo); aviso('Código copiado', 4000); } catch { aviso('Copia el código de abajo', 4000); }
  } catch (e) {
    aviso('Recordatorios: ' + motivo(e), 8000);
  }
});

// ---------- inicio ----------
espejoAjustes();
addEventListener('online', procesarCola);
let ocultaDesde = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ocultaDesde = Date.now(); return; }
  if (Date.now() - ocultaDesde > 5 * 60e3) { diaOff = 0; semOff = 0; } // al volver (quizá otro día), no seguir anotando en el día que se miraba
  render();
  procesarCola();
  navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {}); // al volver a la app, buscar versión nueva
});
setInterval(() => { if (items.some((i) => i.estado === 'pendiente')) procesarCola(); }, 20000);
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) {
  const habia = !!navigator.serviceWorker.controller; // la primera instalación no es «versión nueva»
  navigator.serviceWorker.register('sw.js');
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (habia) aviso('Versión nueva lista', 30000, ['Actualizar', () => location.reload()]);
  });
}
// Abierta en Safari y no desde el ícono: Safari guarda los datos aparte, así que avisar.
$('#en-safari').hidden = !(/iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches);

try { items = await tx('readonly', (s) => s.getAll()); } catch (e) { aviso('No se pudieron leer los datos: ' + motivo(e), 8000); }
for (const it of items.filter((i) => i.estado === 'preparando')) { // la app se cerró a mitad de una foto
  Object.assign(it, { estado: 'error', nota: 'la foto no alcanzó a guardarse' });
  guardar(it);
}
render();
procesarCola();
