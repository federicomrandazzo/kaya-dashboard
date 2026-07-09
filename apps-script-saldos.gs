/**
 * KAYA · Guardado de saldos desde el dashboard
 * ─────────────────────────────────────────────
 * Este script vive en el ARCHIVO DE FLUJO DE FONDOS (no en el dashboard).
 * Recibe los saldos que Ry/Federico guardan desde el módulo Finanzas
 * y los escribe en la hoja "saldos".
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
 *
 * La hoja "saldos" debe tener encabezados en la fila 1:  cuenta | saldo | actualizado
 */

const TOKEN = 'kaya-fin';          // debe coincidir con FIN.token en index.html
const HOJA_SALDOS = 'saldos';      // nombre exacto de la hoja de saldos

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== TOKEN) return respuesta({ ok: false, error: 'token inválido' });
    if (!Array.isArray(data.saldos)) return respuesta({ ok: false, error: 'payload sin saldos' });

    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_SALDOS);
    if (!sh) return respuesta({ ok: false, error: 'no existe la hoja "' + HOJA_SALDOS + '"' });

    const ahora = Utilities.formatDate(new Date(), 'America/Argentina/Cordoba', 'dd/MM/yyyy HH:mm');
    const valores = sh.getDataRange().getValues(); // fila 1 = encabezados

    data.saldos.forEach(function (s) {
      if (!s.cuenta) return;
      let fila = -1;
      for (let i = 1; i < valores.length; i++) {
        if (String(valores[i][0]).trim().toLowerCase() === String(s.cuenta).trim().toLowerCase()) { fila = i + 1; break; }
      }
      if (fila < 0) { fila = sh.getLastRow() + 1; sh.getRange(fila, 1).setValue(s.cuenta); }
      sh.getRange(fila, 2).setValue(Number(s.saldo) || 0);
      sh.getRange(fila, 3).setValue(ahora);
    });

    return respuesta({ ok: true, actualizado: ahora });
  } catch (err) {
    return respuesta({ ok: false, error: String(err) });
  }
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
