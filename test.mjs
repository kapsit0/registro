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
assert.equal(L.sumar([{ kcal: 650 }, { kcal: '325' }, {}], 'kcal'), 975);
const est = L.leerEstimacion({ choices: [{ message: { content: '```json\n{"nombre":"Pan","kcal":250.4,"proteina":8,"carbohidratos":48,"grasa":-1,"detalle":"1 marraqueta"}\n```' } }] });
assert.deepEqual(est, { nombre: 'Pan', kcal: 250, p: 8, c: 48, g: 0, detalle: '1 marraqueta' });
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
  console.log('vivo:', e, `${Date.now() - t0} ms`);
}
