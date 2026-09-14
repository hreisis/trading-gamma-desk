import { z } from 'zod';
const bilingual = z.object({ en:z.string().min(1).max(1600), zh:z.string().min(1).max(1000) });
const source = z.object({url:z.string().regex(/^https:\/\/[^\s]+$/),title:z.string().min(1).max(250),publishedAt:z.string().nullable()});
const section = z.object({kind:z.enum(['drivers','watch','invalidation']),title:bilingual,body:bilingual,sources:z.array(source).min(1).max(4)});
export const ResearchContent = z.object({headline:bilingual,summary:bilingual,sections:z.array(section).length(3),limitations:bilingual});
export const ResearchRecord = z.object({version:z.literal(2),slot:z.string(),generatedAt:z.string(),inputSession:z.string().nullable(),model:z.string(),event:z.object({headline:z.string(),at:z.string(),et:z.string(),sourceUrl:z.string()}).nullable(),content:ResearchContent});
export type WebResearch = z.infer<typeof ResearchRecord>;
export function researchSlot(now: Date): string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=(key:string)=>parts.find(p=>p.type===key)!.value;
 const date=`${get('year')}-${get('month')}-${get('day')}`;const hour=Number(get('hour'));
 if(hour<9) return `${new Date(new Date(`${date}T12:00:00Z`).getTime()-86400000).toISOString().slice(0,10)}-post`;
 return `${date}-${hour<16?'pre':'post'}`;
}
