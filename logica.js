// Funciones puras (sin DOM) para poder probarlas con node: node test.mjs
export const MODELOS = ['google/gemini-3.6-flash', 'google/gemini-3.5-flash-lite'];
export const URL_API = 'https://openrouter.ai/api/v1/chat/completions';

// Mismo prompt y esquema que el Atajo «Comida» (crear_atajo.py), ya probados.
export const PROMPT =
  'Registro de calorías (Chile). Recibes la foto de un plato, de un envase o de su tabla nutricional, ' +
  'los datos de un producto escaneado, o un texto. Con tabla nutricional o datos del producto, usa esos ' +
  'valores para la cantidad indicada (sin cantidad: 1 porción). Con un plato, reconoce cada alimento y ' +
  'estima la porción que se ve. Cifras enteras: kcal y gramos de proteína, carbohidratos y grasa. ' +
  'nombre: máximo 4 palabras en español. detalle: una línea con lo que asumiste, ' +
  "ej. 'arroz 150 g · pollo 120 g'.";

const ESQUEMA = {
  type: 'object',
  properties: {
    nombre: { type: 'string' },
    kcal: { type: 'integer' },
    proteina: { type: 'integer' },
    carbohidratos: { type: 'integer' },
    grasa: { type: 'integer' },
    detalle: { type: 'string' },
  },
  required: ['nombre', 'kcal', 'proteina', 'carbohidratos', 'grasa', 'detalle'],
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
  return {
    nombre: String(j.nombre || 'Comida').slice(0, 60),
    kcal: n(j.kcal),
    p: n(j.proteina),
    c: n(j.carbohidratos),
    g: n(j.grasa),
    detalle: String(j.detalle || ''),
  };
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
