import {Exchange} from '../server/exchanges.mjs';
import {COINS} from '../trading/policy.mjs';
const privateCheck=process.argv.includes('--private');
const names=process.argv.includes('--upbit')?['upbit']:process.argv.includes('--bitget')?['bitget']:['upbit','bitget'];
for(const name of names){
  const e=new Exchange(name);
  for(const coin of COINS)try{
    await e.market(coin);
    if(privateCheck)await e.snapshot(coin);
    console.log(name,coin,privateCheck?'계좌·호가·주문 가능 조건 통과 (주문 전송 없음)':'공개 시세·호가 통과');
  }catch(err){console.error(name,coin,err.message);process.exitCode=1;}
}
