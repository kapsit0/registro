// Texto de la notificación de recordatorio. Script clásico (sin export): sw.js lo carga con importScripts
// y test.mjs con node:vm. tipo = 'almuerzo' (13:45) | 'cena' (20:45).
self.textoRecordatorio = function (tipo, items, ajustes, ahora) {
  const dia = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const fmt = (n) => Math.round(n).toLocaleString('es-CL');
  const hoy = items.filter((i) => i.tipo === 'comida' && dia(new Date(i.t)) === dia(ahora));
  const kcal = hoy.filter((i) => i.estado === 'ok').reduce((s, i) => s + (i.kcal || 0), 0);
  const desde = tipo === 'almuerzo' ? 11 : 16; // ¿anotó algo desde esta hora?
  const anoto = hoy.some((i) => new Date(i.t).getHours() >= desde);
  const meta = ajustes.meta || 0;
  let titulo;
  let cuerpo;
  if (!anoto) {
    titulo = tipo === 'almuerzo' ? '¿Qué almorzaste?' : '¿Qué comiste en la tarde?';
    cuerpo = hoy.length ? `Vas en ${fmt(kcal)} kcal hoy.` : 'Hoy no has anotado nada.';
  } else {
    titulo = `Hoy vas en ${fmt(kcal)} kcal`;
    cuerpo = !meta ? '' : kcal <= meta ? `Quedan ${fmt(meta - kcal)}.` : `${fmt(kcal - meta)} sobre la meta.`;
  }
  if (tipo === 'cena' && ajustes.presupuesto) { // en la noche, también la plata de la semana (lun–dom)
    const lunes = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - ((ahora.getDay() + 6) % 7));
    const gastado = items.filter((i) => i.tipo === 'gasto' && new Date(i.t) >= lunes).reduce((s, i) => s + (i.monto || 0), 0);
    const q = ajustes.presupuesto - gastado;
    cuerpo += ` ${q >= 0 ? 'Quedan' : 'Te pasaste'} $ ${fmt(Math.abs(q))} esta semana.`;
  }
  return { titulo, cuerpo: cuerpo.trim() };
};
