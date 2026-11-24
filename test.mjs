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
  // buscar: todo el historial, sin tildes ni mayúsculas, palabras en cualquier orden, también en lo que se escribió
  lista.push({ ...c('Plátano', 2), texto: '1 banana grande' });
  const b = (q, hoy = new Date(2026, 10, 23, 20)) => L.recientes(lista, hoy, 8, 'comida', q).map((i) => i.nombre);
  assert.deepEqual(b('PALTA pan'), ['pan con palta ']);
  assert.deepEqual(b('platano', new Date(2027, 5, 1)), ['Plátano']);
  assert.deepEqual(b('banana'), ['Plátano']);
  assert.deepEqual(b('foto'), []); // las fallidas no se repiten
  assert.deepEqual(b('  '), ['pan con palta ', 'Yogurt', 'Plátano', 'Pastel']); // solo espacios = sin buscar
  const g = (monto, cat, detalle, dia) => ({ tipo: 'gasto', monto, cat, detalle, t: new Date(2026, 10, dia, 13).toISOString() });
  const gs = [g(4500, 'Comida', 'almuerzo', 20), g(4500, 'Comida', 'Almuerzo ', 21), g(20000, 'Combustible', '', 21), g(4500, 'Super', 'almuerzo', 22)];
  assert.deepEqual(L.recientes(gs, new Date(2026, 10, 23), 8, 'gasto').map((i) => `${i.cat} ${i.monto}`),
    ['Comida 4500', 'Super 4500', 'Combustible 20000']);
}
assert.throws(() => L.leerEstimacion({ choices: [{ message: { content: '{"nombre":"x","alimentos":[]}' } }] }));
{ // código de barras → Open Food Facts
  assert.ok(L.eanValido('7801610001196') && L.eanValido('7802800533343') && L.eanValido('96385074') && L.eanValido('036000291452'));
  assert.ok(!L.eanValido('7801610001195') && !L.eanValido('780161000119') && !L.eanValido('') && !L.eanValido('abc'));
  const leer = (codigo) => L.leerEstimacion({ choices: [{ message: { content: JSON.stringify({ nombre: 'Agua mineral', codigo,
    alimentos: [{ nombre: 'agua', gramos: 500, kcal: 0, proteina: 0, carbohidratos: 0, grasa: 0 }] }) } }] });
  assert.equal(leer('7 801610 001196').codigo, '7801610001196'); // espacios como vienen impresos
  assert.equal(leer('7801610001195').codigo, undefined); // dígito mal leído: se descarta
  // respuesta real de OFF (24-11-2026), recortada
  const coca = { status: 1, product: { product_name: 'Coca-Cola', product_quantity: 350, serving_quantity: 350,
    nutriments: { 'energy-kcal_100g': 44, proteins_100g: 0, carbohydrates_100g: 11, fat_100g: 0 } } };
  const r = L.conOFF(leer('7801610001196'), coca);
  assert.equal(r.nombre, 'Coca-Cola');
  assert.deepEqual(r.alimentos, [{ nombre: 'Coca-Cola', gramos: 350, kcal: 154, p: 0, c: 39, g: 0, q: 1 }]);
  assert.equal(r.kcal, 154);
  const sin = (cambio) => L.conOFF(leer('7801610001196'), { ...coca, product: { ...coca.product, ...cambio } });
  assert.equal(sin({ serving_quantity: undefined, product_quantity: '160' }).alimentos[0].gramos, 160); // sin porción: el envase
  assert.equal(sin({ nutriments: {} }), null); // sin kcal: queda la IA
  assert.equal(sin({ nutriments: { 'energy-kcal_100g': '' } }), null);
  assert.equal(sin({ product_name: '' }).nombre, 'agua');
  assert.equal(L.conOFF(leer('7801610001196'), { status: 0 }), null); // no está en OFF
  assert.equal(L.conOFF(est, coca), null); // la IA vio un plato con varios alimentos: no se reemplaza
}
const cuerpo = L.cuerpoEstimacion({ texto: 'x', anterior: 'Pan · 250 kcal', correccion: 'eran 2' });
assert.equal(cuerpo.messages[0].content.length, 3);
console.log('logica.js: ok');

{ // recordatorio.js (script clásico del service worker)
  const vm = await import('node:vm');
  const { readFileSync } = await import('node:fs');
  const ctx = { self: {} };
  vm.runInNewContext(readFileSync(new URL('./recordatorio.js', import.meta.url), 'utf8'), ctx);
  const R = ctx.self.textoRecordatorio;
  const a = (h, kcal, dia = 24) => ({ tipo: 'comida', estado: 'ok', kcal, t: new Date(2026, 10, dia, h).toISOString() });
  const g = (monto, dia) => ({ tipo: 'gasto', monto, t: new Date(2026, 10, dia, 12).toISOString() });
  const ahora13 = new Date(2026, 10, 24, 13, 45); // martes
  const ahora20 = new Date(2026, 10, 24, 20, 45);
  const sinNada = R('almuerzo', [], {}, ahora13);
  assert.equal(sinNada.titulo, '¿Qué almorzaste?');
  assert.equal(sinNada.cuerpo, 'Hoy no has anotado nada.');
  assert.deepEqual({ ...R('almuerzo', [a(8, 400)], {}, ahora13) }, { titulo: '¿Qué almorzaste?', cuerpo: 'Vas en 400 kcal hoy.' });
  assert.deepEqual({ ...R('almuerzo', [a(8, 400), a(13, 800)], { meta: 2000 }, ahora13) }, { titulo: 'Hoy vas en 1.200 kcal', cuerpo: 'Quedan 800.' });
  assert.equal(R('almuerzo', [a(13, 800, 23)], {}, ahora13).cuerpo, 'Hoy no has anotado nada.'); // ayer no cuenta
  // noche: gastos desde el lunes 23 (el domingo 22 no cuenta)
  const noche = R('cena', [a(13, 800), g(5000, 22), g(4500, 23), g(2000, 24)], { presupuesto: 30000 }, ahora20);
  assert.deepEqual({ ...noche }, { titulo: '¿Qué comiste en la tarde?', cuerpo: 'Vas en 800 kcal hoy. Quedan $ 23.500 esta semana.' });
  assert.equal(R('cena', [a(19, 500), g(40000, 24)], { presupuesto: 30000, meta: 400 }, ahora20).cuerpo, '100 sobre la meta. Te pasaste $ 10.000 esta semana.');
  console.log('recordatorio.js: ok');
}

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
