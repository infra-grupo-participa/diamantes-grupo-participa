const SUMMARY_SHEET = 'Resumo';
const DIAMONDS_SHEET = 'Diamantes x Serviços';
const AREAS_SHEET = 'Equipe por Área';

const COLORS = {
  accent: '#F29725',
  accentSoft: '#FFF4E8',
  dark: '#111827',
  line: '#E2E8F0',
  text: '#0F172A',
  muted: '#64748B',
  successSoft: '#DCFCE7',
  successText: '#166534',
  dangerSoft: '#FEE2E2',
  dangerText: '#B91C1C',
};

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    validateSecret_(payload.secret);

    const spreadsheetId = getRequiredProperty_('GP_SPREADSHEET_ID');
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);

    const summarySheet = resetSheet_(spreadsheet, SUMMARY_SHEET);
    const diamondsSheet = resetSheet_(spreadsheet, DIAMONDS_SHEET);
    const areasSheet = resetSheet_(spreadsheet, AREAS_SHEET);

    writeSummarySheet_(summarySheet, payload.summary || {});
    writeDiamondsSheet_(diamondsSheet, payload.summary || {}, payload.diamonds || []);
    writeAreasSheet_(areasSheet, payload.summary || {}, payload.areas || [], payload.employees || []);

    return jsonOutput_({
      ok: true,
      message: 'Planilha atualizada com sucesso.',
      spreadsheetUrl: spreadsheet.getUrl(),
    });
  } catch (error) {
    return jsonOutput_({
      ok: false,
      error: error && error.message ? error.message : 'Erro ao atualizar a planilha.',
    });
  }
}

function parsePayload_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload inválido.');
  }
  return payload;
}

function validateSecret_(secret) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('GP_SYNC_SECRET') || '').trim();
  if (expected && String(secret || '').trim() !== expected) {
    throw new Error('Secret inválido.');
  }
}

function getRequiredProperty_(key) {
  const value = String(PropertiesService.getScriptProperties().getProperty(key) || '').trim();
  if (!value) {
    throw new Error(`A propriedade ${key} não foi configurada no Apps Script.`);
  }
  return value;
}

function resetSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  sheet.clear();
  sheet.clearFormats();
  sheet.setConditionalFormatRules([]);
  sheet.setFrozenRows(0);
  sheet.setHiddenGridlines(false);
  return sheet;
}

function writeSummarySheet_(sheet, summary) {
  const rows = [
    ['Exportado em', summary.exportedLabel || '—'],
    ['Quantidade de funcionários', Number(summary.employeeCount || 0)],
    ['Quantidade de diamantes', Number(summary.diamondCount || 0)],
    ['Serviços ativos', Number(summary.activeServiceCount || 0)],
    ['Serviços cancelados', Number(summary.canceledServiceCount || 0)],
  ];

  sheet.getRange('A1:D1').merge().setValue('Resumo da operação');
  sheet.getRange('A1').setBackground(COLORS.accent).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(16);

  sheet.getRange(3, 1, 1, 2).setValues([['Métrica', 'Valor']]);
  sheet.getRange(3, 1, 1, 2).setBackground(COLORS.dark).setFontColor('#FFFFFF').setFontWeight('bold');

  sheet.getRange(4, 1, rows.length, 2).setValues(rows);
  sheet.getRange(4, 1, rows.length, 2).setBorder(true, true, true, true, true, true, COLORS.line, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(4, 1, rows.length, 1).setFontWeight('bold');

  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 180);
  sheet.getRange(1, 1, Math.max(rows.length + 3, 8), 2).setVerticalAlignment('middle');
}

function writeDiamondsSheet_(sheet, summary, diamonds) {
  sheet.getRange('A1:E1').merge().setValue('Diamantes x Serviços');
  sheet.getRange('A1').setBackground(COLORS.accent).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(16);

  sheet.getRange('A2:E2').merge().setValue(`Atualizado em ${summary.exportedLabel || '—'}`);
  sheet.getRange('A2').setFontColor(COLORS.muted).setFontSize(10);

  let row = 4;

  if (!diamonds.length) {
    sheet.getRange(row, 1, 1, 5).merge().setValue('Nenhum diamante encontrado para exportação.');
    sheet.getRange(row, 1, 1, 5).setBackground(COLORS.accentSoft).setFontWeight('bold');
    finalizeDiamondsSheet_(sheet, row);
    return;
  }

  diamonds.forEach((diamond) => {
    sheet.getRange(row, 1, 1, 5).merge().setValue(diamond.name || 'Diamante sem nome');
    sheet.getRange(row, 1, 1, 5).setBackground(COLORS.accentSoft).setFontColor(COLORS.text).setFontWeight('bold').setFontSize(13);
    row += 1;

    sheet.getRange(row, 1, 1, 5).setValues([[
      `Slug: ${diamond.slug || '—'}`,
      `Ativos: ${Number(diamond.activeServices || 0)}`,
      `Cancelados: ${Number(diamond.canceledServices || 0)}`,
      `Nota média: ${formatScore_(diamond.averageRating)}`,
      `Avaliações: ${Number(diamond.totalRatings || 0)}`,
    ]]);
    sheet.getRange(row, 1, 1, 5).setFontColor(COLORS.muted).setFontSize(10);
    row += 1;

    sheet.getRange(row, 1, 1, 5).setValues([[
      'Serviço',
      'Funcionário',
      'Status',
      'Nota média do cliente',
      'Avaliações',
    ]]);
    sheet.getRange(row, 1, 1, 5).setBackground(COLORS.dark).setFontColor('#FFFFFF').setFontWeight('bold');
    row += 1;

    const services = Array.isArray(diamond.services) ? diamond.services : [];
    if (!services.length) {
      sheet.getRange(row, 1, 1, 5).setValues([[
        'Sem serviço cadastrado',
        '—',
        '—',
        formatScore_(diamond.averageRating),
        Number(diamond.totalRatings || 0),
      ]]);
      sheet.getRange(row, 1, 1, 5).setBorder(true, true, true, true, true, true, COLORS.line, SpreadsheetApp.BorderStyle.SOLID);
      row += 2;
      return;
    }

    services.forEach((service) => {
      sheet.getRange(row, 1, 1, 5).setValues([[
        service.service || '—',
        service.employee || '—',
        service.status || 'Ativo',
        formatScore_(diamond.averageRating),
        Number(diamond.totalRatings || 0),
      ]]);
      sheet.getRange(row, 1, 1, 5).setBorder(true, true, true, true, true, true, COLORS.line, SpreadsheetApp.BorderStyle.SOLID);

      const statusRange = sheet.getRange(row, 3);
      const isCanceled = String(service.status || '').toLowerCase() === 'cancelado';
      statusRange
        .setBackground(isCanceled ? COLORS.dangerSoft : COLORS.successSoft)
        .setFontColor(isCanceled ? COLORS.dangerText : COLORS.successText)
        .setFontWeight('bold');
      row += 1;
    });

    row += 1;
  });

  finalizeDiamondsSheet_(sheet, row);
}

function finalizeDiamondsSheet_(sheet, lastRow) {
  sheet.setColumnWidth(1, 230);
  sheet.setColumnWidth(2, 230);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 120);
  sheet.getRange(1, 1, Math.max(lastRow, 8), 5).setVerticalAlignment('middle').setWrap(true);
}

function writeAreasSheet_(sheet, summary, areas, employees) {
  sheet.getRange('A1:E1').merge().setValue('Equipe por Área');
  sheet.getRange('A1').setBackground(COLORS.accent).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(16);

  sheet.getRange('A2:E2').merge().setValue(`Funcionários mapeados: ${Number(summary.employeeCount || 0)}`);
  sheet.getRange('A2').setFontColor(COLORS.muted).setFontSize(10);

  let row = 4;
  sheet.getRange(row, 1, 1, 5).merge().setValue('Visão por área');
  sheet.getRange(row, 1, 1, 5).setBackground(COLORS.accentSoft).setFontWeight('bold');
  row += 1;

  sheet.getRange(row, 1, 1, 3).setValues([['Área', 'Quantidade de funcionários', 'Funcionários']]);
  sheet.getRange(row, 1, 1, 3).setBackground(COLORS.dark).setFontColor('#FFFFFF').setFontWeight('bold');
  row += 1;

  if (!areas.length) {
    sheet.getRange(row, 1, 1, 3).setValues([['Sem áreas cadastradas', 0, '—']]);
    row += 2;
  } else {
    areas.forEach((area) => {
      sheet.getRange(row, 1, 1, 3).setValues([[
        area.area || '—',
        Number(area.totalEmployees || 0),
        Array.isArray(area.employees) && area.employees.length ? area.employees.join(', ') : '—',
      ]]);
      sheet.getRange(row, 1, 1, 3).setBorder(true, true, true, true, true, true, COLORS.line, SpreadsheetApp.BorderStyle.SOLID);
      row += 1;
    });
    row += 1;
  }

  sheet.getRange(row, 1, 1, 5).merge().setValue('Desempenho individual');
  sheet.getRange(row, 1, 1, 5).setBackground(COLORS.accentSoft).setFontWeight('bold');
  row += 1;

  sheet.getRange(row, 1, 1, 5).setValues([[
    'Funcionário',
    'Diamantes ativos',
    'Serviços cancelados',
    'Nota média',
    'Avaliações',
  ]]);
  sheet.getRange(row, 1, 1, 5).setBackground(COLORS.dark).setFontColor('#FFFFFF').setFontWeight('bold');
  row += 1;

  if (!employees.length) {
    sheet.getRange(row, 1, 1, 5).setValues([['Sem funcionários cadastrados', 0, 0, 'Sem nota', 0]]);
  } else {
    employees.forEach((employee) => {
      sheet.getRange(row, 1, 1, 5).setValues([[
        employee.name || '—',
        Number(employee.activeDiamonds || 0),
        Number(employee.canceledServices || 0),
        formatScore_(employee.averageRating),
        Number(employee.totalRatings || 0),
      ]]);
      sheet.getRange(row, 1, 1, 5).setBorder(true, true, true, true, true, true, COLORS.line, SpreadsheetApp.BorderStyle.SOLID);
      row += 1;
    });
  }

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 170);
  sheet.setColumnWidth(3, 380);
  sheet.setColumnWidth(4, 120);
  sheet.setColumnWidth(5, 110);
  sheet.getRange(1, 1, Math.max(row, 8), 5).setVerticalAlignment('middle').setWrap(true);
}

function formatScore_(value) {
  if (value === null || value === undefined || value === '') {
    return 'Sem nota';
  }
  return `${Number(value).toFixed(1)} / 10`;
}

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
