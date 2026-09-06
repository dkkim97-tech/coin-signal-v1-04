import {Exchange} from '../server/exchanges.mjs';
import {selection} from '../trading/policy.mjs';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'GET only'});
  try {
    const {exchange='korbit',coin='BTC',action='market',end}=req.query||{};
    selection(exchange,coin,1);if(!['market','candles'].includes(action))throw Error('지원하지 않는 조회');
    const until=end===undefined?Date.now():Number(end);if(!Number.isFinite(until)||until<0||until>Date.now()+1000)throw Error('조회 시각 오류');
    const client=new Exchange(exchange);
    return res.status(200).json(action==='market'?await client.market(coin):{candles:await client.candlePage(coin,until),exchange,coin});
  }catch(e){return res.status(400).json({error:e.message});}
}
