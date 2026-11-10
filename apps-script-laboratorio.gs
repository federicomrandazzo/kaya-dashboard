/**
 * KAYA · Plan del laboratorio (Web App del dashboard)
 * ────────────────────────────────────────────────────
 * Vive en la PLANILLA DE PRODUCCIÓN (la misma de las hojas produccion y armado_cajas).
 *   1) Guarda el plan que arma Tomi en el dashboard.
 *   2) Cada 10 minutos lee de Dux los INGRESOS de stock (la producción que Tomi da de alta)
 *      y los guarda: de ahí sale lo entregado, sin cargar nada dos veces.
 *   3) Producción ANTICIPADA: si Tomi escribe "ANTICIPADA" en las observaciones del ingreso
 *      en Dux (se da de alta para poder vender, pero se envasa después), el dashboard la
 *      muestra como pendiente para el lab hasta que Tomi toca "Ya se envasó".
 *
 * Crea solas, la primera vez, dos hojas:
 *   lab_planes   → un plan por fila (desde, hasta, estado, items en JSON)
 *   lab_ingresos → una fila por producto de cada ingreso de Dux (+ si es anticipada y cuándo se envasó)
 *
 * INSTALACIÓN (una sola vez):
 * 1. Abrir la planilla de producción → Extensiones → Apps Script.
 * 2. Archivo nuevo (+ → Secuencia de comandos), pegar TODO este código y guardar.
 * 3. Configuración del proyecto (engranaje) → Propiedades de la secuencia de comandos
 *    → Agregar propiedad: DUX_TOKEN = el mismo token de Dux que usa la sincronización de ventas.
 * 4. Elegir la función instalarActivador en la barra de arriba → Ejecutar → autorizar.
 *    (Deja programada la lectura de Dux cada 10 minutos y hace la primera lectura.)
 * 5. Implementar → Nueva implementación → tipo "Aplicación web"
 *    → Ejecutar como: Yo → Quién tiene acceso: Cualquier usuario → Implementar.
 * 6. Copiar la URL que termina en /exec y pasársela a Claude (va en LAB.url del index.html).
 *
 * PARA ACTUALIZAR después: pegar el código nuevo y guardar (el activador ya usa lo guardado);
 * para la URL del dashboard: Implementar → Administrar implementaciones → lápiz
 * → Versión: "Nueva versión" → Implementar. (No crear una implementación nueva.)
 */

const TOKEN = 'kaya-lab';   // debe coincidir con LAB.token en index.html
const HOJA_PLANES = 'lab_planes';
const HOJA_INGRESOS = 'lab_ingresos';
const COLS_PLANES = ['id', 'creado', 'desde', 'hasta', 'estado', 'cerrado', 'items', 'creado_por'];
const COLS_INGRESOS = ['mov_id', 'fecha', 'personal', 'observaciones', 'anticipada', 'sku', 'producto',
                       'cantidad', 'visto_en', 'anulado', 'envasado_en', 'envasado_por'];
const DUX_BASE = 'https://erp.duxsoftware.com.ar/WSERP/rest/services';
const VENTANA_DIAS = 21;   // días hacia atrás que se releen en cada lectura (detecta anulaciones)
const TZ = 'America/Argentina/Cordoba';

// ── WEB APP ─────────────────────────────────────────────────────
function doGet(e) {
  try {
    const p = e.parameter || {};
    if (p.token !== TOKEN) return respuesta({ ok: false, error: 'token inválido' });
    let aviso = '';
    // "Traer de Dux ahora" desde el dashboard: como mucho una vez por minuto.
    if (p.refrescar) {
      const ult = Number(PropertiesService.getScriptProperties().getProperty('ULTIMO_SYNC') || 0);
      if (Date.now() - ult > 60000) {
        const lock = LockService.getScriptLock();
        if (lock.tryLock(5000)) {
          try { syncIngresos_(); } catch (err) { aviso = String(err); } finally { lock.releaseLock(); }
        } else aviso = 'ya se está leyendo Dux; probá en un minuto';
      }
    }
    const est = estado_();
    if (aviso) est.aviso = aviso;
    return respuesta(est);
  } catch (err) {
    return respuesta({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return respuesta({ ok: false, error: 'token inválido' });
    if (d.accion === 'crearPlan') crearPlan_(d);
    else if (d.accion === 'cerrarPlan') cerrarPlan_(d.id);
    else if (d.accion === 'confirmarEnvasado') confirmarEnvasado_(d);
    else return respuesta({ ok: false, error: 'acción desconocida' });
    return respuesta(estado_());
  } catch (err) {
    return respuesta({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// El plan abierto (si no hay, el último cerrado) + los ingresos de Dux de la ventana
// + todas las anticipadas que todavía no se envasaron, sean de la fecha que sean.
function estado_() {
  const planes = leer_(HOJA_PLANES, COLS_PLANES);
  let plan = null;
  for (let i = planes.length - 1; i >= 0; i--) { if (planes[i].estado === 'abierto') { plan = planes[i]; break; } }
  if (!plan && planes.length) plan = planes[planes.length - 1];
  if (plan) {
    plan.items = JSON.parse(plan.items || '[]');
    plan.cerrado_fecha = plan.cerrado ? Utilities.formatDate(new Date(plan.cerrado), TZ, 'yyyy-MM-dd') : '';
  }
  const desde = Utilities.formatDate(new Date(Date.now() - (VENTANA_DIAS + 14) * 86400000), TZ, 'yyyy-MM-dd');
  const ingresos = leer_(HOJA_INGRESOS, COLS_INGRESOS)
    .filter(function (r) {
      if (r.anulado === 'si') return false;
      return r.fecha >= desde || (plan && r.fecha >= plan.desde) || (r.anticipada === 'si' && !r.envasado_en);
    })
    .map(function (r) {
      return { mov_id: r.mov_id, fecha: r.fecha, personal: r.personal, anticipada: r.anticipada === 'si',
               sku: r.sku, producto: r.producto, cantidad: Number(r.cantidad) || 0, visto_en: Number(r.visto_en) || 0,
               envasado_en: r.envasado_en, envasado_por: r.envasado_por };
    });
  const ult = Number(PropertiesService.getScriptProperties().getProperty('ULTIMO_SYNC') || 0);
  return { ok: true, plan: plan, ingresos: ingresos, ultimoSync: ult, ahora: Date.now() };
}

// ── PLANES ──────────────────────────────────────────────────────
function crearPlan_(d) {
  if (!d.desde || !d.hasta) throw new Error('faltan las fechas del plan');
  const items = (d.items || [])
    .map(function (i) { return { sku: String(i.sku || '').trim(), cantidad: Math.round(Number(i.cantidad) || 0) }; })
    .filter(function (i) { return i.sku && i.cantidad > 0; });
  if (!items.length) throw new Error('el plan no tiene productos');
  cerrarAbiertos_();   // un solo plan abierto a la vez: el nuevo cierra al anterior
  hoja_(HOJA_PLANES, COLS_PLANES).appendRow([
    'P' + Date.now(), new Date().toISOString(), d.desde, d.hasta, 'abierto', '', JSON.stringify(items), d.usuario || ''
  ]);
}

function cerrarAbiertos_() {
  const sh = hoja_(HOJA_PLANES, COLS_PLANES);
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  sh.getRange(2, 5, n, 1).getValues().forEach(function (r, i) {
    if (r[0] === 'abierto') sh.getRange(i + 2, 5, 1, 2).setValues([['cerrado', new Date().toISOString()]]);
  });
}

function cerrarPlan_(id) {
  const sh = hoja_(HOJA_PLANES, COLS_PLANES);
  const fila = buscarFila_(sh, 1, id);
  if (!fila) throw new Error('no se encontró el plan');
  sh.getRange(fila, 5, 1, 2).setValues([['cerrado', new Date().toISOString()]]);
}

// "Ya se envasó" de una anticipada (un producto de un ingreso).
function confirmarEnvasado_(d) {
  const sh = hoja_(HOJA_INGRESOS, COLS_INGRESOS);
  const n = sh.getLastRow() - 1;
  if (n < 1) throw new Error('no hay ingresos');
  const vals = sh.getRange(2, 1, n, COLS_INGRESOS.length).getDisplayValues();
  const cMov = COLS_INGRESOS.indexOf('mov_id'), cSku = COLS_INGRESOS.indexOf('sku'), cEnv = COLS_INGRESOS.indexOf('envasado_en');
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][cMov] === String(d.mov_id) && vals[i][cSku] === String(d.sku)) {
      const hoy = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
      sh.getRange(i + 2, cEnv + 1, 1, 2).setValues([[hoy, d.usuario || '']]);
      return;
    }
  }
  throw new Error('no se encontró ese ingreso');
}

// ── LECTURA DE DUX ──────────────────────────────────────────────
// Lo llama el activador cada 10 minutos (6 a 23 h) y el botón "Traer de Dux ahora".
function actualizarIngresos() {
  const h = Number(Utilities.formatDate(new Date(), TZ, 'H'));
  if (h < 6 || h > 23) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try { syncIngresos_(); } finally { lock.releaseLock(); }
}

function syncIngresos_() {
  const hoy = new Date();
  const desde = Utilities.formatDate(new Date(hoy.getTime() - VENTANA_DIAS * 86400000), TZ, 'yyyy-MM-dd');
  const hasta = Utilities.formatDate(new Date(hoy.getTime() + 86400000), TZ, 'yyyy-MM-dd');
  // 1) Lista de ingresos emitidos de la ventana (paginada de a 50).
  const lista = [];
  let offset = 0, total = null;
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const r = dux_('/v2/ingresos-egresos-stock?tipo=INGRESO&estado=EMITIDO&limit=50&offset=' + offset +
                   '&fecha_desde=' + desde + '&fecha_hasta=' + hasta);
    const datos = r.datos || [];
    if (total === null) total = (r.paginacion && r.paginacion.total) || 0;
    datos.forEach(function (m) { lista.push(m); });
    offset += 50;
    if (!datos.length || lista.length >= total) break;
  }
  if (total && lista.length < total) throw new Error('Dux cortó la lista: ' + lista.length + ' de ' + total);

  const sh = hoja_(HOJA_INGRESOS, COLS_INGRESOS);
  const n = sh.getLastRow() - 1;
  const actuales = n > 0 ? sh.getRange(2, 1, n, COLS_INGRESOS.length).getDisplayValues() : [];
  const cMov = COLS_INGRESOS.indexOf('mov_id'), cFecha = COLS_INGRESOS.indexOf('fecha'), cAnul = COLS_INGRESOS.indexOf('anulado');
  const conocidos = {};
  actuales.forEach(function (r) { conocidos[r[cMov]] = true; });
  const enLista = {};
  lista.forEach(function (m) { enLista[String(m.id_ingreso_egreso_stock)] = true; });

  // 2) Detalle solo de los ingresos nuevos (lo ya leído no cambia).
  const ahora = Date.now(), nuevas = [];
  lista.forEach(function (m) {
    const id = String(m.id_ingreso_egreso_stock);
    if (conocidos[id]) return;
    const d = dux_('/v2/ingresos-egresos-stock/' + id);
    const cab = d.datos || d;
    const obs = String(cab.observaciones || m.observaciones || '').trim();
    const anticipada = /ANTICIPAD/i.test(obs) ? 'si' : '';
    (cab.items || []).forEach(function (it) {
      if (String(it.tipo || 'INGRESO').toUpperCase() !== 'INGRESO') return;
      nuevas.push([id, cab.fecha || m.fecha || '', cab.personal || m.personal || '', obs, anticipada,
                   String(it.cod_item || '').trim(), it.item || '', Number(it.cantidad) || 0, String(ahora), '', '', '']);
    });
  });
  if (nuevas.length) sh.getRange(sh.getLastRow() + 1, 1, nuevas.length, COLS_INGRESOS.length).setValues(nuevas);

  // 3) Los que estaban y ya no vienen dentro de la ventana: se anularon en Dux.
  actuales.forEach(function (r, i) {
    if (r[cFecha] >= desde && r[cAnul] !== 'si' && !enLista[r[cMov]]) sh.getRange(i + 2, cAnul + 1).setValue('si');
  });
  PropertiesService.getScriptProperties().setProperty('ULTIMO_SYNC', String(Date.now()));
}

// Respeta el límite de Dux (1 consulta cada 5 s, compartido con la sincronización de ventas):
// espera 6 s entre consultas y reintenta si Dux contesta 429 o una respuesta vacía.
function dux_(path) {
  const token = PropertiesService.getScriptProperties().getProperty('DUX_TOKEN');
  if (!token) throw new Error('falta la propiedad DUX_TOKEN');
  for (let intento = 0; intento < 4; intento++) {
    Utilities.sleep(intento ? 12000 : 6000);
    const res = UrlFetchApp.fetch(DUX_BASE + path, {
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' }, muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 200) { try { return JSON.parse(res.getContentText()); } catch (e) {} }
    else if (code !== 429 && code < 500) throw new Error('Dux respondió ' + code + ': ' + res.getContentText().slice(0, 200));
  }
  throw new Error('Dux no respondió después de 4 intentos');
}

// Ejecutar UNA vez a mano: programa la lectura cada 10 minutos y hace la primera.
function instalarActivador() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'actualizarIngresos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('actualizarIngresos').timeBased().everyMinutes(10).create();
  syncIngresos_();
}

// ── UTILIDADES ──────────────────────────────────────────────────
function hoja_(nombre, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange('A:Z').setNumberFormat('@');   // todo como texto: que Sheets no reinterprete fechas ni ids
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function leer_(nombre, cols) {
  const sh = hoja_(nombre, cols);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, cols.length).getDisplayValues().map(function (r) {
    const o = {};
    cols.forEach(function (c, i) { o[c] = String(r[i]).trim(); });
    return o;
  });
}

function buscarFila_(sh, col, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1 || !id) return 0;
  const ids = sh.getRange(2, col, n, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) { if (ids[i][0] === id) return i + 2; }
  return 0;
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
