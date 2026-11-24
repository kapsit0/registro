// node test.mjs  → pruebas de logica.js;  node test.mjs vivo  → además 1 llamada real a OpenRouter (~US$ 0,0006)
import assert from 'node:assert/strict';
import * as L from './logica.js';

const dom = new Date(2026, 10, 22, 23, 59); // domingo 22-11-2026
assert.equal(L.diaClave(L.inicioSemana(dom)), '2026-11-16');
assert.equal(L.diaClave(L.inicioSemana(new Date(2026, 10, 23, 0, 1))), '2026-11-23'); // lunes
assert.equal(L.diaClave(L.inicioSemana(new Date(2026, 11, 2))), '2026-11-30'); // cruza mes
assert.equal(L.etiquetaSemana(new Date(2026, 10, 16)), '16–22 nov');
assert.equal(L.etiquetaSemana(new Date(2026, 10, 30)), '30 nov – 6 dic');
assert.equal(L.etiquetaDia(dom, dom), 'Hoy');
assert.equal(L.etiquetaDia(new Date(2026, 10, 21, 8), dom), 'Ayer');
assert.equal(L.etiquetaDia(new Date(2026, 10, 18), dom), 'mié 18 nov');
assert.equal(L.pesos(12300), '$ 12.300');
assert.equal(L.pesos(-2000), '−$ 2.000');
assert.equal(L.leerMonto('$ 4.500'), 4500);
assert.equal(L.leerMonto(''), 0);
assert.equal(L.lineaExcel({ t: new Date(2026, 10, 5, 9, 5, 59).toISOString(), monto: 1700, cat: 'Comida', detalle: 'pan; queso\n' }),
  '2026-11-05 09:05:59;1700;Comida;pan queso');
assert.deepEqual([7, 10, 11, 15, 16, 19, 20, 23, 1].map((h) => L.momento(new Date(2026, 10, 23, h, 59))),
  ['Desayuno', 'Desayuno', 'Almuerzo', 'Almuerzo', 'Once', 'Once', 'Cena', 'Cena', 'Noche']);
assert.equal(L.sumar([{ kcal: 650 }, { kcal: '325' }, {}], 'kcal'), 975);
const est = L.leerEstimacion({ choices: [{ message: { content: '```json\n{"nombre":"Arroz con pollo","alimentos":[' +
  '{"nombre":"arroz","gramos":150,"kcal":195.4,"proteina":4,"carbohidratos":42,"grasa":-1},' +
  '{"nombre":"pollo","gramos":120,"kcal":198,"proteina":37,"carbohidratos":0,"grasa":4}]}\n```' } }] });
assert.equal(est.nombre, 'Arroz con pollo');
assert.deepEqual(est.alimentos[0], { nombre: 'arroz', gramos: 150, kcal: 195, p: 4, c: 42, g: 0, q: 1 });
assert.deepEqual(L.totales(est), { kcal: 393, p: 41, c: 42, g: 4 });
assert.equal(est.kcal, 393);
est.alimentos[0].q = 0.5; // media porción de arroz
assert.deepEqual(L.totales(est), { kcal: 296, p: 39, c: 21, g: 4 });
assert.deepEqual(L.totales({ ...est, porcion: 0.5 }), { kcal: 148, p: 20, c: 11, g: 2 });
assert.equal(L.describir({ ...est, ...L.totales(est) }), 'Arroz con pollo · 296 kcal (arroz 75 g, pollo 120 g)');
assert.deepEqual(L.alimentosDe({ nombre: 'Pan', kcal: 250, p: 8, c: 48, g: 1 }), [{ nombre: 'Pan', gramos: 0, kcal: 250, p: 8, c: 48, g: 1, q: 1 }]);
assert.equal(L.paso(1, -1), 0.75);
assert.equal(L.paso(1, 1), 1.5);
assert.equal(L.paso(0, -1), 0);
assert.equal(L.paso(4, 1), 4);
assert.equal(L.paso(1.2, 1), 1.5); // fuera de la lista: al siguiente
assert.deepEqual([0, 0.25, 0.5, 1, 1.5, 2.75, 1.2].map(L.fraccion), ['0', '¼', '½', '1', '1½', '2¾', '1,2']);
{
  const c = (nombre, dia, estado = 'ok') => ({ tipo: 'comida', estado, nombre, t: new Date(2026, 10, dia, 13).toISOString() });
  const lista = [c('Pan con palta', 20), c('pan con palta ', 22), c('Yogurt', 23), c('Pastel', 1), c('Foto', 23, 'error'),
    { tipo: 'gasto', t: new Date(2026, 10, 23).toISOString() }];
  const r = L.recientes(lista, new Date(2026, 10, 23, 20));
  assert.deepEqual(r.map((i) => i.nombre), ['pan con palta ', 'Yogurt', 'Pastel']); // más veces primero, la última versión
  assert.equal(L.recientes(lista, new Date(2026, 11, 25)).length, 0); // más de 30 días
  const g = (monto, cat, detalle, dia) => ({ tipo: 'gasto', monto, cat, detalle, t: new Date(2026, 10, dia, 13).toISOString() });
  const gs = [g(4500, 'Comida', 'almuerzo', 20), g(4500, 'Comida', 'Almuerzo ', 21), g(20000, 'Combustible', '', 21), g(4500, 'Super', 'almuerzo', 22)];
  assert.deepEqual(L.recientes(gs, new Date(2026, 10, 23), 8, 'gasto').map((i) => `${i.cat} ${i.monto}`),
    ['Comida 4500', 'Super 4500', 'Combustible 20000']);
}
assert.throws(() => L.leerEstimacion({ choices: [{ message: { content: '{"nombre":"x","alimentos":[]}' } }] }));
const cuerpo = L.cuerpoEstimacion({ texto: 'x', anterior: 'Pan · 250 kcal', correccion: 'eran 2' });
assert.equal(cuerpo.messages[0].content.length, 3);
console.log('logica.js: ok');

if (process.argv[2] === 'vivo') {
  const { readFileSync } = await import('node:fs');
  const clave = readFileSync(`${process.env.HOME}/.config/comida/clave_openrouter`, 'utf8').trim();
  const t0 = Date.now();
  const r = await fetch(L.URL_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(L.cuerpoEstimacion({ texto: '2 marraquetas con palta' })),
  });
  assert.equal(r.status, 200, await r.clone().text());
  const e = L.leerEstimacion(await r.json());
  assert.ok(e.kcal > 200 && e.kcal < 1500, JSON.stringify(e));
  assert.ok(e.alimentos.length >= 2, 'debería separar pan y palta: ' + JSON.stringify(e.alimentos));
  console.log('vivo:', e, `${Date.now() - t0} ms`);
}
