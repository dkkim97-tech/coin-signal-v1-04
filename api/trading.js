import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
export const sameSecret=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function session(secret,now=Date.now()) {const body=Buffer.from(JSON.stringify({exp:now+1800000,nonce:randomBytes(16).toString('hex')})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');}
export function authenticated(token,secret,now=Date.now()) {try {if(!secret||secret.length<32)return false;const [b,s,...extra]=token.split('.');return !extra.length&&sameSecret(s,createHmac('sha256',secret).update(b).digest('base64url'))&&JSON.parse(Buffer.from(b,'base64url')).exp>now;}catch{return false;}}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
  const env=process.env,configured=!!env.TRADE_GATEWAY_URL&&!!env.TRADE_GATEWAY_TOKEN&&!!env.TRADE_OPERATOR_TOKEN&&!!env.TRADING_ALLOWED_ORIGIN;
  if(req.method==='GET')return res.status(200).json({configured,policy:'D5-80-v2',message:configured?'관리자 접속 후 계좌 상태를 확인하세요.':'실행 서버 미연결 · 공개 시세와 주문 계산만 사용 가능합니다.'});
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  if(!configured)return res.status(503).json({error:'실행 서버·관리자 인증 설정이 필요합니다.'});
  if(req.headers.origin!==env.TRADING_ALLOWED_ORIGIN||req.headers['x-trading-ui']!=='1')return res.status(403).json({error:'요청 출처 확인 실패'});
  if(!String(req.headers['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'JSON required'});
  try {
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    if(JSON.stringify(body).length>16384)throw Error('요청 크기 초과');
    if(body.action==='login') {
      if(env.TRADE_OPERATOR_TOKEN.length<32||!sameSecret(body.token,env.TRADE_OPERATOR_TOKEN))return res.status(401).json({error:'관리자 토큰 확인 실패'});
      res.setHeader('Set-Cookie','trade_session='+session(env.TRADE_OPERATOR_TOKEN)+'; HttpOnly; Secure; SameSite=Strict; Path=/api/trading; Max-Age=1800');return res.status(200).json({authenticated:true});
    }
    if(body.action==='logout') {res.setHeader('Set-Cookie','trade_session=; HttpOnly; Secure; SameSite=Strict; Path=/api/trading; Max-Age=0');return res.status(200).json({authenticated:false});}
    const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('trade_session='))?.slice(14)||'';
    if(!authenticated(token,env.TRADE_OPERATOR_TOKEN))return res.status(401).json({error:'관리자 접속이 필요하거나 세션이 만료되었습니다.'});
    if(!['status','preview','arm','stop','limits','automation'].includes(body.action))throw Error('지원하지 않는 명령');
    const url=new URL(env.TRADE_GATEWAY_URL);if(url.protocol!=='https:'&&!(env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('실행 서버는 HTTPS가 필요합니다.');
    const upstream=await fetch(new URL('/command',url),{method:'POST',headers:{Authorization:'Bearer '+env.TRADE_GATEWAY_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
    const data=await upstream.json();return res.status(upstream.ok?200:400).json(data);
  }catch{return res.status(502).json({error:'실행 서버 응답을 확인하지 못했습니다. 상태를 조회하세요. 주문을 중복 시작하지 마세요.'});}
}
