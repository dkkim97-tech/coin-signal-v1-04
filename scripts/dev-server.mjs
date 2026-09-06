import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import candles from '../api/candles.js';
import marketContext from '../api/market-context.js';
import exchange from '../api/exchange.js';
import trading from '../api/trading.js';
const root = resolve(new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const handlers={'/api/candles':candles,'/api/market-context':marketContext,'/api/exchange':exchange,'/api/trading':trading};
    if (handlers[url.pathname]) {
      req.query = Object.fromEntries(url.searchParams); res.status = code => { res.statusCode = code; return res; }; res.json = payload => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)); };
      if(req.method==='POST'){let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)return res.status(413).json({error:'Too large'});}req.body=body?JSON.parse(body):{};}
      return await handlers[url.pathname](req,res);
    }
    let path = decodeURIComponent(url.pathname).replace(/^\/futures(?=\/|$)/, '') || '/';
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep) || path.includes('/.') || /^\/(server|node_modules|test)\//.test(path)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', (mime[extname(file)] || 'application/octet-stream') + '; charset=utf-8');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4186, '127.0.0.1', () => console.log('http://127.0.0.1:4186/futures/'));
