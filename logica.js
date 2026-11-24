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
  'para esa cantidad. Cifras enteras.';

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
  properties: { nombre: { type: 'string' }, alimentos: { type: 'array', items: ALIMENTO } },
  required: ['nombre', 'alimentos'],
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
  return { ...est, ...totales(est) };
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

// Comidas para repetir con un toque: las más frecuentes de los últimos 30 días (por nombre), la última versión de cada una.
// Gastos: mismo monto, categoría y detalle cuentan como el mismo.
export function recientes(items, ahora = new Date(), n = 8, tipo = 'comida') {
  const desde = new Date(ahora - 30 * 864e5).toISOString();
  const clave = tipo === 'comida'
    ? (i) => i.estado === 'ok' && String(i.nombre || '').trim().toLowerCase()
    : (i) => `${i.cat}|${i.monto}|${String(i.detalle || '').trim().toLowerCase()}`;
  const m = new Map();
  for (const i of items) {
    if (i.tipo !== tipo || i.t < desde) continue;
    const k = clave(i);
    if (!k) continue;
    const r = m.get(k) || { veces: 0, ult: i };
    r.veces++;
    if (i.t > r.ult.t) r.ult = i;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.veces - a.veces || (a.ult.t < b.ult.t ? 1 : -1)).slice(0, n).map((r) => r.ult);
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
  return h < 11 ? 'Desayuno' : h < 16 ? 'Almuerzo' : h < 20 ? 'Once' : 'Cena';
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
