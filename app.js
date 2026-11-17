/* Arus — PWA keuangan pribadi. Tidak ada server, rahasia, atau penyimpanan transaksi lokal. */
'use strict';
(() => {
  const CFG = window.ARUS_CONFIG || {};
  const HEADERS = ['Tanggal & Jam','Kategori','Keterangan','Nominal (Rp)','Bulan','Sumber','ID Update'];
  const SHEET_NAMES = ['Pemasukan','Pengeluaran'];
  const DEFAULT_INCOME = ['Gaji','Usaha','Bonus','Hadiah','Investasi','Lainnya'];
  const DEFAULT_EXPENSE = ['Makanan & Minuman','Transportasi','Belanja','Tagihan','Kesehatan','Pendidikan','Hiburan','Sedekah','Lainnya'];
  const COLORS = ['#626ce7','#35bba9','#8f80e7','#f2b663','#ee8693','#65a4db','#9bbed7','#b4a0d8'];
  const TZ = CFG.TIMEZONE || 'Asia/Makassar';
  const IDR = new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0});
  const compactIDR = new Intl.NumberFormat('id-ID',{notation:'compact',maximumFractionDigits:1});
  const $ = id => document.getElementById(id);
  let token = '', tokenExpires = 0, client = null, busy = false, records = [], currentView = 'home';
  let sheetIds = {}; // sheetId numerik per tab, hanya untuk format tanggal sel yang ditambahkan
  let currentPeriod = 'month', formType = 'Pengeluaran', editing = null, deleting = null;
  let toastTimer = null;
  let prefs = {
    expense:loadPreference('arus.expense',DEFAULT_EXPENSE.join(', ')),
    income:loadPreference('arus.income',DEFAULT_INCOME.join(', ')),
    source:loadPreference('arus.source',CFG.SOURCE_DEFAULT||'Aplikasi PWA')
  };
  let spreadsheetId = loadPreference('arus.sheetId','');

  function loadPreference(k,fallback){try{return localStorage.getItem(k)??fallback;}catch{return fallback;}}
  function savePreference(k,v){try{localStorage.setItem(k,v);}catch{}}
  function todayParts(){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
    return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}:${p.second}`};
  }
  const pad2=n=>String(n).padStart(2,'0');
  function dateKeyOf(y,m,d){return `${y}-${pad2(m)}-${pad2(d)}`;}
  function dateOnly(d){return dateKeyOf(d.getFullYear(),d.getMonth()+1,d.getDate());}
  function dateAt(key){const [y,m,d]=String(key).split('-').map(Number);return new Date(y,m-1,d,12,0,0);}
  function offsetDate(key,days){const d=dateAt(key);d.setDate(d.getDate()+days);return dateOnly(d);}
  function numberMoney(value){
    if(typeof value==='number')return Number.isFinite(value)?value:NaN;
    let t=String(value??'').replace(/Rp/gi,'').replace(/\s/g,'').replace(/[^\d.,-]/g,'');
    if(!t)return NaN;
    const dot=t.lastIndexOf('.'), comma=t.lastIndexOf(',');
    if(comma>=0&&dot>=0){t=comma>dot?t.replace(/\./g,'').replace(',','.'):t.replace(/,/g,'');}
    else if(comma>=0){t=/,\d{1,2}$/.test(t)?t.replace(/\./g,'').replace(',','.'):t.replace(/,/g,'');}
    else if(dot>=0){t=/\.\d{1,2}$/.test(t)?t.replace(/,/g,''):t.replace(/\./g,'');}
    return Number(t);
  }
  function formatRp(n){return IDR.format(Number.isFinite(n)?n:0).replace(/,00$/,'');}
  function compactRp(n){return 'Rp '+compactIDR.format(Number.isFinite(n)?n:0);}
  function parseSheetDate(value){
    if(typeof value==='number'||(/^\d{5}(?:\.\d+)?$/.test(String(value).trim()))){
      const num=Number(value);
      if(num>20000&&num<100000){
        const date=new Date(Date.UTC(1899,11,30)+Math.round(num*86400000));
        const y=date.getUTCFullYear(),m=date.getUTCMonth()+1,d=date.getUTCDate();
        return {key:dateKeyOf(y,m,d),time:`${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`};
      }
    }
    const s=String(value??'').trim();
    if(!s)return null;
    // ISO YYYY-MM-DD HH:mm:ss / YYYY-MM-DDTHH:mm:ss, tanpa offset.
    let match=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/);
    if(match)return validateDate(+match[1],+match[2],+match[3],+match[4]||0,+match[5]||0,+match[6]||0);
    // Indonesia DD/MM/YYYY dan DD-MM-YYYY (opsional waktu).
    match=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ ,T]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/);
    if(match)return validateDate(+match[3],+match[2],+match[1],+match[4]||0,+match[5]||0,+match[6]||0);
    // Bentuk Date.toString dengan timezone eksplisit.
    if(/[TZ+]|GMT|UTC/i.test(s)){
      const d=new Date(s);
      if(!Number.isNaN(d.getTime())){
        const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
        return validateDate(+parts.year,+parts.month,+parts.day,+parts.hour,+parts.minute,+parts.second);
      }
    }
    return null;
  }
  function validateDate(y,m,d,h=0,min=0,s=0){
    const val=new Date(y,m-1,d);
    if(val.getFullYear()!==y||val.getMonth()!==m-1||val.getDate()!==d||h>23||min>59||s>59)return null;
    return {key:dateKeyOf(y,m,d),time:`${pad2(h)}:${pad2(min)}:${pad2(s)}`};
  }
  function formatDateLabel(row){if(!row.date)return 'Tanggal tidak dikenali';const [y,m,d]=row.date.key.split('-');return `${d}/${m}/${y}${row.date.time?' • '+row.date.time.slice(0,5):''}`;}
  function normHeader(x){return String(x??'').trim().replace(/\s+/g,' ').toLowerCase();}
  function getSheetId(input){
    const t=String(input??'').trim();
    const fromUrl=t.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    const id=fromUrl?fromUrl[1]:t;
    return /^[a-zA-Z0-9_-]{20,}$/.test(id)?id:null;
  }
  function hasAuth(){return Boolean(token)&&Date.now()<tokenExpires-30000;}
  function hasSetup(){return Boolean(spreadsheetId);}
  function configValid(){return Boolean(CFG.GOOGLE_CLIENT_ID)&&!CFG.GOOGLE_CLIENT_ID.includes('GANTI_')&&CFG.GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com');}
  function status(text,online=false){$('syncLabel').innerHTML='';const dot=document.createElement('span');dot.className='status-dot';$('syncLabel').append(dot,document.createTextNode(text));$('syncLabel').classList.toggle('online',online);$('accountStatus').textContent=online?'Akun Google terhubung. Token hanya disimpan sementara selama sesi aplikasi.':'Belum login Google.';}
  function toast(msg,kind=''){const el=$('toast');el.textContent=msg;el.className=`toast ${kind}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),4600);}
  function showConnectionBanner(){
    const banner=$('connectionBanner');
    banner.classList.toggle('hidden',hasAuth()&&hasSetup());
    const text=banner.querySelector('p');
    if(!configValid())text.textContent='Admin perlu mengisi OAuth Client ID di config.js sebelum aplikasi dapat digunakan.';
    else if(!hasSetup())text.textContent='Masukkan link spreadsheet milikmu di Pengaturan, lalu hubungkan akun Google.';
    else if(!hasAuth())text.textContent='Hubungkan akun Google yang memiliki akses ke spreadsheet.';
    $('connectBannerBtn').textContent=!hasSetup()?'Atur Sheet':'Login';
    $('loginBtn').textContent=hasAuth()?'Google terhubung':'Hubungkan Google';
    $('loginBtn').disabled=hasAuth();
  }
  function ensureSetup(){
    if(!configValid()){showView('settings');toast('Isi OAuth Client ID di config.js terlebih dahulu.','error');return false;}
    if(!hasSetup()){showView('settings');toast('Masukkan link spreadsheet di Pengaturan.','error');return false;}
    if(!hasAuth()){token='';status('Perlu login ulang');showConnectionBanner();toast('Hubungkan akun Google terlebih dahulu.','error');return false;}
    return true;
  }
  function authClick(){
    if(!configValid()){showView('settings');toast('Client ID Google belum dikonfigurasi.','error');return;}
    if(!window.google?.accounts?.oauth2){toast('Layanan login Google belum tersedia. Periksa internet.','error');return;}
    try{
      if(!client)client=window.google.accounts.oauth2.initTokenClient({client_id:CFG.GOOGLE_CLIENT_ID,scope:CFG.SCOPES,callback:response=>{
        if(response.error){toast('Login gagal: '+response.error,'error');return;}
        if(!response.access_token){toast('Google tidak mengembalikan izin akses.','error');return;}
        token=response.access_token;tokenExpires=Date.now()+(Number(response.expires_in||3600)*1000);
        status('Google terhubung',true);showConnectionBanner();toast('Akun Google berhasil terhubung.','success');
        if(hasSetup())loadData();else showView('settings');
      },error_callback:()=>toast('Pop-up login gagal atau dibatalkan. Izinkan pop-up lalu coba lagi.','error')});
      client.requestAccessToken({prompt:'select_account'});
    }catch(err){toast('Tidak bisa membuka login Google: '+err.message,'error');}
  }
  async function api(method,endpoint,body){
    if(!hasAuth()){token='';status('Perlu login ulang');showConnectionBanner();throw new Error('Sesi Google habis. Hubungkan akun lagi.');}
    if(!hasSetup())throw new Error('Spreadsheet belum dikonfigurasi.');
    const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+endpoint;
    let response;
    try{response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw new Error('Tidak dapat menghubungi Google Sheets. Periksa koneksi internet.');}
    let data={};try{data=await response.json();}catch{}
    if(!response.ok){
      const explanation=data.error?.message||'Gagal meminta data ke Google Sheets.';
      if(response.status===401){token='';status('Login ulang');showConnectionBanner();throw new Error('Sesi login habis. Hubungkan Google lagi.');}
      if(response.status===403)throw new Error('Akses ditolak. Pastikan akun Google punya izin edit spreadsheet dan Sheets API sudah diaktifkan. '+explanation);
      if(response.status===404)throw new Error('Spreadsheet atau tab tidak ditemukan. Periksa link dan nama tab.');
      throw new Error(explanation);
    }
    return data;
  }
  const rangeUrl=range=>'/values/'+encodeURIComponent(range);
  async function readRange(range,formula=false){return api('GET',rangeUrl(range)+'?'+new URLSearchParams({valueRenderOption:formula?'FORMULA':'FORMATTED_VALUE'}));}
  async function loadData(){
    if(!hasAuth()||!hasSetup()){showConnectionBanner();return;}
    if(busy)return;
    busy=true;status('Sinkronisasi...',true);$('refreshBtn').disabled=true;
    try{
      const qs=new URLSearchParams({valueRenderOption:'FORMATTED_VALUE'});
      for(const sheet of SHEET_NAMES)qs.append('ranges',`'${sheet}'!A1:G`);
      const [data,meta]=await Promise.all([api('GET','/values:batchGet?'+qs.toString()),api('GET','?fields=sheets(properties(sheetId,title))')]);
      sheetIds=Object.fromEntries((meta.sheets||[]).map(s=>[s.properties.title,s.properties.sheetId]));
      if(!data.valueRanges||data.valueRanges.length!==2)throw new Error('Tidak dapat membaca kedua tab.');
      const temp=[];
      data.valueRanges.forEach((range,i)=>{
        const sheet=SHEET_NAMES[i],rows=range.values||[];
        if(!rows.length)throw new Error(`Header di tab ${sheet} tidak ditemukan.`);
        const header=rows[0];
        if(HEADERS.some((expected,j)=>normHeader(header[j])!==normHeader(expected)))throw new Error(`Header tab ${sheet} tidak sesuai 7 kolom yang dikirim. Tidak ada perubahan data dilakukan.`);
        rows.slice(1).forEach((row,j)=>{
          const cells=Array.from({length:7},(_,k)=>row[k]??'');
          if(!cells.some(x=>String(x).trim()!==''))return;
          const value=numberMoney(cells[3]);
          const date=parseSheetDate(cells[0]);
          temp.push({sheet,rowNumber:j+2,cells,type:sheet,category:String(cells[1]||'Tanpa kategori'),note:String(cells[2]||''),amount:Number.isFinite(value)?value:0,rawAmountValid:Number.isFinite(value),date,source:String(cells[5]||'')});
        });
      });
      records=temp.sort(byRecent);
      status('Tersinkron',true);renderAll();toast('Data Google Sheets berhasil diperbarui.','success');
    }catch(err){status('Sinkronisasi gagal',false);showConnectionBanner();toast(err.message,'error');}
    finally{busy=false;$('refreshBtn').disabled=false;}
  }
  function byRecent(a,b){return (b.date?.key||'').localeCompare(a.date?.key||'')||(b.date?.time||'').localeCompare(a.date?.time||'')||b.rowNumber-a.rowNumber;}
  function currentRange(){
    const today=todayParts().date;
    if(currentPeriod==='today')return {from:today,to:today};
    if(currentPeriod==='week'){
      const day=dateAt(today).getDay(),monday=day===0?6:day-1;
      return {from:offsetDate(today,-monday),to:offsetDate(today,6-monday)};
    }
    if(currentPeriod==='month'){const [y,m]=today.split('-').map(Number);return {from:dateKeyOf(y,m,1),to:dateKeyOf(y,m,new Date(y,m,0).getDate())};}
    let from=$('fromDate').value||today,to=$('toDate').value||today;
    if(from>to)[from,to]=[to,from];
    return {from,to};
  }
  function between(date,r){return date&&date.key>=r.from&&date.key<=r.to;}
  function inRange(r){return records.filter(x=>between(x.date,r));}
  function sums(items){return {income:items.filter(x=>x.type==='Pemasukan').reduce((v,x)=>v+x.amount,0),expense:items.filter(x=>x.type==='Pengeluaran').reduce((v,x)=>v+x.amount,0)};}
  function categoriesFor(type){
    const custom=prefs[type==='Pengeluaran'?'expense':'income'].split(',').map(s=>s.trim()).filter(Boolean);
    const existing=records.filter(x=>x.type===type).map(x=>x.category);
    return Array.from(new Set([...custom,...existing].filter(Boolean))).sort((a,b)=>a.localeCompare(b,'id'));
  }
  function categorySums(items){const map=new Map();items.filter(x=>x.type==='Pengeluaran').forEach(x=>map.set(x.category,(map.get(x.category)||0)+x.amount));return [...map].map(([name,value])=>({name,value})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);}
  function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
  function emptyMessage(parent,message){parent.replaceChildren(el('div','empty',message));}
  function buildTransaction(row,showActions=false){
    const item=el('div','transaction-row');
    const isIncome=row.type==='Pemasukan';
    item.appendChild(el('div','transaction-glyph '+(isIncome?'':'expense'),isIncome?'↙':'↗'));
    const info=el('div','transaction-info');info.append(el('strong','',row.category),el('span','',`${formatDateLabel(row)}${row.note?' • '+row.note:''}`));item.appendChild(info);
    const right=el('div','transaction-right');right.appendChild(el('strong',isIncome?'income-value':'expense-value',(isIncome?'+':'−')+formatRp(Math.abs(row.amount))));
    if(showActions){const buttons=el('div','row-buttons');const edit=el('button','','Ubah'),del=el('button','','Hapus');edit.type='button';del.type='button';edit.setAttribute('aria-label','Ubah '+row.category);del.setAttribute('aria-label','Hapus '+row.category);edit.addEventListener('click',()=>openForm(row));del.addEventListener('click',()=>askDelete(row));buttons.append(edit,del);right.appendChild(buttons);}
    item.appendChild(right);return item;
  }
  function renderHome(){
    const selected=inRange(currentRange());const total=sums(selected);
    $('incomeTotal').textContent=formatRp(total.income);$('expenseTotal').textContent=formatRp(total.expense);$('netTotal').textContent=formatRp(total.income-total.expense);
    $('balanceContext').textContent=selected.length?`${selected.length} transaksi dalam periode terpilih.`:'Belum ada transaksi untuk periode ini.';
    const cats=categorySums(selected),sum=cats.reduce((v,x)=>v+x.value,0);
    $('donutTotal').textContent=compactRp(sum);$('categoryCount').textContent=`${cats.length} kategori`;
    let pos=0;const gradient=cats.map((c,i)=>{const a=(pos/sum*100),b=((pos+c.value)/sum*100);pos+=c.value;return `${COLORS[i%COLORS.length]} ${a}% ${b}%`;});
    $('donutChart').style.background=gradient.length?`conic-gradient(${gradient.join(',')})`:'#e9eef8';
    const legend=$('categoryLegend');legend.replaceChildren();
    if(!cats.length)legend.append(el('p','muted','Belum ada pengeluaran.'));
    cats.slice(0,7).forEach((c,i)=>{const line=el('div','legend-row'),dot=el('i','legend-dot');dot.style.background=COLORS[i%COLORS.length];line.append(dot,el('span','legend-name',c.name),el('span','legend-value',compactRp(c.value)),el('span','legend-percent',`${Math.round(c.value/sum*100)}%`));legend.appendChild(line);});
    if(cats.length>7)legend.append(el('p','muted',`+ ${cats.length-7} kategori lainnya`));
    const latest=$('latestList');latest.replaceChildren();records.slice(0,5).forEach(x=>latest.appendChild(buildTransaction(x)));
    if(!records.length)emptyMessage(latest,hasSetup()&&hasAuth()?'Belum ada transaksi dalam spreadsheet.':'Hubungkan Google Sheets untuk menampilkan transaksi.');
  }
  function renderHistory(){
    const type=$('historyType').value,cat=$('historyCategory').value,term=$('searchInput').value.trim().toLocaleLowerCase('id');
    const from=$('historyFrom').value,to=$('historyTo').value;
    const items=records.filter(r=>(type==='all'||r.type===type)&&(cat==='all'||r.category===cat)&&(!from||r.date?.key>=from)&&(!to||r.date?.key<=to)&&(!term||`${r.category} ${r.note} ${r.source} ${r.cells[0]}`.toLocaleLowerCase('id').includes(term)));
    $('historyCount').textContent=`${items.length} transaksi`;
    const list=$('historyList');list.replaceChildren();items.forEach(x=>list.appendChild(buildTransaction(x,true)));
    if(!items.length)emptyMessage(list,records.length?'Tidak ada transaksi yang cocok dengan filter.':'Belum ada transaksi.');
  }
  function renderHistoryCategoryOptions(){
    const select=$('historyCategory'),selected=select.value,all=Array.from(new Set(records.map(r=>r.category))).sort((a,b)=>a.localeCompare(b,'id'));
    select.replaceChildren(new Option('Semua kategori','all'));
    all.forEach(x=>select.add(new Option(x,x)));
    select.value=all.includes(selected)?selected:'all';
  }
  function previousRange(r){const n=Math.round((dateAt(r.to)-dateAt(r.from))/86400000)+1;return {from:offsetDate(r.from,-n),to:offsetDate(r.from,-1)};}
  function renderInsights(){
    const r=currentRange(),items=inRange(r),summary=sums(items),older=sums(inRange(previousRange(r)));
    const today=todayParts().date,days=Math.max(1,Math.round((dateAt((r.to>today?today:r.to))-dateAt(r.from))/86400000)+1);
    const average=(summary.expense/days);
    $('dailyAverage').textContent=formatRp(average);$('averageNote').textContent=`Per ${days} hari yang sudah berjalan`;
    if(older.expense<=0){$('spendingChange').textContent=summary.expense?'Baru':'—';$('changeNote').textContent='Periode sebelumnya belum ada pengeluaran';}
    else{const change=(summary.expense-older.expense)/older.expense*100;$('spendingChange').textContent=`${change>0?'+':''}${change.toFixed(1).replace('.',',')}%`;$('changeNote').textContent=change>0?'Pengeluaran meningkat dari sebelumnya':change<0?'Pengeluaran turun dari sebelumnya':'Sama seperti periode sebelumnya';}
    const ranked=categorySums(items);$('topCategory').textContent=ranked[0]?.name||'—';$('topCategoryNote').textContent=ranked[0]?formatRp(ranked[0].value):'Belum ada pengeluaran';$('transactionCount').textContent=String(items.length);
    renderTrend(r,items);renderComparison(summary);
    const invalid=records.filter(x=>!x.date||!x.rawAmountValid).length;
    $('parseWarning').classList.toggle('hidden',!invalid);
    $('parseWarning').textContent=invalid?`Perhatian: ${invalid} baris lama memiliki tanggal atau nominal yang belum terbaca dengan benar. Baris tersebut tetap muncul di Riwayat, tetapi tidak dihitung dalam ringkasan periode sampai formatnya diperiksa.`:'';
  }
  function renderComparison(v){const host=$('comparisonChart');host.replaceChildren();const max=Math.max(v.income,v.expense,1);
    [['Pemasukan',v.income,'income'],['Pengeluaran',v.expense,'expense']].forEach(([name,value,klass])=>{const row=el('div','comparison-line'),label=el('div','comparison-label');label.append(el('span','',name),el('strong','',formatRp(value)));const rail=el('div','comparison-rail'),bar=el('div','comparison-bar '+klass);bar.style.width=(Math.max(0,value)/max*100)+'%';rail.append(bar);row.append(label,rail);host.append(row);});
  }
  function renderTrend(range,items){
    const host=$('trendChart');host.replaceChildren();
    if(!items.length){emptyMessage(host,'Belum ada data untuk grafik tren.');return;}
    const n=Math.round((dateAt(range.to)-dateAt(range.from))/86400000)+1;
    const monthly=n>45;$('trendGranularity').textContent=monthly?'Bulanan':'Harian';
    const lookup=new Map();
    items.forEach(x=>{const key=monthly?x.date.key.slice(0,7):x.date.key;const value=lookup.get(key)||{income:0,expense:0};value[x.type==='Pemasukan'?'income':'expense']+=x.amount;lookup.set(key,value);});
    const labels=[];
    if(monthly){let [y,m]=range.from.split('-').map(Number),[ey,em]=range.to.split('-').map(Number);while(y<ey||(y===ey&&m<=em)){labels.push(dateKeyOf(y,m,1).slice(0,7));m++;if(m>12){m=1;y++;}if(labels.length>50)break;}}
    else{for(let key=range.from;key<=range.to;key=offsetDate(key,1)){labels.push(key);if(labels.length>46)break;}}
    const values=labels.map(label=>lookup.get(label)||{income:0,expense:0});const max=Math.max(...values.flatMap(x=>[x.income,x.expense]),1);
    const W=Math.max(350,labels.length*31+40),H=210,top=18,bottom=35,left=20,chartH=H-top-bottom;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Grafik pemasukan dan pengeluaran per '+(monthly?'bulan':'hari'));
    const add=(tag,attrs,textContent)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,String(v)));if(textContent!==undefined)node.textContent=textContent;svg.appendChild(node);return node;};
    for(let step=0;step<=3;step++){const y=top+chartH*step/3;add('line',{x1:left,y1:y,x2:W-7,y2:y,stroke:'#e9edf5','stroke-width':1,'stroke-dasharray':'3 4'});}
    const spacing=(W-left-18)/labels.length;
    values.forEach((pair,i)=>{
      const x=left+i*spacing+spacing*.19;
      [['income','#35bba9',0],['expense','#7578ea',1]].forEach(([name,color,j])=>{const v=pair[name],height=chartH*v/max;add('rect',{x:x+j*spacing*.27,y:top+chartH-height,width:Math.max(2,spacing*.23),height:Math.max(0,height),fill:color,rx:Math.min(3,spacing*.1)});});
      if(labels.length<=12||i%Math.ceil(labels.length/9)===0||i===labels.length-1){const label=monthly?labels[i].slice(5)+'/'+labels[i].slice(2,4):labels[i].slice(8);add('text',{x:left+i*spacing+spacing*.48,y:H-14,fill:'#9ba8bc','font-size':'10','text-anchor':'middle'},label);}
    });host.appendChild(svg);
  }
  function renderAll(){showConnectionBanner();renderHistoryCategoryOptions();renderHome();renderHistory();renderInsights();}
  function showView(view){currentView=view;document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));window.scrollTo({top:0,behavior:'smooth'});}
  function setFormType(type){formType=type;document.querySelectorAll('[data-txtype]').forEach(b=>b.classList.toggle('active',b.dataset.txtype===type));const opts=$('categorySuggestions');opts.replaceChildren();categoriesFor(type).forEach(c=>opts.appendChild(new Option(c)));}
  function openForm(row=null){
    if(!ensureSetup())return;
    editing=row;$('modalHeading').textContent=row?'Ubah transaksi':'Tambah transaksi';$('submitTransaction').textContent=row?'Simpan perubahan':'Simpan transaksi';
    $('transactionForm').reset();$('formMessage').textContent='';const now=todayParts();
    setFormType(row?.type||'Pengeluaran');$('amountInput').value=row?String(Math.abs(row.amount)).replace(/\B(?=(\d{3})+(?!\d))/g,'.'):'';
    $('categoryInput').value=row?.category||'';$('noteInput').value=row?.note||'';$('dateInput').value=row?.date?.key||now.date;
    $('transactionOverlay').classList.remove('hidden');document.body.style.overflow='hidden';
    setTimeout(()=>$('amountInput').focus(),180);
  }
  function closeForm(){editing=null;$('transactionOverlay').classList.add('hidden');document.body.style.overflow='';}
  function monthFor(date){return date.slice(0,7);} // sama persis dengan bot: yyyy-MM
  function sheetSerial(date,time){
    const [y,m,d]=date.split('-').map(Number),[h,minute,sec]=time.split(':').map(Number);
    return (Date.UTC(y,m-1,d,h,minute,sec)-Date.UTC(1899,11,30))/86400000;
  }
  async function formatDateCell(sheet,row){
    if(!Number.isInteger(sheetIds[sheet]))throw new Error('Data berhasil disimpan, tetapi ID tab belum diketahui untuk format tanggal.');
    await api('POST',':batchUpdate',{requests:[{repeatCell:{range:{sheetId:sheetIds[sheet],startRowIndex:row-1,endRowIndex:row,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE_TIME',pattern:'dd/MM/yyyy HH:mm'}}},fields:'userEnteredFormat.numberFormat'}}]});
  }
  function extractRowFromUpdate(updatedRange){const match=String(updatedRange||'').match(/![A-Z]+(\d+):[A-Z]+\d+$/);return match?Number(match[1]):null;}
  async function checkUnchanged(row){
    const fresh=await readRange(`'${row.sheet}'!A${row.rowNumber}:G${row.rowNumber}`);
    const received=Array.from({length:7},(_,i)=>fresh.values?.[0]?.[i]??'');
    if(JSON.stringify(received)!==JSON.stringify(row.cells))throw new Error('Baris ini sudah berubah sejak terakhir dimuat. Muat ulang data sebelum mengedit atau menghapusnya.');
  }
  async function saveTransaction(evt){
    evt.preventDefault();if(busy)return;if(!ensureSetup())return;
    const rawAmount=$('amountInput').value.trim();const sanitized=rawAmount.replace(/\./g,'').replace(/\s/g,'');
    const amount=Number(sanitized),category=$('categoryInput').value.trim(),note=$('noteInput').value.trim(),date=$('dateInput').value;
    if(!/^\d+$/.test(sanitized)||!Number.isSafeInteger(amount)||amount<=0){$('formMessage').textContent='Nominal wajib berupa angka bulat positif lebih dari Rp 0.';return;}
    if(!category){$('formMessage').textContent='Pilih atau ketik kategori terlebih dahulu.';return;}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!parseSheetDate(date)){$('formMessage').textContent='Tanggal belum valid.';return;}
    busy=true;$('submitTransaction').disabled=true;$('submitTransaction').textContent='Menyimpan...';$('formMessage').textContent='';
    try{
      if(editing){
        if(formType!==editing.type)throw new Error('Jenis transaksi lama tidak boleh dipindahkan saat edit. Hapus dan tambah transaksi baru jika ingin mengganti jenis.');
        await checkUnchanged(editing);
        const original=editing.date?.key===date?editing.date.time:editing.date?.time;
        const time=original||todayParts().time;
        // A:D diperbarui saja agar kolom F Sumber & G ID Update dari bot tidak berubah.
        const rowNo=editing.rowNumber,sheet=editing.sheet;
        const ranges=[{range:`'${sheet}'!A${rowNo}:D${rowNo}`,values:[[sheetSerial(date,time),category,note,amount]]}];
        if(editing.date?.key!==date){
          const monthCell=await readRange(`'${sheet}'!E${rowNo}`,true);
          const formula=String(monthCell.values?.[0]?.[0]??'');
          if(!formula.startsWith('='))ranges.push({range:`'${sheet}'!E${rowNo}`,values:[[monthFor(date)]]});
        }
        await api('POST','/values:batchUpdate',{valueInputOption:'RAW',data:ranges});
        toast('Perubahan transaksi berhasil disimpan.','success');
      }else{
        const timestamp=sheetSerial(date,todayParts().time);
        // Kolom G sengaja kosong: tidak mencampur ID Update numerik dari Telegram.
        const values=[[timestamp,category,note,amount,monthFor(date),prefs.source||'Aplikasi PWA','']];
        const result=await api('POST',rangeUrl(`'${formType}'!A:G`)+`?${new URLSearchParams({valueInputOption:'RAW',insertDataOption:'INSERT_ROWS'})}`,{values});
        const insertedRow=extractRowFromUpdate(result.updates?.updatedRange);
        if(insertedRow){try{await formatDateCell(formType,insertedRow);}catch(formatError){toast('Data tersimpan; format tanggal perlu diperiksa di Sheet. '+formatError.message,'error');}}
        toast('Transaksi tersimpan di Google Sheets.','success');
      }
      closeForm();
    }catch(err){$('formMessage').textContent=err.message;toast(err.message,'error');}
    finally{busy=false;$('submitTransaction').disabled=false;$('submitTransaction').textContent=editing?'Simpan perubahan':'Simpan transaksi';}
    if($('transactionOverlay').classList.contains('hidden'))await loadData();
  }
  function askDelete(row){if(!ensureSetup())return;deleting=row;$('confirmText').textContent=`Hapus ${row.type.toLowerCase()} ${row.category} sebesar ${formatRp(row.amount)}? Hanya isi A:G pada baris ${row.rowNumber} di tab ${row.sheet} yang dikosongkan; baris lain tidak bergeser.`;$('confirmOverlay').classList.remove('hidden');}
  function cancelDelete(){deleting=null;$('confirmOverlay').classList.add('hidden');}
  async function deleteConfirmed(){if(!deleting||busy)return;const row=deleting;busy=true;$('approveDeleteBtn').disabled=true;$('approveDeleteBtn').textContent='Menghapus...';
    try{await checkUnchanged(row);await api('POST',rangeUrl(`'${row.sheet}'!A${row.rowNumber}:G${row.rowNumber}`)+':clear',{});cancelDelete();toast('Transaksi berhasil dihapus (baris tidak bergeser).','success');}
    catch(err){toast(err.message,'error');}
    finally{busy=false;$('approveDeleteBtn').disabled=false;$('approveDeleteBtn').textContent='Ya, hapus';}
    await loadData();
  }
  function initialize(){
    const now=todayParts();$('fromDate').value=now.date;$('toDate').value=now.date;
    $('sheetInput').value=spreadsheetId;$('expenseCategories').value=prefs.expense;$('incomeCategories').value=prefs.income;$('sourceInput').value=prefs.source;
    if(!configValid())$('configHelp').textContent='⚠️ OAuth Client ID belum diisi di config.js. Baca PANDUAN-SETUP.md terlebih dahulu.';
    $('connectBannerBtn').addEventListener('click',()=>{if(!hasSetup())showView('settings');else authClick();});
    $('loginBtn').addEventListener('click',authClick);
    $('saveSheetBtn').addEventListener('click',()=>{const id=getSheetId($('sheetInput').value);if(!id){toast('Link atau ID spreadsheet tidak valid.','error');return;}spreadsheetId=id;savePreference('arus.sheetId',id);$('sheetInput').value=id;toast('Spreadsheet ID tersimpan di perangkat.','success');renderAll();if(hasAuth())loadData();});
    $('savePrefsBtn').addEventListener('click',()=>{prefs={expense:$('expenseCategories').value.trim(),income:$('incomeCategories').value.trim(),source:$('sourceInput').value.trim()||'Aplikasi PWA'};savePreference('arus.expense',prefs.expense);savePreference('arus.income',prefs.income);savePreference('arus.source',prefs.source);toast('Preferensi berhasil disimpan.','success');});
    $('disconnectBtn').addEventListener('click',()=>{if(token&&window.google?.accounts?.oauth2)window.google.accounts.oauth2.revoke(token,()=>{});token='';tokenExpires=0;records=[];status('Belum terhubung');renderAll();toast('Koneksi Google diputus dari aplikasi ini.');});
    $('refreshBtn').addEventListener('click',()=>{if(!ensureSetup())return;loadData();});
    document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
    $('seeAllBtn').addEventListener('click',()=>showView('history'));
    document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{currentPeriod=b.dataset.period;document.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('chosen',x===b));$('customPeriod').classList.toggle('hidden',currentPeriod!=='custom');renderHome();renderInsights();}));
    ['fromDate','toDate'].forEach(id=>$(id).addEventListener('change',()=>{renderHome();renderInsights();}));
    ['historyType','historyCategory','historyFrom','historyTo','searchInput'].forEach(id=>$(id).addEventListener('input',renderHistory));
    $('resetHistoryBtn').addEventListener('click',()=>{$('historyType').value='all';$('historyCategory').value='all';$('historyFrom').value='';$('historyTo').value='';$('searchInput').value='';renderHistory();});
    $('addBtn').addEventListener('click',()=>openForm());$('closeModalBtn').addEventListener('click',closeForm);
    document.querySelectorAll('[data-txtype]').forEach(b=>b.addEventListener('click',()=>{if(editing&&editing.type!==b.dataset.txtype){toast('Jenis transaksi lama tidak bisa dipindah saat edit.','error');return;}setFormType(b.dataset.txtype);}));
    $('transactionForm').addEventListener('submit',saveTransaction);
    $('amountInput').addEventListener('input',()=>{let v=$('amountInput').value;if(/^-/.test(v))return;const raw=v.replace(/\D/g,'').slice(0,15);$('amountInput').value=raw.replace(/\B(?=(\d{3})+(?!\d))/g,'.');$('formMessage').textContent='';});
    $('transactionOverlay').addEventListener('click',evt=>{if(evt.target===$('transactionOverlay'))closeForm();});
    $('cancelDeleteBtn').addEventListener('click',cancelDelete);$('approveDeleteBtn').addEventListener('click',deleteConfirmed);
    document.addEventListener('keydown',evt=>{if(evt.key==='Escape'){if(!$('confirmOverlay').classList.contains('hidden'))cancelDelete();else if(!$('transactionOverlay').classList.contains('hidden'))closeForm();}});
    window.addEventListener('online',()=>{if(hasAuth()&&hasSetup())loadData();});
    if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
    status('Belum terhubung');renderAll();
    if(!hasSetup())showView('settings');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
})();
