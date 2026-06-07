/* ============================================================================
   VIKINGBAD · CRM-HYDRERING + PERSISTENS
   - Kundeunivers + salgstall fra analyseportalen (localStorage['vbDataset2']).
   - Ekte dialog fra kundeloggen (localStorage['vbKundelogg'], mates av appen).
   - Oppgaver og besøk lagres/leses mot Supabase pr. RA (VBP) når appen kjører
     (konfig injiseres som window.__VB_CFG__). Uten konfig: illustrativ
     forhåndsvisning i minnet (som før). Øvrige felt (kontakter, kreditt,
     Brreg/DNB, kategorimiks, rabatter, grupper) er illustrative.
   ========================================================================== */
(function(){
  var NOW=new Date();

  /* ---------- Supabase REST (deler økt med appen, samme origin) ---------- */
  var VBP=(function(){
    var cfg=(typeof window!=='undefined'&&window.__VB_CFG__)||null;
    function token(){
      try{
        for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);
          if(/^sb-.*-auth-token$/.test(k)){
            var v=JSON.parse(localStorage.getItem(k));
            return (v&&(v.access_token||(v.currentSession&&v.currentSession.access_token)))||null;
          }}
      }catch(e){} return null;
    }
    function uid(){try{var t=token();if(!t)return null;var pl=JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))));return pl.sub||null;}catch(e){return null;}}
    var enabled=!!(cfg&&cfg.url&&cfg.key&&token());
    function hdr(extra){var t=token();return Object.assign({'apikey':cfg.key,'Authorization':'Bearer '+t,'Content-Type':'application/json'},extra||{});}
    function api(path,opts){return fetch(cfg.url+'/rest/v1/'+path,opts);}
    return {
      enabled:enabled,
      async load(){ // hent oppgaver + besøk brukeren har tilgang til
        if(!enabled)return {tasks:[],visits:[],pipeline:[],state:{}};
        var u=uid();
        try{
          var [t,v,p,st]=await Promise.all([
            api('crm_tasks?select=*&order=frist.asc',{headers:hdr()}).then(r=>r.ok?r.json():[]),
            api('crm_visits?select=*&order=dato.desc',{headers:hdr()}).then(r=>r.ok?r.json():[]),
            api('crm_pipeline?select=*',{headers:hdr()}).then(r=>r.ok?r.json():[]),
            api('crm_state?select=kundenr,state'+(u?'&created_by=eq.'+u:''),{headers:hdr()}).then(r=>r.ok?r.json():[])
          ]);
          var smap={}; (st||[]).forEach(function(row){smap[row.kundenr]=row.state||{};});
          return {tasks:t||[],visits:v||[],pipeline:p||[],state:smap};
        }catch(e){console.warn('[CRM] kunne ikke laste persistert data',e);return {tasks:[],visits:[],pipeline:[],state:{}};}
      },
      saveVisit(c,a){ if(!enabled||!a)return;
        api('crm_visits',{method:'POST',headers:hdr({'Prefer':'return=representation'}),
          body:JSON.stringify({kundenr:c.kundenr,ra:c.region||c.selger,dato:a.d,type:a.ty,tittel:a.tt,notat:a.no||'',neste_steg:a.ns||null})})
          .then(r=>r.ok?r.json():null).then(rows=>{if(rows&&rows[0])a._id=rows[0].id;}).catch(function(){});
      },
      saveTask(c,o){ if(!enabled||!o)return;
        api('crm_tasks',{method:'POST',headers:hdr({'Prefer':'return=representation'}),
          body:JSON.stringify({kundenr:c.kundenr,ra:c.region||c.selger,tittel:o.tt,frist:o.f||null,status:o.st||'apen',prioritet:o.pr||'middels'})})
          .then(r=>r.ok?r.json():null).then(rows=>{if(rows&&rows[0])o._id=rows[0].id;}).catch(function(){});
      },
      updateTask(c,o){ if(!enabled||!o||!o._id)return;
        api('crm_tasks?id=eq.'+o._id,{method:'PATCH',headers:hdr(),body:JSON.stringify({status:o.st})}).catch(function(){});
      },
      saveState(kundenr,ra,state){ if(!enabled)return; var u=uid();
        api('crm_state?on_conflict=kundenr,created_by',{method:'POST',
          headers:hdr({'Prefer':'resolution=merge-duplicates,return=minimal'}),
          body:JSON.stringify({kundenr:kundenr,created_by:u,ra:ra||null,state:state})}).catch(function(){});
      }
    };
  })();
  window.VBP=VBP;
  window.__VBP_ENABLED__=VBP.enabled;

  /* ---------- helpers ---------- */
  function getLogEntries(){
    try{var lz=localStorage.getItem('vbKundelogg');if(lz){var t=LZString.decompressFromBase64(lz);if(t)return JSON.parse(t);}}catch(e){}
    try{if(typeof VB_LOG_B64!=='undefined'&&VB_LOG_B64){var s=LZString.decompressFromBase64(VB_LOG_B64);if(s)return JSON.parse(s);}}catch(e){}
    return [];
  }
  function rng(seed){var s=seed>>>0;return function(){s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
  function pick(r,arr){return arr[Math.floor(r()*arr.length)%arr.length];}
  function toIso(d){var m=String(d||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:null;}
  function plus(days){return new Date(NOW.getTime()+days*86400000).toISOString().slice(0,10);}
  function freqDays(seg){return ({A:30,B:37,C:90,D:180,E:180})[seg]||120;}
  function statusOf(u){return /Hvilende|Dvale|Stoppet/i.test(u||'')?'hvilende':'aktiv';}

  var TYMAP={'Fysisk møte':'besok','Oppfølging av befaring':'besok','Oppfølging studio':'besok',
    'Teams møte (produkt og verktøy)':'mote','Teams møte (onboarding)':'mote','Proff møte':'mote',
    'E-post/SMS':'epost','Sendt e-post (KS)':'epost',
    'Utgående':'telefon','Utgående (KS)':'telefon','Inngående':'telefon','Inngående (KS)':'telefon','Ikke svar':'telefon','Delvis oppfølging':'telefon',
    'Oppfølging av tilbud':'tilbud',
    'Kredittinformasjon':'annet','Oppdatering av kundekort':'annet','Prosjektlogg':'annet','CATI':'annet'};
  function tyOf(s){return TYMAP[s]||'annet';}

  var FORNAVN=['Anne','Bjørn','Camilla','Dag','Eirik','Frode','Gro','Håkon','Ingrid','Jan','Kari','Lars','Marit','Nils','Ola','Per','Rune','Silje','Tom','Vegard','Hanne','Geir','Tone','Stein'];
  var ETTERNAVN=['Hansen','Johansen','Olsen','Larsen','Andersen','Pedersen','Nilsen','Kristiansen','Berg','Haugen','Lien','Moen','Solberg','Eriksen','Halvorsen','Lunde','Dahl','Strand'];
  var ROLLER=['Daglig leder','Innkjøpssjef','Butikksjef','Prosjektleder','Avdelingsleder','Innkjøper','Markedsansvarlig'];
  var BETAL=['Netto 15 dager','Netto 20 dager','Netto 30 dager','Forskudd','Netto + 30 dager'];
  var DNBR=['AAA','AA','A','BBB','BB'];
  var NAERING=['46.739 Engros byggevarer','47.524 Butikkhandel jernvare/fargevarer','43.221 VVS-arbeid','46.740 Engros jernvare/rørlegger'];
  var KJEDER=['Bademiljø','VVS Eksperten','Comfort','Bad & Interiør','Frittstående / Web','Rørkjøp','VA-senteret'];
  var GRPKAT=['Byggevarekjede','VVS-kjede','Frittstående','Interiør'];
  var SERIER=['Spa STD','Dusj PRO','Møbler 2026','Fliser SELECT'];
  var CATS=['Møbler','Blandebatteri','Dusjløsninger','Toalett','Bade/massasje','Fliser'];

  function tmpl(){return {
    navn:'',kundenr:null,seg:'E',score:null,fylke:'',sted:'',selger:'',region:'',
    dial:'',bad:null,kjede:'',freq:120,status:'aktiv',
    h24:null,h25:null,hit25:null,hit26:null,utv:'',utvkr:null,
    bud:null,budoppn:null,dg:null,oi:null,omsFjor:null,endringPct:null,
    orgnr:'',adresse:{gate:'',postnr:'',sted:'',tlf:''},
    kreditt:{},dnb:{},brreg:{},grupper:{kategori:'',gruppe:'',pakker:[]},
    kat:[],akt:[],opp:[],mul:[],kontakter:[],utstilling:[],
    onsker:[],rabatt:[],saker:[],tilbud:[],kommentarer:[],backup:null
  };}

  function enrich(c,logAkt){
    var r=rng((c.kundenr||0)*2654435761);
    var rev=c.hit26||0, prev=c.hit25||0;
    var w=CATS.map(function(){return r()<0.78?Math.round(r()*100)/100:0;});
    var sum=w.reduce(function(a,b){return a+b;},0)||1;
    c.kat=CATS.map(function(k,i){
      var ar=Math.round(rev*w[i]/sum), fj=Math.round(prev*w[i]/sum*(0.7+r()*0.6));
      var pct=fj?((ar-fj)/fj):0;
      return {k:k,ff:Math.round(fj*0.8),fj:fj,ar:ar,pct:Math.round(pct*100)/100,trend:pct>0.15?'Snudd opp':pct<-0.15?'Faller':'Stabil'};
    }).filter(function(k){return k.ar>0||k.fj>0;});
    var nKon=1+Math.floor(r()*2), slug=(c.navn||'').toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,12)||'kunde';
    c.kontakter=[];
    for(var i=0;i<nKon;i++){var fn=pick(r,FORNAVN),en=pick(r,ETTERNAVN);
      c.kontakter.push({n:fn+' '+en,r:pick(r,ROLLER),t:'4'+(10000000+Math.floor(r()*89999999)),e:fn.toLowerCase()+'@'+slug+'.no',p:i===0});}
    c.kjede=pick(r,KJEDER); c.orgnr=String(900000000+Math.floor(r()*99999999));
    c.adresse={gate:pick(r,['Storgata','Industriveien','Næringsparken','Verkstedveien','Bruveien'])+' '+(1+Math.floor(r()*80)),postnr:String(1000+Math.floor(r()*8999)),sted:c.sted||'',tlf:'4'+(10000000+Math.floor(r()*89999999))};
    c.grupper={kategori:pick(r,GRPKAT),gruppe:c.kjede,pakker:[pick(r,['Katalogpakke spa STD','Katalogpakke bad 2026','Skiltpakke Studio'])]};
    c.brreg={orgform:'Aksjeselskap',stiftet:'0'+(1+Math.floor(r()*9))+'.0'+(1+Math.floor(r()*9))+'.'+(1985+Math.floor(r()*38)),naeringskode:pick(r,NAERING),oppdatert:plus(-Math.floor(r()*120))};
    var forf=r()<0.18?-Math.round(r()*40000):0;
    c.kreditt={grense:Math.max(100000,Math.round((c.oi||rev||300000)*0.6/10000)*10000),rating:pick(r,DNBR)+' '+pick(r,DNBR),overvakes:r()<0.12,betaling:pick(r,BETAL),forfalte:forf};
    var dnbOms=Math.round((rev||500000)*(2.5+r()*4));
    c.dnb={rating:pick(r,DNBR),maksKreditt:Math.round(c.kreditt.grense*1.5),ansatte:2+Math.floor(r()*40),omsetning:dnbOms,varekjop:Math.round(dnbOms*(0.5+r()*0.2)),arsresultat:Math.round(dnbOms*(r()*0.12-0.02)),oppdatert:plus(-Math.floor(r()*90))};
    c.rabatt=['Spa','Dusj','Møbler','Fliser'].filter(function(){return r()<0.7;}).map(function(g){return {gruppe:g,pct:15+Math.floor(r()*4)*5};});
    if(!c.rabatt.length)c.rabatt=[{gruppe:'Spa',pct:20}];
    c.onsker=['LED-speil','Servantskap','Innbyggingsdusj','Gulvvarme'].filter(function(){return r()<0.3;});
    // Operative felt (oppgaver/pipeline): kun illustrative når persistens IKKE er på.
    c.opp=[]; c.mul=[];
    if(!VBP.enabled){
      var ld=logAkt.length?Math.round((NOW-new Date(logAkt[0].d))/86400000):null;
      if(/Stoppet/i.test(c.utv))c.opp.push({tt:'Vinn tilbake – ta kontakt',f:plus(-3),st:'apen',pr:'hoy'});
      else if(/Faller/i.test(c.utv))c.opp.push({tt:'Stopp lekkasje – book besøk',f:plus(2),st:'apen',pr:'hoy'});
      else if(/Ny|reaktiv/i.test(c.utv))c.opp.push({tt:'Onboarding – sikre gjenkjøp',f:plus(7),st:'apen',pr:'middels'});
      if(ld!=null&&ld>c.freq)c.opp.push({tt:'Ta kontakt – utenfor kontaktmål',f:plus(-Math.floor(r()*5)),st:'apen',pr:'middels'});
      else if(/Vokser/i.test(c.utv)&&c.budoppn!=null&&c.budoppn<90)c.opp.push({tt:'Løft mot budsjett',f:plus(10),st:'apen',pr:'middels'});
      if(r()<0.3)c.opp.push({tt:'Oppdater sortiment etter kampanje',f:plus(-20),st:'ferdig',pr:'lav'});
      if(/Vokser|Ny|reaktiv/i.test(c.utv)&&(c.seg==='A'||c.seg==='B'))
        c.mul.push({tt:pick(r,['Utvidet sortiment fliser','Studio-oppgradering','Nettbutikk-pakke']),ty:'sortiment',v:Math.round((rev||300000)*(0.1+r()*0.3)),s:40+Math.floor(r()*5)*10,st:pick(r,['kvalifisert','tilbud'])});
    }
    c.saker=[];
    if(r()<0.22)c.saker.push({type:'reklamasjon',tittel:'Reklamasjon på leveranse',dato:plus(-Math.floor(r()*40)),status:pick(r,['apen','arbeid','lost']),beskrivelse:'Avvik registrert – under oppfølging.'});
    c.utstilling=[];
    if((c.seg==='A'||c.seg==='B')&&r()<0.5)
      c.utstilling.push({navn:c.sted?('Utstilling '+c.sted):'Hovedutstilling',ty:pick(r,['egen','studio','shop-in-shop']),m2:20+Math.floor(r()*12)*10,avtale:pick(r,['Standardavtale','Studio-avtale']),serier:[pick(r,SERIER),pick(r,SERIER)],sist:plus(-Math.floor(r()*200)),neste:plus(Math.floor(r()*180))});
    return c;
  }

  function build(rows,byCust){
    return rows.map(function(r){
      var c=tmpl();
      c.kundenr=r[0]; c.navn=(r[1]||('Kunde '+r[0])); c.seg=(r[2]||'E');
      c.score=(r[3]==null?null:Math.round(r[3]));
      c.fylke=(r[4]||''); c.sted=(r[5]||''); c.region=(r[6]||''); c.selger=(r[6]||'Uten RA');
      c.dial=(r[7]||''); c.h25=r[9]; c.omsFjor=r[9]; c.hit25=r[11]; c.hit26=r[12];
      c.utv=(r[13]||''); c.utvkr=r[14]; c.endringPct=r[15];
      c.bud=r[16]; c.budoppn=r[17]; c.dg=r[18]; c.oi=r[19];
      c.freq=freqDays(c.seg); c.status=statusOf(c.utv);
      var logs=byCust[c.kundenr]||[];
      var akt=logs.map(function(e){return {d:e.d,ty:tyOf(e.s),tt:e.s,no:e.c||'',av:c.selger};})
                  .filter(function(a){return a.d;}).sort(function(a,b){return new Date(b.d)-new Date(a.d);});
      if(akt.length)c.akt=akt;
      else{var iso=toIso(c.dial); if(iso)c.akt=[{d:iso,ty:'annet',tt:'Siste registrerte kontakt (kundelogg)',no:'',av:c.selger}];}
      return enrich(c,c.akt);
    });
  }

  /* ---- overlay (alle øvrige redigerbare felt) ---- */
  var OVERLAY_FIELDS=['saker','utstilling','rabatt','onsker','tilbud','kommentarer','backup','adresse','kreditt','grupper','kjede'];
  function overlayOf(c){var o={};OVERLAY_FIELDS.forEach(function(f){o[f]=c[f];});return o;}
  var _baselines={}, _persistT=null;
  function initBaselines(arr){arr.forEach(function(c){_baselines[c.kundenr]=JSON.stringify(overlayOf(c));});}
  function persistDirty(){
    if(!VBP.enabled||typeof DATA==='undefined')return;
    DATA.forEach(function(c){
      var cur=JSON.stringify(overlayOf(c));
      if(_baselines[c.kundenr]===undefined){_baselines[c.kundenr]=cur;return;}
      if(cur!==_baselines[c.kundenr]){_baselines[c.kundenr]=cur;VBP.saveState(c.kundenr,c.region||c.selger,overlayOf(c));}
    });
  }
  function schedulePersist(){if(_persistT)clearTimeout(_persistT);_persistT=setTimeout(persistDirty,500);}
  function wrapRender(){
    if(typeof window==='undefined'||typeof window.render!=='function'||window.render.__vbWrapped)return;
    var _r=window.render;
    window.render=function(){var x=_r.apply(this,arguments);schedulePersist();return x;};
    window.render.__vbWrapped=true;
  }

  /* Slå sammen persisterte oppgaver/besøk inn i kundeobjektene, og re-render. */
  function mergePersisted(byKund,ops){
    var st=ops.state||{};
    Object.keys(st).forEach(function(kn){var c=byKund[kn];if(!c)return;var o=st[kn]||{};
      OVERLAY_FIELDS.forEach(function(f){if(o[f]!==undefined&&o[f]!==null)c[f]=o[f];});});
    (ops.visits||[]).forEach(function(v){var c=byKund[v.kundenr];if(!c)return;
      c.akt=c.akt||[];c.akt.unshift({d:v.dato,ty:v.type,tt:v.tittel||v.type,no:v.notat||'',ns:v.neste_steg||'',av:v.ra||c.selger,_id:v.id});});
    Object.keys(byKund).forEach(function(k){var c=byKund[k];if(c.akt)c.akt.sort(function(a,b){return new Date(b.d)-new Date(a.d);});});
    (ops.tasks||[]).forEach(function(t){var c=byKund[t.kundenr];if(!c)return;
      c.opp=c.opp||[];c.opp.push({tt:t.tittel,f:t.frist,st:t.status,pr:t.prioritet,_id:t.id});});
    (ops.pipeline||[]).forEach(function(p){var c=byKund[p.kundenr];if(!c)return;
      c.mul=c.mul||[];c.mul.push({tt:p.tittel,ty:p.type,v:p.verdi,s:p.sannsynlighet,st:p.stage,_id:p.id});});
  }

  try{
    if(typeof LZString==='undefined')return;
    var lz=localStorage.getItem('vbDataset2'); if(!lz)return;
    var raw=LZString.decompressFromUTF16(lz); if(!raw)return;
    var p=JSON.parse(raw); if(!p||!p.rows||!p.rows.length)return;
    var entries=getLogEntries(), byCust={};
    for(var i=0;i<entries.length;i++){var e=entries[i];if(e.k==null)continue;(byCust[e.k]=byCust[e.k]||[]).push(e);}
    DATA=build(p.rows,byCust);
    KAMP=KAMP.map(function(k){var kk=Object.assign({},k);
      var pool=DATA.map(function(c,ix){return {ix:ix,c:c};}).filter(function(o){return o.c.seg==='A'||o.c.seg==='B';}).slice(0,8);
      var stages=['mål','kontaktet','interessert','bestilt'];
      kk.deltakere=pool.map(function(o,ix){return {ki:o.ix,status:stages[ix%stages.length],oms:stages[ix%stages.length]==='bestilt'?Math.round((o.c.hit26||0)*0.05):0};});
      return kk;});
    window.__VB_CRM_SOURCE__='dataset'; window.__VB_CRM_LOG__=entries.length;
    window.__VB_CRM_PERIODE__=(p.meta&&p.meta.maxDate)||'';
    console.log('[CRM] hydrert · '+DATA.length+' kunder · '+entries.length+' loggførte dialoger · persistens '+(VBP.enabled?'PÅ':'av'));
    // Last persistert data asynkront og re-render
    if(VBP.enabled){
      var byKund={}; DATA.forEach(function(c){byKund[c.kundenr]=c;});
      VBP.load().then(function(ops){mergePersisted(byKund,ops);initBaselines(DATA);wrapRender();
        if(window.render)window.render();
        console.log('[CRM] persistert: '+ops.tasks.length+' oppgaver, '+ops.visits.length+' besøk, '+Object.keys(ops.state||{}).length+' lagrede kundekort');});
      // fallback hvis render finnes før load er ferdig
      setTimeout(wrapRender,0);
    }
  }catch(e){console.warn('[CRM] hydrering feilet, bruker demodata:',e);}
})();
