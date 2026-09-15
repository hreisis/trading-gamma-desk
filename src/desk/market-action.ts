import type { OpportunityV3 } from './opportunity-score-v3';
export interface MarketAction {
  version: 'action-v1';
  action: 'BUY' | 'HOLD' | 'SELL' | null;
  rule: 'missing_risk' | 'defensive' | 'event_gate' | 'missing_opportunity' | 'early_entry' | 'recovery' | 'tactical_recovery' | 'wait';
  reason: {en:string;zh:string};
  inputs: {risk:number|null;opportunity:number|null;confirmation:OpportunityV3['confirmation'];eventBlocked:boolean};
}
/** Policy overlay only: neither scores nor exposure sizing are changed. */
export function deriveMarketAction(inputs:MarketAction['inputs']):MarketAction {
 const result=(action:MarketAction['action'],rule:MarketAction['rule'],en:string,zh:string):MarketAction=>({version:'action-v1',action,rule,reason:{en,zh},inputs});
 const {risk,opportunity,confirmation,eventBlocked}=inputs;
 if(risk===null||!Number.isFinite(risk)||risk<0||risk>100)return result(null,'missing_risk','Insufficient risk inputs.','风险数据不足，暂不形成操作判断。');
 if(risk>65)return result('SELL','defensive','Reduce exposure within the risk-based allocation; this is not a full-exit instruction.','优先收缩风险敞口；SELL 不代表要求清仓。');
 if(eventBlocked)return result('HOLD','event_gate','New buying is gated by event risk or incomplete event coverage.','事件风险或事件信息不足，暂停新增买入。');
 if(opportunity===null||!Number.isFinite(opportunity)||opportunity<0||opportunity>100)return result('HOLD','missing_opportunity','Wait for complete opportunity inputs.','等待完整机会数据，不把缺失当作零分。');
 const recovering=confirmation==='recovering'||confirmation==='broadening';
 if(risk<=40&&opportunity>=65&&!recovering&&confirmation==='unconfirmed')return result('BUY','early_entry','Potential dip entry; recovery is unconfirmed. Keep within the risk-based exposure range.','回撤机会出现，可分步试探；尚未修复，仓位仍受风险上限约束。');
 if(risk<=40&&opportunity>=45&&recovering)return result('BUY','recovery','Dip opportunity and recovery align; keep within the risk-based exposure range.','回撤机会与修复配合，仍遵守风险模型仓位范围。');
 if(risk>40&&opportunity>=65&&recovering)return result('BUY','tactical_recovery','Tactical recovery setup; moderate risk still limits exposure.','战术性修复机会，整体风险仍限制仓位。');
 return result('HOLD','wait','Maintain or wait; entry conditions are not aligned.','维持或等待，新增买入条件尚未同时满足。');
}
