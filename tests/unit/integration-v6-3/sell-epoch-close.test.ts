import {describe,expect,it} from 'vitest';
import {Cl} from '@stacks/transactions';
import {U,P,owner,alice,bob,taker,token,stx,name,update,value,call,read,ok,balance,specs,setup} from './helpers';

// Sell-side mirror of withdraw-dust.test.ts: the status page states
// "The sell-side epoch-close case cannot be reached through public calls".
// This file drives the same sequence against jing-sell-stx-spread-0.
const received=1001n;
const data=(rung:string,key:string)=>value(simnet.getDataVar(rung,key));
const prints=(receipt:ReturnType<typeof call>)=>receipt.events.filter(e=>e.event==='print_event').map(e=>value(e.data.value));

describe('sell withdraw: reachability of close-epoch proceeds',()=>{
 for(const path of ['held','live','admitted'] as const)it(`${path}: public final withdrawal pays existing proceeds once, then closes the epoch`,()=>{
  const r=setup(specs[1]);
  if(path==='held')ok(call(r.rung,'set-push-paused',[Cl.bool(true)]));
  if(path==='admitted')r.addOppositeMaker();
  ok(call(r.rung,'deposit',[U(specs[1].amount)],alice));
  const pending=path==='admitted';
  expect(r.pending()!==null).toBe(pending);
  // proceeds arrive as sBTC on the sell rung
  ok(call('token','mint',[U(received),Cl.principal(r.principal)]));
  const before=balance(false,alice);
  const receipt=call(r.rung,'withdraw',[U(specs[1].amount),pending?Cl.some(update):Cl.none()],alice);
  expect(ok(receipt)).toEqual({stx:specs[1].amount,sbtc:received});
  expect(balance(false,alice)-before).toBe(specs[1].amount);
  const events=prints(receipt),payouts=events.filter(e=>e?.event==='rung-payout');
  expect(payouts).toHaveLength(1);expect(payouts[0].proceeds).toBe(received);
  expect(events.some(e=>e?.event==='rung-epoch-closed')).toBe(true);
  expect(r.state().members).toBe(0n);expect(r.state().epoch).toBe(1n);
  expect(r.pending()).toBe(null);
  for(const key of ['current-proceeds','sats-accounted','proceeds-carry'])expect(data(r.rung,key)).toBe(0n);
  expect(balance(false,r.principal)).toBe(0n);expect(balance(true,r.principal)).toBe(0n);
 });
});
