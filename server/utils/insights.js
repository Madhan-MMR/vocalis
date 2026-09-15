export function summarizeCalls(calls = []) {
  const byBand = { low: 0, watch: 0, elevated: 0, high: 0 };
  let totalRisk = 0;
  const numbers = new Set();

  for (const call of calls) {
    const band = call.band || 'low';
    byBand[band] = (byBand[band] || 0) + 1;
    totalRisk += Number(call.risk || 0);
    if (call.phoneNumber) numbers.add(String(call.phoneNumber));
  }

  return {
    total: calls.length,
    byBand,
    averageRisk: calls.length ? totalRisk / calls.length : 0,
    uniqueNumbers: numbers.size,
    maxRisk: calls.reduce((max, call) => Math.max(max, Number(call.risk || 0)), 0)
  };
}

export function toCsv(rows = []) {
  const headers = ['phoneNumber', 'risk', 'band', 'headline'];
  const values = rows.map((row) => [
    row.phoneNumber ?? '',
    Number(row.risk ?? 0),
    row.band ?? 'low',
    String(row.headline ?? '').replace(/\r?\n/g, ' ')
  ]);

  const lines = [headers.join(',')].concat(values.map((entry) => entry.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')));
  return lines.join('\n');
}
