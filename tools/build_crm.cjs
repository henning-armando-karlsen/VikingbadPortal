const fs=require('fs'), zlib=require('zlib');
const LZString=require('/home/claude/app/project/node_modules/lz-string/libs/lz-string.min.js');
const SRC='/mnt/user-data/uploads/1780825143852_Vikingbad_CRM_prototype_17_10.html';
const LZMIN=fs.readFileSync('/home/claude/app/project/node_modules/lz-string/libs/lz-string.min.js','utf8');
const HYDRATION=fs.readFileSync('/home/claude/hydration.js','utf8');
const BAKE_LOG=true;

// kundelogg -> entries -> LZ base64
const klhtml=fs.readFileSync('/mnt/user-data/uploads/kundelogg.html','utf8');
const b64=klhtml.match(/<script id="payload"[^>]*>([\s\S]*?)<\/script>/)[1].trim();
const entries=JSON.parse(zlib.gunzipSync(Buffer.from(b64,'base64')).toString('utf8'));
const logB64=BAKE_LOG?LZString.compressToBase64(JSON.stringify(entries)):'';

let html=fs.readFileSync(SRC,'utf8');

// inject lzstring + (optional) baked log + open main script; flip DATA/KAMP to let
const anchor='<script>\nconst DATA=';
html=html.replace(anchor,
  '<script>\n'+LZMIN+'\n</script>\n'+
  (BAKE_LOG?('<script id="vb-log">var VB_LOG_B64="'+logB64+'";</script>\n'):'')+
  '<script>\nlet DATA=');
html=html.replace('\nconst KAMP=','\nlet KAMP=');

// inject hydration + VBP before SEGC
const segc="const SEGC={A:'var(--A)'";
html=html.replace(segc, HYDRATION+'\n'+segc);

// ---- persistence hooks at exact mutation points ----
function inject(anchor, replacement){
  const n=html.split(anchor).length-1;
  if(n!==1) throw new Error('Anker (#'+n+') ikke unik: '+anchor.slice(0,60));
  html=html.replace(anchor, replacement);
}
// A1: data-logbesok (visit)
inject(
  "ns:'',av:c.selger});render();",
  "ns:'',av:c.selger});VBP.saveVisit(c,c.akt[0]);render();");
// A2: data-logty handler – akt + (optional) task   (uses 864e5)
inject(
  "c.akt.unshift({d,ty,tt,no,ns,av:c.selger});if(ns){",
  "c.akt.unshift({d,ty,tt,no,ns,av:c.selger});VBP.saveVisit(c,c.akt[0]);if(ns){");
inject(
  "c.opp.unshift({tt:ns,f,st:'apen',pr:'middels'});}render();});",
  "c.opp.unshift({tt:ns,f,st:'apen',pr:'middels'});VBP.saveTask(c,c.opp[0]);}render();});");
// A3: addAkt (uses 86400000, newline before if(ns))
inject(
  "c.akt.unshift({d,ty,tt,no,ns,av:c.selger});\n  if(ns){",
  "c.akt.unshift({d,ty,tt,no,ns,av:c.selger});VBP.saveVisit(c,c.akt[0]);\n  if(ns){");
inject(
  "c.opp.unshift({tt:ns,f,st:'apen',pr:'middels'});}}",
  "c.opp.unshift({tt:ns,f,st:'apen',pr:'middels'});VBP.saveTask(c,c.opp[0]);}}");
// A4: crosstask (task)
inject(
  "c.opp.unshift({tt:'Kryssalg: '+cat,f:new Date(TODAY.getTime()+7*864e5).toISOString().slice(0,10),st:'apen',pr:'middels'});render();",
  "c.opp.unshift({tt:'Kryssalg: '+cat,f:new Date(TODAY.getTime()+7*864e5).toISOString().slice(0,10),st:'apen',pr:'middels'});VBP.saveTask(c,c.opp[0]);render();");
// A5: task toggle (update status)
inject(
  "c.opp[+cb.dataset.ti].st=cb.checked?'ferdig':'apen';render();",
  "c.opp[+cb.dataset.ti].st=cb.checked?'ferdig':'apen';VBP.updateTask(c,c.opp[+cb.dataset.ti]);render();");

// footer
html=html.replace(
  'Designforhåndsvisning · ekte kunde-/salgstall · demodata for dialog, utstilling, oppgaver og pipeline · endringer lagres ikke',
  'Salgstall fra analyseportalen · dialog fra kundeloggen · oppgaver og besøk lagres per RA i appen · øvrige felt er illustrative');

fs.writeFileSync('/home/claude/app/project/public/crm.html', html);
fs.writeFileSync('/mnt/user-data/outputs/Vikingbad_CRM_integrert.html', html);
console.log('CRM total:', (html.length/1024/1024).toFixed(2),'MB · log baked:', BAKE_LOG, '· entries:', entries.length);

// test dataset with real kundenr (overlap log)
const kset=[...new Set(entries.map(e=>e.k))].filter(k=>k!=null).slice(0,60);
const utvs=['Vokser','Faller','Stabil','Hvilende','Ny / reaktivert','Stoppet'];
const regions=['RA Øst – Kari Nordmann','RA Vest – Ola Hansen','RA Midt – Per Berg','Sentralt / Web'];
const fylker=['Oslo','Vestland','Trøndelag','Rogaland','Viken'], steder=['Oslo','Bergen','Trondheim','Stavanger','Lillestrøm'], segs=['A','A','B','B','C','C','D','E'];
const rows=kset.map((k,i)=>{const seg=segs[i%segs.length],utv=utvs[i%utvs.length];const fjor=Math.round(200000+Math.random()*4000000),h25=Math.round(fjor*0.45);
  let h26=/Stoppet|Hvilende/.test(utv)?0:/Ny|reaktiv/.test(utv)?180000:/Faller/.test(utv)?Math.round(h25*0.6):/Vokser/.test(utv)?Math.round(h25*1.6):h25;
  const by=Math.round(h25),bf=Math.round(by*2.4),budoppn=by>0?+(h26/by*100).toFixed(1):null,dg=Math.random()<0.75?+(35+Math.random()*30).toFixed(1):null;
  return [k,['Bademiljø','VVS Senteret','Bygg & Bad','Comfort','Rørkjøp'][i%5]+' '+(i+1)+' AS',seg,Math.round(20+Math.random()*75),fylker[i%5],steder[i%5],regions[i%4],'',null,fjor,fjor,h25,h26,utv,h26-h25,h25?Math.round((h26-h25)/h25*100):0,by,budoppn,dg,bf,'Begge'];});
fs.writeFileSync('/home/claude/test_vbdataset.txt', LZString.compressToUTF16(JSON.stringify({rows,ldata:{kpi:{omsetning:0}},cats:{order:[],cats:{}},meta:{maxDate:'07.06.2026'},name:'t',ts:1})));
console.log('test dataset:', rows.length,'kunder');
