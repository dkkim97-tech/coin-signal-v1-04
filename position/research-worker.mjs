import { research } from './backtest.mjs';
self.onmessage = ({ data }) => {
  try { const result = research(data.candles, data.settings, data.options, message => self.postMessage({ progress: message })); self.postMessage({ result }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
