import { readFile, writeFile } from 'node:fs/promises';
for (const file of ['index.html', 'MACD-RSI-V2.3-전체코인-백테스트.html', 'BTC-MACD-RSI-V2.3-ALL.html']) {
  const path = new URL('../' + file, import.meta.url); let text = await readFile(path, 'utf8');
  const tag = '<script type="module" src="position/dashboard.mjs?v=1.17"></script>';
  if (!text.includes('position/dashboard.mjs')) text = text.replace('</body>', '  ' + tag + '\n</body>');
  await writeFile(path, text.replaceAll('V1.15', 'V1.17').replaceAll('V1.16', 'V1.17').replaceAll('dashboard.mjs?v=1.16','dashboard.mjs?v=1.17'));
}
