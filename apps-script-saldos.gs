/**
 * KAYA · Web App del dashboard (saldos + marcar pagados)
 * ──────────────────────────────────────────────────────
 * Vive en el ARCHIVO DE FLUJO DE FONDOS. Dos funciones:
 *   1) Guardar saldos     → escribe A8:B27 de la hoja "saldos" + celda fecha
 *   2) Marcar pagados     → escribe "pagado por dashboard" en la columna N de
 *      la hoja "base de datos" (y la fecha de pago en FECHA REAL, col G, si viene)
 *
 * ⚠ CÓMO ACTUALIZAR SI YA ESTABA DESPLEGADO (para que la URL siga siendo la misma):
 * 1. Extensiones → Apps Script → reemplazar TODO el código por este archivo y guardar.
 * 2. Implementar → ADMINISTRAR IMPLEMENTACIONES → lápiz (editar)
 *    → en "Versión" elegir "Nueva versión" → Implementar.
 *    (NO crear una "Nueva implementación": eso cambia la URL.)
 *
 * Instalación desde cero: ver instrucciones de la versión anterior
 * (Implementar → Nueva implementación → Aplicación web → Ejecutar como: Yo →
 *  Acceso: Cualquier usuario → autorizar → copiar URL /exec).
 */

const TOKEN = 'kaya-fin';            // debe coincidir con FIN.token en index.html
const HOJA_SALDOS = 'saldos';        // hoja de saldos
const FILA_INICIO = 8;               // primera fila de cuentas (A8)
const FILA_FIN = 27;                 // última fila de cuentas (B27) — rango de la fórmula TOTAL
const HOJA_BASE = 'base de datos';   // hoja del recopilador
const COL_FECHA_REAL = 7;            // columna G = FECHA REAL
const COL_PAGADO = 14;               // columna N = "pagado por dashboard"

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== TOKEN) return respuesta({ ok: false, error: 'token inválido' });
    if (data.accion === 'pagar') return marcarPagados(data);
    if (Array.isArray(data.saldos)) return guardarSaldos(data);
    return respuesta({ ok: false, error: 'acción desconocida' });
  } catch (err) {
    return respuesta({ ok: false, error: String(err) });
  }
}

// ── 1) SALDOS ────────────────────────────────────────────────────
function guardarSaldos(data) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_SALDOS);
  if (!sh) return respuesta({ ok: false, error: 'no existe la hoja "' + HOJA_SALDOS + '"' });

  const n = FILA_FIN - FILA_INICIO + 1;
  const filas = [];
  for (let i = 0; i < n; i++) {
    const s = data.saldos[i];
    filas.push(s && s.cuenta ? [String(s.cuenta), Number(s.saldo) || 0] : ['', '']);
  }
  sh.getRange(FILA_INICIO, 1, n, 2).setValues(filas);

  const hoyStr = Utilities.formatDate(new Date(), 'America/Argentina/Cordoba', 'd/MM/yyyy');
  const arriba = sh.getRange(1, 1, FILA_INICIO - 1, 1).getValues();
  for (let i = 0; i < arriba.length; i++) {
    if (String(arriba[i][0]).trim().toLowerCase() === 'fecha') {
      sh.getRange(i + 1, 2).setValue(hoyStr);
      break;
    }
  }
  return respuesta({ ok: true, fecha: hoyStr });
}

// ── 2) MARCAR PAGADOS ────────────────────────────────────────────
// Verifica FUENTE y CONCEPTO de cada fila antes de escribir, por si la hoja
// cambió entre que el dashboard cargó y guardó (filas corridas → no escribe).
function marcarPagados(data) {
  if (!Array.isArray(data.pagos) || !data.pagos.length) return respuesta({ ok: false, error: 'payload sin pagos' });
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_BASE);
  if (!sh) return respuesta({ ok: false, error: 'no existe la hoja "' + HOJA_BASE + '"' });

  const marcadas = [], rechazadas = [];
  data.pagos.forEach(function (p) {
    const fila = Number(p.fila);
    if (!fila || fila < 3 || fila > sh.getLastRow()) { rechazadas.push(fila); return; }
    const vals = sh.getRange(fila, 1, 1, 4).getValues()[0]; // A..D
    const okFuente = String(vals[0]).trim().toLowerCase() === String(p.fuente || '').trim().toLowerCase();
    const okConc = String(vals[3]).trim().toLowerCase() === String(p.concepto || '').trim().toLowerCase();
    if (!okFuente || !okConc) { rechazadas.push(fila); return; }
    sh.getRange(fila, COL_PAGADO).setValue('pagado por dashboard');
    if (p.fecha && String(p.fecha).trim()) sh.getRange(fila, COL_FECHA_REAL).setValue(String(p.fecha).trim());
    marcadas.push(fila);
  });

  return respuesta({ ok: true, marcadas: marcadas, rechazadas: rechazadas });
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
