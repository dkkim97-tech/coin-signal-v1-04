import {prepare} from './research.mjs';
import {DAY} from './policy.mjs';
export function decide(candles,strategy,{now=Date.now(),initial=false}={}) {
  if(candles.length<400)throw Error('완성된 일봉이 400개 이상 필요합니다.');
  const last=candles.at(-1);
  if(last.timestamp+DAY>now||now-(last.timestamp+DAY)>DAY+300000)throw Error('최근 완성 일봉이 누락되었거나 오래되었습니다.');
  if(candles.slice(-200).some((c,i,a)=>i&&c.timestamp-a[i-1].timestamp!==DAY))throw Error('최근 일봉에 빈 구간이 있어 신호 실행을 중지합니다.');
  const p=prepare(candles,strategy,{latestOnly:true}),r=p.rows.at(-1),state=p.states.at(-1),prediction=p.predictions.at(-1);
  const kind=state.event?'CONFIRMED':prediction?.eligible?'PRE':initial?'INITIAL':'WAIT';
  return {kind,target:kind==='PRE'?prediction.target:state.target,event:kind==='PRE'?prediction.key:state.event,day:prediction?.day??null,probability:prediction?.probability??null,sample:prediction?.sample??0,anchor:r.close,adr:r.adr,bar:r.timestamp,due:prediction?r.timestamp+(prediction.day+1)*DAY:null,explanation:kind==='WAIT'?'확정 신호 또는 D−5·80% 조건 대기':kind==='PRE'?'과거 유사 사례의 5일 내 사건 발생률 ≥80%':'확정된 목표 비중 적용',dataStart:candles[0].timestamp};
}
