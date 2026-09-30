import {existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const path=new URL('../.env.pc',import.meta.url);
if(!existsSync(path)){
  writeFileSync(path,`# PC only. Never upload this file or send it in chat.\nTRADE_OPERATOR_TOKEN=${randomBytes(32).toString('hex')}\nTRADING_ENABLED=false\nBITGET_DEMO=true\nBITGET_LIVE_ENABLED=false\nBITGET_API_KEY=\nBITGET_API_SECRET=\nBITGET_PASSPHRASE=\n`,{mode:0o600,flag:'wx'});
  console.log('Created .env.pc. Add exchange credentials locally; trading remains disabled.');
}else console.log('Existing .env.pc preserved.');
