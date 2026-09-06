export const STRATEGIES = Object.freeze({
  1:{name:'MACD 1',targets:[0,.4],maxExposure:1},
  2:{name:'MACD 2',targets:[0,.5,1],maxExposure:1},
  3:{name:'MACD 3',targets:[0,.5,1],maxExposure:1},
  4:{name:'MACD 4',targets:[-1,.5,1],maxExposure:1},
  5:{name:'MACD 5',targets:[-2,.5,2],maxExposure:2},
});
export function regimeTarget(n,line,histogram){
  if(n===5)return line>=0?(histogram>=0?2:.5):(histogram>=0?.5:-2);
  return line>=0?(histogram>=0?1:.5):(histogram>=0?.5:n>=4?-1:0);
}
