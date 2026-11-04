'use strict';
const $ = id => document.getElementById(id);
const app = {
  tours: [], tourId:(()=>{try{return localStorage.getItem('egypt-active-tour-v1')||'karnak'}catch(_){return 'karnak'}})(), stopId:null, view:'cards',
  visited:new Set((()=>{try{return JSON.parse(localStorage.getItem('egypt-visited-v1')||'[]')}catch(_){return []}})()),
  photoCache:'egypt-photo-cache-v1',
  extensionsUnlocked:new Set((()=>{try{return JSON.parse(localStorage.getItem('egypt-extension-unlocked-v1')||'[]')}catch(_){return []}})()),
  extensionsDeclined:new Set()
};
const audio = new Audio();
audio.preload='metadata';
audio.playsInline=true;
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
const speech = {pieces:[], index:0, active:false, paused:false, token:0, rate:1, estimated:0};
let mode='mp3';
const icons={play:'<path d="m8 5 12 7-12 7V5z"/>',pause:'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'};
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmt(s){if(!Number.isFinite(s))return '0:00';s=Math.floor(s);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
function toast(message){const e=$('toast');e.textContent=message;e.classList.add('show');clearTimeout(e._timeout);e._timeout=setTimeout(()=>e.classList.remove('show'),4200);}
function tour(){return app.tours.find(t=>t.id===app.tourId)||app.tours[0];}
function extension(t){return t?.extension?.stops?.length?t.extension:null;}
function unlocked(t){return !!extension(t)&&app.extensionsUnlocked.has(t.id);}
function visibleStops(t){return unlocked(t)?t.stops.concat(t.extension.stops):t.stops;}
function isMainLast(t,id){return !!extension(t)&&t.stops[t.stops.length-1]?.id===id;}
function isExtendedStop(t,id){return !!extension(t)&&t.extension.stops.some(s=>s.id===id);}
function stop(){const t=tour();return t&&visibleStops(t).find(s=>s.id===app.stopId);}
function extensionMinutes(e){return Math.max(1,Math.ceil(e.stops.reduce((sum,s)=>sum+(s.seconds||0),0)/60));}
function saveExtensionState(){try{localStorage.setItem('egypt-extension-unlocked-v1',JSON.stringify([...app.extensionsUnlocked]));}catch(_){}}

function uid(t,s){return t.id+'/'+s.id;}
function setLocked(){document.body.classList.toggle('locked',!$('modal-overlay').hidden||$('drawer').classList.contains('open'));}
function openDrawer(){$('drawer').classList.add('open');$('drawer').setAttribute('aria-hidden','false');$('drawer-scrim').hidden=false;$('open-menu').setAttribute('aria-expanded','true');setLocked();$('close-menu').focus();}
function closeDrawer(){$('drawer').classList.remove('open');$('drawer').setAttribute('aria-hidden','true');$('drawer-scrim').hidden=true;$('open-menu').setAttribute('aria-expanded','false');setLocked();}
function renderDrawer(){
 const group=city=>app.tours.filter(t=>t.city===city).map(t=>`<button type="button" class="tour-menu-item ${t.id===app.tourId?'active':''}" data-tour="${esc(t.id)}"><span><strong>${esc(t.title)}</strong><small>${t.stops.length} точек${extension(t)?` · +${extension(t).stops.length} после основной части`:''} · ${esc(t.day)}</small></span><span class="menu-arrow">›</span></button>`).join('');
 $('drawer-tours').innerHTML=`<div class="drawer-group-label">ЛУКСОР</div>${group('Луксор')}<div class="drawer-group-label">КАИР / ГИЗА</div>${group('Каир')}<div class="drawer-group-label">АЛЕКСАНДРИЯ</div>${group('Александрия')}`;
 $('drawer-tours').querySelectorAll('[data-tour]').forEach(b=>b.addEventListener('click',()=>{selectTour(b.dataset.tour);closeDrawer();}));
}
function setView(next){
 app.view=next==='map'&&tour().map?'map':'cards';
 $('view-cards').classList.toggle('selected',app.view==='cards');$('view-map').classList.toggle('selected',app.view==='map');
 $('view-cards').setAttribute('aria-pressed',String(app.view==='cards'));
 $('view-map').setAttribute('aria-pressed',String(app.view==='map'));
 $('tile-grid').hidden=app.view==='map';$('map-wrap').hidden=app.view!=='map';
 if(app.view==='map'&&window.EgyptAtlasMap)window.EgyptAtlasMap.activate({...tour(),stops:visibleStops(tour())},openStop);
}
function renderMap(t){
 const map=t.map, stops=visibleStops(t);
 $('view-toggle').hidden=!map;
 if(!map){setView('cards');return;}
 $('map-image').src=map.image;
 if(window.EgyptAtlasMap)window.EgyptAtlasMap.setTour({...t,stops},openStop);
 $('map-image').alt=(map.planKind==='ordered_route'?'Условная схема порядка рассказов: ':'Ориентировочная архитектурная схема ')+t.title;
 $('map-caption').textContent=map.note+(unlocked(t)?' Дополнительные точки доступны в списке ниже; на схеме порядок условный. Для географических ориентиров используйте интерактивную карту.':'');
 $('map-source').href=map.source;
 $('map-scroll').setAttribute('aria-label',(map.planKind==='ordered_route'?'Условная схема рассказов: ':'Архитектурный ориентир: ')+t.title);
 $('map-pins').innerHTML=stops.map((s,i)=>{
   const p=map.points?.[s.id];if(!p)return '';
   return `<button type="button" class="map-pin" data-stop="${esc(s.id)}" style="left:${p.x}%;top:${p.y}%" title="${esc(s.title)}" aria-label="Точка ${i+1}. ${esc(s.title)}">${i+1}</button>`;
 }).join('');
 $('map-pins').querySelectorAll('[data-stop]').forEach(b=>b.addEventListener('click',()=>openStop(b.dataset.stop)));
 $('map-legend').innerHTML=stops.map((s,i)=>`<button type="button" class="map-legend-button ${isExtendedStop(t,s.id)?'extra-map-legend':''}" data-stop="${esc(s.id)}"><b>${i+1}</b> ${esc(s.title)} <span class='marker-confidence'>${isExtendedStop(t,s.id)?'· продолжение ':''}${!map.geoPoints?.[s.id]?'· нет GPS':(['shared_site','approx_plan','interpretive_zone','legacy_approx','area','photo_viewpoint'].includes(map.geoPoints[s.id].precision)?'· примерная зона':'· на карте')}</span></button>`).join('');
 $('map-legend').querySelectorAll('[data-stop]').forEach(b=>b.addEventListener('click',()=>openStop(b.dataset.stop)));
 $('map-image').style.aspectRatio='920 / 540';
 $('map-source').textContent=map.planKind==='ordered_route'?'Источник об объекте ↗':'Основа схемы ↗';
 const missing=stops.filter(s=>!map.geoPoints?.[s.id]);
 const box=$('map-unlocated');
 if(box){box.hidden=!missing.length;box.innerHTML=missing.length?`<strong>Без геопривязки: ${missing.length} из ${stops.length}</strong><p>Для этих остановок нет индивидуального картографического ориентира: используйте план объекта. Остальные метки бывают приблизительными — нажмите на них для подробностей.</p><div>${missing.map(s=>`<button type="button" class="map-legend-button" data-unlocated="${esc(s.id)}">${esc(s.id)} · ${esc(s.title)}</button>`).join('')}</div>`:'';box.querySelectorAll('[data-unlocated]').forEach(b=>b.addEventListener('click',()=>openStop(b.dataset.unlocated)));}
 setView(app.view);
}
function renderTour(){
 const t=tour();if(!t)return;
 const ext=extension(t), expanded=unlocked(t), all=visibleStops(t);
 $('city-label').textContent=t.city.toUpperCase();$('day-label').textContent=t.day.toUpperCase();$('tour-title').textContent=t.title;
 const seconds=t.stops.reduce((acc,s)=>acc+(s.seconds||0),0);
 $('total-time').textContent=`≈ ${Math.max(1,Math.ceil(seconds/60))} мин рассказов`;
 const baseDone=t.stops.filter(s=>app.visited.has(uid(t,s))).length;
 const extDone=expanded?ext.stops.filter(s=>app.visited.has(uid(t,s))).length:0;
 $('progress-label').textContent=`${baseDone} из ${t.stops.length} основных${expanded?` · ${extDone}/${ext.stops.length} доп.`:''}`;
 const tile=(s,i)=>`<button class="tile ${isExtendedStop(t,s.id)?'tile-extension':''}" data-stop="${esc(s.id)}" aria-label="${isExtendedStop(t,s.id)?'Дополнительная ':''}Точка ${i+1}: ${esc(s.title)}"><img src="${esc(s.photo)}" loading="${i<4?'eager':'lazy'}" alt="${esc(s.title)}"><span class="tile-index">${String(i+1).padStart(2,'0')}</span>${app.visited.has(uid(t,s))?'<span class="tile-complete" aria-label="Прослушано">✓</span>':''}<span class="tile-content"><strong>${esc(s.title)}</strong><span>${isExtendedStop(t,s.id)?'✦ Продолжение · ':''}${s.cartoucheIntegrated?'◈ Картуши · ':''}${(window.EgyptAtlasAudioReady?.ids||[]).includes(s.id)?'♫ MP3':'◉ Текст / голос устройства'} · ≈ ${fmt(s.seconds)}</span></span></button>`;
 $('tile-grid').innerHTML=t.stops.map(tile).join('')+(expanded?`<div class="extension-divider"><span>✦ Продолжение без возвращения назад</span><small>${esc(ext.label)}</small></div>`+ext.stops.map((s,i)=>tile(s,t.stops.length+i)).join(''):'');
 $('tile-grid').querySelectorAll('[data-stop]').forEach(b=>b.addEventListener('click',()=>openStop(b.dataset.stop)));
 $('tile-grid').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.onerror=null;img.src='./photos/visual-fallback.svg';},{once:true}));
 const hint=$('extension-mini');hint.hidden=!ext;
 if(ext){hint.innerHTML=`<span>✦ ДОПОЛНИТЕЛЬНАЯ ЧАСТЬ</span><p>${expanded?'Продолжение добавлено к маршруту —':'После основных остановок можно продолжить —'} ещё ${ext.stops.length} точки, ≈ ${extensionMinutes(ext)} мин аудио и прогулка. Никаких отдельных маршрутов.</p>`;}
 const offer=$('extension-main-offer');offer.hidden=!ext||expanded||!app.visited.has(uid(t,t.stops[t.stops.length-1]));
 if(ext&&!expanded){const ready=baseDone===t.stops.length;offer.innerHTML=`<span class="extension-kicker">${ready?'✓ ОСНОВНАЯ ЭКСКУРСИЯ ЗАВЕРШЕНА':'✦ ЕСЛИ ЗАХОЧЕТСЯ БОЛЬШЕ'}</span><h2>${ready?'У вас есть время продолжить?':'Продолжение после последней остановки'}</h2><p>${esc(ext.hint)}</p><p class="extension-meta">+${ext.stops.length} остановки · ≈ ${extensionMinutes(ext)} мин аудио · дополнительно ≈ ${ext.walkMinutes} мин на прогулку</p><p class="extension-warning">${esc(ext.warning)}</p><button type="button" class="extension-primary" id="unlock-extension-main">${ready?'Продолжить эту экскурсию':'Посмотреть продолжение'} →</button>`; offer.querySelector('#unlock-extension-main').addEventListener('click',()=>unlockExtension(t.id));}
 renderMap(t);renderDrawer();
}
function selectTour(id){if(app.tourId===id)return;closeStop();app.tourId=id;try{localStorage.setItem('egypt-active-tour-v1',id)}catch(_){}app.view='cards';renderTour();window.EgyptAtlasNearby?.refresh();window.scrollTo({top:0,behavior:'instant'});}
function addSources(s){
 $('sheet-sources').innerHTML=(s.sources||[]).map((url,i)=>`<a href="${esc(url)}" rel="noopener noreferrer" target="_blank">↗ ${esc(new URL(url,location.href).hostname.replace(/^www\./,''))} · источник ${i+1}</a>`).join('');
 $('photo-credit').innerHTML=s.photoSource?`${esc(s.photoAccuracy||'Фото')} · Фото: <a href="${esc(s.photoSource)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons · оригинал и условия использования</a>${s.photoAttribution?' · '+esc(s.photoAttribution):''}${s.photoLicense?' · '+esc(s.photoLicense):''}${s.photoReview==='candidate'?' · фото-кандидат, требуется редакторская проверка':''}`:'';
 $('factchecks').hidden=!(s.factChecks||[]).length;
 $('factchecks-list').innerHTML=(s.factChecks||[]).map(([fact,url])=>`<li>${esc(fact)} <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">проверить ↗</a></li>`).join('');
 $('review-status').textContent=s.reviewStatus||'Материал в редактуре';
}
function showPlay(playing){$('play-icon').innerHTML=playing?icons.pause:icons.play;$('play-pause').setAttribute('aria-label',playing?'Пауза':'Воспроизвести');}
function splitSentences(s){return (s.replace(/\n+/g,' ').match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)||[s]).map(x=>x.trim()).filter(Boolean);}
function cancelSpeech(){speech.token++;speech.active=false;speech.paused=false;if(synth){try{synth.cancel()}catch(_){}}}
function updateSpeechProgress(){
 const length=speech.pieces.length||1;
 $('seek').value=String(Math.round(1000*speech.index/length));
 $('current-time').textContent=`${Math.min(speech.index+1,length)}/${length}`;
 $('duration-time').textContent=`≈ ${fmt(speech.estimated)}`;
}
function chooseVoice(){if(!synth)return null;const all=synth.getVoices()||[];return all.find(v=>v.lang?.toLowerCase().startsWith('ru')&&v.localService)||all.find(v=>v.lang?.toLowerCase().startsWith('ru'))||null;}
function sayPart(token){
 if(token!==speech.token||!speech.active||!stop())return;
 if(speech.index>=speech.pieces.length){speech.active=false;showPlay(false);storyFinished();return;}
 const utterance=new SpeechSynthesisUtterance(speech.pieces[speech.index]);
 utterance.lang='ru-RU';utterance.rate=speech.rate;
 const voice=chooseVoice();if(voice)utterance.voice=voice;
 utterance.onend=()=>{if(token!==speech.token)return;speech.index++;updateSpeechProgress();sayPart(token);};
 utterance.onerror=e=>{if(token!==speech.token||e.error==='canceled'||e.error==='interrupted')return;speech.active=false;showPlay(false);toast('Голос устройства недоступен. Проверьте установку русского голоса в настройках телефона.');};
 try{synth.speak(utterance)}catch(_){toast('Не удалось запустить голос устройства.');speech.active=false;showPlay(false);}
}
function startSpeech(at=speech.index){
 if(!synth){toast('В этом браузере нет встроенного синтеза речи.');return;}
 cancelSpeech();speech.index=Math.max(0,Math.min(speech.pieces.length-1,at));
 speech.active=true;const token=speech.token;updateSpeechProgress();showPlay(true);
 sayPart(token);
}
function togglePlay(){
 if(mode==='mp3'){
   if(audio.paused)audio.play().catch(()=>toast('Не удалось воспроизвести MP3. Проверьте наличие файла.'));
   else audio.pause();return;
 }
 if(!speech.active){startSpeech();return;}
 if(speech.paused){synth.resume();speech.paused=false;showPlay(true);}
 else {synth.pause();speech.paused=true;showPlay(false);}
}
function seekTo(value){
 if(mode==='mp3'){
  if(Number.isFinite(audio.duration)&&audio.duration>0)audio.currentTime=Number(value)/1000*audio.duration;return;
 }
 const at=Math.max(0,Math.min(speech.pieces.length-1,Math.floor(Number(value)/1000*speech.pieces.length)));
 const wasPlaying=speech.active&&!speech.paused;
 cancelSpeech();speech.index=at;updateSpeechProgress();showPlay(false);
 if(wasPlaying)startSpeech(at);
}
function seekBy(diff){
 if(mode==='mp3'){if(Number.isFinite(audio.duration))audio.currentTime=Math.max(0,Math.min(audio.duration,audio.currentTime+diff));return;}
 // No exact time-axis in SpeechSynthesis: arrow buttons skip one full sentence.
 seekTo((speech.index+(diff<0?-1:1))*1000/Math.max(1,speech.pieces.length));
}
function openStop(id){
 const t=tour(),list=visibleStops(t),s=list.find(x=>x.id===id);if(!s)return;
 cancelSpeech();audio.pause();audio.removeAttribute('src');audio.load();app.stopId=id;
 const i=list.findIndex(x=>x.id===id);
 $('sheet-photo-wrap').classList.remove('expanded');$('expand-photo').setAttribute('aria-pressed','false');$('expand-photo').textContent='⛶ Увеличить фото';$('sheet-photo').setAttribute('aria-label','Увеличить фотографию');$('sheet-photo').onerror=()=>{if(!$('sheet-photo').src.includes('/photos/')){$('sheet-photo').src='./photos/visual-fallback.svg';}};$('sheet-photo').src=s.photo;$('sheet-photo').alt=s.title;
 $('sheet-number').textContent=`${String(i+1).padStart(2,'0')} / ${String(list.length).padStart(2,'0')}`;
 $('sheet-location').textContent=s.position;$('sheet-title').textContent=s.title;$('sheet-summary').textContent=s.summary;
 $('sheet-script').textContent=s.script;
 if(window.EgyptAtlasCartouchesInlineUI)window.EgyptAtlasCartouchesInlineUI.setStop(s);
 $('sheet-photo-wrap').classList.toggle('is-placeholder',!!s.photoPlaceholder);$('next-story').hidden=i===list.length-1;
 $('sheet-extension-offer').hidden=true;
 $('sheet-extension-finish').hidden=true;
 if(isExtendedStop(t,id))$('sheet-extension-finish').hidden=i!==list.length-1;
 if(isMainLast(t,id)&&app.visited.has(uid(t,s))&&!unlocked(t)&&!app.extensionsDeclined.has(t.id))showSheetExtensionOffer(false);
 $('sheet-scroller').scrollTop=0;$('modal-overlay').hidden=false;setLocked();
 mode=(window.EgyptAtlasAudioReady?.ids||[]).includes(s.id)?'mp3':'speech';speech.rate=1;speech.pieces=splitSentences(s.script);speech.index=0;speech.estimated=s.seconds||100;
 $('player-length').textContent=mode==='mp3'?`≈ ${fmt(s.seconds)} · MP3`:`≈ ${fmt(s.seconds)} · голос устройства`;
 $('voice-notice').hidden=mode==='mp3';
 $('seek').setAttribute('aria-label',mode==='mp3'?'Перемотать аудиофайл':'Перейти к предложению в рассказе');
 $('rewind').textContent=mode==='mp3'?'↶ 10 сек':'← Фраза';
 $('forward').textContent=mode==='mp3'?'10 сек ↷':'Фраза →';
 $('seek').value='0';$('current-time').textContent='0:00';$('duration-time').textContent=fmt(s.seconds);
 if(mode==='mp3') {audio.src=new URL(s.audio,location.href).href;audio.load();}
 else updateSpeechProgress();
 audio.playbackRate=1;$('speed').textContent='1× скорость';showPlay(false);addSources(s);
 if(mode==='mp3'&&'mediaSession' in navigator){
  try{
   navigator.mediaSession.metadata=new MediaMetadata({title:s.title,artist:'Egypt Atlas',album:t.title,artwork:[{src:s.photo,sizes:'512x512'}]});
   navigator.mediaSession.setActionHandler('play',()=>audio.play().catch(()=>{}));
   navigator.mediaSession.setActionHandler('pause',()=>audio.pause());
   navigator.mediaSession.setActionHandler('seekbackward',d=>seekBy(-(d.seekOffset||10)));
   navigator.mediaSession.setActionHandler('seekforward',d=>seekBy(d.seekOffset||10));
  }catch(_){/* optional */}
 }
 $('close-sheet').focus();
}
function closeStop(){if($('modal-overlay').hidden)return;cancelSpeech();audio.pause();$('modal-overlay').hidden=true;app.stopId=null;setLocked();}
function markVisited(){const s=stop();if(!s)return;app.visited.add(uid(tour(),s));try{localStorage.setItem('egypt-visited-v1',JSON.stringify([...app.visited]));}catch(_){}renderTour();}
function nextStory(){if(!app.stopId)return;const t=tour(),list=visibleStops(t);const i=list.findIndex(x=>x.id===app.stopId);if(i<list.length-1)openStop(list[i+1].id);}
function showSheetExtensionOffer(autoScroll){
 const t=tour(),ext=extension(t),el=$('sheet-extension-offer');
 if(!ext||unlocked(t)||!isMainLast(t,app.stopId)||app.extensionsDeclined.has(t.id)){el.hidden=true;return;}
 el.hidden=false;
 el.innerHTML=`<div class="extension-complete">✓ Основная экскурсия завершена</div><h3>Есть время увидеть больше?</h3><p>${esc(ext.hint)}</p><p class="extension-meta">${ext.stops.length} дополнительные остановки · ≈ ${extensionMinutes(ext)} мин аудио · ≈ ${ext.walkMinutes} мин прогулки</p><p class="extension-warning">${esc(ext.warning)}</p><div class="extension-actions"><button type="button" class="extension-primary" data-accept>Продолжить экскурсию →</button><button type="button" class="extension-secondary" data-decline>Закончить здесь</button></div>`;
 el.querySelector('[data-accept]').addEventListener('click',()=>unlockExtension(t.id));
 el.querySelector('[data-decline]').addEventListener('click',()=>{app.extensionsDeclined.add(t.id);el.hidden=true;closeStop();toast('Основная экскурсия завершена. Продолжение можно открыть из списка точек.');});
 if(autoScroll)requestAnimationFrame(()=>el.scrollIntoView({behavior:'smooth',block:'nearest'}));
}
function unlockExtension(tourId){
 const t=tour();if(!t||t.id!==tourId||!extension(t))return;
 app.extensionsUnlocked.add(t.id);app.extensionsDeclined.delete(t.id);saveExtensionState();
 renderTour();openStop(t.extension.stops[0].id);
 toast('Продолжение добавлено в тот же маршрут. Запускайте аудио, когда подойдёте к точке.');
}
function storyFinished(){
 const t=tour(),s=stop();if(!t||!s)return;
 markVisited();toast('Рассказ прослушан ✓');
 if(isMainLast(t,s.id)&&!unlocked(t)){showSheetExtensionOffer(true);return;}
 if(unlocked(t)&&t.extension.stops.at(-1)?.id===s.id){$('sheet-extension-finish').hidden=false;}
}

function setupPlayer(){
 $('play-pause').addEventListener('click',togglePlay);
 audio.addEventListener('play',()=>{if(mode==='mp3')showPlay(true)});
 audio.addEventListener('pause',()=>{if(mode==='mp3')showPlay(false)});
 audio.addEventListener('loadedmetadata',()=>{if(mode==='mp3')$('duration-time').textContent=fmt(audio.duration)});
 audio.addEventListener('timeupdate',()=>{if(mode!=='mp3')return;$('current-time').textContent=fmt(audio.currentTime);if(Number.isFinite(audio.duration)&&audio.duration>0)$('seek').value=String(Math.round(1000*audio.currentTime/audio.duration));});
 audio.addEventListener('ended',()=>{if(mode!=='mp3')return;showPlay(false);storyFinished();});
 audio.addEventListener('error',()=>{if(mode==='mp3'&&stop()){mode='speech';$('voice-notice').hidden=false;showPlay(false);toast('MP3 недоступен: используйте голос устройства.');}});
 $('seek').addEventListener('input',e=>seekTo(e.target.value));
 $('rewind').addEventListener('click',()=>seekBy(-10));$('forward').addEventListener('click',()=>seekBy(10));
 const speeds=[1,1.15,1.3,.85];
 $('speed').addEventListener('click',()=>{
  const current=mode==='mp3'?audio.playbackRate:speech.rate;const idx=speeds.findIndex(x=>Math.abs(x-current)<.01);const rate=speeds[(idx+1)%speeds.length];
  if(mode==='mp3')audio.playbackRate=rate;
  else {const wasPlaying=speech.active&&!speech.paused;const position=speech.index;cancelSpeech();speech.rate=rate;if(wasPlaying)startSpeech(position);}
  $('speed').textContent=`${rate}× скорость`;
 });
 $('next-story').addEventListener('click',nextStory);
}
async function registerServiceWorker(){if(location.protocol==='file:'||!('serviceWorker'in navigator))return false;try{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;return true}catch(e){console.warn(e);return false;}}
// Downloadable media are declared in the generated manifest, not guessed from URLs.
const OFFLINE_MEDIA_CACHE='egypt-atlas-media-v1';
let offlineManifest=null;
async function getOfflineManifest(){
 if(offlineManifest)return offlineManifest;
 const response=await fetch('./offline-manifest.json',{cache:'no-store'});
 if(!response.ok)throw new Error('Не найден offline-manifest.json. Пересоберите сайт.');
 const data=await response.json();
 if(data.version!==1||!Array.isArray(data.files))throw new Error('Неверный формат офлайн-манифеста');
 offlineManifest=data;
 return data;
}
function offlineState(message,state='info'){
 const el=$('offline-status-banner');if(!el)return;
 el.dataset.state=state;
 el.textContent=message;
}
async function inspectOfflinePackage(){
 if(!('caches'in window)||!navigator.serviceWorker?.controller)return;
 try{
  const manifest=await getOfflineManifest();
  const cache=await caches.open(OFFLINE_MEDIA_CACHE);
  let ready=0;
  for(const file of manifest.files){
   const response=await cache.match(new URL(file.path,location.href).href);
   if(response&&response.headers.get('X-Atlas-Sha256')===file.sha256&&(await response.blob()).size===file.bytes)ready++;
  }
  const total=manifest.files.length;
  const missing=(manifest.missingAudio||[]).length+(manifest.missingPhotos||[]).length+(manifest.missingCartouches||[]).length+(manifest.missingMaps||[]).length;
  if(!total){offlineState('Медиафайлы ещё не опубликованы. Сначала загрузите архив в GitHub Releases.','error');return;}
  if(ready===total&&missing===0){offlineState('Аудио, фотографии и интерактивные карты готовы офлайн ✓','ready');}
  else offlineState(`Офлайн-медиа: ${ready}/${total} скачано. Не опубликовано: ${missing}.`,'error');
 }catch(e){offlineState('Пока не удалось проверить офлайн-пакет: '+e.message,'error');}
}
async function offlineDownload(){
 if(location.protocol==='file:'){toast('Для офлайн-установки откройте сайт по HTTPS.');return;}
 if(!('caches'in window)){toast('Не поддерживается Cache Storage.');return;}
 const btn=$('offline-btn');btn.disabled=true;
 try{
  await navigator.serviceWorker.ready;
  const manifest=await getOfflineManifest();
  const cache=await caches.open(OFFLINE_MEDIA_CACHE);
  const files=manifest.files;
  if(!files.length){offlineState('Сначала опубликуйте полный медиапакет на сайте.','error');return;}
  let ok=0,fail=[];
  for(const [index,item] of files.entries()){
   const url=new URL(item.path,location.href).href;
   const cached=await cache.match(url);
   if(cached&&cached.headers.get('X-Atlas-Sha256')===item.sha256&&(await cached.blob()).size===item.bytes){ok++;continue;}
   offlineState(`Скачивание: ${index+1}/${files.length} · ${item.path}`);
   try{
    const response=await fetch(url,{cache:'no-store',headers:{'X-Atlas-Download':'1'}});
    if(!response.ok||response.status!==200)throw new Error('HTTP '+response.status);
    const payload=await response.clone().arrayBuffer();
    if(payload.byteLength!==item.bytes)throw new Error('Размер не совпадает с манифестом');
    if(window.crypto?.subtle&&item.sha256){
     const digest=await crypto.subtle.digest('SHA-256',payload);
     const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
     if(hash!==item.sha256)throw new Error('Контрольная сумма не совпадает');
    }
    const headers=new Headers(response.headers);headers.set('X-Atlas-Sha256',item.sha256);
    await cache.put(url,new Response(payload,{status:200,headers}));ok++;
   }catch(e){console.warn('Offline media',item.path,e);fail.push(item.path);}
  }
  const missing=(manifest.missingAudio||[]).length+(manifest.missingPhotos||[]).length+(manifest.missingCartouches||[]).length+(manifest.missingMaps||[]).length;
  if(ok===files.length&&missing===0){offlineState('Аудио, фотографии и интерактивные карты готовы офлайн ✓','ready');toast('Офлайн-медиа скачаны. Проверяйте в авиарежиме.');}
  else{offlineState(`Доступно ${ok}/${files.length}. Ошибок загрузки: ${fail.length}, ещё не опубликовано: ${missing}.`,'error');toast('Не всё готово. Повторная загрузка докачает недостающее.');}
 }catch(e){offlineState('Не удалось скачать: '+e.message,'error');toast('Проверьте подключение к интернету.');}
 finally{btn.disabled=false;}
}
async function init(){
 try{
  if(!Array.isArray(window.EgyptAtlasCatalog))throw new Error('catalog.js not loaded');app.tours=window.EgyptAtlasCatalog;

  setupPlayer();renderTour();
  if(window.EgyptAtlasMap)window.EgyptAtlasMap.setup();
  if(window.EgyptAtlasNearby)window.EgyptAtlasNearby.setup({getTours:()=>app.tours,getActiveId:()=>app.tourId,openTour:selectTour});
  $('view-cards').addEventListener('click',()=>setView('cards'));$('view-map').addEventListener('click',()=>setView('map'));
  $('open-menu').addEventListener('click',openDrawer);$('close-menu').addEventListener('click',closeDrawer);$('drawer-scrim').addEventListener('click',closeDrawer);
  $('close-sheet').addEventListener('click',closeStop);
  function togglePhoto(){const wrap=$('sheet-photo-wrap');const expanded=wrap.classList.toggle('expanded');$('expand-photo').setAttribute('aria-pressed',String(expanded));$('expand-photo').textContent=expanded?'↙ Уменьшить фото':'⛶ Увеличить фото';$('sheet-photo').setAttribute('aria-label',expanded?'Уменьшить фотографию':'Увеличить фотографию');}
  $('expand-photo').addEventListener('click',togglePhoto);
  $('sheet-photo').addEventListener('click',togglePhoto);
  $('sheet-photo').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();togglePhoto();}});

  $('modal-overlay').addEventListener('click',e=>{if(e.target===$('modal-overlay'))closeStop()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeStop();closeDrawer();}});
  $('offline-btn').addEventListener('click',offlineDownload);
  const ok=await registerServiceWorker();if(ok){
   if(navigator.serviceWorker.controller)await inspectOfflinePackage();
   else navigator.serviceWorker.addEventListener('controllerchange',()=>inspectOfflinePackage(),{once:true});
  }else console.log('PWA требует HTTPS/localhost; локальное открытие работает для основного интерфейса');
 }catch(e){console.error(e);$('tile-grid').innerHTML='<p>Не удалось открыть каталог. Проверьте целостность распакованной папки.</p>';}
}
init();
