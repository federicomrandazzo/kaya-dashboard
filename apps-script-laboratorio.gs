/**
 * KAYA · Plan del laboratorio (Web App del dashboard)
 * ────────────────────────────────────────────────────
 * Vive en la PLANILLA DE PRODUCCIÓN (la misma de las hojas produccion y armado_cajas).
 * Guarda el plan que arma Tomi y las entregas que va cargando, y se las devuelve al
 * dashboard al momento (sin el retraso de la hoja publicada como CSV).
 *
 * Crea solas, la primera vez, dos hojas:
 *   lab_planes   → un plan por fila (desde, hasta, estado, items en JSON)
 *   lab_entregas → una entrega por fila (plan, fecha y hora, sku, cantidad, quién)
 * No tocar a mano las columnas; sí se puede leer o corregir una cantidad.
 *
 * INSTALACIÓN (una sola vez):
 * 1. Abrir la planilla de producción → Extensiones → Apps Script.
 * 2. Archivo nuevo (+ → Secuencia de comandos), pegar TODO este código y guardar.
 * 3. Implementar → Nueva implementación → tipo "Aplicación web"
 *    → Ejecutar como: Yo → Quién tiene acceso: Cualquier usuario → Implementar → autorizar.
 * 4. Copiar la URL que termina en /exec y pasársela a Claude (va en LAB.url del index.html).
 *
 * PARA ACTUALIZAR después (misma URL): Implementar → Administrar implementaciones → lápiz
 * → Versión: "Nueva versión" → Implementar. (No crear una implementación nueva.)
 */

const TOKEN = 'kaya-lab';   // debe coincidir con LAB.token en index.html
const HOJA_PLANES = 'lab_planes';
const HOJA_ENTREGAS = 'lab_entregas';
const COLS_PLANES = ['id', 'creado', 'desde', 'hasta', 'estado', 'cerrado', 'items', 'creado_por'];
const COLS_ENTREGAS = ['id', 'plan_id', 'fecha_hora', 'sku', 'cantidad', 'responsable', 'cargado_por', 'anulada'];

function doGet(e) {
  try {
    if ((e.parameter || {}).token !== TOKEN) return respuesta({ ok: false, error: 'token inválido' });
    return respuesta(estado());
  } catch (err) {
    return respuesta({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return respuesta({ ok: false, error: 'token inválido' });
    if (d.accion === 'crearPlan') crearPlan(d);
    else if (d.accion === 'cerrarPlan') cerrarPlan(d.id);
    else if (d.accion === 'entrega') registrarEntrega(d);
    else if (d.accion === 'anularEntrega') anularEntrega(d.id);
    else return respuesta({ ok: false, error: 'acción desconocida' });
    return respuesta(estado());
  } catch (err) {
    return respuesta({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// El plan abierto con sus entregas; si no hay abierto, el último cerrado (para que el
// laboratorio vea cómo terminó hasta que Tomi arme el siguiente).
function estado() {
  const planes = leer(HOJA_PLANES, COLS_PLANES);
  let plan = null;
  for (let i = planes.length - 1; i >= 0; i--) { if (planes[i].estado === 'abierto') { plan = planes[i]; break; } }
  if (!plan && planes.length) plan = planes[planes.length - 1];
  let entregas = [];
  if (plan) {
    plan.items = JSON.parse(plan.items || '[]');
    entregas = leer(HOJA_ENTREGAS, COLS_ENTREGAS)
      .filter(function (r) { return r.plan_id === plan.id && r.anulada !== 'si'; })
      .map(function (r) { r.cantidad = Number(r.cantidad) || 0; return r; });
  }
  return { ok: true, plan: plan, entregas: entregas, ahora: new Date().toISOString() };
}

function crearPlan(d) {
  if (!d.desde || !d.hasta) throw new Error('faltan las fechas del plan');
  const items = (d.items || [])
    .map(function (i) { return { sku: String(i.sku || '').trim(), cantidad: Math.round(Number(i.cantidad) || 0) }; })
    .filter(function (i) { return i.sku && i.cantidad > 0; });
  if (!items.length) throw new Error('el plan no tiene productos');
  // Un solo plan abierto a la vez: el nuevo cierra al anterior.
  cerrarAbiertos();
  hoja(HOJA_PLANES, COLS_PLANES).appendRow([
    'P' + Date.now(), new Date().toISOString(), d.desde, d.hasta, 'abierto', '',
    JSON.stringify(items), d.usuario || ''
  ]);
}

function cerrarAbiertos() {
  const sh = hoja(HOJA_PLANES, COLS_PLANES);
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const est = sh.getRange(2, 5, n, 1).getValues();
  est.forEach(function (r, i) {
    if (r[0] === 'abierto') sh.getRange(i + 2, 5, 1, 2).setValues([['cerrado', new Date().toISOString()]]);
  });
}

function cerrarPlan(id) {
  const sh = hoja(HOJA_PLANES, COLS_PLANES);
  const fila = buscarFila(sh, id);
  if (!fila) throw new Error('no se encontró el plan');
  sh.getRange(fila, 5, 1, 2).setValues([['cerrado', new Date().toISOString()]]);
}

function registrarEntrega(d) {
  const cant = Math.round(Number(d.cantidad) || 0);
  if (!d.plan_id || !d.sku || cant <= 0) throw new Error('entrega incompleta');
  hoja(HOJA_ENTREGAS, COLS_ENTREGAS).appendRow([
    'E' + Date.now(), d.plan_id, new Date().toISOString(), String(d.sku).trim(), cant,
    d.responsable || '', d.usuario || '', ''
  ]);
}

// Las entregas no se borran: se marcan anuladas, así queda el rastro de la corrección.
function anularEntrega(id) {
  const sh = hoja(HOJA_ENTREGAS, COLS_ENTREGAS);
  const fila = buscarFila(sh, id);
  if (!fila) throw new Error('no se encontró la entrega');
  sh.getRange(fila, COLS_ENTREGAS.indexOf('anulada') + 1).setValue('si');
}

// ── utilidades ──────────────────────────────────────────────────
function hoja(nombre, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@');   // todo como texto: que Sheets no reinterprete fechas ni ids
  }
  return sh;
}

function leer(nombre, cols) {
  const sh = hoja(nombre, cols);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, cols.length).getDisplayValues().map(function (r) {
    const o = {};
    cols.forEach(function (c, i) { o[c] = String(r[i]).trim(); });
    return o;
  });
}

function buscarFila(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1 || !id) return 0;
  const ids = sh.getRange(2, 1, n, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) { if (ids[i][0] === id) return i + 2; }
  return 0;
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
