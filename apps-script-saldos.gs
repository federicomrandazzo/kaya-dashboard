/**
 * KAYA · Guardado de saldos desde el dashboard
 * ─────────────────────────────────────────────
 * Este script vive en el ARCHIVO DE FLUJO DE FONDOS (no en el dashboard).
 * Recibe los saldos que Ry/Federico guardan desde el módulo Finanzas
 * y los escribe en la hoja "saldos".
 *
 * Layout esperado de la hoja saldos (el real de Federico):
 *   - una fila arriba con "fecha" en col A y la fecha en col B (se pisa con el día del guardado)
 *   - la fila TOTAL con fórmula =SUM(B8:B27) — NO se toca
 *   - encabezados "cuenta | saldo" en la fila 7
 *   - las cuentas en A8:B27 (máx. 20) — este rango se reescribe completo al guardar,
 *     lo que permite renombrar cuentas y agregar nuevas desde el dashboard
 *
 * CÓMO INSTALARLO (una sola vez, ~3 minutos):
 * 1. Abrir el Google Sheets del flujo de fondos.
 * 2. Extensiones → Apps Script. Borrar lo que haya y pegar este archivo entero.
 * 3. Ajustar HOJA_SALDOS abajo si la hoja no se llama exactamente "saldos".
 * 4. Botón "Implementar" (Deploy) → "Nueva implementación" → tipo "Aplicación web":
 *      - Ejecutar como: Yo (tu cuenta)
 *      - Quién tiene acceso: Cualquier usuario ("Anyone")
 * 5. Autorizar los permisos cuando lo pida.
 * 6. Copiar la URL que termina en /exec y pasársela a Claude para
 *    pegarla en FIN.appsScript del index.html del dashboard.
 */

const TOKEN = 'kaya-fin';          // debe coincidir con FIN.token en index.html
const HOJA_SALDOS = 'saldos';      // nombre exacto de la hoja de saldos
const FILA_INICIO = 8;             // primera fila de cuentas (A8)
const FILA_FIN = 27;               // última fila de cuentas (B27) — rango de la fórmula TOTAL

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== TOKEN) return respuesta({ ok: false, error: 'token inválido' });
    if (!Array.isArray(data.saldos)) return respuesta({ ok: false, error: 'payload sin saldos' });

    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_SALDOS);
    if (!sh) return respuesta({ ok: false, error: 'no existe la hoja "' + HOJA_SALDOS + '"' });

    // Reescribir el bloque de cuentas A8:B27 completo (permite renombrar y agregar)
    const n = FILA_FIN - FILA_INICIO + 1;
    const filas = [];
    for (let i = 0; i < n; i++) {
      const s = data.saldos[i];
      filas.push(s && s.cuenta ? [String(s.cuenta), Number(s.saldo) || 0] : ['', '']);
    }
    sh.getRange(FILA_INICIO, 1, n, 2).setValues(filas);

    // Actualizar la celda de fecha (fila con "fecha" en col A, arriba del bloque)
    const hoyStr = Utilities.formatDate(new Date(), 'America/Argentina/Cordoba', 'd/MM/yyyy');
    const arriba = sh.getRange(1, 1, FILA_INICIO - 1, 1).getValues();
    for (let i = 0; i < arriba.length; i++) {
      if (String(arriba[i][0]).trim().toLowerCase() === 'fecha') {
        sh.getRange(i + 1, 2).setValue(hoyStr);
        break;
      }
    }

    return respuesta({ ok: true, fecha: hoyStr });
  } catch (err) {
    return respuesta({ ok: false, error: String(err) });
  }
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
