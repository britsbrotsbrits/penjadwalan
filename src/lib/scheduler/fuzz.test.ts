import { describe, expect, it } from "vitest";
import { expandRequirements } from "./requirements";
import { scheduler } from "./solve";
import type { SchedulingSnapshot } from "./types";
const DAYS=[1,2,3,4,5];
const cells=(d:number[],s:number[])=>d.flatMap(day=>s.map(slotNo=>({day,slotNo})));
function rnd(seed:number){let x=seed*2654435761>>>0;return()=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}
describe("regresi: penjadwal acak (ruangan langka, mentor terbatas) tidak pernah melempar galat",()=>{it("sesi N tidak ada tidak muncul lagi",()=>{
 const subs=["pk","pu","pm","ppu","kmm"];
 let fails=0, first="";
 for(let seed=1;seed<=600;seed++){
  const r=rnd(seed);
  const nR=3+Math.floor(r()*8), nT=4+Math.floor(r()*8);
  const slotsOf=()=>[1+Math.floor(r()*5)];
  const rombels=Array.from({length:nR},(_,i)=>{const sl=slotsOf();return {id:`r${i}`,name:`r${i}`,classTypeId:"c",studentCount:10,fixedRoomId:null,sessionsPerDay:1,weeklySessions:null,
   distribution:subs.slice(0,2+Math.floor(r()*3)).map(s=>({subtestId:s,flexibleSubtestIds:[],label:null,sessionsPerWeek:1})),pattern:{subtestSlots:sl,drillingSlots:[]}};});
  const tutors=Array.from({length:nT},(_,i)=>({id:`t${i}`,name:`t${i}`,level:1,competencies:subs.filter(()=>r()<0.7),availability:cells(DAYS,[1,2,3,4,5]).filter(()=>r()<0.85)}));
  const snapshot: SchedulingSnapshot ={days:DAYS,slotNos:[1,2,3,4,5],subtests:subs.map(c=>({id:c,code:c.toUpperCase()})),rooms:Array.from({length:1+Math.floor(r()*5)},(_,i)=>({id:`room${i}`,name:`R${i}`,capacity:40})),rombels,tutors};
  const {requirements}=expandRequirements(snapshot.rombels,snapshot.days);
  try{scheduler({snapshot,requirements,seed})}catch(e){fails++; if(!first) first=`seed ${seed}: ${e instanceof Error ? e.message : String(e)}`;}
 }
 expect(first).toBe("");expect(fails).toBe(0);
});});
