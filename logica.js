// Funciones puras (sin DOM) para poder probarlas con node: node test.mjs
export const MODELOS = ['google/gemini-3.6-flash', 'google/gemini-3.5-flash-lite'];
export const URL_API = 'https://openrouter.ai/api/v1/chat/completions';

// Mismo prompt y esquema que el Atajo «Comida» (crear_atajo.py), ya probados.
export const PROMPT =
  'Registro de calorías (Chile). Recibes la foto de un plato, de un envase o de su tabla nutricional, ' +
  'los datos de un producto escaneado, o un texto. Con tabla nutricional o datos del producto, usa esos ' +
  'valores para la cantidad indicada (sin cantidad: 1 porción). Con un plato, reconoce cada alimento y ' +
  'estima la porción que se ve. nombre: el plato completo, máximo 4 palabras en español. ' +
  'alimentos: cada alimento por separado (un producto envasado o un plato indivisible = 1 alimento), ' +
  'con su nombre corto, gramos (o ml) estimados, y kcal y gramos de proteína, carbohidratos y grasa ' +
  'para esa cantidad. Cifras enteras. codigo: si se ve un código de barras, sus dígitos tal como están ' +
  'impresos bajo las barras; si no se ve o no se leen todos, texto vacío.';

const ALIMENTO = {
  type: 'object',
  properties: {
    nombre: { type: 'string' },
    gramos: { type: 'integer' },
    kcal: { type: 'integer' },
    proteina: { type: 'integer' },
    carbohidratos: { type: 'integer' },
    grasa: { type: 'integer' },
  },
  required: ['nombre', 'gramos', 'kcal', 'proteina', 'carbohidratos', 'grasa'],
};
const ESQUEMA = {
  type: 'object',
  properties: { nombre: { type: 'string' }, codigo: { type: 'string' }, alimentos: { type: 'array', items: ALIMENTO } },
  required: ['nombre', 'codigo', 'alimentos'],
};

export function cuerpoEstimacion({ texto, imagen, anterior, correccion }) {
  const partes = [{ type: 'text', text: PROMPT }];
  if (imagen) partes.push({ type: 'image_url', image_url: { url: imagen } });
  if (texto) partes.push({ type: 'text', text: texto });
  if (correccion)
    partes.push({
      type: 'text',
      text: `Tu estimación anterior: ${anterior || '(ninguna)'}. Corrección de la persona: ${correccion}. Entrega la estimación corregida.`,
    });
  return {
    models: MODELOS,
    messages: [{ role: 'user', content: partes }],
    response_format: { type: 'json_schema', json_schema: { name: 'comida', strict: true, schema: ESQUEMA } },
    reasoning: { effort: 'low' },
  };
}

export function leerEstimacion(respuesta) {
  const txt = String(respuesta.choices[0].message.content).replace(/^\s*```(json)?|```\s*$/g, '');
  const j = JSON.parse(txt);
  const n = (x) => Math.max(0, Math.round(Number(x) || 0));
  const alimentos = (Array.isArray(j.alimentos) ? j.alimentos : []).map((a) => ({
    nombre: String(a.nombre || '').slice(0, 40),
    gramos: n(a.gramos),
    kcal: n(a.kcal),
    p: n(a.proteina),
    c: n(a.carbohidratos),
    g: n(a.grasa),
    q: 1,
  }));
  if (!alimentos.length) throw new Error('sin alimentos');
  const est = { nombre: String(j.nombre || alimentos[0].nombre || 'Comida').slice(0, 60), alimentos, porcion: 1 };
  const codigo = String(j.codigo || '').replace(/\D/g, '');
  if (eanValido(codigo)) est.codigo = codigo;
  return { ...est, ...totales(est) };
}

// EAN-8, UPC-A (12) o EAN-13 con su dígito verificador: descarta dígitos mal leídos por la IA.
export function eanValido(s) {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(s)) return false;
  const d = [...s].map(Number).reverse(); // desde el verificador: pesos 1,3,1,3… hacia la izquierda
  return d.reduce((t, x, i) => t + x * (i % 2 ? 3 : 1), 0) % 10 === 0;
}

export const urlOFF = (codigo) =>
  `https://world.openfoodfacts.org/api/v2/product/${codigo}?fields=product_name,product_name_es,serving_quantity,product_quantity,nutriments`;

// Producto envasado con código: Open Food Facts manda (por 100 g × 1 porción de la etiqueta), no lo que adivinó la IA.
// null = no sirve (no está, sin kcal, o la IA vio más de un alimento) → queda la estimación de la IA.
export function conOFF(est, off) {
  const p = off && off.status === 1 && off.product;
  const n = p && p.nutriments;
  if (!n || est.alimentos.length !== 1 || !(parseFloat(n['energy-kcal_100g']) >= 0)) return null; // NaN si falta, '' o null
  // porción de la etiqueta; sin ella, el envase si es de una porción (lata, barra); un envase grande (arroz 1 kg) no se come entero
  const envase = Number(p.product_quantity) || 0;
  const gramos = Math.round(Number(p.serving_quantity) || (envase && envase <= 600 ? envase : est.alimentos[0].gramos || 100));
  const k = (x) => Math.max(0, Math.round(((Number(n[x]) || 0) * gramos) / 100));
  const nombre = String(p.product_name_es || p.product_name || '').trim().slice(0, 40) || est.alimentos[0].nombre;
  const alimentos = [{ nombre, gramos, kcal: k('energy-kcal_100g'), p: k('proteins_100g'), c: k('carbohydrates_100g'), g: k('fat_100g'), q: 1 }];
  const r = { ...est, nombre: nombre.slice(0, 60), alimentos, porcion: 1 };
  return { ...r, ...totales(r) };
}

// Totales = Σ alimento × su cantidad, × porción del plato. Se guardan en el ítem para sumar sin recalcular.
export function totales({ alimentos, porcion = 1 }) {
  const t = (k) => Math.round(alimentos.reduce((s, a) => s + a[k] * a.q, 0) * porcion);
  return { kcal: t('kcal'), p: t('p'), c: t('c'), g: t('g') };
}

// Comidas guardadas antes de separar alimentos: un solo alimento con sus totales.
export const alimentosDe = (it) =>
  it.alimentos || [{ nombre: it.nombre || it.texto || 'Comida', gramos: 0, kcal: it.kcal || 0, p: it.p || 0, c: it.c || 0, g: it.g || 0, q: 1 }];

export const PASOS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4];
export function paso(q, dir) {
  const i = dir > 0 ? PASOS.findIndex((x) => x > q) : PASOS.findLastIndex((x) => x < q);
  return i < 0 ? q : PASOS[i];
}
export function fraccion(x) {
  const ent = Math.floor(x);
  const fr = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[Math.round((x - ent) * 100) / 100];
  if (fr) return (ent || '') + fr;
  return Number.isInteger(x) ? String(x) : String(x).replace('.', ',');
}

export const normal = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

// Comidas para repetir con un toque: las más frecuentes de los últimos 30 días (por nombre), la última versión de cada una.
// Primero lo anotado a esta misma hora del día (al desayuno, lo que se suele desayunar).
// Gastos: mismo monto, categoría y detalle cuentan como el mismo.
// buscar: todo el historial que tenga cada palabra escrita (sin tildes ni mayúsculas).
export function recientes(items, ahora = new Date(), n = 8, tipo = 'comida', buscar = '') {
  const m0 = momento(ahora);
  const palabras = normal(buscar).split(/\s+/).filter(Boolean);
  const desde = palabras.length ? '' : new Date(ahora - 30 * 864e5).toISOString();
  const clave = tipo === 'comida'
    ? (i) => i.estado === 'ok' && normal(i.nombre)
    : (i) => `${i.cat}|${i.monto}|${normal(i.detalle)}`;
  const m = new Map();
  for (const i of items) {
    if (i.tipo !== tipo || i.t < desde) continue;
    const texto = palabras.length && normal(`${i.nombre || ''} ${i.texto || ''} ${i.cat || ''} ${i.detalle || ''}`);
    if (texto && !palabras.every((w) => texto.includes(w))) continue;
    const k = clave(i);
    if (!k) continue;
    const r = m.get(k) || { veces: 0, aEstaHora: 0, ult: i };
    r.veces++;
    if (momento(new Date(i.t)) === m0) r.aEstaHora++;
    if (i.t > r.ult.t) r.ult = i;
    m.set(k, r);
  }
  return [...m.values()]
    .sort((a, b) => b.aEstaHora - a.aEstaHora || b.veces - a.veces || (a.ult.t < b.ult.t ? 1 : -1))
    .slice(0, n).map((r) => r.ult);
}

// Lo escrito ya se anotó antes (mismo nombre o mismo texto): la última versión, para repetirla sin IA.
export function yaAnotado(items, texto) {
  const q = normal(texto);
  let ult = null;
  for (const i of items)
    if (i.tipo === 'comida' && i.estado === 'ok' && (normal(i.nombre) === q || normal(i.texto) === q) && (!ult || i.t > ult.t)) ult = i;
  return q ? ult : null;
}

// Para la corrección: lo que se estimó, con las cantidades que dejó la persona.
export function describir(it) {
  const pr = it.porcion || 1;
  const als = alimentosDe(it).map((a) => `${a.nombre}${a.gramos ? ' ' + Math.round(a.gramos * a.q * pr) + ' g' : ''}`).join(', ');
  return `${it.nombre} · ${it.kcal} kcal (${als})`;
}

export const pad = (n) => String(n).padStart(2, '0');
export const diaClave = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hora = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const sumar = (items, campo) => items.reduce((s, i) => s + (Number(i[campo]) || 0), 0);
export const miles = (n) => Math.round(n).toLocaleString('es-CL');
export const pesos = (n) => (n < 0 ? '−$ ' : '$ ') + miles(Math.abs(n));
export const leerMonto = (s) => parseInt(String(s).replace(/\D/g, ''), 10) || 0;

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const diaCorto = (d) => `${DIAS[d.getDay()]} ${d.getDate()}`;

// Comidas del día en Chile, por la hora en que se anotaron.
export const momento = (d) => {
  const h = d.getHours();
  return h < 5 ? 'Noche' : h < 11 ? 'Desayuno' : h < 16 ? 'Almuerzo' : h < 20 ? 'Once' : 'Cena';
};

// Lunes 00:00 local de la semana de d (semana lunes–domingo, como el panel de Finanzas).
export function inicioSemana(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function etiquetaDia(d, hoy) {
  const dif = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 864e5);
  if (dif === 0) return 'Hoy';
  if (dif === -1) return 'Ayer';
  return `${diaCorto(d)} ${MESES[d.getMonth()]}`;
}

export function etiquetaSemana(ini) {
  const fin = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 6);
  return ini.getMonth() === fin.getMonth()
    ? `${ini.getDate()}–${fin.getDate()} ${MESES[fin.getMonth()]}`
    : `${ini.getDate()} ${MESES[ini.getMonth()]} – ${fin.getDate()} ${MESES[fin.getMonth()]}`;
}

// Mismo formato que el Atajo «Gasto» → importador de Finanzas: yyyy-MM-dd HH:mm:ss;monto;categoría;detalle
export function lineaExcel(g) {
  const d = new Date(g.t);
  const limpio = (s) => String(s || '').replace(/[;\s]+/g, ' ').trim();
  return `${diaClave(d)} ${hora(d)}:${pad(d.getSeconds())};${g.monto};${limpio(g.cat)};${limpio(g.detalle)}`;
}

// Hora en que se sacó la foto (EXIF DateTimeOriginal, o DateTime) de un JPEG; null si no la trae.
export function horaExif(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    for (let o = 2; o + 10 <= v.byteLength; ) {
      const marca = v.getUint16(o);
      if (marca === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return fechaTiff(v, o + 10); // APP1 'Exif'
      if ((marca & 0xff00) !== 0xff00 || marca === 0xffda) return null; // empezó la imagen: no hay EXIF
      o += 2 + v.getUint16(o + 2);
    }
  } catch {} // archivo cortado o raro: sin hora
  return null;
}
function fechaTiff(v, t) {
  const le = v.getUint16(t) === 0x4949; // 'II' = little endian; el iPhone usa 'MM'
  const u16 = (p) => v.getUint16(t + p, le);
  const u32 = (p) => v.getUint32(t + p, le);
  const entrada = (ifd, tag) => {
    for (let i = 0, n = u16(ifd); i < n; i++) if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12;
    return -1;
  };
  const ifd0 = u32(4);
  const pExif = entrada(ifd0, 0x8769);
  for (const [ifd, tag] of [[pExif >= 0 ? u32(pExif + 8) : -1, 0x9003], [ifd0, 0x0132]]) {
    if (ifd < 0) continue;
    const e = entrada(ifd, tag);
    if (e < 0) continue;
    const txt = String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + t + u32(e + 8), 19));
    const m = txt.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)$/);
    if (m) return new Date(m[1], m[2] - 1, m[3], m[4], m[5], m[6]);
  }
  return null;
}
