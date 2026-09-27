import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
export function embedded(text) {
 const marker=/window\.__COIN_DATA__\s*=\s*/.exec(text); if(!marker)throw Error('Missing candle data');
 const start=marker.index+marker[0].length;let depth=0,quoted=false,escaped=false;
 for(let i=start;i<text.length;i++){const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)return JSON.parse(text.slice(start,i+1));}
 throw Error('Incomplete candle data');
}
const markets=['BTC','ETH','XRP','SOL','ADA','DOGE','AVAX','DOT','XLM','UNI','LINK','ONDO'],data={};
for(const coin of markets){const d=embedded(await readFile(new URL(`${coin}-MACD-RSI-V2.3-ALL.html`,root),'utf8'));data[d.market]=d.candles.d1;}
await writeFile(new URL('baseline-data.js',root),'window.__BASELINE_DAILY__='+JSON.stringify(data)+';\n');
console.log('Generated baseline daily candles for '+markets.length+' markets');
