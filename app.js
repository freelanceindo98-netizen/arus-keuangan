import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $ = (id) => document.getElementById(id);
const config = window.ARUS_CLOUD_CONFIG || {};
// Public Site Key dari Cloudflare Turnstile (bukan Secret Key).
const TURNSTILE_SITE_KEY = '0x4AAAAAAGGnqKddIMfgFfTz';
const validConfig = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.SUPABASE_URL || '') &&
  /^(sb_publishable_|eyJ)/.test(config.SUPABASE_PUBLISHABLE_KEY || '');
const rupiah = (number) => 'Rp ' + Number(number || 0).toLocaleString('id-ID');
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const showDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});
const monthStart = () => localToday().slice(0,7) + '-01';
let sb;
// Penanda khusus reset password harus dibaca SEBELUM Supabase membersihkan token URL.
// Ini mencegah redirect pemulihan keliru diperlakukan sebagai login normal.
const initialQuery = new URLSearchParams(window.location.search);
const initialHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
let recoveryFlow = initialQuery.get('reset_password') === '1' ||
  initialQuery.get('type') === 'recovery' || initialHash.get('type') === 'recovery';
function clearRecoveryUrl(){
  history.replaceState(null, '', window.location.pathname);
}
const state = {user:null,profile:null,adminUsers:[],tx:[],budgets:[],weeklyBudgets:[],goals:[],budgetPeriod:'monthly',budgetDate:localToday(),editBudget:null,reportPeriod:'monthly',reportDate:localToday(),period:'month',view:'Home',authMode:'login',editTx:null,editGoal:null,deleteTask:null,approvalTask:null,authStamp:0,working:false};
let readyUserId = null;
const AVATAR_BUCKET = 'arus-avatars';
const avatarCache = {userId:null, path:null, url:null, validUntil:0};
let toastHandle;
function toast(message, kind='ok') {const el=$('toast');el.textContent=message;el.classList.toggle('error',kind==='error');el.hidden=false;clearTimeout(toastHandle);toastHandle=setTimeout(()=>el.hidden=true,4500);}
function showOnly(id){['setupScreen','authScreen','pendingScreen','appScreen'].forEach(x=>$(x).hidden=x!==id);}
function busy(btn, status){if(!btn)return;btn.disabled=!!status;if(status){btn.dataset.original=btn.textContent;btn.textContent='Memprosesâ€¦';}else if(btn.dataset.original){btn.textContent=btn.dataset.original;delete btn.dataset.original;}}
function reportError(error){console.error(error);const msg=String(error?.message||error||'Terjadi kesalahan');if(/email address not authorized|email_address_not_authorized/i.test(msg))toast('Email belum diizinkan oleh SMTP Supabase. Untuk uji coba gunakan email anggota tim proyek, atau konfigurasi SMTP sendiri.','error');else if(/email rate limit/i.test(msg))toast('Batas email Supabase tercapai. Ulangi nanti atau siapkan SMTP.','error');else toast(msg,'error');}

function resetPasswordVisibility(){
  document.querySelectorAll('#authScreen [data-toggle-password]').forEach(button=>{
    const input=$(button.dataset.togglePassword);
    if(input)input.type='password';
    button.setAttribute('aria-pressed','false');
    button.setAttribute('aria-label','Tampilkan kata sandi');
    button.title='Tampilkan kata sandi';
  });
}
function bindPasswordVisibility(){
  document.querySelectorAll('#authScreen [data-toggle-password]').forEach(button=>{
    button.addEventListener('click',()=>{
      const input=$(button.dataset.togglePassword);
      if(!input)return;
      const visible=input.type==='password';
      input.type=visible?'text':'password';
      const action=visible?'Sembunyikan kata sandi':'Tampilkan kata sandi';
      button.setAttribute('aria-pressed',String(visible));
      button.setAttribute('aria-label',action);
      button.title=action;
      input.focus({preventScroll:true});
    });
  });
}
// CAPTCHA wajib untuk login, daftar, dan pengiriman email pemulihan.
// Token divalidasi oleh Supabase Auth di server setelah CAPTCHA diaktifkan di Dashboard.
let captchaWidgetId = null;
let captchaToken = '';
let captchaIssuedAt = 0;
function captchaMessage(message) {
  const el = $('captchaStatus');
  if (el) el.textContent = message;
}
function resetCaptcha() {
  captchaToken = '';
  captchaIssuedAt = 0;
  if (window.turnstile && captchaWidgetId !== null) {
    try { window.turnstile.reset(captchaWidgetId); }
    catch (error) { console.warn('Tidak dapat memuat ulang Turnstile:', error); }
  }
  captchaMessage('Selesaikan pemeriksaan keamanan sebelum melanjutkan.');
}
function renderCaptcha() {
  if (captchaWidgetId !== null || !window.turnstile || !$('authTurnstile') ||
      $('authScreen').hidden || state.authMode === 'recovery') return;
  try {
    captchaWidgetId = window.turnstile.render('#authTurnstile', {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'light',
      size: 'flexible',
      'response-field': false,
      callback: token => {
        captchaToken = token;
        captchaIssuedAt = Date.now();
        captchaMessage('Pemeriksaan keamanan berhasil.');
      },
      'expired-callback': () => {
        captchaToken = ''; captchaIssuedAt = 0;
        captchaMessage('Verifikasi kedaluwarsa. Ulangi pemeriksaan keamanan.');
      },
      'error-callback': errorCode => {
        captchaToken = ''; captchaIssuedAt = 0;
        console.warn('Turnstile tidak dapat diverifikasi:', errorCode);
        captchaMessage('Verifikasi keamanan gagal dimuat. Coba refresh halaman atau nonaktifkan pemblokir skrip.');
      },
      'timeout-callback': () => {
        captchaToken = ''; captchaIssuedAt = 0;
        captchaMessage('Pemeriksaan keamanan kehabisan waktu. Coba lagi.');
      }
    });
  } catch (error) {
    console.error('Gagal menampilkan CAPTCHA:', error);
    captchaMessage('CAPTCHA belum berhasil dimuat. Muat ulang halaman untuk mencoba lagi.');
  }
}
function requireCaptchaToken() {
  if (!captchaToken || !captchaIssuedAt || Date.now() - captchaIssuedAt > 270000) {
    resetCaptcha();
    throw new Error('Selesaikan pemeriksaan keamanan (CAPTCHA) terlebih dahulu.');
  }
  return captchaToken;
}
// Callback Turnstile berjalan setelah JavaScript Cloudflare selesai dimuat.
window.addEventListener('arus:turnstile-ready', renderCaptcha);

function showAuth(mode='login'){
  state.authMode=mode;showOnly('authScreen');$('authForm').reset();resetPasswordVisibility();
  $('captchaWrap').hidden=mode==='recovery';
  if(mode!=='recovery'){if(captchaWidgetId!==null)resetCaptcha();else renderCaptcha();}
  const titles={login:'Selamat datang kembali.',signup:'Mulai atur keuanganmu.',recovery:'Buat kata sandi baru.'};
  const subtitles={login:'Masuk untuk melihat arus keuanganmu.',signup:'Daftar tanpa perlu Google Sheets.',recovery:'Masukkan kata sandi baru untuk akunmu.'};
  $('authTitle').textContent=titles[mode];$('authSubtitle').textContent=subtitles[mode];
  $('authTabs').hidden=mode==='recovery';$('authEmail').parentElement.hidden=mode==='recovery';$('authEmail').required=mode!=='recovery';
  $('confirmPasswordLabel').hidden=mode!=='recovery';$('authConfirmPassword').required=mode==='recovery';
  $('recoveryCancelBtn').hidden=mode!=='recovery';
  $('authPassword').autocomplete=mode==='login'?'current-password':'new-password';$('fullNameLabel').hidden=mode!=='signup';$('authFullName').required=mode==='signup';
  $('authSubmit').textContent={login:'Masuk',signup:'Daftar akun',recovery:'Simpan kata sandi'}[mode];$('forgotBtn').hidden=mode==='recovery';
  document.querySelectorAll('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===mode));
}
function showApp(){showOnly('appScreen');$('userName').textContent=state.profile?.full_name||state.user?.email?.split('@')[0]||'Akun';$('accountEmail').textContent=state.user?.email||'';$('adminNavBtn').hidden=state.profile?.role!=='admin';document.querySelector('.bottom-nav').style.gridTemplateColumns=state.profile?.role==='admin'?'repeat(6,minmax(0,1fr))':'repeat(5,minmax(0,1fr))';if(state.profile?.role!=='admin'&&state.view==='Admin')state.view='Home';switchView(state.view);renderProfile();}
function switchView(v){if(v==='Admin'&&state.profile?.role!=='admin')return;state.view=v;['Home','History','Budget','Report','Admin','Account'].forEach(x=>$('view'+x).hidden=x!==v);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));$('addTransaction').hidden=v==='Account'||v==='Admin'||v==='Report';if(v==='Admin')loadAdminUsers();window.scrollTo({top:0,behavior:'smooth'});}
function confirmAction(message, job){state.deleteTask=job;$('confirmText').textContent=message;$('confirmDialog').showModal();}
function clearAvatarImages(){
  for(const id of ['profileAvatarImage','headerAvatarImage']){
    const img=$(id);if(!img)continue;img.hidden=true;img.removeAttribute('src');
  }
  $('profileAvatarFallback').hidden=false;
  $('headerAvatarPlaceholder').hidden=false;
}
function showAvatarImages(url){
  for(const [imageId,fallbackId] of [['profileAvatarImage','profileAvatarFallback'],['headerAvatarImage','headerAvatarPlaceholder']]){
    const img=$(imageId), fallback=$(fallbackId);
    img.onload=()=>{if(img.src===url){img.hidden=false;fallback.hidden=true;}};
    img.onerror=()=>{img.hidden=true;fallback.hidden=false;};
    img.hidden=true;fallback.hidden=false;img.src=url;
    if(img.complete && img.naturalWidth){img.hidden=false;fallback.hidden=true;}
  }
}
async function loadAvatar(){
  const userId=state.user?.id, path=state.profile?.avatar_path;
  if(!userId||!path)return;
  if(avatarCache.userId===userId&&avatarCache.path===path&&avatarCache.url&&Date.now()<avatarCache.validUntil){
    showAvatarImages(avatarCache.url);return;
  }
  const {data,error}=await sb.storage.from(AVATAR_BUCKET).createSignedUrl(path,600);
  if(error){console.warn('Foto profil tidak dapat dimuat:',error);return;}
  if(!data?.signedUrl||state.user?.id!==userId||state.profile?.avatar_path!==path)return;
  Object.assign(avatarCache,{userId,path,url:data.signedUrl,validUntil:Date.now()+540000});
  showAvatarImages(data.signedUrl);
}
function renderProfile(){
  if(!state.user||!state.profile)return;
  const name=state.profile.full_name||state.user.email?.split('@')[0]||'Pengguna';
  $('profileDisplayName').textContent=name;
  $('profileEmail').textContent=state.user.email||'';
  $('userName').textContent=name;
  $('accountEmail').textContent=state.user.email||'';
  $('profileAvatarFallback').textContent=(name.trim().charAt(0)||'A').toUpperCase();
  $('headerAvatarPlaceholder').textContent=(name.trim().charAt(0)||'A').toUpperCase();
  if(document.activeElement!==$('profileFullName'))$('profileFullName').value=state.profile.full_name||'';
  $('removeProfilePhotoBtn').hidden=!state.profile.avatar_path;
  if(!state.profile.avatar_path){clearAvatarImages();return;}
  if(avatarCache.path!==state.profile.avatar_path||avatarCache.userId!==state.user.id)clearAvatarImages();
  loadAvatar().catch(error=>console.warn('Gagal menampilkan foto profil:',error));
}
async function saveProfileName(event){
  event.preventDefault();
  if(!isActive())return toast('Akun belum aktif.','error');
  const name=$('profileFullName').value.trim();
  if(name.length<2||name.length>120)return toast('Nama harus 2â€“120 karakter.','error');
  const button=$('saveProfileNameBtn');busy(button,true);
  try{
    const {error}=await sb.rpc('arus_set_my_name',{p_full_name:name});
    if(error)throw error;
    state.profile.full_name=name;renderProfile();toast('Nama profil berhasil diperbarui.');
  }catch(error){reportError(error);}finally{busy(button,false);}
}
async function uploadProfilePhoto(event){
  const input=event.target;
  const file=input.files?.[0];input.value='';
  if(!file)return;
  if(!isActive())return toast('Akun belum aktif.','error');
  const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
  const ext=extensions[file.type];
  if(!ext)return toast('Gunakan foto JPG, PNG, atau WEBP.','error');
  if(file.size>2*1024*1024||file.size===0)return toast('Ukuran foto harus maksimal 2 MB.','error');
  const userId=state.user.id;
  const path=`${userId}/${crypto.randomUUID()}.${ext}`;
  const oldPath=state.profile.avatar_path;
  const button=$('uploadProfileBtn');busy(button,true);
  try{
    const {error:uploadError}=await sb.storage.from(AVATAR_BUCKET)
      .upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
    if(uploadError)throw uploadError;
    const {error:profileError}=await sb.rpc('arus_set_my_avatar',{p_avatar_path:path});
    if(profileError){
      await sb.storage.from(AVATAR_BUCKET).remove([path]).catch(console.warn);
      throw profileError;
    }
    if(state.user?.id!==userId)return;
    state.profile.avatar_path=path;
    Object.assign(avatarCache,{userId:null,path:null,url:null,validUntil:0});
    renderProfile();toast('Foto profil berhasil diperbarui.');
    if(oldPath&&oldPath!==path)sb.storage.from(AVATAR_BUCKET).remove([oldPath])
      .then(({error})=>{if(error)console.warn('Foto lama belum terhapus:',error);});
  }catch(error){reportError(error);}finally{busy(button,false);}
}
async function removeProfilePhoto(){
  const path=state.profile?.avatar_path;
  if(!path||!isActive())return;
  if(!confirm('Hapus foto profil dan gunakan avatar huruf bawaan?'))return;
  const button=$('removeProfilePhotoBtn');busy(button,true);
  try{
    const {error}=await sb.rpc('arus_set_my_avatar',{p_avatar_path:null});
    if(error)throw error;
    state.profile.avatar_path=null;
    Object.assign(avatarCache,{userId:null,path:null,url:null,validUntil:0});
    renderProfile();toast('Foto profil dihapus.');
    const {error:removeError}=await sb.storage.from(AVATAR_BUCKET).remove([path]);
    if(removeError)console.warn('Berkas foto lama belum dihapus:',removeError);
  }catch(error){reportError(error);}finally{busy(button,false);}
}

async function handleAuthSubmit(e){e.preventDefault();const btn=$('authSubmit');busy(btn,true);try{
 const email=$('authEmail').value.trim();const password=$('authPassword').value;
 if(state.authMode==='signup'){
   const fullName=$('authFullName').value.trim();if(!fullName)throw new Error('Nama lengkap wajib diisi.');
   const captchaToken = requireCaptchaToken();
   const {data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin+window.location.pathname,data:{full_name:fullName},captchaToken}});if(error)throw error;
   if(data.session){toast('Pengajuan akun sudah dibuat. Menunggu persetujuan admin.');}else{toast('Pengajuan dikirim. Jika email belum diverifikasi, cek inbox lalu masuk untuk memantau status.');showAuth('login');}
 }else if(state.authMode==='login'){
   const captchaToken = requireCaptchaToken();
   const {error}=await sb.auth.signInWithPassword({email,password,options:{captchaToken}});if(error)throw error;toast('Berhasil masuk.');
 }else if(state.authMode==='recovery'){
   const confirm=$('authConfirmPassword').value;
   if(password.length<8)throw new Error('Kata sandi baru minimal 8 karakter.');
   if(password!==confirm)throw new Error('Konfirmasi kata sandi tidak sama.');
   const {data:sessionData,error:sessionError}=await sb.auth.getSession();
   if(sessionError||!sessionData.session)throw new Error('Tautan reset tidak aktif. Minta tautan baru lewat Lupa kata sandi.');
   const {error}=await sb.auth.updateUser({password});if(error)throw error;
   // Akhiri sesi pemulihan setelah penggantian berhasil, lalu minta login normal.
   recoveryFlow=false;clearRecoveryUrl();
   const {error:logoutError}=await sb.auth.signOut();
   if(logoutError){console.error('Gagal keluar setelah ganti kata sandi:',logoutError);toast('Password berhasil diubah. Silakan keluar dari akun lalu masuk dengan password baru.','error');}
   else{await syncUser(null);toast('Password berhasil diubah. Silakan masuk dengan password baru.');}
 }
 }catch(error){reportError(error)}finally{if(state.authMode!=='recovery')resetCaptcha();busy(btn,false);btn.textContent={login:'Masuk',signup:'Daftar akun',recovery:'Simpan kata sandi'}[state.authMode];}}
async function forgotPassword(){const email=$('authEmail').value.trim();if(!email){toast('Isi alamat email terlebih dahulu.','error');$('authEmail').focus();return;}const btn=$('forgotBtn');busy(btn,true);try{const captchaToken=requireCaptchaToken();const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+'/reset-password.html',captchaToken});if(error)throw error;toast('Jika email terdaftar, periksa inbox untuk tautan reset kata sandi.');}catch(error){reportError(error)}finally{resetCaptcha();busy(btn,false);}}

async function cancelRecovery(){
  recoveryFlow=false;clearRecoveryUrl();
  try{await sb.auth.signOut();}catch(error){console.error('Keluar dari pemulihan:',error);}
  await syncUser(null);
  toast('Pemulihan dibatalkan. Silakan masuk atau minta tautan baru.');
}

function isActive(){return state.profile && (state.profile.role==='admin'||state.profile.approval_status==='approved');}
function cleanProtectedState(){
  state.tx=[];state.goals=[];state.budgets=[];state.weeklyBudgets=[];state.adminUsers=[];readyUserId=null;
  for(const id of ['reportRows','reportCategories']){const element=$(id);if(element)element.innerHTML='';}
  for(const id of ['reportIncome','reportExpense','reportNet']){const element=$(id);if(element)element.textContent='Rp 0';}
  Object.assign(avatarCache,{userId:null,path:null,url:null,validUntil:0});
  clearAvatarImages();
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
}
function displayWaiting(profile){
  const status=profile?.approval_status||'pending';
  const titles={pending:'Menunggu persetujuan admin.',rejected:'Pendaftaran belum disetujui.',suspended:'Akses akun ditangguhkan.'};
  const details={
    pending:'Pengajuanmu sudah tercatat. Admin akan meninjau pendaftaran sebelum akses keuangan dibuka.',
    rejected:'Admin belum menyetujui pengajuan akun ini. Hubungi pengelola Arus Cloud untuk informasi lebih lanjut.',
    suspended:'Akses akun ini sementara dinonaktifkan oleh admin. Data keuanganmu tidak dihapus.'
  };
  $('pendingTitle').textContent=titles[status]||'Status akun belum tersedia.';
  $('pendingMessage').textContent=details[status]||'Tidak dapat memeriksa status. Coba muat ulang.';
  $('pendingEmail').textContent=state.user?.email||'';
  showOnly('pendingScreen');
}
async function syncUser(user){
  const stamp=++state.authStamp;
  if(!user){state.user=null;state.profile=null;cleanProtectedState();showAuth('login');return;}
  state.user=user;
  try{
    const {data,error}=await sb.from('profiles')
      .select('id,email,full_name,avatar_path,role,approval_status,requested_at,admin_note')
      .eq('id',user.id).single();
    if(stamp!==state.authStamp)return;
    if(error)throw error;
    state.profile=data;
    if(!isActive()){cleanProtectedState();displayWaiting(data);return;}
    const reload=readyUserId!==user.id || $('appScreen').hidden;
    showApp();
    if(reload){readyUserId=user.id;await loadAll();}
  }catch(error){
    if(stamp!==state.authStamp)return;
    console.error('Gagal memeriksa akses pengguna:',error);
    state.profile=null;cleanProtectedState();displayWaiting(null);
    $('pendingTitle').textContent='Tidak dapat memeriksa status.';
    $('pendingMessage').textContent='Coba Periksa status terbaru. Jika tetap gagal, periksa apakah tabel profiles sudah diekspos pada Data API Supabase.';
    toast('Gagal memeriksa status akun. Akses ditahan untuk keamanan.','error');
  }
}
async function refreshCurrentAccess(){
  if(!sb||!state.user)return;
  const {data,error}=await sb.auth.getUser();
  if(error){reportError(error);return;}
  await syncUser(data.user||null);
}
async function logoutCloud(){
  const {error}=await sb.auth.signOut();
  if(error){reportError(error);return;}
  await syncUser(null);toast('Berhasil keluar dari akun.');
}
const approvalNames={pending:'Menunggu',approved:'Disetujui',rejected:'Ditolak',suspended:'Ditangguhkan'};
function adminRow(u){
  const name=u.full_name||u.email?.split('@')[0]||'Tanpa nama';
  const date=new Date(u.requested_at).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});
  const actions=u.role==='admin'?'':u.approval_status==='pending'
    ?`<button class="btn small primary" type="button" data-review-id="${esc(u.id)}" data-review-status="approved">Setujui</button><button class="btn small" type="button" data-review-id="${esc(u.id)}" data-review-status="rejected">Tolak</button>`
    :u.approval_status==='approved'
      ?`<button class="btn small danger-outline" type="button" data-review-id="${esc(u.id)}" data-review-status="suspended">Tangguhkan</button>`
      :`<button class="btn small primary" type="button" data-review-id="${esc(u.id)}" data-review-status="approved">Aktifkan</button>`;
  return `<article class="white-card admin-user-card">
    <div class="admin-user-top"><div><b>${esc(name)}</b><small>${esc(u.email||'Tidak ada email')}</small></div><span class="status-chip status-${esc(u.approval_status)}">${esc(u.role==='admin'?'Admin':approvalNames[u.approval_status]||u.approval_status)}</span></div>
    <div class="admin-user-meta">Daftar ${esc(date)}${u.admin_note?` Â· Catatan: ${esc(u.admin_note)}`:''}</div>
    ${actions?`<div class="admin-actions">${actions}</div>`:''}
  </article>`;
}
function renderAdmin(){
  if(state.profile?.role!=='admin')return;
  const users=state.adminUsers;
  const pending=users.filter(u=>u.role!=='admin'&&u.approval_status==='pending');
  const approved=users.filter(u=>u.role!=='admin'&&u.approval_status==='approved');
  const term=$('adminSearch').value.trim().toLowerCase();
  const others=users.filter(u=>u.role==='admin'||u.approval_status!=='pending').filter(u=>!term||[u.email,u.full_name,u.approval_status].some(s=>String(s||'').toLowerCase().includes(term)));
  $('adminStats').innerHTML=`<div class="admin-stat"><small>Terdaftar</small><strong>${users.length}</strong></div><div class="admin-stat"><small>Menunggu</small><strong>${pending.length}</strong></div><div class="admin-stat"><small>Aktif</small><strong>${approved.length}</strong></div>`;
  $('adminPendingList').innerHTML=pending.length?pending.map(adminRow).join(''):emptyText('Tidak ada pendaftaran yang menunggu.');
  $('adminOthersList').innerHTML=others.length?others.map(adminRow).join(''):emptyText('Pengguna tidak ditemukan.');
}
async function loadAdminUsers(){
  if(state.profile?.role!=='admin')return;
  const {data,error}=await sb.from('profiles')
    .select('id,email,full_name,role,approval_status,requested_at,admin_note')
    .order('requested_at',{ascending:false}).limit(1000);
  if(error){reportError(error);return;}
  state.adminUsers=data||[];renderAdmin();
  if(data?.length>=1000)toast('Daftar melebihi 1.000 akun. Tambahkan pagination sebelum meluncurkan ke publik.');
}
function openReview(id,status){
  if(!['approved','rejected','suspended'].includes(status)||state.profile?.role!=='admin')return;
  const user=state.adminUsers.find(u=>u.id===id&&u.role!=='admin');if(!user)return;
  state.approvalTask={id,status};
  const action={approved:'Menyetujui',rejected:'Menolak',suspended:'Menangguhkan'}[status];
  $('approvalTitle').textContent=action+' pengguna';
  $('approvalDesc').textContent=`${action} akses untuk ${user.full_name||user.email} (${user.email||'tanpa email'})?`;
  $('approvalNote').value='';$('approvalConfirm').textContent='Ya, konfirmasi';
  $('approvalDialog').showModal();
}
async function submitReview(e){
  e.preventDefault();const job=state.approvalTask;if(!job)return;
  const btn=$('approvalConfirm');busy(btn,true);
  try{
    const {data,error}=await sb.from('profiles')
      .update({approval_status:job.status,admin_note:$('approvalNote').value.trim()})
      .eq('id',job.id).eq('role','user')
      .select('id,approval_status');
    if(error)throw error;
    if(!data?.length)throw new Error('Persetujuan gagal. Periksa izin admin dan kebijakan RLS.');
    $('approvalDialog').close();state.approvalTask=null;
    toast('Status akun berhasil diperbarui.');await loadAdminUsers();
  }catch(error){reportError(error);}finally{busy(btn,false);}
}

async function loadAll(){if(!state.user||!isActive())return;const reload=$('reloadBtn');busy(reload,true);try{
  const results=await Promise.all([
    sb.from('transactions').select('id,type,amount,category,note,transaction_date,created_at').order('transaction_date',{ascending:false}).order('created_at',{ascending:false}).limit(3000),
    sb.from('budgets').select('id,category,month,limit_amount').order('month',{ascending:false}).limit(1000),
    sb.from('weekly_budgets').select('id,category,week_start,limit_amount').order('week_start',{ascending:false}).limit(1000),
    sb.from('savings_goals').select('id,name,target_amount,saved_amount,target_date').order('created_at',{ascending:false}).limit(1000)
  ]);
  for(const r of results)if(r.error)throw r.error;
  [state.tx,state.budgets,state.weeklyBudgets,state.goals]=results.map(r=>r.data||[]);
  renderAll();
  if(state.tx.length>=3000 || state.budgets.length>=1000 || state.weeklyBudgets.length>=1000)toast('Sebagian catatan melebihi batas tampilan beta; total anggaran mungkin tidak lengkap.','error');
 }catch(error){reportError(error)}finally{busy(reload,false);}}
function filteredByPeriod(){const now=localToday();let start='0000-01-01',end=now;
 if(state.period==='today')start=now;
 if(state.period==='month')start=monthStart();
 if(state.period==='week'){const d=new Date(now+'T12:00:00');const offset=(d.getDay()+6)%7;d.setDate(d.getDate()-offset);start=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
 return {start,end,rows:state.tx.filter(t=>t.transaction_date>=start&&t.transaction_date<=end)};
}
function totals(rows){return rows.reduce((a,t)=>{a[t.type]+=Number(t.amount);return a;},{income:0,expense:0});}
function emptyText(message){return `<div class="empty">${esc(message)}</div>`;}
function transactionItem(t,actions=false){return `<div class="transaction-item"><div class="tx-emoji ${t.type==='income'?'income':''}">${t.type==='income'?'â†“':'â†‘'}</div><div class="tx-meta"><b>${esc(t.category)}</b><small>${esc(showDate(t.transaction_date))}${t.note?' Â· '+esc(t.note):''}</small></div><span class="tx-amount ${t.type==='income'?'income':''}">${t.type==='income'?'+':'âˆ’'}${rupiah(t.amount)}</span>${actions?`<button class="tx-menu" type="button" data-edit-tx="${esc(t.id)}" aria-label="Edit transaksi">âœŽ</button><button class="tx-menu" type="button" data-delete-tx="${esc(t.id)}" aria-label="Hapus transaksi">Ã—</button>`:''}</div>`;}
// Dashboard 2.0 â€” semuanya membaca transaksi milik sesi aktif, tanpa query baru.
// Kategori dinormalisasi agar "BBM" dan "bbm" tidak terhitung terpisah.
function dashboardCategories(rows){
  const categories=new Map();
  for(const t of rows){
    if(t.type!=='expense')continue;
    const label=String(t.category||'Lainnya').trim()||'Lainnya';
    const key=label.toLocaleLowerCase('id-ID');
    if(!categories.has(key))categories.set(key,{name:label,total:0});
    categories.get(key).total+=Number(t.amount)||0;
  }
  return [...categories.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'id-ID'));
}
function dashboardTrendData(today=localToday(),transactions=state.tx){
  const anchor=new Date(`${today}T12:00:00`);
  const periods=Array.from({length:6},(_,i)=>{
    const d=new Date(anchor.getFullYear(),anchor.getMonth()-5+i,1,12);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    return {key,label:d.toLocaleDateString('id-ID',{month:'short'}),year:d.getFullYear(),income:0,expense:0};
  });
  const lookup=new Map(periods.map(p=>[p.key,p]));
  for(const tx of transactions){
    if(!tx.transaction_date||tx.transaction_date>today)continue;
    const item=lookup.get(tx.transaction_date.slice(0,7));
    if(item&&(tx.type==='income'||tx.type==='expense'))item[tx.type]+=Number(tx.amount)||0;
  }
  return periods;
}
function dashboardCompact(value){
  return new Intl.NumberFormat('id-ID',{notation:'compact',maximumFractionDigits:1}).format(Number(value)||0);
}
function renderDashboardTrend(){
  const host=$('dashboardTrendChart');
  const months=dashboardTrendData();
  const largest=Math.max(0,...months.flatMap(m=>[m.income,m.expense]));
  if(largest===0){host.innerHTML=emptyText('Belum ada transaksi dalam enam bulan terakhir. Grafik akan muncul setelah ada pemasukan atau pengeluaran.');return;}
  const minYear=months[0].year,maxYear=months[months.length-1].year;
  const each=months.map(m=>{
    const h=type=>m[type]>0?Math.max(5,Math.round(m[type]/largest*130)):0;
    const periodLabel=`${m.label} ${m.year}`;
    return `<div class="dash-chart-month" title="${esc(periodLabel)} Â· pemasukan ${esc(rupiah(m.income))} Â· pengeluaran ${esc(rupiah(m.expense))}">
      <div class="dash-bar-pair" aria-label="${esc(periodLabel)}: pemasukan ${esc(rupiah(m.income))}; pengeluaran ${esc(rupiah(m.expense))}">
        <div class="dash-bar dash-bar-income" style="height:${h('income')}px" title="Pemasukan ${esc(rupiah(m.income))}"></div>
        <div class="dash-bar dash-bar-expense" style="height:${h('expense')}px" title="Pengeluaran ${esc(rupiah(m.expense))}"></div>
      </div>
      <strong>${esc(m.label)}${minYear!==maxYear?` <small>${String(m.year).slice(2)}</small>`:''}</strong>
      <span class="dash-month-value dash-value-income">+${esc(dashboardCompact(m.income))}</span>
      <span class="dash-month-value dash-value-expense">âˆ’${esc(dashboardCompact(m.expense))}</span>
    </div>`;
  }).join('');
  host.innerHTML=`<div class="dash-chart-scroll"><div class="dash-chart-grid">${each}</div></div>`;
}
function renderDashboardCategories(categories,totalExpense){
  const list=$('dashboardTopCategories');
  $('dashboardCategoryCount').textContent=`${categories.length} kategori`;
  const labels={today:'Hari ini',week:'Minggu ini',month:'Bulan ini',all:'Semua transaksi'};
  $('dashboardCategoryPeriod').textContent=`Periode: ${labels[state.period]}`;
  if(!categories.length){list.innerHTML=emptyText('Belum ada pengeluaran pada periode ini.');return;}
  list.innerHTML=categories.slice(0,5).map((c,index)=>{
    const portion=totalExpense>0?100*c.total/totalExpense:0;
    const share=Math.round(portion);
    return `<div class="dash-category-item">
      <div class="dash-category-top"><div class="dash-category-name"><span>${index+1}</span><strong>${esc(c.name)}</strong></div><b>${esc(rupiah(c.total))}</b></div>
      <div class="dash-category-progress"><div style="width:${Math.min(100,Math.max(0,portion))}%"></div></div>
      <small>${share}% dari total pengeluaran periode ini</small>
    </div>`;
  }).join('');
}
function renderHome(){const {rows,start,end}=filteredByPeriod();const sum=totals(rows);$('saldoValue').textContent=rupiah(sum.income-sum.expense);$('inValue').textContent=rupiah(sum.income);$('outValue').textContent=rupiah(sum.expense);$('countInfo').textContent=`${rows.length} transaksi`;
 const labels={today:'Hari ini',week:'Minggu ini',month:'Bulan ini',all:'Semua transaksi hingga hari ini'};$('periodLabel').textContent=labels[state.period];document.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('selected',b.dataset.period===state.period));
 const sorted=dashboardCategories(rows);
 $('topCategory').textContent=sorted[0]?.name||'â€”';$('topCategoryTotal').textContent=sorted[0]?rupiah(sorted[0].total):'Belum ada pengeluaran';
 const days=state.period==='all'?(rows.length?Math.max(1,Math.ceil((Date.parse(end+'T12:00:00')-Date.parse([...rows].map(t=>t.transaction_date).sort()[0]+'T12:00:00'))/86400000)+1):1):Math.max(1,Math.floor((Date.parse(end+'T12:00:00')-Date.parse(start+'T12:00:00'))/86400000)+1);
 $('dailyAverage').textContent=rupiah(Math.round(sum.expense/days));$('recentList').innerHTML=rows.length?rows.slice(0,5).map(t=>transactionItem(t)).join(''):emptyText('Belum ada transaksi di periode ini.');
 $('homeDataWarning').hidden=state.tx.length<3000;
 renderDashboardTrend();renderDashboardCategories(sorted,sum.expense);
}
function renderHistory(){const term=$('historySearch').value.toLocaleLowerCase('id-ID').trim();const kind=$('historyType').value;const rows=state.tx.filter(t=>(kind==='all'||t.type===kind)&&(!term||[t.category,t.note,t.transaction_date].some(x=>String(x||'').toLocaleLowerCase('id-ID').includes(term))));$('historyList').innerHTML=rows.length?rows.map(t=>transactionItem(t,true)).join(''):emptyText('Transaksi tidak ditemukan.');}
// Satu periode anggaran: pekanan Seninâ€“Minggu, bulanan tgl 1â€“terakhir.
function dateString(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function budgetWindow(period,date){
  const ref=/^\d{4}-\d{2}-\d{2}$/.test(date||'') ? date : localToday();
  const d=new Date(ref+'T12:00:00');
  if(Number.isNaN(d.getTime()))throw new Error('Tanggal anggaran tidak valid.');
  if(period==='weekly'){
    const first=new Date(d);first.setDate(first.getDate()-(first.getDay()+6)%7);
    const last=new Date(first);last.setDate(first.getDate()+6);
    return {period,start:dateString(first),end:dateString(last),key:dateString(first),label:`${showDate(dateString(first))} â€“ ${showDate(dateString(last))}`};
  }
  const first=new Date(d.getFullYear(),d.getMonth(),1,12);
  const last=new Date(d.getFullYear(),d.getMonth()+1,0,12);
  return {period:'monthly',start:dateString(first),end:dateString(last),key:dateString(first),label:first.toLocaleDateString('id-ID',{month:'long',year:'numeric'})};
}
function budgetCategory(value){return String(value||'').trim().toLocaleLowerCase('id-ID');}
function relevantBudgets(date){
  const month=budgetWindow('monthly',date).key,week=budgetWindow('weekly',date).key;
  return [
    ...state.budgets.filter(b=>b.month===month).map(b=>({...b,periodType:'monthly'})),
    ...state.weeklyBudgets.filter(b=>b.week_start===week).map(b=>({...b,periodType:'weekly'}))
  ];
}
function spendingForBudget(b,excludeId=null){
  const w=budgetWindow(b.periodType,b.periodType==='monthly'?b.month:b.week_start);
  return state.tx.filter(t=>t.id!==excludeId&&t.type==='expense'&&
    budgetCategory(t.category)===budgetCategory(b.category)&&
    t.transaction_date>=w.start&&t.transaction_date<=w.end
  ).reduce((sum,t)=>sum+Number(t.amount),0);
}
function budgetLevel(spent,limit){
  const pct=limit>0?(spent/limit)*100:0;
  return {pct,kind:pct>100?'over':pct>=100?'full':pct>=80?'near':'ok'};
}
function statusText(spent,limit){
  const {kind,pct}=budgetLevel(spent,limit);
  if(kind==='over')return `Melebihi anggaran ${rupiah(spent-limit)} (${Math.round(pct)}%).`;
  if(kind==='full')return 'Anggaran sudah 100% terpakai.';
  if(kind==='near')return `Perhatian: ${Math.round(pct)}% anggaran terpakai; sisa ${rupiah(limit-spent)}.`;
  return `Masih dalam anggaran; sisa ${rupiah(limit-spent)}.`;
}
function projectedWarnings(payload,excludeId=null){
  if(payload.type!=='expense'||!payload.transaction_date||!payload.category)return [];
  return relevantBudgets(payload.transaction_date)
    .filter(b=>budgetCategory(b.category)===budgetCategory(payload.category))
    .map(b=>({budget:b,spent:spendingForBudget(b,excludeId)+Number(payload.amount||0)}))
    .filter(x=>budgetLevel(x.spent,Number(x.budget.limit_amount)).kind!=='ok');
}
function transactionDraft(){return {
  type:document.querySelector('input[name="txType"]:checked')?.value||'expense',
  amount:Number($('txAmount').value)||0,
  category:$('txCategory').value.trim(),
  transaction_date:$('txDate').value
};}
function updateTransactionBudgetHint(){
  const el=$('txBudgetHint');const payload=transactionDraft();
  if(payload.type!=='expense'||payload.amount<=0||!payload.category||!payload.transaction_date){el.hidden=true;el.textContent='';return;}
  const matching=relevantBudgets(payload.transaction_date).filter(b=>budgetCategory(b.category)===budgetCategory(payload.category));
  if(!matching.length){el.hidden=true;el.textContent='';return;}
  el.hidden=false;
  el.classList.toggle('warn',matching.some(b=>budgetLevel(spendingForBudget(b,state.editTx)+payload.amount,Number(b.limit_amount)).kind!=='ok'));
  el.textContent=matching.map(b=>{
    const spent=spendingForBudget(b,state.editTx)+payload.amount;
    const period=b.periodType==='weekly'?'Pekanan':'Bulanan';
    return `${period} Â· ${statusText(spent,Number(b.limit_amount))}`;
  }).join('  |  ');
}
function renderHomeBudgetAlerts(){
  const el=$('homeBudgetAlerts');
  const budgets=relevantBudgets(localToday()).map(b=>({
    ...b,spent:spendingForBudget(b),limit:Number(b.limit_amount)
  })).map(b=>({...b,level:budgetLevel(b.spent,b.limit)}));
  if(!budgets.length){
    el.innerHTML=emptyText('Belum ada anggaran untuk pekan atau bulan berjalan. Buat anggaran agar pengeluaran lebih terkontrol.');
    return;
  }
  const importance={over:4,full:3,near:2,ok:1};
  budgets.sort((a,b)=>importance[b.level.kind]-importance[a.level.kind]||b.level.pct-a.level.pct||a.category.localeCompare(b.category,'id-ID'));
  const needsAttention=budgets.filter(b=>b.level.kind!=='ok').length;
  const summary=`<div class="dash-budget-summary"><span><b>${budgets.length}</b> anggaran aktif</span><span class="${needsAttention?'dash-has-warning':''}"><b>${needsAttention}</b> perlu perhatian</span></div>`;
  const cards=budgets.slice(0,5).map(b=>{
    const percent=Math.round(b.level.pct);
    const statusIcon=b.level.kind==='over'?'âš ':b.level.kind==='full'||b.level.kind==='near'?'!':'âœ“';
    const statusClass=b.level.kind;
    return `<article class="white-card dash-budget-card ${statusClass}">
      <div class="dash-budget-card-head"><strong>${esc(b.category)}</strong><span class="dash-budget-period">${b.periodType==='weekly'?'Pekanan':'Bulanan'}</span></div>
      <div class="dash-budget-numbers"><b>${esc(rupiah(b.spent))}</b><span>dari ${esc(rupiah(b.limit))}</span></div>
      ${progressMarkup(b.spent,b.limit)}
      <p class="dash-budget-state ${statusClass}"><span aria-hidden="true">${statusIcon}</span> ${esc(statusText(b.spent,b.limit))}${b.level.kind==='ok'?` <small>(${percent}%)</small>`:''}</p>
    </article>`;
  }).join('');
  const more=budgets.length>5?`<p class="dash-more-note">+${budgets.length-5} anggaran lainnya tersedia di menu Anggaran.</p>`:'';
  el.innerHTML=summary+`<div class="dash-budget-cards">${cards}</div>`+more;
}
function changeBudgetReference(delta){
  const d=new Date(state.budgetDate+'T12:00:00');
  if(state.budgetPeriod==='weekly')d.setDate(d.getDate()+delta*7);
  else {d.setDate(1);d.setMonth(d.getMonth()+delta);}
  state.budgetDate=dateString(d);$('budgetReferenceDate').value=state.budgetDate;renderBudget();
}
function updateBudgetFormPeriod(){
  const p=$('budgetFormPeriodType').value,date=$('budgetFormDate').value||localToday();
  $('budgetFormPeriodText').textContent='Periode: '+budgetWindow(p,date).label;
}

// Ringkasan bulanan: tampilkan pekanan yang beririsan dengan bulan pilihan.
// Anggaran pekanan tetap utuh Seninâ€“Minggu, termasuk jika melintasi batas bulan.
function weeklyBudgetsOverlappingMonth(monthWindow){
  return state.weeklyBudgets
    .filter(b=>{
      const week=budgetWindow('weekly',b.week_start);
      return week.start<=monthWindow.end && week.end>=monthWindow.start;
    })
    .map(b=>({...b,periodType:'weekly'}))
    .sort((a,b)=>a.week_start.localeCompare(b.week_start));
}
function progressMarkup(spent,limit,extraClass=''){
  const {pct,kind}=budgetLevel(spent,limit);
  const width=Math.min(100,Math.max(0,pct));
  return `<div class="progress-track ${extraClass}"><div class="progress-fill ${kind==='over'?'over':kind==='near'||kind==='full'?'nearing':''}" style="width:${width}%"></div></div>`;
}
function budgetCardMarkup(b){
  const spent=spendingForBudget(b),limit=Number(b.limit_amount),pct=Math.round(budgetLevel(spent,limit).pct);
  const {kind}=budgetLevel(spent,limit);
  return `<div class="budget-item"><div class="item-top"><b>${esc(b.category)}</b><div class="item-actions"><button type="button" data-edit-budget="${esc(b.id)}" data-budget-type="${esc(b.periodType)}">Edit</button><button type="button" data-delete-budget="${esc(b.id)}" data-budget-type="${esc(b.periodType)}">Hapus</button></div></div>${progressMarkup(spent,limit)}<div class="item-foot"><span>Terpakai ${rupiah(spent)}</span><span>${pct}% dari ${rupiah(limit)}</span></div><p class="budget-status ${kind}">${esc(statusText(spent,limit))}</p></div>`;
}
function weeklyBreakdownMarkup(b,monthWindow){
  const week=budgetWindow('weekly',b.week_start);
  const crossMonth=week.start<monthWindow.start || week.end>monthWindow.end;
  const spent=spendingForBudget(b),limit=Number(b.limit_amount),{pct,kind}=budgetLevel(spent,limit);
  return `<div class="weekly-breakdown-item">
    <div class="weekly-breakdown-head"><div><strong>${esc(week.label)}</strong>${crossMonth?'<small>Pekan lintas bulan Â· dihitung satu pekan penuh</small>':''}</div><button type="button" class="weekly-open-btn" data-open-budget-week="${esc(b.week_start)}" aria-label="Lihat anggaran pekan ${esc(week.label)}">Lihat pekan â†’</button></div>
    ${progressMarkup(spent,limit,'weekly-breakdown-progress')}
    <div class="item-foot"><span>Terpakai ${rupiah(spent)}</span><span>${Math.round(pct)}% dari ${rupiah(limit)}</span></div>
    <p class="budget-status ${kind}">${esc(statusText(spent,limit))}</p>
  </div>`;
}
function monthlyIntegratedMarkup(monthWindow){
  const monthly=state.budgets.filter(b=>b.month===monthWindow.key).map(b=>({...b,periodType:'monthly'}));
  const weekly=weeklyBudgetsOverlappingMonth(monthWindow);
  const groups=monthly.map(b=>{
    const sameCategory=weekly.filter(x=>budgetCategory(x.category)===budgetCategory(b.category));
    return `<section class="monthly-budget-group">
      ${budgetCardMarkup(b)}
      <div class="monthly-weekly-section"><div class="monthly-weekly-heading"><h3>Rincian pekanan</h3><span>${sameCategory.length} anggaran pekanan</span></div>
      ${sameCategory.length?sameCategory.map(x=>weeklyBreakdownMarkup(x,monthWindow)).join(''):'<p class="monthly-weekly-empty">Belum ada anggaran pekanan untuk kategori ini pada bulan tersebut. Kamu bisa membuatnya melalui pilihan periode Pekanan.</p>'}
      </div>
    </section>`;
  });
  // Anggaran pekanan tanpa anggaran bulanan tetap terlihat dalam ringkasan bulan.
  const extraWeekly=weekly.filter(b=>!monthly.some(m=>budgetCategory(m.category)===budgetCategory(b.category)));
  const extraMarkup=extraWeekly.length?`<section class="weekly-other-section"><div class="monthly-weekly-heading"><h3>Anggaran pekanan lainnya</h3><span>${extraWeekly.length} anggaran</span></div><p class="monthly-weekly-caption">Kategori di bawah belum memiliki anggaran bulanan. Semua tetap bisa dipantau.</p>${extraWeekly.map(b=>`<div class="weekly-other-category"><strong>${esc(b.category)}</strong>${weeklyBreakdownMarkup(b,monthWindow)}</div>`).join('')}</section>`:'';
  if(!monthly.length&&!weekly.length)return emptyText('Belum ada anggaran pada bulan ini. Klik + Anggaran untuk membuatnya.');
  return `${groups.length?groups.join(''):emptyText('Belum ada anggaran bulanan pada periode ini. Anggaran pekanan yang sudah dibuat ditampilkan di bawah.')}${extraMarkup}`;
}
function renderBudget(){
  const w=budgetWindow(state.budgetPeriod,state.budgetDate);
  $('budgetPeriodType').value=state.budgetPeriod;
  $('budgetReferenceDate').value=state.budgetDate;
  $('budgetMonth').textContent=w.label;
  $('budgetPeriodDescription').textContent=state.budgetPeriod==='monthly'
    ?`Anggaran bulanan dan rincian pekanan yang beririsan dengan ${w.label}. Pengeluaran bulanan dihitung hanya dalam bulan tersebut; pengeluaran pekanan dihitung Seninâ€“Minggu secara penuh. Kedua batas anggaran tidak dijumlahkan.`
    :`Anggaran pekanan untuk transaksi tanggal ${showDate(w.start)} sampai ${showDate(w.end)}. Kategori pada transaksi harus sama.`;
  if(state.budgetPeriod==='monthly'){
    $('budgetList').innerHTML=monthlyIntegratedMarkup(w);
  } else {
    const list=state.weeklyBudgets.filter(b=>b.week_start===w.key).map(b=>({...b,periodType:'weekly'}));
    $('budgetList').innerHTML=list.length?list.map(budgetCardMarkup).join(''):emptyText('Belum ada anggaran pada pekan ini. Klik + Anggaran untuk membuatnya.');
  }
  $('goalsList').innerHTML=state.goals.length?state.goals.map(g=>{const pct=Math.round(Number(g.saved_amount)/Number(g.target_amount)*100);return `<div class="goal-item"><div class="item-top"><b>${esc(g.name)}</b><div class="item-actions"><button data-edit-goal="${esc(g.id)}">Edit</button><button data-delete-goal="${esc(g.id)}">Hapus</button></div></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,pct)}%"></div></div><div class="item-foot"><span>${rupiah(g.saved_amount)} terkumpul</span><span>${pct}% dari ${rupiah(g.target_amount)}</span></div>${g.target_date?`<small class="hint">Target tanggal ${esc(showDate(g.target_date))}</small>`:''}</div>`;}).join(''):emptyText('Belum ada target tabungan.');
}
function renderAll(){renderHome();renderHomeBudgetAlerts();renderHistory();renderBudget();renderReport();}
function openTx(t=null){
  state.editTx=t?.id||null;$('transactionTitle').textContent=t?'Edit transaksi':'Tambah transaksi';
  $('transactionForm').reset();const type=t?.type||'expense';
  document.querySelector(`input[name="txType"][value="${type}"]`).checked=true;
  $('txAmount').value=t?.amount||'';$('txCategory').value=t?.category||'';
  $('txNote').value=t?.note||'';$('txDate').value=t?.transaction_date||localToday();
  updateTransactionBudgetHint();$('transactionDialog').showModal();
  setTimeout(()=>$('txAmount').focus(),80);
}
async function saveTx(event){
  event.preventDefault();if(state.working)return;
  const amount=Number($('txAmount').value);
  if(!Number.isSafeInteger(amount)||amount<=0){toast('Nominal harus bilangan bulat positif.','error');return;}
  const category=$('txCategory').value.trim();
  if(!category){toast('Kategori wajib diisi.','error');return;}
  const payload={type:document.querySelector('input[name="txType"]:checked').value,amount,category,note:$('txNote').value.trim(),transaction_date:$('txDate').value};
  const warnings=projectedWarnings(payload,state.editTx);
  state.working=true;const btn=$('saveTransaction');busy(btn,true);
  try{
    const r=state.editTx?await sb.from('transactions').update(payload).eq('id',state.editTx).select('id'):
      await sb.from('transactions').insert(payload).select('id');
    if(r.error)throw r.error;
    if(!r.data?.length)throw new Error('Perubahan tidak diizinkan atau transaksi tidak ditemukan.');
    $('transactionDialog').close();await loadAll();
    if(warnings.length){
      const first=warnings[0];toast(`âš  ${first.budget.category}: ${statusText(first.spent,Number(first.budget.limit_amount))}`,'error');
    }else toast(state.editTx?'Transaksi diperbarui.':'Transaksi tersimpan.');
  }catch(error){reportError(error)}finally{busy(btn,false);state.working=false;}
}
function openBudget(b=null){
  const type=b?.periodType||state.budgetPeriod;
  state.editBudget=b?{id:b.id,periodType:type}:null;
  $('budgetDialogTitle').textContent=b?'Edit anggaran':'Buat anggaran';
  $('budgetForm').reset();$('budgetFormPeriodType').value=type;
  $('budgetFormPeriodType').disabled=!!b;
  $('budgetFormDate').value=b?(type==='monthly'?b.month:b.week_start):state.budgetDate;
  $('budgetCategory').value=b?.category||'';$('budgetLimit').value=b?.limit_amount||'';
  updateBudgetFormPeriod();$('budgetDialog').showModal();
}
async function saveBudget(e){
  e.preventDefault();if(state.working)return;
  const category=$('budgetCategory').value.trim(),amount=Number($('budgetLimit').value);
  if(!category||!Number.isSafeInteger(amount)||amount<=0){toast('Isi kategori dan batas anggaran yang valid.','error');return;}
  const type=$('budgetFormPeriodType').value;
  const w=budgetWindow(type,$('budgetFormDate').value);
  const table=type==='weekly'?'weekly_budgets':'budgets';
  const payload={category,limit_amount:amount,[type==='weekly'?'week_start':'month']:w.key};
  const btn=$('saveBudgetButton');busy(btn,true);state.working=true;
  try{
    let r;
    if(state.editBudget){
      r=await sb.from(table).update(payload).eq('id',state.editBudget.id).select('id');
    }else{
      r=await sb.from(table).upsert({...payload,user_id:state.user.id},
        {onConflict:type==='weekly'?'user_id,category,week_start':'user_id,category,month'}).select('id');
    }
    if(r.error)throw r.error;
    if(!r.data?.length)throw new Error('Anggaran gagal disimpan atau tidak memiliki izin.');
    state.budgetPeriod=type;state.budgetDate=$('budgetFormDate').value;
    state.editBudget=null;$('budgetDialog').close();toast('Anggaran tersimpan.');await loadAll();
  }catch(error){reportError(error)}finally{busy(btn,false);state.working=false;}
}
function openGoal(g=null){state.editGoal=g?.id||null;$('goalTitle').textContent=g?'Edit target tabungan':'Target tabungan baru';$('goalForm').reset();$('goalName').value=g?.name||'';$('goalTarget').value=g?.target_amount||'';$('goalSaved').value=g?.saved_amount??0;$('goalDate').value=g?.target_date||'';$('goalDialog').showModal();}
async function saveGoal(e){e.preventDefault();const target=Number($('goalTarget').value),saved=Number($('goalSaved').value);if(!Number.isSafeInteger(target)||target<=0||!Number.isSafeInteger(saved)||saved<0){toast('Nominal target harus valid.','error');return;}const payload={name:$('goalName').value.trim(),target_amount:target,saved_amount:saved,target_date:$('goalDate').value||null};if(!payload.name){toast('Nama target wajib diisi.','error');return;}const btn=e.submitter;busy(btn,true);try{const r=state.editGoal?await sb.from('savings_goals').update(payload).eq('id',state.editGoal).select('id'):await sb.from('savings_goals').insert(payload).select('id');if(r.error)throw r.error;if(!r.data?.length)throw new Error('Target tidak tersimpan.');$('goalDialog').close();toast('Target tabungan tersimpan.');await loadAll();}catch(error){reportError(error)}finally{busy(btn,false);}}
async function doDelete(){const job=state.deleteTask;$('confirmDialog').close();if(!job)return;const tables={tx:'transactions',budget:'budgets',weeklyBudget:'weekly_budgets',goal:'savings_goals'};try{const r=await sb.from(tables[job.kind]).delete().eq('id',job.id).select('id');if(r.error)throw r.error;if(!r.data?.length)throw new Error('Tidak diizinkan menghapus catatan.');toast('Catatan dihapus.');await loadAll();}catch(error){reportError(error)}finally{state.deleteTask=null;}}

// Laporan keuangan: hanya menghitung transaksi yang telah dimuat untuk akun login.
// Tidak menambah query ke database atau akses lintas pengguna.
function reportRange(){
  const date=/^\d{4}-\d{2}-\d{2}$/.test(state.reportDate)?state.reportDate:localToday();
  const d=new Date(date+'T12:00:00');
  if(state.reportPeriod==='yearly')return {start:`${d.getFullYear()}-01-01`,end:`${d.getFullYear()}-12-31`,label:`Tahun ${d.getFullYear()}`};
  const start=dateString(new Date(d.getFullYear(),d.getMonth(),1,12));
  const end=dateString(new Date(d.getFullYear(),d.getMonth()+1,0,12));
  return {start,end,label:new Date(start+'T12:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'})};
}
function reportData(){
  const range=reportRange();
  const rows=state.tx.filter(t=>t.transaction_date>=range.start&&t.transaction_date<=range.end);
  const sum=totals(rows);
  const byCategory=new Map();
  for(const t of rows){
    if(t.type!=='expense')continue;
    const category=String(t.category||'Lainnya').trim()||'Lainnya';
    const key=category.toLocaleLowerCase('id-ID');
    if(!byCategory.has(key))byCategory.set(key,{name:category,total:0});
    byCategory.get(key).total+=Number(t.amount);
  }
  const categories=[...byCategory.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'id-ID'));
  const ordered=[...rows].sort((a,b)=>b.transaction_date.localeCompare(a.transaction_date)||String(b.created_at||'').localeCompare(String(a.created_at||'')));
  return {range,rows:ordered,sum,categories};
}
function updateReportFilters(){
  $('reportPeriodType').value=state.reportPeriod;
  $('reportMonthLabel').hidden=state.reportPeriod==='yearly';
  $('reportYearLabel').hidden=state.reportPeriod!=='yearly';
  $('reportMonthInput').value=state.reportDate.slice(0,7);
  $('reportYearInput').value=Number(state.reportDate.slice(0,4));
}
function renderReport(){
  if(!state.user||!isActive())return;
  updateReportFilters();
  const {range,rows,sum,categories}=reportData();
  $('reportPeriodTitle').textContent=range.label;
  $('reportIncome').textContent=rupiah(sum.income);
  $('reportExpense').textContent=rupiah(sum.expense);
  $('reportNet').textContent=rupiah(sum.income-sum.expense);
  $('reportNet').classList.toggle('negative',sum.income-sum.expense<0);
  $('reportDataWarning').hidden=state.tx.length<3000;
  $('reportCategoryCount').textContent=`${categories.length} kategori`;
  $('reportTransactionCount').textContent=`${rows.length} transaksi`;
  const maxCategory=Math.max(1,...categories.map(x=>x.total));
  $('reportCategories').innerHTML=categories.length?categories.map(c=>`<div class="report-category"><div class="report-category-row"><strong>${esc(c.name)}</strong><span>${rupiah(c.total)} <small>(${sum.expense?Math.round(c.total/sum.expense*100):0}%)</small></span></div><div class="report-category-track"><div style="width:${Math.min(100,c.total/maxCategory*100)}%"></div></div></div>`).join(''):emptyText('Belum ada transaksi pengeluaran pada periode ini.');
  $('reportRows').innerHTML=rows.map(t=>`<tr><td>${esc(showDate(t.transaction_date))}</td><td><span class="report-type ${t.type==='income'?'in':'out'}">${t.type==='income'?'Pemasukan':'Pengeluaran'}</span></td><td>${esc(t.category)}</td><td>${esc(t.note||'â€”')}</td><td class="number">${t.type==='income'?'+':'âˆ’'}${rupiah(t.amount)}</td></tr>`).join('');
  $('reportEmptyNote').textContent=rows.length?'': 'Belum ada transaksi pada periode ini.';
}
function changeReportDate(delta){
  const d=new Date(state.reportDate+'T12:00:00');
  d.setDate(1);
  if(state.reportPeriod==='yearly')d.setFullYear(d.getFullYear()+delta);
  else d.setMonth(d.getMonth()+delta);
  state.reportDate=dateString(d);
  renderReport();
}
function csvSafeCell(value){
  let content=String(value??'');
  // Hindari spreadsheet formula injection pada data dari pengguna.
  if(/^[\s\uFEFF]*[=+\-@]/.test(content))content="'"+content;
  return '"'+content.replaceAll('"','""')+'"';
}
function downloadReportCsv(){
  if(!state.user||!isActive())return;
  if(state.tx.length>=3000){toast('Data mencapai batas 3.000 transaksi. Ekspor CSV dibatalkan supaya tidak disangka lengkap.','error');return;}
  const {range,rows,sum,categories}=reportData();
  const lines=[
    ['Laporan Keuangan Arus Cloud'].map(csvSafeCell).join(';'),
    [range.label].map(csvSafeCell).join(';'),
    ['Pemasukan',sum.income].map((v,i)=>i===1?String(v):csvSafeCell(v)).join(';'),
    ['Pengeluaran',sum.expense].map((v,i)=>i===1?String(v):csvSafeCell(v)).join(';'),
    ['Selisih Bersih',sum.income-sum.expense].map((v,i)=>i===1?String(v):csvSafeCell(v)).join(';'),
    '',
    ['Ringkasan kategori pengeluaran','Nominal'].map(csvSafeCell).join(';'),
    ...categories.map(c=>[csvSafeCell(c.name),String(c.total)].join(';')),
    '',
    ['Tanggal','Jenis','Kategori','Keterangan','Nominal (Rp)'].map(csvSafeCell).join(';'),
    ...rows.map(t=>[csvSafeCell(t.transaction_date),csvSafeCell(t.type==='income'?'Pemasukan':'Pengeluaran'),csvSafeCell(t.category),csvSafeCell(t.note||''),String(t.type==='income'?Number(t.amount):-Number(t.amount))].join(';'))
  ];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`Arus-Cloud-Laporan-${state.reportPeriod==='yearly'?range.start.slice(0,4):range.start.slice(0,7)}.csv`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast('Laporan CSV siap dibuka di Excel.');
}
function printReport(){
  if(!state.user||!isActive())return;
  if(state.tx.length>=3000){toast('Data mencapai batas 3.000 transaksi. Laporan cetak mungkin belum lengkap.','error');return;}
  if(state.view!=='Report')switchView('Report');
  window.print();
}

function exportCsv(){const cols=['tanggal','jenis','kategori','nominal','keterangan'];const cell=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s='\t'+s;return '"'+s.replaceAll('"','""')+'"';};const data=[cols.join(','),...state.tx.map(t=>[t.transaction_date,t.type==='income'?'Pemasukan':'Pengeluaran',t.category,t.amount,t.note].map(cell).join(','))];const blob=new Blob(['\ufeff'+data.join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`Arus-Cloud-Transaksi-${localToday()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('File CSV berhasil disiapkan.');}
function bindEvents(){
 bindPasswordVisibility();
 $('authForm').addEventListener('submit',handleAuthSubmit);$('forgotBtn').addEventListener('click',forgotPassword);$('recoveryCancelBtn').addEventListener('click',cancelRecovery);document.querySelectorAll('[data-auth-mode]').forEach(b=>b.addEventListener('click',()=>showAuth(b.dataset.authMode)));
 $('reloadBtn').addEventListener('click',loadAll);document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
 $('addTransaction').addEventListener('click',()=>openTx());$('seeHistory').addEventListener('click',()=>switchView('History'));$('dashboardGoToBudget').addEventListener('click',()=>switchView('Budget'));document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{state.period=b.dataset.period;renderHome();}));
 $('historySearch').addEventListener('input',renderHistory);$('historyType').addEventListener('change',renderHistory);
 $('transactionForm').addEventListener('submit',saveTx);
  ['txAmount','txCategory','txDate'].forEach(id=>$(id).addEventListener('input',updateTransactionBudgetHint));
  document.querySelectorAll('input[name="txType"]').forEach(input=>input.addEventListener('change',updateTransactionBudgetHint));
  $('newBudget').addEventListener('click',()=>openBudget());$('budgetForm').addEventListener('submit',saveBudget);
  $('budgetPeriodType').addEventListener('change',e=>{state.budgetPeriod=e.target.value;renderBudget();});
  $('budgetReferenceDate').addEventListener('change',e=>{if(e.target.value){state.budgetDate=e.target.value;renderBudget();}});
  $('budgetPrev').addEventListener('click',()=>changeBudgetReference(-1));
  $('budgetToday').addEventListener('click',()=>{state.budgetDate=localToday();renderBudget();});
  $('budgetNext').addEventListener('click',()=>changeBudgetReference(1));
  $('budgetFormPeriodType').addEventListener('change',updateBudgetFormPeriod);
  $('budgetFormDate').addEventListener('change',updateBudgetFormPeriod);
 $('reportPeriodType').addEventListener('change',e=>{state.reportPeriod=e.target.value;renderReport();});
 $('reportMonthInput').addEventListener('change',e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){state.reportDate=e.target.value+'-01';renderReport();}});
 $('reportYearInput').addEventListener('change',e=>{const year=Number(e.target.value);if(Number.isInteger(year)&&year>=2000&&year<=2100){state.reportDate=`${year}-01-01`;renderReport();}});
 $('reportPrev').addEventListener('click',()=>changeReportDate(-1));
 $('reportNext').addEventListener('click',()=>changeReportDate(1));
 $('reportThis').addEventListener('click',()=>{state.reportDate=localToday();renderReport();});
 $('reportCsvBtn').addEventListener('click',downloadReportCsv);
 $('reportPrintBtn').addEventListener('click',printReport);
 $('newGoal').addEventListener('click',()=>openGoal());$('goalForm').addEventListener('submit',saveGoal);
 document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
 $('confirmDelete').addEventListener('click',doDelete);$('cancelDelete').addEventListener('click',()=>{$('confirmDialog').close();state.deleteTask=null;});
 $('logoutBtn').addEventListener('click',logoutCloud);
 $('pendingLogoutBtn').addEventListener('click',logoutCloud);
 $('checkStatusBtn').addEventListener('click',refreshCurrentAccess);
 $('adminReloadBtn').addEventListener('click',loadAdminUsers);
 $('adminSearch').addEventListener('input',renderAdmin);
 $('approvalForm').addEventListener('submit',submitReview);
 ['adminPendingList','adminOthersList'].forEach(x=>$(x).addEventListener('click',e=>{const btn=e.target.closest('[data-review-id]');if(btn)openReview(btn.dataset.reviewId,btn.dataset.reviewStatus);}));
 $('profileNameForm').addEventListener('submit',saveProfileName);
 $('uploadProfileBtn').addEventListener('click',()=>$('profilePhotoInput').click());
 $('profilePhotoInput').addEventListener('change',uploadProfilePhoto);
 $('removeProfilePhotoBtn').addEventListener('click',removeProfilePhoto);
 $('exportBtn').addEventListener('click',exportCsv);
 $('historyList').addEventListener('click',e=>{const edit=e.target.closest('[data-edit-tx]'),del=e.target.closest('[data-delete-tx]');if(edit){const t=state.tx.find(t=>t.id===edit.dataset.editTx);if(t)openTx(t);}if(del)confirmAction('Transaksi ini akan dihapus permanen dari akunmu.',{kind:'tx',id:del.dataset.deleteTx});});
  $('budgetList').addEventListener('click',e=>{
    const weekButton=e.target.closest('[data-open-budget-week]');
    if(weekButton){
      const chosenWeek=weekButton.dataset.openBudgetWeek;
      if(/^\d{4}-\d{2}-\d{2}$/.test(chosenWeek)){
        state.budgetPeriod='weekly';state.budgetDate=chosenWeek;renderBudget();
        $('budgetMonth').scrollIntoView({behavior:'smooth',block:'start'});
      }
      return;
    }
    const edit=e.target.closest('[data-edit-budget]'),del=e.target.closest('[data-delete-budget]');
    if(edit){const type=edit.dataset.budgetType;
      const b=(type==='weekly'?state.weeklyBudgets:state.budgets).find(b=>b.id===edit.dataset.editBudget);
      if(b)openBudget({...b,periodType:type});
    }
    if(del){const isWeekly=del.dataset.budgetType==='weekly';
      confirmAction('Anggaran ini akan dihapus.',{kind:isWeekly?'weeklyBudget':'budget',id:del.dataset.deleteBudget});
    }
  });
 $('goalsList').addEventListener('click',e=>{const edit=e.target.closest('[data-edit-goal]'),del=e.target.closest('[data-delete-goal]');if(edit){const g=state.goals.find(g=>g.id===edit.dataset.editGoal);if(g)openGoal(g);}if(del)confirmAction('Target tabungan ini akan dihapus.',{kind:'goal',id:del.dataset.deleteGoal});});
}
async function start(){
  if(!validConfig){showOnly('setupScreen');return;}
  try{
    sb=createClient(config.SUPABASE_URL.replace(/\/$/,''),config.SUPABASE_PUBLISHABLE_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    bindEvents();showAuth(recoveryFlow?'recovery':'login');
    // Tangani Turnstile yang selesai dimuat sebelum atau sesudah modul aplikasi.
    if(window.turnstile)renderCaptcha();
    // Reaksi cepat atas PASSWORD_RECOVERY agar getSession() tidak memicu dashboard.
    // Callback Auth ditunda agar tidak membuat deadlock pada Supabase client.
    sb.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY')recoveryFlow=true;
      setTimeout(async()=>{
        if(recoveryFlow){
          if(event==='SIGNED_OUT'){recoveryFlow=false;clearRecoveryUrl();await syncUser(null);return;}
          state.user=session?.user||state.user;
          if(state.authMode!=='recovery'||$('authScreen').hidden)showAuth('recovery');
          return;
        }
        await syncUser(session?.user||null);
      },0);
    });
    const {data,error}=await sb.auth.getSession();if(error)throw error;
    if(recoveryFlow){
      if(data.session?.user){state.user=data.session.user;showAuth('recovery');}
      else{
        // Jika tautan sudah kedaluwarsa/invalid, minta tautan baru.
        recoveryFlow=false;clearRecoveryUrl();showAuth('login');
        toast('Tautan pemulihan tidak berlaku. Silakan minta tautan baru.','error');
      }
    }else if(data.session?.user)await syncUser(data.session.user);
    if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'))
      navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('PWA offline cache:',err));
    const query=new URLSearchParams(location.hash.replace(/^#/,''));
    if(query.get('error_description'))toast(query.get('error_description').replaceAll('+',' '),'error');
    window.addEventListener('focus',()=>{if(state.user&&state.authMode!=='recovery')refreshCurrentAccess();});
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden&&state.user&&state.authMode!=='recovery')refreshCurrentAccess();
    });
    setInterval(()=>{if(state.user&&state.authMode!=='recovery'&&!document.hidden)refreshCurrentAccess();},60000);
  }catch(error){reportError(error);showAuth('login');}
}
start();
