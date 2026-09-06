import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import candles from '../api/candles.js';
import marketContext from '../api/market-context.js';
const root = resolve(new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/candles' || url.pathname === '/api/market-context') {
      req.query = Object.fromEntries(url.searchParams); res.status = code => { res.statusCode = code; return res; }; res.json = payload => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)); }; return await (url.pathname === '/api/candles' ? candles : marketContext)(req, res);
    }
    let path = decodeURIComponent(url.pathname).replace(/^\/futures(?=\/|$)/, '') || '/';
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep) || path.includes('/.')) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', (mime[extname(file)] || 'application/octet-stream') + '; charset=utf-8');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4186, '127.0.0.1', () => console.log('http://127.0.0.1:4186/futures/'));
