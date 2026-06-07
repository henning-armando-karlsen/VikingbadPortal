// ===== Vikingbad weekly recompute pipeline (browser-portable) =====
// Mirrors gen.py + genL.py + gen_cats.py. Pure JS; uses a SheetJS workbook.
(function(global){
'use strict';
function parseNum(v){
  if(v==null||v==='')return 0;
  if(typeof v==='number')return v;
  var s=String(v).replace(/\u00a0/g,'').replace(/ /g,'');
  // Norwegian: thousands '.' decimal ',' -> remove dots, comma to dot
  if(s.indexOf(',')>=0){ s=s.replace(/\./g,'').replace(',', '.'); }
  var n=parseFloat(s); return isNaN(n)?0:n;
}
function toDate(v){
  if(v==null||v==='')return null;
  if(v instanceof Date)return v;
  if(typeof v==='number'){ // excel serial
    var d=new Date(Math.round((v-25569)*86400*1000)); return isNaN(d)?null:d;
  }
  var s=String(v).trim();
  // dd.mm.yyyy or yyyy-mm-dd
  var m=s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if(m)return new Date(+m[3],+m[2]-1,+m[1]);
  var d=new Date(s); return isNaN(d)?null:d;
}
function daysInMonth(y,m){return new Date(y,m,0).getDate();} // m=1..12
function round(x){return Math.round(x);}
function str(v){ if(v==null)return ''; var s=String(v).trim(); return (s==='NULL'||s==='null'||s==='#N/A'||s==='nan')?'':s; }
function median(a){if(!a.length)return 0;var b=a.slice().sort(function(x,y){return x-y;});var n=b.length;return n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2;}
function gini(xs){var a=xs.filter(function(x){return x>0;}).sort(function(x,y){return x-y;});var n=a.length;if(!n)return 0;var s=0,cum=0;for(var i=0;i<n;i++){s+=a[i];cum+=(i+1)*a[i];}if(!s)return 0;return +((2*cum)/(n*s)-(n+1)/n).toFixed(3);}

function recompute(wb, orig){
  var S=function(name){var ws=wb.Sheets[name];return ws?XLSX.utils.sheet_to_json(ws,{defval:null,raw:true}):[];};
  var kd=S('Kundedata'), fl=S('Fakturalinjer'), bu=S('BudsjettKundeManed'), kl=S('Kundelogg');
  // ---- detect optional margin columns (variant 2: DB per line; variant 3: DG% per customer) ----
  function findKey(obj, re){ if(!obj)return null; var ks=Object.keys(obj); for(var i=0;i<ks.length;i++){ if(re.test(String(ks[i]).trim()))return ks[i]; } return null; }
  var dbKey   = fl.length? findKey(fl[0], /^(dekningsbidrag|db)([ _-]?kr)?$/i) : null;        // NOK per line
  var lkostKey= fl.length? findKey(fl[0], /^(linjekost|varekostnad|kostnad|linje[ _-]?kost)$/i) : null; // line cost NOK
  var ekostKey= fl.length? findKey(fl[0], /^(enhetkost|kostpris|varekost|innkjøpspris|innpris|enhet[ _-]?kost)$/i) : null; // unit cost
  var custDgKey = kd.length? findKey(kd[0], /^(dekningsgrad|dg|margin)([ _%-]*)?$/i) : null;  // per-customer DG (variant 3)
  var hasDB = !!(dbKey||lkostKey||ekostKey);
  // ---- parse invoice lines ----
  var lines=[];
  var maxDate=null;
  for(var i=0;i<fl.length;i++){
    var r=fl[i]; var d=toDate(r.FakturertDato); var lp=parseNum(r.LinjePris);
    if(!d)continue;
    var ant=parseNum(r.Antall), db=0;
    if(dbKey)db=parseNum(r[dbKey]);
    else if(lkostKey)db=lp-parseNum(r[lkostKey]);
    else if(ekostKey)db=lp-ant*parseNum(r[ekostKey]);
    var o={k:(r.BestillerKundenr!=null?+r.BestillerKundenr:null), d:d, y:d.getFullYear(), mo:d.getMonth()+1, day:d.getDate(),
           lp:lp, ant:ant, db:db, pg:r.ProduktGruppe1, ot:r.OrdreType, ordre:r.OrdreNr, navn:r.BestillerNavn};
    lines.push(o); if(!maxDate||d>maxDate)maxDate=d;
  }
  // per-customer explicit DG% (variant 3) — normalize to fraction
  var custDG={};
  if(custDgKey){ var vals=[]; for(var i=0;i<kd.length;i++){var v=parseNum(kd[i][custDgKey]); if(v)vals.push(v);}
    var mx=vals.length?Math.max.apply(null,vals):0; var asPct=mx>1.5; // >1.5 => percent scale
    for(var i=0;i<kd.length;i++){ if(kd[i].kundenr==null)continue; var v=kd[i][custDgKey]; if(v==null||v==='')continue; var f=parseNum(v); custDG[+kd[i].kundenr]=asPct?f/100:f; } }
  if(!maxDate)throw new Error('Fant ingen gyldige fakturadatoer.');
  var curY=maxDate.getFullYear(), prevY=curY-1, cM=maxDate.getMonth()+1, cD=maxDate.getDate();
  function inYTD(o,y){ return o.y===y && (o.mo<cM || (o.mo===cM && o.day<=cD)); }
  // ---- aggregations ----
  function aggBy(pred, key){ var m={}; for(var i=0;i<lines.length;i++){var o=lines[i];if(o.k==null)continue;if(pred(o)){m[o.k]=(m[o.k]||0)+o[key];}} return m; }
  var hitCur=aggBy(function(o){return inYTD(o,curY);},'lp');
  var hitPrev=aggBy(function(o){return inYTD(o,prevY);},'lp');
  var fullPrev=aggBy(function(o){return o.y===prevY;},'lp');
  var dbCur=aggBy(function(o){return inYTD(o,curY);},'db');
  var dbPrev=aggBy(function(o){return inYTD(o,prevY);},'db');
  function custDgPct(k){ // percent 0-100 or null
    if(custDG[k]!=null)return +(custDG[k]*100).toFixed(1);
    if(hasDB){ var rev=hitCur[k]||0; if(rev>0)return +((dbCur[k]||0)/rev*100).toFixed(1); }
    return null;
  }
  // ---- budget ---- (YTD = complete months 1..cM-1, matching embedded convention)
  var budYtd={}, budFull={}, budMon=[0,0,0,0,0,0,0,0,0,0,0,0];
  for(var i=0;i<bu.length;i++){
    var b=bu[i]; if(b.kunde==null)continue; var k=+b.kunde, full=0, ytd=0;
    for(var mm=1;mm<=12;mm++){ var val=parseNum(b['budsjett'+mm]); full+=val; budMon[mm-1]+=val;
      if(mm<cM)ytd+=val; }
    budYtd[k]=ytd; budFull[k]=full;
  }
  // ---- last contact date from log ----
  var lastDate={};
  for(var i=0;i<kl.length;i++){ var L=kl[i]; if(L.kunde==null)continue; var k=+L.kunde, d=toDate(L.dato); if(d&&(!lastDate[k]||d>lastDate[k]))lastDate[k]=d; }
  function fmtDate(d){ if(!d)return ''; var p=function(n){return(n<10?'0':'')+n;}; return p(d.getDate())+'.'+p(d.getMonth()+1)+'.'+d.getFullYear(); }
  function devcat(h25,h26,fjor){
    if(h25===0&&h26===0)return (fjor&&fjor>0)?'Hvilende':'Dvale';
    if(h25>0&&h26<=0)return 'Stoppet';
    if(h25===0&&h26>0)return 'Ny / reaktivert';
    var ch=h25?(h26-h25)/h25:0;
    if(ch<=-0.05)return 'Faller'; if(ch>=0.05)return 'Vokser'; return 'Stabil';
  }
  // ---- ra-raw rows (21 cols) ----
  var rows=[];
  for(var i=0;i<kd.length;i++){
    var r=kd[i]; if(r.kundenr==null)continue; var k=+r.kundenr;
    var seg=r.segment!=null?String(r.segment):'';
    var h25=round(hitPrev[k]||0), h26=round(hitCur[k]||0), fjor=round(fullPrev[k]||0);
    var dc=devcat(h25,h26,fjor), devkr=h26-h25, devpct=h25?round(devkr/h25*100):0;
    var by=round(budYtd[k]||0), bf=round(budFull[k]||0);
    var budoppn=by>0?+(h26/by*100).toFixed(1):null;
    var score=r.total_score!=null?round(+r.total_score):null;
    rows.push([k, str(r.navn), seg, score,
      str(r.fylke), str(r.poststed),
      str(r.region), fmtDate(lastDate[k]), null,
      fjor, fjor, h25, h26, dc, devkr, devpct, by, budoppn, custDgPct(k), bf,
      ((hitCur[k]!=null||hitPrev[k]!=null||fullPrev[k]!=null)?'Begge':'Bare kundeliste')]);
  }
  global.__RECOMP_META__={curY:curY,prevY:prevY,cM:cM,cD:cD,maxDate:fmtDate(maxDate)};
  return {rows:rows, lines:lines, kd:kd, curY:curY, prevY:prevY, cM:cM, cD:cD,
          hitCur:hitCur, hitPrev:hitPrev, budYtd:budYtd, budFull:budFull, budMon:budMon,
          hasDB:hasDB, dbCur:dbCur, dbPrev:dbPrev, custDG:custDG,
          nmap:(function(){var m={};for(var i=0;i<kd.length;i++)if(kd[i].kundenr!=null)m[+kd[i].kundenr]=kd[i].navn;return m;})(),
          fylkemap:(function(){var m={};for(var i=0;i<kd.length;i++)if(kd[i].kundenr!=null)m[+kd[i].kundenr]=kd[i].fylke;return m;})()
        };
}
global.VBRecompute={recompute:recompute, parseNum:parseNum, toDate:toDate, gini:gini, median:median, daysInMonth:daysInMonth};
})(typeof window!=='undefined'?window:globalThis);

// ===== __LDATA__ (mirrors genL.py) =====
(function(global){
var VB=global.VBRecompute;
function g(a,b){return b?+((a-b)/b).toFixed(3):null;}
function buildLData(R, orig){
  orig=orig||{};
  var lines=R.lines, curY=R.curY, prevY=R.prevY, cM=R.cM, cD=R.cD;
  function inYTD(o,y){return o.y===y&&(o.mo<cM||(o.mo===cM&&o.day<=cD));}
  var y26=lines.filter(function(o){return inYTD(o,curY);});
  var y25=lines.filter(function(o){return inYTD(o,prevY);});
  var T26=y26.reduce(function(s,o){return s+o.lp;},0), T25=y25.reduce(function(s,o){return s+o.lp;},0);
  var MN=['Jan','Feb','Mar','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Des'];
  var maaned=[];
  for(var m=1;m<cM;m++){
    var a=lines.filter(function(o){return o.y===curY&&o.mo===m;}).reduce(function(s,o){return s+o.lp;},0);
    var fj=lines.filter(function(o){return o.y===prevY&&o.mo===m;}).reduce(function(s,o){return s+o.lp;},0);
    maaned.push({m:MN[m-1],aar:Math.round(a),fjor:Math.round(fj),forfjor:null,vf:g(a,fj),vff:null,oi:null,budsjett:Math.round(R.budMon[m-1])});
  }
  var maaned_rest=[]; for(var m=cM;m<=12;m++)maaned_rest.push([MN[m-1],Math.round(R.budMon[m-1])]);
  // products
  function aggProd(arr){var m={};arr.forEach(function(o){var p=o.pg;if(p==null)return;if(!m[p])m[p]={oms:0,ant:0};m[p].oms+=o.lp;m[p].ant+=o.ant;});return m;}
  var p26=aggProd(y26), p25=aggProd(y25);
  var produkt=Object.keys(p26).sort(function(a,b){return p26[b].oms-p26[a].oms;}).slice(0,8).map(function(nm){
    var o25=p25[nm]||{oms:0,ant:0};
    return {navn:nm,oms:Math.round(p26[nm].oms),vekst:g(p26[nm].oms,o25.oms),volum:g(p26[nm].ant,o25.ant),dg:null};
  });
  // order types
  function aggOT(arr){var m={};arr.forEach(function(o){var t=o.ot;if(t==null)return;if(!m[t])m[t]={oms:0,ord:{}};m[t].oms+=o.lp;m[t].ord[o.ordre]=1;});return m;}
  var ot26=aggOT(y26), ot25=aggOT(y25);
  var ordretype=Object.keys(ot26).sort(function(a,b){return ot26[b].oms-ot26[a].oms;}).slice(0,8).map(function(nm){
    var o25=ot25[nm]||{oms:0,ord:{}};
    return {navn:nm,oms_v:g(ot26[nm].oms,o25.oms),antall_v:g(Object.keys(ot26[nm].ord).length,Object.keys(o25.ord).length)};
  });
  // order-size bands
  function bands(arr){var ord={};arr.forEach(function(o){ord[o.ordre]=(ord[o.ordre]||0)+o.lp;});
    var edges=[[0,5000,'0–4 999'],[5000,15000,'5 000–14 999'],[15000,30000,'15 000–29 999'],[30000,75000,'30 000–74 999'],[75000,150000,'75 000–149 999'],[150000,1e12,'150 000+']];
    var res={};edges.forEach(function(e){res[e[2]]=0;});Object.keys(ord).forEach(function(k){var v=ord[k];edges.forEach(function(e){if(v>=e[0]&&v<e[1])res[e[2]]++;});});return res;}
  var b26=bands(y26), b25=bands(y25);
  var ordrestr=Object.keys(b26).map(function(lab){return {band:lab,vekst:g(b26[lab],b25[lab])};});
  // customers
  var c26={},c25={};y26.forEach(function(o){if(o.k!=null)c26[o.k]=(c26[o.k]||0)+o.lp;});y25.forEach(function(o){if(o.k!=null)c25[o.k]=(c25[o.k]||0)+o.lp;});
  function custDgFrac(k){ if(R.custDG&&R.custDG[k]!=null)return +R.custDG[k].toFixed(4); if(R.hasDB){var rev=c26[k]||0; if(rev>0)return +((R.dbCur[k]||0)/rev).toFixed(4);} return null; }
  var kunder=Object.keys(c26).sort(function(a,b){return c26[b]-c26[a];}).slice(0,17).map(function(k){k=+k;var oms=c26[k],f=c25[k]||0;
    return {navn:String(R.nmap[k]!=null?R.nmap[k]:k),oms:Math.round(oms),budsjett:Math.round(R.budYtd[k]||0),vf:f?+(oms/f).toFixed(3):null,oi:Math.round(R.budFull[k]||0),dg:custDgFrac(k)};});
  // fall customers
  var drop=[];Object.keys(c25).forEach(function(k){k=+k;var f=c25[k],a=c26[k]||0;if(f>50000)drop.push([k,f,a,(a-f)/f]);});
  drop.sort(function(x,y){return x[3]-y[3];});
  var fallkunder=drop.slice(0,7).map(function(d){return {navn:String(R.nmap[d[0]]!=null?R.nmap[d[0]]:d[0]),forfjor:null,fjor:Math.round(d[1]),aar:Math.round(d[2]),pct:+d[3].toFixed(3),mig:false};});
  // fylker
  var f26={},f25={};y26.forEach(function(o){if(o.k==null)return;var fy=R.fylkemap[o.k];if(fy==null)return;f26[fy]=(f26[fy]||0)+o.lp;});
  y25.forEach(function(o){if(o.k==null)return;var fy=R.fylkemap[o.k];if(fy==null)return;f25[fy]=(f25[fy]||0)+o.lp;});
  var fylker=Object.keys(f26).sort(function(a,b){return f26[b]-f26[a];}).slice(0,12).map(function(fy){return {navn:String(fy),vekst:g(f26[fy],f25[fy]||0)};});
  // order list (top 8 curY orders)
  var ordsum={};y26.forEach(function(o){var key=o.ordre;if(!ordsum[key])ordsum[key]={navn:o.navn,d:o.d,lp:0};ordsum[key].lp+=o.lp;});
  var ordreliste=Object.keys(ordsum).map(function(k){return [k,ordsum[k]];}).sort(function(a,b){return b[1].lp-a[1].lp;}).slice(0,8).map(function(x){
    var d=x[1].d,p=function(n){return(n<10?'0':'')+n;};return [String(x[0]),String(x[1].navn),Math.round(x[1].lp),p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear()];});
  var budYtdTot=0;for(var m=0;m<cM-1;m++)budYtdTot+=R.budMon[m];
  // ---- margin (variant 2/3) ----
  var ordCur={}; y26.forEach(function(o){ordCur[o.ordre]=1;}); var nOrd26=Object.keys(ordCur).length;
  var ordPrev={}; y25.forEach(function(o){ordPrev[o.ordre]=1;}); var nOrd25=Object.keys(ordPrev).length;
  var snitt26=nOrd26?T26/nOrd26:0, snitt25=nOrd25?T25/nOrd25:0;
  var DB26=R.hasDB?y26.reduce(function(s,o){return s+o.db;},0):null;
  var DB25=R.hasDB?y25.reduce(function(s,o){return s+o.db;},0):null;
  var dg=R.hasDB&&T26?+ (DB26/T26).toFixed(4):null;
  var dg_fjor=R.hasDB&&T25?+(DB25/T25).toFixed(4):null;
  var produkt_dg;
  if(R.hasDB){ var pr={}; y26.forEach(function(o){var p=o.pg;if(p==null)return;if(!pr[p])pr[p]={oms:0,db:0};pr[p].oms+=o.lp;pr[p].db+=o.db;});
    produkt_dg=Object.keys(pr).filter(function(p){return pr[p].oms>0;}).map(function(p){return [p,+(pr[p].db/pr[p].oms).toFixed(4)];}).sort(function(a,b){return b[1]-a[1];}); }
  else produkt_dg=(orig.produkt_dg||null);
  var kpi={omsetning:Math.round(T26),oms_vekst_fjor:g(T26,T25),oms_endr_fjor:Math.round(T26-T25),oms_vekst_forfjor:null,oms_endr_forfjor:null,
      ordreinngang:Math.round(T26),oi_vekst_fjor:g(T26,T25),oi_endr_fjor:Math.round(T26-T25),oi_vekst_forfjor:null,
      budsjett_ytd:Math.round(budYtdTot),budsjett_avvik:Math.round(T26-budYtdTot),budsjett_avvik_pct:g(T26,budYtdTot),
      snitt_ordre:Math.round(snitt26),snitt_vekst:g(snitt26,snitt25),
      dg:dg,dg_fjor:dg_fjor,dekningsbidrag:(DB26!=null?Math.round(DB26):null),varekost:(DB26!=null?Math.round(T26-DB26):null)};
  return {
    meta:Object.assign({},orig.meta||{},{kilde:'Datagrunnlag.xlsx (kunde-, faktura-, budsjett- og loggdata)',periode:'Jan–'+(['Jan','Feb','Mar','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Des'][cM-2]||'')+' '+curY}),
    kpi:kpi,
    maaned:maaned,maaned_rest_budsjett:maaned_rest,produkt:produkt,produkt_dg:produkt_dg,retur:(orig.retur||null),
    kjeder:(orig.kjeder||null),regioner:(orig.regioner||null),fylker:fylker,kunder:kunder,fallkunder:fallkunder,
    ordretype:ordretype,ordrestr:ordrestr,ordreliste:ordreliste
  };
}
VB.buildLData=buildLData; VB._g=g;
})(typeof window!=='undefined'?window:globalThis);

// ===== __CATS__ (mirrors gen_cats.py) =====
(function(global){
var VB=global.VBRecompute; var gini=VB.gini, median=VB.median;
function mapcat(pg){var p=String(pg);
  if(p.indexOf('Baderomsmøbler')===0)return 'Møbler';
  if(p==='Blandebatteri')return 'Blandebatteri';
  if(p.indexOf('Dusj')===0)return 'Dusjløsninger';
  if(p.indexOf('Toalett')===0)return 'Toalett og sisterne';
  if(p==='Bade- og massasjekar')return 'Bade- og massasjekar';
  if(p.indexOf('Flis')===0)return 'Fliser';
  return null;}
var ORDER=['Møbler','Blandebatteri','Dusjløsninger','Toalett og sisterne','Bade- og massasjekar','Fliser'];
function rnd(x){return Math.round(x);}
function buildCat(cat, R){
  var curY=R.curY, prevY=R.prevY, cM=R.cM, cD=R.cD, nmap=R.nmap;
  function inYTD(o,y){return o.y===y&&(o.mo<cM||(o.mo===cM&&o.day<=cD));}
  var fjA={}, arA={};
  R.lines.forEach(function(o){ if(o.k==null||mapcat(o.pg)!==cat)return;
    if(inYTD(o,prevY))fjA[o.k]=(fjA[o.k]||0)+o.lp;
    if(inYTD(o,curY))arA[o.k]=(arA[o.k]||0)+o.lp; });
  var ks={}; Object.keys(fjA).forEach(function(k){ks[k]=1;}); Object.keys(arA).forEach(function(k){ks[k]=1;});
  var rows=[];
  Object.keys(ks).forEach(function(k){k=+k;
    var fj=rnd(fjA[k]||0), ar=rnd(arA[k]||0), navn=String(nmap[k]!=null?nmap[k]:k);
    var endr=ar-fj, pct=fj>0?+((ar-fj)/fj).toFixed(3):null, seg,trend;
    if(fj===0&&ar===0){seg='Inaktiv';trend='Inaktiv';}
    else if(fj>0&&ar===0){seg='Tapt';trend='Tapt';}
    else if(fj<=0&&ar>0){seg='Ny';trend='Ny';}
    else if(fj<=0&&ar<0){seg='Ny negativ';trend='Ny';}
    else if(ar<0){seg='Negativ (beholdt)';trend='Jevn nedgang';}
    else if(ar>=fj){seg='Vekst (beholdt)';trend='Vekst';}
    else {seg='Nedgang (beholdt)';trend='Jevn nedgang';}
    var risk='Lav';
    if(seg==='Tapt'||(fj>0&&pct!=null&&pct<=-0.5))risk='Høy';
    else if(fj>0&&pct!=null&&pct<=-0.1)risk='Middels';
    rows.push({id:k,navn:navn,ff:null,fj:fj,ar:ar,pct:pct,endr:endr,seg:seg,mig:false,prevpct:null,twoyr:null,trend:trend,risk:risk});
  });
  // migration
  var byname={}; rows.forEach(function(r){(byname[r.navn]=byname[r.navn]||[]).push(r);});
  Object.keys(byname).forEach(function(nm){var rs=byname[nm];if(rs.length>1){
    var ht=rs.some(function(r){return r.seg==='Tapt';}), hn=rs.some(function(r){return r.seg==='Ny'||r.seg==='Ny negativ';});
    if(ht&&hn)rs.forEach(function(r){r.mig=true;});}});
  rows.sort(function(a,b){return b.ar-a.ar;});
  var tot_ar=rows.reduce(function(s,r){return s+r.ar;},0), tot_fj=rows.reduce(function(s,r){return s+r.fj;},0);
  var cum=0, nact=rows.filter(function(r){return r.ar>0;}).length;
  rows.forEach(function(r,i){r.rank=i+1;r.share=tot_ar?+(r.ar/tot_ar).toFixed(5):0;cum+=r.ar;r.cumshare=tot_ar?+(cum/tot_ar).toFixed(4):0;r.pctile=r.ar>0?+(1-(r.rank-1)/Math.max(1,nact)).toFixed(3):null;});
  var arv=rows.filter(function(r){return r.ar>0;}).map(function(r){return r.ar;});
  var fjv=rows.filter(function(r){return r.fj>0;}).map(function(r){return r.fj;});
  var kept=rows.filter(function(r){return r.fj>0&&r.ar>0;}), base=rows.filter(function(r){return r.fj>0;});
  var totals={forfjor:null,fjor:tot_fj,aar:tot_ar,yoy_pct:tot_fj?+((tot_ar-tot_fj)/tot_fj).toFixed(3):null,yoy_abs:tot_ar-tot_fj,prev_pct:null,twoyr_pct:null,aktive_aar:nact,aktive_fjor:base.length,aktive_forfjor:null};
  var seglabs=['Inaktiv','Nedgang (beholdt)','Negativ (beholdt)','Ny','Ny negativ','Tapt','Vekst (beholdt)'];
  var segments=seglabs.map(function(s){var rr=rows.filter(function(r){return r.seg===s;});return {navn:s,antall:rr.length,fjor:rr.reduce(function(a,r){return a+r.fj;},0),aar:rr.reduce(function(a,r){return a+r.ar;},0),endr:rr.reduce(function(a,r){return a+r.endr;},0)};});
  var bridge={start:tot_fj,
    ny:rows.filter(function(r){return r.fj===0&&r.ar>0;}).reduce(function(a,r){return a+r.ar;},0),
    ekspansjon:rows.filter(function(r){return r.fj>0&&r.ar>r.fj;}).reduce(function(a,r){return a+r.endr;},0),
    kontraksjon:rows.filter(function(r){return r.fj>0&&r.ar>0&&r.ar<r.fj;}).reduce(function(a,r){return a+r.endr;},0),
    tapt:-rows.filter(function(r){return r.ar===0&&r.fj>0;}).reduce(function(a,r){return a+r.fj;},0),
    slutt:tot_ar,
    n_ny:rows.filter(function(r){return r.fj===0&&r.ar>0;}).length,
    n_grow:rows.filter(function(r){return r.fj>0&&r.ar>r.fj;}).length,
    n_decl:rows.filter(function(r){return r.fj>0&&r.ar>0&&r.ar<r.fj;}).length,
    n_churn:rows.filter(function(r){return r.ar===0&&r.fj>0;}).length};
  var fj_base=base.reduce(function(a,r){return a+r.fj;},0);
  var retention={nrr:fj_base?+(kept.reduce(function(a,r){return a+r.ar;},0)/fj_base).toFixed(4):0,
    grr:fj_base?+(kept.reduce(function(a,r){return a+Math.min(r.ar,r.fj);},0)/fj_base).toFixed(4):0,
    logo:base.length?+(kept.length/base.length).toFixed(4):0,
    churn_logo:base.length?+(1-kept.length/base.length).toFixed(4):0};
  function tier(v){if(v<10000)return '< 10k';if(v<50000)return '10–50k';if(v<100000)return '50–100k';if(v<500000)return '100–500k';return '500k +';}
  var tiers=['< 10k','10–50k','50–100k','100–500k','500k +'].map(function(tl){var rr=rows.filter(function(r){return r.ar>0&&tier(r.ar)===tl;});return {tier:tl,antall:rr.length,aar:rr.reduce(function(a,r){return a+r.ar;},0),fjor:rr.reduce(function(a,r){return a+r.fj;},0)};});
  var traj=[{navn:'Jevn nedgang',antall:rows.filter(function(r){return r.trend==='Jevn nedgang';}).length,aar:rows.filter(function(r){return r.trend==='Jevn nedgang';}).reduce(function(a,r){return a+r.ar;},0)},
    {navn:'Jevn vekst',antall:rows.filter(function(r){return r.trend==='Vekst';}).length,aar:rows.filter(function(r){return r.trend==='Vekst';}).reduce(function(a,r){return a+r.ar;},0)},
    {navn:'Snudd ned',antall:0,aar:0},{navn:'Snudd opp',antall:0,aar:0}];
  var winback={antall:0,oms:0};
  // lorenz
  var sv=arv.slice().sort(function(a,b){return a-b;}); var n=sv.length, cs=sv.reduce(function(a,b){return a+b;},0);
  var lorenz=[];for(var i=0;i<51;i++){var p=i/50,idx=Math.floor(p*n),c=cs?sv.slice(0,idx).reduce(function(a,b){return a+b;},0)/cs:0;lorenz.push({p:+p.toFixed(3),c:+c.toFixed(4)});}
  lorenz=lorenz.slice(0,50);
  var gv=gini(arv);
  var svd=arv.slice().sort(function(a,b){return b-a;});
  var top1=(svd.length&&cs)?+(svd[0]/cs).toFixed(4):0;
  var nfor80=0,acc=0;for(var i=0;i<svd.length;i++){acc+=svd[i];nfor80++;if(cs&&acc/cs>=0.8)break;}
  function shareK(K){K=Math.min(K,svd.length);return (cs&&K>0)?+(svd.slice(0,K).reduce(function(a,b){return a+b;},0)/cs).toFixed(4):0;}
  var pareto=[1,5,10,20,50,100,200,nfor80].map(function(K){return {k:K,share:shareK(K)};});
  var concentration={top1:top1,n_for_80:nfor80,n:nact};
  function pick(r){return {id:r.id,navn:r.navn,fjor:r.fj,aar:(r.ar!==0?r.ar:null),endr:r.endr,pct:r.pct,mig:r.mig};}
  var top_gain=rows.filter(function(r){return r.endr>0;}).slice().sort(function(a,b){return b.endr-a.endr;}).slice(0,20).map(pick);
  var top_loss=rows.filter(function(r){return r.endr<0;}).slice().sort(function(a,b){return a.endr-b.endr;}).slice(0,20).map(pick);
  var migration=rows.filter(function(r){return r.mig;}).slice(0,40).map(pick);
  var negatives=rows.filter(function(r){return r.ar<0;}).slice(0,30).map(function(r){return {id:r.id,navn:r.navn,fjor:r.fj,aar:r.ar,endr:r.endr,pct:r.pct,mig:r.mig};});
  function hb(v){var E=[[5000,'0–5k'],[10000,'5–10k'],[25000,'10–25k'],[50000,'25–50k'],[100000,'50–100k'],[200000,'100–200k'],[500000,'200–500k']];for(var i=0;i<E.length;i++)if(v<E[i][0])return E[i][1];return '500k+';}
  var hist=['0–5k','5–10k','10–25k','25–50k','50–100k','100–200k','200–500k','500k+'].map(function(lab){return {band:lab,n:arv.filter(function(v){return hb(v)===lab;}).length};});
  var missing={forfjor:null,fjor:rows.filter(function(r){return r.fj===0;}).length,aar:rows.filter(function(r){return r.ar===0;}).length};
  function restat(adj){
    var f=function(r){return !(adj&&r.mig);};
    var churn=rows.filter(function(r){return r.seg==='Tapt'&&f(r);}).length;
    var nw=rows.filter(function(r){return (r.seg==='Ny'||r.seg==='Ny negativ')&&f(r);}).length;
    var tapt_oms=rows.filter(function(r){return r.seg==='Tapt'&&f(r);}).reduce(function(a,r){return a+r.fj;},0);
    var ny_oms=rows.filter(function(r){return (r.seg==='Ny'||r.seg==='Ny negativ')&&f(r);}).reduce(function(a,r){return a+r.ar;},0);
    var kpt=rows.filter(function(r){return r.fj>0&&r.ar>0&&f(r);}), bse=rows.filter(function(r){return r.fj>0&&f(r);});
    var fb=bse.reduce(function(a,r){return a+r.fj;},0);
    return {churn:churn,new:nw,nrr:fb?+(kpt.reduce(function(a,r){return a+r.ar;},0)/fb).toFixed(4):0,grr:fb?+(kpt.reduce(function(a,r){return a+Math.min(r.ar,r.fj);},0)/fb).toFixed(4):0,logo:bse.length?+(kpt.length/bse.length).toFixed(4):0,tapt_oms:tapt_oms,ny_oms:ny_oms};
  }
  var restatement={raw:restat(false),adj:restat(true)};
  function tb(v){if(v<=0)return 0;if(v<10000)return 1;if(v<50000)return 2;if(v<100000)return 3;return 4;}
  var M=[[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]];
  rows.forEach(function(r){M[tb(r.fj)][tb(r.ar)]++;});
  var transition={labels:['Ingen','< 10k','10–50k','50–100k','100k +'],matrix:M};
  var logo=retention.logo;
  var cohort={n:base.length,surv:[100,+(logo*100).toFixed(1),+(logo*100).toFixed(1)],rev:[rnd(tot_fj),rnd(tot_fj),rnd(kept.reduce(function(a,r){return a+r.ar;},0))]};
  function vp(rs,key){var vals=rs.map(function(r){return r[key];});return {n:rs.length,snitt:vals.length?Math.round(vals.reduce(function(a,b){return a+b;},0)/vals.length):0,median:Math.round(median(vals))};}
  var valueprofile={tapt:vp(rows.filter(function(r){return r.seg==='Tapt';}),'fj'),ny:vp(rows.filter(function(r){return r.seg==='Ny'||r.seg==='Ny negativ';}),'ar'),beholdt:vp(kept,'ar')};
  function csb(v){if(v<10000)return '< 10k';if(v<50000)return '10–50k';if(v<100000)return '50–100k';return '100k +';}
  var churn_by_size=['< 10k','10–50k','50–100k','100k +'].map(function(lab){var bb=base.filter(function(r){return csb(r.fj)===lab;}),ch=bb.filter(function(r){return r.ar===0;});return {band:lab,rate:bb.length?+(ch.length/bb.length).toFixed(3):0,n:bb.length};});
  var cm=[0,0,0,0,0];kept.forEach(function(r){var p=r.pct;if(p==null)return;if(p<-0.5)cm[0]++;else if(p<-0.1)cm[1]++;else if(p<=0.1)cm[2]++;else if(p<=0.5)cm[3]++;else cm[4]++;});
  var changemag=['Falt >50%','Falt 10–50%','Flat ±10%','Vokst 10–50%','Vokst >50%'].map(function(l,i){return {lab:l,n:cm[i]};});
  function topShare(vals,frac){var s=vals.reduce(function(a,b){return a+b;},0);if(!s)return 0;var k=Math.max(1,Math.floor(vals.length*frac));return +(vals.slice(0,k).reduce(function(a,b){return a+b;},0)/s).toFixed(4);}
  var conc_time=[
    {aar:'2025',gini:gini(fjv),top10:topShare(fjv.slice().sort(function(a,b){return b-a;}),0.1),top50:topShare(fjv.slice().sort(function(a,b){return b-a;}),0.5),n:fjv.length},
    {aar:'2026',gini:gv,top10:topShare(svd,0.1),top50:topShare(svd,0.5),n:nact}
  ];
  // lognorm
  var logs=arv.filter(function(v){return v>0;}).map(function(v){return Math.log(v);});
  var lognorm;
  if(logs.length){var mu=logs.reduce(function(a,b){return a+b;},0)/logs.length;var sigma=Math.sqrt(logs.reduce(function(a,b){return a+(b-mu)*(b-mu);},0)/logs.length);
    var lo=Math.min.apply(null,logs),hi=Math.max.apply(null,logs);var bins=[],counts=[];for(var i=0;i<18;i++){bins.push(+(lo+(hi-lo)*i/18).toFixed(3));counts.push(0);}
    logs.forEach(function(x){var bi=hi>lo?Math.min(17,Math.floor((x-lo)/(hi-lo)*18)):0;counts[bi]++;});
    function skew(a){var m=a.reduce(function(x,y){return x+y;},0)/a.length;var s=Math.sqrt(a.reduce(function(x,y){return x+(y-m)*(y-m);},0)/a.length);return s?+(a.reduce(function(x,y){return x+Math.pow(y-m,3);},0)/a.length/Math.pow(s,3)).toFixed(3):0;}
    lognorm={skew_raw:skew(arv),skew_log:skew(logs),mu:+mu.toFixed(3),sigma:+sigma.toFixed(3),bins:bins,counts:counts};
  }else lognorm={skew_raw:0,skew_log:0,mu:0,sigma:0,bins:new Array(18).fill(0),counts:new Array(18).fill(0)};
  // benford
  function lead(v){v=Math.abs(Math.floor(v));while(v>=10)v=Math.floor(v/10);return v;}
  var digs=arv.filter(function(v){return v>=1;}).map(lead);var nb=digs.length;
  var obs=[],exp=[];for(var dd=1;dd<=9;dd++){obs.push(digs.filter(function(x){return x===dd;}).length);exp.push(+((Math.log10(1+1/dd))*nb).toFixed(1));}
  var chi2=0;for(var i=0;i<9;i++)if(exp[i]>0)chi2+=Math.pow(obs[i]-exp[i],2)/exp[i];
  var benford={digits:[1,2,3,4,5,6,7,8,9],obs:obs,exp:exp,chi2:+chi2.toFixed(2),n:nb};
  var risk_ct={'Høy':rows.filter(function(r){return r.risk==='Høy';}).length,'Middels':rows.filter(function(r){return r.risk==='Middels';}).length,'Lav':rows.filter(function(r){return r.risk==='Lav';}).length};
  var custlevel={n_total:rows.length,n_active:nact,risk:risk_ct,risk_value:rows.filter(function(r){return r.risk==='Høy';}).reduce(function(a,r){return a+r.ar;},0),
    top10_share:cs?+(svd.slice(0,Math.max(1,Math.floor(nact*0.1))).reduce(function(a,b){return a+b;},0)/cs).toFixed(4):0,median_active:Math.round(median(arv))};
  var quality={mig_navn:Object.keys(byname).filter(function(nm){return byname[nm].some(function(r){return r.mig;});}).length,
    mig_rader:rows.filter(function(r){return r.mig;}).length,
    mig_falsk_churn:rows.filter(function(r){return r.mig&&r.seg==='Tapt';}).length,
    mig_falsk_ny:rows.filter(function(r){return r.mig&&(r.seg==='Ny'||r.seg==='Ny negativ');}).length,
    mig_netto:rows.filter(function(r){return r.mig;}).reduce(function(a,r){return a+r.endr;},0),
    negatives:rows.filter(function(r){return r.ar<0;}).length,inaktive:rows.filter(function(r){return r.seg==='Inaktiv';}).length};
  var meta={navn:cat,kilde:'Datagrunnlag.xlsx (fakturalinjer, ProduktGruppe1)',periode:'jan–'+(['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'][cM-2]||''),aar:[2024,prevY,curY],rader:rows.length,avledning:'Avledet fra fakturalinjer, gruppe → '+cat+'. 2024 ikke tilgjengelig i datasettet.'};
  return {meta:meta,totals:totals,segments:segments,bridge:bridge,retention:retention,tiers:tiers,trajectory:traj,winback:winback,chains:[],
    lorenz:lorenz,gini:gv,pareto:pareto,concentration:concentration,top_gain:top_gain,top_loss:top_loss,migration:migration,negatives:negatives,
    hist:hist,rows:rows,missing:missing,restatement:restatement,transition:transition,cohort:cohort,valueprofile:valueprofile,churn_by_size:churn_by_size,
    changemag:changemag,rkn:{n:0,fjor:0,aar:0,nonrkn_fjor:tot_fj,nonrkn_aar:tot_ar},entity:[],conc_time:conc_time,lognorm:lognorm,benford:benford,
    custlevel:custlevel,quality:quality,chains_real:[],chaincov:{mapped_aar:0,total_aar:tot_ar,mapped_n:0,total_n:nact}};
}
function buildCats(R){var cats={};ORDER.forEach(function(c){cats[c]=buildCat(c,R);});
  return {order:ORDER,cats:cats,chainmeta:{totals:{},missing:[],note:'Kjede-mapping finnes ikke i Datagrunnlag.xlsx.'}};}
VB.buildCats=buildCats; VB.mapcat=mapcat;
})(typeof window!=='undefined'?window:globalThis);
