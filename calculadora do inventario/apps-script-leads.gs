const SHEET_NAME = "Leads";
const HEADERS = ["Data", "Nome", "Email", "Origem", "Pagina"];

function doGet() {
  return jsonResponse_({
    ok: true,
    message: "Apps Script ativo."
  });
}

function doPost(e) {
  const payload = parsePayload_(e);
  const sheet = getOrCreateSheet_();

  sheet.appendRow([
    new Date(),
    payload.name || "",
    payload.email || "",
    payload.source || "",
    payload.page || ""
  ]);

  return jsonResponse_({
    ok: true
  });
}

function parsePayload_(e) {
  const params = (e && e.parameter) || {};

  if (e && e.postData && e.postData.contents) {
    const contentType = String(e.postData.type || "");

    if (contentType.indexOf("application/json") !== -1) {
      try {
        return JSON.parse(e.postData.contents);
      } catch (error) {
      }
    }
  }

  return {
    timestamp: params.timestamp || "",
    name: params.name || "",
    email: params.email || "",
    source: params.source || "",
    page: params.page || ""
  };
}

function getOrCreateSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }

  return sheet;
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
