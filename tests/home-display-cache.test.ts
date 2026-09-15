import {it,expect,vi} from 'vitest';
import {readHomeDisplay,saveHomeDisplay} from '../src/desk/home-display-cache';
import type {RuntimeJsonStore} from '../src/desk/runtime-store';
import type {V2CommandCenterPageView} from '../src/desk/load-v2-home';
it('withholds expired display snapshots',async()=>{const store={readText:async()=>JSON.stringify({savedAt:'2020-01-01',view:{gamma:[],marketQuotes:[]}})} as unknown as RuntimeJsonStore;expect(await readHomeDisplay(store,'en')).toBeNull();});
it('never saves fixture views',async()=>{const writeText=vi.fn();const store={writeText} as unknown as RuntimeJsonStore;await saveHomeDisplay(store,'zh',{decisionStatus:'ready',gamma:[{isFixture:true}]} as unknown as V2CommandCenterPageView);expect(writeText).not.toHaveBeenCalled();});
