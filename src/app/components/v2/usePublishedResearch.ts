'use client';
import {useEffect,useState} from 'react';
import {ResearchRecord,type WebResearch} from '@/ai-study/web-research-contract';
let request:Promise<WebResearch|null>|null=null;
let checkedAt=0;
function readLatest() {
 if(!request || Date.now()-checkedAt>15000) {
  checkedAt=Date.now();
  request=fetch('/api/research/latest',{cache:'no-store'}).then(async r=>{
   if(!r.ok)return null;
   const parsed=ResearchRecord.safeParse((await r.json()).research);
   return parsed.success?parsed.data:null;
  }).catch(()=>null);
 }
 return request;
}
export function usePublishedResearch(initial:WebResearch|null,enabled=true) {
 const [research,setResearch]=useState(initial);
 useEffect(()=>{setResearch(initial);},[initial]);
 useEffect(()=>{
  if(!enabled)return;
  let active=true;
  const started=Date.now();
  const check=async()=>{
   if(document.visibilityState!=='visible')return;
   const next=await readLatest();
   if(active && next)setResearch(previous=>!previous || next.generatedAt>previous.generatedAt?next:previous);
  };
  const timer=setInterval(()=>{if(Date.now()-started<5*60000)void check();else clearInterval(timer);},20000);
  const focus=()=>{void check();};
  window.addEventListener('focus',focus);
  return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',focus);};
 },[enabled]);
 return research;
}
