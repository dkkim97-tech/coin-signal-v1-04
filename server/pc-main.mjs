import {createPcRuntime} from './pc-runtime.mjs';
import {spawn} from 'node:child_process';
// Isolate this launcher from cloud/Upbit execution settings.
process.env.UPBIT_LIVE_ENABLED='false';
const runtime=createPcRuntime();
console.log('PC 선물 실행기:',await runtime.listen());
console.log('시작 시 자동매매는 OFF입니다. 종료 전 화면의 PC 실행기 종료 버튼을 이용하세요.');
if(process.platform==='win32'&&process.argv.includes('--open'))spawn('powershell.exe',['-NoProfile','-Command',"Start-Process 'http://127.0.0.1:4187/pc/'"],{windowsHide:true,stdio:'ignore'}).on('error',()=>console.log('브라우저에서 http://127.0.0.1:4187/pc/ 를 열어 주세요.'));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{await runtime.close();process.exit(0);});
