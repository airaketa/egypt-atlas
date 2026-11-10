/* Atlas v2: data-driven country/city/attraction navigation and city packages. */
(() => {
'use strict';

const $ = id => document.getElementById(id);
const ROOT = new URL('./', location.href);
const CATALOG_URL = './content-data/catalog.json';
const OFFLINE_URL = './content-data/offline-packages.json';
const BUILD_INFO_URL = './content-data/build-info.json';
const INSTALLED_KEY = 'atlas-installed-cities-v2';
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const DEFAULT_THEME = {
  ink:'#17231d',muted:'#69746e',paper:'#f5f2e9',surface:'#fffdf8',line:'#ded9cc',
  primary:'#254f3d',primary_alt:'#39755a',soft:'#dce9df',accent:'#c6923d',sand:'#eadcc3',
};
const THEME_PROPERTIES = {
  ink:'--ink',muted:'--muted',paper:'--paper',surface:'--surface',line:'--line',
  primary:'--green',primary_alt:'--green-2',soft:'--mint',accent:'--gold',sand:'--sand',
};
const state = {
  catalog: null,
  offline: null,
  buildInfo: null,
  packages: new Map(),
  renderToken: 0,
  programModes: new Map(),
  toastTimer: null,
  downloading: false,
  playback: null,
  speedIndex: 1,
};

function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}
function safeThemeColor(value,fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value||''))?value:fallback;
}
function applyTheme(theme={}) {
  for(const [name,property] of Object.entries(THEME_PROPERTIES)){
    document.documentElement.style.setProperty(property,safeThemeColor(theme[name],DEFAULT_THEME[name]));
  }
}
function safeExternalUrl(value='') {
  try { const url=new URL(value); return /^https?:$/.test(url.protocol)?url.href:''; } catch (_) { return ''; }
}
function formatBytes(bytes=0) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024*1024) return `${Math.round(bytes/1024)} КБ`;
  return `${(bytes/1024/1024).toFixed(bytes < 10*1024*1024 ? 1 : 0)} МБ`;
}
function formatTime(value) {
  if (!Number.isFinite(value)) return '0:00';
  const minutes=Math.floor(value/60),seconds=Math.floor(value%60);
  return `${minutes}:${String(seconds).padStart(2,'0')}`;
}
function toast(message) {
  const element=$('toast');
  element.textContent=message;element.hidden=false;
  clearTimeout(state.toastTimer);
  state.toastTimer=setTimeout(()=>{element.hidden=true;},3600);
}
async function fetchJson(path) {
  const response=await fetch(new URL(path,ROOT),{cache:'no-store'});
  if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function installedState() {
  try {
    const value=JSON.parse(localStorage.getItem(INSTALLED_KEY)||'{}');
    return value&&typeof value==='object'&&value.cities?value:{cities:{}};
  } catch (_) { return {cities:{}}; }
}
function saveInstalled(value) { localStorage.setItem(INSTALLED_KEY,JSON.stringify(value)); }
function offlinePackage(id) { return state.offline?.packages?.find(item=>item.id===id); }
function isCityInstalled(packageId) {
  const record=installedState().cities[packageId],manifest=offlinePackage(packageId);
  return !!(record&&manifest&&record.revision===manifest.revision&&!manifest.missing.length);
}
function countryInstalledCityIds(countryId) {
  const installed=installedState();
  return Object.keys(installed.cities).filter(packageId=>offlinePackage(packageId)?.country_id===countryId);
}
function isCommonInstalled(country) {
  return country.cities.some(city=>isCityInstalled(city.package_id)&&offlinePackage(city.package_id)?.requires?.includes(country.package_id));
}
function packageBadge(packageId) {
  return isCityInstalled(packageId)
    ? '<span class="package-badge">На устройстве</span>'
    : '<span class="package-badge remote">Нужен интернет</span>';
}

async function loadPackage(id, url) {
  if(state.packages.has(id))return state.packages.get(id);
  const promise=fetchJson(url).catch(error=>{state.packages.delete(id);throw error;});
  state.packages.set(id,promise);
  return promise;
}
function countryRef(id) { return state.catalog?.countries.find(item=>item.id===id); }
function cityRef(countryId,cityId) { return countryRef(countryId)?.cities.find(item=>item.id===cityId); }
async function countryData(countryId) {
  const item=countryRef(countryId);if(!item)throw new Error('Страна не найдена');
  return loadPackage(item.package_id,item.package_url);
}
async function cityData(countryId,cityId) {
  const item=cityRef(countryId,cityId);if(!item)throw new Error('Город не найден');
  return loadPackage(item.package_id,item.package_url);
}

function parseRoute() {
  const parts=(location.hash.replace(/^#\/?/,'')||'').split('/').filter(Boolean).map(decodeURIComponent);
  if(!parts.length)return {name:'home'};
  if(parts[0]==='country'&&parts[1])return {name:'country',countryId:parts[1]};
  if(parts[0]==='city'&&parts[1]&&parts[2])return {name:'city',countryId:parts[1],cityId:parts[2]};
  if(parts[0]==='attraction'&&parts[1]&&parts[2]&&parts[3])return {name:'attraction',countryId:parts[1],cityId:parts[2],attractionId:parts[3]};
  if(parts[0]==='point'&&parts[1]&&parts[2]&&parts[3]&&parts[4])return {name:'point',countryId:parts[1],cityId:parts[2],attractionId:parts[3],pointId:parts[4]};
  if(parts[0]==='story'&&parts[1]&&parts[2]&&parts[3])return {name:'story',countryId:parts[1],cityId:parts[2]==='_'?null:parts[2],storyId:parts[3]};
  return {name:'not-found'};
}
function href(...parts) { return '#/'+parts.map(part=>encodeURIComponent(part)).join('/'); }
function parentRoute(route) {
  if(route.name==='country')return '#/';
  if(route.name==='city')return href('country',route.countryId);
  if(route.name==='attraction')return href('city',route.countryId,route.cityId);
  if(route.name==='point')return href('attraction',route.countryId,route.cityId,route.attractionId);
  if(route.name==='story')return route.cityId?href('city',route.countryId,route.cityId):href('country',route.countryId);
  return '#/';
}
function breadcrumb(items) {
  return `<nav class="breadcrumb" aria-label="Навигационная цепочка">${items.map((item,index)=>
    index===items.length-1?`<span>${escapeHtml(item.title)}</span>`:`<a href="${item.url}">${escapeHtml(item.title)}</a><span>›</span>`
  ).join('')}</nav>`;
}

function storySections(stories,countryId,cityId=null) {
  if(!stories?.episodes?.length)return '<p class="page-lead">Рассказы пока не добавлены.</p>';
  const byId=new Map(stories.episodes.map(item=>[item.id,item]));
  const used=new Set();
  const sections=(stories.sections||[]).map(section=>{
    const episodes=(section.episode_ids||[]).map(id=>byId.get(id)).filter(Boolean);episodes.forEach(item=>used.add(item.id));
    return {title:section.title,episodes};
  });
  const rest=stories.episodes.filter(item=>!used.has(item.id));
  if(rest.length)sections.push({title:'Другие истории',episodes:rest});
  return `<div class="story-sections">${sections.filter(section=>section.episodes.length).map(section=>`
    <section class="story-section"><h3>${escapeHtml(section.title)}</h3><div class="story-list">
      ${section.episodes.map(episode=>storyCard(episode,countryId,cityId)).join('')}
    </div></section>`).join('')}</div>`;
}
function storyCard(episode,countryId,cityId) {
  const route=href('story',countryId,cityId||'_',episode.id);
  return `<article class="story-card">
    <button class="play-button" type="button" data-play="${escapeHtml(episode.audio)}" data-title="${escapeHtml(episode.title)}" aria-label="Воспроизвести ${escapeHtml(episode.title)}"><span data-play-glyph>▶</span></button>
    <div><h4><a href="${route}">${escapeHtml(episode.title)}</a></h4><p>≈ ${escapeHtml(episode.estimated_min_at_130_wpm||'—')} мин · ${escapeHtml(episode.section||'Аудиоистория')}</p></div>
    <span class="story-mode">${episode.mode==='practical'?'Практика':'История'}</span>
  </article>`;
}

function renderHome() {
  const countries=state.catalog.countries;
  const cities=countries.reduce((sum,item)=>sum+item.cities.length,0);
  $('app-main').innerHTML=`<div class="page">
    <section class="hero">
      <span class="eyebrow">Путешествуйте глубже</span>
      <h1>Мир говорит.<br>Слушайте.</h1>
      <p>Истории стран и городов, экскурсии по достопримечательностям и точные офлайн-пакеты без лишних загрузок.</p>
      <div class="hero-stats"><span>${countries.length} ${countries.length===1?'страна':'стран'}</span><span>${cities} города</span><span>Пакеты по городам</span></div>
    </section>
    <div class="section-head"><div><span class="eyebrow">Каталог</span><h2>Куда отправимся?</h2></div><p>Выберите страну. Новые направления появятся здесь автоматически после добавления контента.</p></div>
    <div class="card-grid">${countries.map((country,index)=>`<a class="country-card" href="${href('country',country.id)}">
      <span class="card-number">${String(index+1).padStart(2,'0')}</span><span class="card-arrow">↗</span>
      <h3>${escapeHtml(country.title)}</h3><div class="card-meta"><span>${country.cities.length} города</span><span>·</span><span>${country.story_count} историй страны</span></div>
    </a>`).join('')}</div>
  </div>`;
}

async function renderCountry(route) {
  const ref=countryRef(route.countryId),data=await countryData(route.countryId);
  const hero=data.country.manifest.hero||{},palette=Array.isArray(hero.palette)?hero.palette:[];
  const heroStyle=`--hero-start:${safeThemeColor(palette[0],'#17291f')};--hero-middle:${safeThemeColor(palette[1],'#315b44')};--hero-end:${safeThemeColor(palette[2],'#9b7a42')}`;
  const heroArt=hero.art?`<img class="country-hero-art" src="${escapeHtml(hero.art)}" alt="" aria-hidden="true">`:'';
  $('app-main').innerHTML=`<div class="page">
    ${breadcrumb([{title:'Все страны',url:'#/'},{title:ref.title}])}
    <section class="hero country-hero" style="${heroStyle}">${heroArt}<span class="eyebrow">Страна</span><h1>${escapeHtml(ref.title)}</h1><p>Общие истории страны загрузятся автоматически вместе с первым выбранным городом.</p>
      <div class="hero-stats"><span>${ref.cities.length} города</span><span>${ref.story_count} общих историй</span></div></section>
    <div class="section-head"><div><span class="eyebrow">Направления</span><h2>Города и регионы</h2></div><p>Каждый город — самостоятельный офлайн-пакет с историями, фото, аудио и картами.</p></div>
    <div class="card-grid">${ref.cities.map((city,index)=>`<a class="city-card" href="${href('city',ref.id,city.id)}">
      ${packageBadge(city.package_id)}<span class="card-arrow">↗</span><h3>${escapeHtml(city.title)}</h3>
      <div class="card-meta"><span>${city.attraction_count} достопримечательности</span><span>·</span><span>${city.story_count} историй</span></div>
    </a>`).join('')}</div>
    <div class="section-head"><div><span class="eyebrow">Слушать заранее</span><h2>${escapeHtml(data.stories.title)}</h2></div><p>Общие культурные и практические рассказы о стране.</p></div>
    ${storySections(data.stories,ref.id)}
  </div>`;
}

async function renderCity(route) {
  const cref=countryRef(route.countryId),ref=cityRef(route.countryId,route.cityId),data=await cityData(route.countryId,route.cityId);
  const manifest=offlinePackage(ref.package_id),installed=isCityInstalled(ref.package_id);
  $('app-main').innerHTML=`<div class="page">
    ${breadcrumb([{title:'Все страны',url:'#/'},{title:cref.title,url:href('country',cref.id)},{title:ref.title}])}
    <div class="title-row"><div><span class="eyebrow">Город</span><h1 class="page-title">${escapeHtml(ref.title)}</h1><p class="page-lead">Выберите достопримечательность или включите городскую историю перед прогулкой.</p></div>
      ${installed?'':`<button class="primary-button" type="button" data-install="${escapeHtml(ref.package_id)}">Скачать офлайн · ${formatBytes((manifest?.bytes||0)+(manifest?.requires||[]).reduce((sum,id)=>sum+(offlinePackage(id)?.bytes||0),0))}</button>`}</div>
    <div class="section-head"><div><span class="eyebrow">Ориентирование</span><h2>Достопримечательности на карте</h2></div><p>Нажмите на метку, чтобы открыть выбранное место.</p></div>
    <div id="city-map"></div>
    <div class="section-head"><div><span class="eyebrow">Исследовать</span><h2>Достопримечательности</h2></div><p>${data.attractions.length} маршрутов с точками интереса и двумя уровнями рассказа.</p></div>
    <div class="card-grid">${data.attractions.map((item,index)=>`<a class="attraction-card" href="${href('attraction',route.countryId,route.cityId,item.id)}">
      <span class="card-number">${String(index+1).padStart(2,'0')}</span><span class="card-arrow">↗</span><h3>${escapeHtml(item.title)}</h3>
      <div class="card-meta"><span>${item.points.length} точек</span><span>·</span><span>полный и must-see</span></div></a>`).join('')}</div>
    <div class="section-head"><div><span class="eyebrow">Аудиожурнал</span><h2>${escapeHtml(data.stories.title)}</h2></div><p>Истории города не привязаны к GPS — слушайте когда удобно.</p></div>
    ${storySections(data.stories,route.countryId,route.cityId)}
  </div>`;
  if(window.AtlasMap)window.AtlasMap.mountCity($('city-map'),data,attractionId=>{location.hash=href('attraction',route.countryId,route.cityId,attractionId).slice(1);});
}

async function attractionContext(route) {
  const city=await cityData(route.countryId,route.cityId);
  const attraction=city.attractions.find(item=>item.id===route.attractionId);
  if(!attraction)throw new Error('Достопримечательность не найдена');
  return {city,attraction};
}
function orderedPoints(attraction,mode) {
  const program=attraction.programs[mode]||attraction.programs.full;
  const ids=[...(program.ordered_point_ids||[]),...(program.optional_point_ids||[])];
  const byId=new Map(attraction.points.map(item=>[item.id,item]));
  return ids.map(id=>byId.get(id)).filter(Boolean);
}
function openPointDialog(route,attraction,programPoints,pointId) {
  const point=attraction.points.find(item=>item.id===pointId);if(!point)return;
  const sequence=programPoints.some(item=>item.id===pointId)?programPoints:attraction.points;
  const index=sequence.findIndex(item=>item.id===pointId),nextPoint=index>=0?sequence[index+1]:null;
  const photo=point.media?.photo||{},main=point.narrations.main,more=point.narrations.learn_more;
  const sources=(point.source_candidates_unchecked||[]).map(url=>safeExternalUrl(url)).filter(Boolean);
  $('point-dialog-content').innerHTML=`<article class="point-dialog-card">
    ${photo.path?`<div class="point-dialog-photo"><img src="${escapeHtml(photo.path)}" alt="${escapeHtml(point.title)}"></div>`:''}
    <div class="point-dialog-copy"><span class="eyebrow">Точка ${index>=0?index+1:'—'} из ${sequence.length}</span><h2 id="point-dialog-title">${escapeHtml(point.title)}</h2>
      <p class="listen-note"><strong>Где слушать:</strong> ${escapeHtml(point.where_to_listen||'У памятника, не мешая проходу.')}</p>
      <div class="point-dialog-actions"><button class="primary-button" type="button" data-play="${escapeHtml(main.audio)}" data-title="${escapeHtml(point.title)}" data-next-play="${escapeHtml(more.audio)}" data-next-title="${escapeHtml(point.title)} · Хочу узнать больше"><span data-play-glyph>▶</span> Основной рассказ</button>
      <button class="secondary-button" type="button" data-play="${escapeHtml(more.audio)}" data-title="${escapeHtml(point.title)} · Хочу узнать больше"><span data-play-glyph>▶</span> Хочу узнать больше</button></div>
      <details class="point-dialog-text"><summary>Текст основного рассказа</summary><p class="narration-text">${escapeHtml(main.text)}</p></details>
      <details class="point-dialog-text"><summary>Текст продолжения</summary><p class="narration-text">${escapeHtml(more.text)}</p>${sources.length?`<p>${sources.map(url=>`<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">Источник-кандидат ↗</a>`).join('<br>')}</p>`:''}</details>
      <div class="point-dialog-footer"><a class="source-link" href="${href('point',route.countryId,route.cityId,route.attractionId,point.id)}">Открыть отдельную страницу ↗</a>${nextPoint?`<button class="primary-button" type="button" data-dialog-next="${escapeHtml(nextPoint.id)}">Следующая точка · ${escapeHtml(nextPoint.title)} →</button>`:''}</div>
    </div></article>`;
  const dialog=$('point-dialog');dialog.scrollTop=0;
  dialog.querySelector('[data-dialog-next]')?.addEventListener('click',event=>openPointDialog(route,attraction,programPoints,event.currentTarget.dataset.dialogNext));
  if(typeof dialog.show==='function'&&!dialog.open)dialog.show();else if(!dialog.open)dialog.setAttribute('open','');
  syncAudioButtons();
}
async function renderAttraction(route) {
  const cref=countryRef(route.countryId),cityRefValue=cityRef(route.countryId,route.cityId);
  const {attraction}=await attractionContext(route);
  const mode=state.programModes.get(attraction.id)||'full',points=orderedPoints(attraction,mode);
  $('app-main').innerHTML=`<div class="page">
    ${breadcrumb([{title:cref.title,url:href('country',cref.id)},{title:cityRefValue.title,url:href('city',cref.id,cityRefValue.id)},{title:attraction.title}])}
    <span class="eyebrow">Достопримечательность</span><h1 class="page-title">${escapeHtml(attraction.title)}</h1>
    <p class="page-lead">Выберите короткую подборку главного или полную экскурсию. Геометки — ориентиры, а не обещание доступного прохода.</p>
    <div class="program-switch" role="group" aria-label="Программа экскурсии">
      <button type="button" data-program="must_see" class="${mode==='must_see'?'active':''}">Главное · ${attraction.programs.must_see.ordered_point_ids.length}</button>
      <button type="button" data-program="full" class="${mode==='full'?'active':''}">Полная · ${attraction.programs.full.ordered_point_ids.length+(attraction.programs.full.optional_point_ids||[]).length}</button>
    </div>
    <div id="attraction-map"></div>
    <div class="points-list">${points.map((point,index)=>`<a class="point-card" href="${href('point',route.countryId,route.cityId,route.attractionId,point.id)}">
      <span class="point-index">${index+1}</span><div><h3>${escapeHtml(point.title)}</h3><p>${escapeHtml(point.summary||point.where_to_listen||'Открыть рассказ')}</p></div><span class="chevron">›</span></a>`).join('')}</div>
  </div>`;
  document.querySelectorAll('[data-program]').forEach(button=>button.addEventListener('click',()=>{
    state.programModes.set(attraction.id,button.dataset.program);renderRoute(false);
  }));
  if(window.AtlasMap)window.AtlasMap.mount($('attraction-map'),attraction,pointId=>openPointDialog(route,attraction,points,pointId));
}

async function renderPoint(route) {
  const cref=countryRef(route.countryId),cityRefValue=cityRef(route.countryId,route.cityId);
  const {attraction}=await attractionContext(route),point=attraction.points.find(item=>item.id===route.pointId);
  if(!point)throw new Error('Точка интереса не найдена');
  const photo=point.media?.photo||{},main=point.narrations.main,more=point.narrations.learn_more;
  const sources=(point.source_candidates_unchecked||[]).map(url=>safeExternalUrl(url)).filter(Boolean);
  $('app-main').innerHTML=`<div class="page page-narrow">
    ${breadcrumb([{title:cref.title,url:href('country',cref.id)},{title:cityRefValue.title,url:href('city',cref.id,cityRefValue.id)},{title:attraction.title,url:href('attraction',cref.id,cityRefValue.id,attraction.id)},{title:point.title}])}
    <div class="point-hero"><div class="point-photo"><img src="${escapeHtml(photo.path||'')}" alt="${escapeHtml(point.title)}" loading="eager"></div>
      <div class="point-copy"><span class="eyebrow">Точка интереса · ${escapeHtml(point.id)}</span><h1>${escapeHtml(point.title)}</h1>
      <p class="listen-note"><strong>Где слушать:</strong> ${escapeHtml(point.where_to_listen||'У памятника, не мешая проходу.')}</p>
      <button class="primary-button" type="button" data-play="${escapeHtml(main.audio)}" data-title="${escapeHtml(point.title)}" data-next-play="${escapeHtml(more.audio)}" data-next-title="${escapeHtml(point.title)} · Хочу узнать больше"><span data-play-glyph>▶</span> Слушать основной рассказ</button></div></div>
    <details class="narration narration-details"><summary>Текст основного рассказа</summary><div class="narration-details-body"><p class="narration-text">${escapeHtml(main.text)}</p></div></details>
    <section class="continue-card">
      <div class="continue-head"><div><span class="eyebrow">Продолжение</span><h2>Хочу узнать больше</h2><p>Дополнительный рассказ · ≈ ${escapeHtml(more.estimated_minutes||'—')} мин</p></div>
      <button class="primary-button" type="button" data-play="${escapeHtml(more.audio)}" data-title="${escapeHtml(point.title)} · Хочу узнать больше"><span data-play-glyph>▶</span> Слушать продолжение</button></div>
      <details><summary>Показать текст продолжения</summary><p class="narration-text">${escapeHtml(more.text)}</p>
        ${sources.length?`<p>${sources.map(url=>`<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">Источник-кандидат ↗</a>`).join('<br>')}</p>`:''}
      </details>
    </section>
    ${photo.source_url?`<a class="source-link" href="${escapeHtml(safeExternalUrl(photo.source_url))}" target="_blank" rel="noopener">Источник фотографии ↗</a>`:''}
  </div>`;
}

async function renderStory(route) {
  const cref=countryRef(route.countryId),cityReference=route.cityId?cityRef(route.countryId,route.cityId):null;
  const data=route.cityId?await cityData(route.countryId,route.cityId):await countryData(route.countryId);
  const story=data.stories.episodes.find(item=>item.id===route.storyId);
  if(!story)throw new Error('Рассказ не найден');
  const parent=route.cityId?href('city',route.countryId,route.cityId):href('country',route.countryId);
  $('app-main').innerHTML=`<div class="page page-narrow">
    ${breadcrumb([{title:cref.title,url:href('country',cref.id)},...(cityReference?[{title:cityReference.title,url:parent}]:[]),{title:story.title}])}
    <span class="eyebrow">${escapeHtml(story.section||'Аудиоистория')}</span><h1 class="page-title">${escapeHtml(story.title)}</h1>
    <p class="page-lead">≈ ${escapeHtml(story.estimated_min_at_130_wpm||'—')} мин · ${story.mode==='practical'?'Практический рассказ':'История и культура'}</p>
    <article class="narration"><div class="narration-head"><h2>Слушать</h2><button class="primary-button" type="button" data-play="${escapeHtml(story.audio)}" data-title="${escapeHtml(story.title)}"><span data-play-glyph>▶</span> Включить</button></div><p class="narration-text">${escapeHtml(story.text)}</p></article>
  </div>`;
}

function renderNotFound() {
  $('app-main').innerHTML='<div class="page"><div class="error-state"><h1>Страница не найдена</h1><p>Вернитесь в каталог и выберите направление заново.</p><a class="primary-button" href="#/">На главную</a></div></div>';
}
function showLoading() { $('app-main').innerHTML='<section class="loading-screen"><span class="loading-orbit"></span><p>Загружаем контент…</p></section>'; }
function showError(error) {
  console.error(error);
  $('app-main').innerHTML=`<div class="page"><div class="error-state"><h1>Не удалось открыть раздел</h1><p>${escapeHtml(error.message||error)}</p><button class="primary-button" type="button" onclick="location.reload()">Повторить</button></div></div>`;
}
function updateNavigation(route) {
  const back=$('back-button');back.hidden=route.name==='home'||route.name==='not-found';back.dataset.href=parentRoute(route);
  document.querySelector('[data-nav="explore"]')?.classList.toggle('active',route.name!=='downloads');
}
async function renderRoute(scroll=true) {
  const token=++state.renderToken,route=parseRoute();
  if($('point-dialog')?.open)$('point-dialog').close();
  if(window.AtlasMap)window.AtlasMap.unmount();
  updateNavigation(route);showLoading();
  try {
    const themedCountry=route.countryId?await countryData(route.countryId):null;
    if(token!==state.renderToken)return;
    applyTheme(themedCountry?.country?.manifest?.theme);
    if(route.name==='home')renderHome();
    else if(route.name==='country')await renderCountry(route);
    else if(route.name==='city')await renderCity(route);
    else if(route.name==='attraction')await renderAttraction(route);
    else if(route.name==='point')await renderPoint(route);
    else if(route.name==='story')await renderStory(route);
    else renderNotFound();
    if(token!==state.renderToken)return;
    syncAudioButtons();
    if(scroll)scrollTo({top:0,behavior:'auto'});
  } catch(error) { if(token===state.renderToken){applyTheme();showError(error);} }
}

function syncAudioButtons() {
  const audio=$('audio-element');
  const activeUrl=audio.src;
  document.querySelectorAll('[data-play]').forEach(button=>{
    const buttonUrl=button.dataset.play?new URL(button.dataset.play,ROOT).href:'';
    const playing=!!buttonUrl&&buttonUrl===activeUrl&&!audio.paused&&!audio.ended;
    button.classList.toggle('is-playing',playing);
    const glyph=button.querySelector('[data-play-glyph]');
    if(glyph)glyph.textContent=playing?'❚❚':'▶';
    button.setAttribute('aria-pressed',String(playing));
  });
}
function playAudio(path,title,{nextPath='',nextTitle=''}={}) {
  if(!path){toast('Для этой записи аудио ещё не опубликовано.');return;}
  const audio=$('audio-element'),url=new URL(path,ROOT).href;
  if(audio.src===url){
    if(nextPath)state.playback={...(state.playback||{}),url,title,nextPath,nextTitle};
    $('audio-dock').hidden=false;
    if(!audio.paused){audio.pause();return;}
    audio.play().catch(()=>toast(navigator.onLine?'Аудио ещё не опубликовано или повреждено.':'Этот аудиопакет не скачан.'));
    return;
  }
  state.playback={url,title,nextPath,nextTitle};
  $('dock-next').hidden=true;
  audio.src=url;audio.playbackRate=PLAYBACK_RATES[state.speedIndex];
  $('dock-title').textContent=title;$('audio-dock').hidden=false;
  audio.play().catch(()=>toast(navigator.onLine?'Аудио ещё не опубликовано или повреждено.':'Этот аудиопакет не скачан.'));
}
function setupPlayer() {
  const audio=$('audio-element');
  $('dock-play').addEventListener('click',()=>audio.paused?audio.play():audio.pause());
  $('dock-rewind').addEventListener('click',()=>{audio.currentTime=Math.max(0,(audio.currentTime||0)-5);});
  $('dock-forward').addEventListener('click',()=>{audio.currentTime=Math.min(Number.isFinite(audio.duration)?audio.duration:Infinity,(audio.currentTime||0)+5);});
  $('dock-speed').addEventListener('click',()=>{
    state.speedIndex=(state.speedIndex+1)%PLAYBACK_RATES.length;
    audio.playbackRate=PLAYBACK_RATES[state.speedIndex];
    $('dock-speed').textContent=`${PLAYBACK_RATES[state.speedIndex]}×`;
  });
  $('dock-close').addEventListener('click',()=>{
    audio.pause();audio.removeAttribute('src');audio.load();state.playback=null;
    $('audio-dock').hidden=true;$('dock-next').hidden=true;$('dock-progress').style.width='0';
    $('dock-current').textContent='0:00';$('dock-duration').textContent='0:00';syncAudioButtons();
  });
  $('dock-next').addEventListener('click',event=>{
    const button=event.currentTarget;
    playAudio(button.dataset.play,button.dataset.title);
  });
  audio.addEventListener('play',()=>{$('dock-play').textContent='❚❚';$('dock-next').hidden=true;syncAudioButtons();});
  audio.addEventListener('pause',()=>{$('dock-play').textContent='▶';syncAudioButtons();});
  audio.addEventListener('ended',()=>{
    $('dock-play').textContent='▶';syncAudioButtons();
    if(state.playback?.nextPath){
      const next=$('dock-next');next.dataset.play=state.playback.nextPath;next.dataset.title=state.playback.nextTitle;
      next.textContent=`▶ Продолжить: ${state.playback.nextTitle.split(' · ').pop()}`;next.hidden=false;
    }
  });
  audio.addEventListener('timeupdate',()=>{
    $('dock-current').textContent=formatTime(audio.currentTime);$('dock-duration').textContent=formatTime(audio.duration);
    $('dock-progress').style.width=`${audio.duration?audio.currentTime/audio.duration*100:0}%`;
  });
  audio.addEventListener('loadedmetadata',()=>{$('dock-duration').textContent=formatTime(audio.duration);});
  audio.addEventListener('error',()=>{syncAudioButtons();toast(navigator.onLine?'Не удалось открыть аудио.':'Аудио недоступно офлайн: скачайте пакет города.');});
}

async function sha256(buffer) {
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
async function validCached(cache,file) {
  const response=await cache.match(new URL(file.path,ROOT).href);
  return !!(response&&response.headers.get('X-Atlas-Sha256')===file.sha256&&Number(response.headers.get('Content-Length')||file.bytes)===file.bytes);
}
function setDownloadProgress(title,done,total,note='') {
  const box=$('download-progress');box.hidden=false;
  const percent=total?Math.round(done/total*100):0;
  $('download-progress-title').textContent=title;$('download-progress-value').textContent=`${percent}%`;
  $('download-progress-bar').value=percent;$('download-progress-note').textContent=note;
}
async function installCity(packageId) {
  if(state.downloading)return;
  if(!('caches'in window)||!crypto?.subtle){toast('Этот браузер не поддерживает безопасные офлайн-пакеты.');return;}
  const cityPackage=offlinePackage(packageId);
  if(!cityPackage)return;
  const packageIds=[...cityPackage.requires,packageId],packages=packageIds.map(offlinePackage).filter(Boolean);
  const missing=packages.flatMap(item=>item.missing||[]);
  if(missing.length){toast(`Пакет ещё не опубликован полностью: не хватает ${missing.length} файлов.`);return;}
  state.downloading=true;renderPackageManager();
  try {
    if(navigator.storage?.persist)await navigator.storage.persist();
    const cache=await caches.open(state.offline.cache_name);
    const files=[];const seen=new Set();
    packages.forEach(pack=>pack.files.forEach(file=>{if(!seen.has(file.path)){seen.add(file.path);files.push({...file,packageTitle:pack.title});}}));
    let done=0;
    for(const file of files){
      setDownloadProgress(`Скачиваем ${cityPackage.title}`,done,files.length,`${done+1}/${files.length} · ${file.path.split('/').pop()}`);
      if(await validCached(cache,file)){done++;continue;}
      const url=new URL(file.path,ROOT).href;
      const response=await fetch(url,{cache:'no-store',headers:{'X-Atlas-Download':'1'}});
      if(!response.ok||response.status!==200)throw new Error(`${file.path}: HTTP ${response.status}`);
      const payload=await response.arrayBuffer();
      if(payload.byteLength!==file.bytes)throw new Error(`${file.path}: неверный размер`);
      if(await sha256(payload)!==file.sha256)throw new Error(`${file.path}: неверная контрольная сумма`);
      const headers=new Headers(response.headers);headers.set('X-Atlas-Sha256',file.sha256);headers.set('Content-Length',String(file.bytes));
      await cache.put(url,new Response(payload,{status:200,headers}));done++;
    }
    const installed=installedState();
    installed.cities[packageId]={revision:cityPackage.revision,countryId:cityPackage.country_id,installedAt:new Date().toISOString()};
    saveInstalled(installed);setDownloadProgress(`${cityPackage.title} готов офлайн`,files.length,files.length,'Можно включать авиарежим.');
    toast(`${cityPackage.title}: офлайн-пакет установлен.`);
  } catch(error) {
    console.error(error);toast('Загрузка остановилась: '+error.message);
  } finally {
    state.downloading=false;await renderPackageManager();renderRoute(false);
  }
}
async function deletePackageFiles(cache,manifest) {
  for(const file of manifest.files)await cache.delete(new URL(file.path,ROOT).href);
}
async function removeCity(packageId) {
  if(state.downloading)return;
  const manifest=offlinePackage(packageId);if(!manifest||!isCityInstalled(packageId))return;
  if(!confirm(`Удалить офлайн-пакет «${manifest.title}» с устройства?`))return;
  const cache=await caches.open(state.offline.cache_name),installed=installedState();
  await deletePackageFiles(cache,manifest);delete installed.cities[packageId];
  const countryStillUsed=Object.keys(installed.cities).some(id=>offlinePackage(id)?.country_id===manifest.country_id);
  if(!countryStillUsed){
    for(const dependencyId of manifest.requires){const dependency=offlinePackage(dependencyId);if(dependency)await deletePackageFiles(cache,dependency);}
  }
  saveInstalled(installed);toast(`${manifest.title}: файлы удалены.`);await renderPackageManager();renderRoute(false);
}
async function removeCountry(countryId) {
  if(state.downloading)return;
  const country=countryRef(countryId),packageIds=countryInstalledCityIds(countryId);
  if(!country||!packageIds.length)return;
  if(!confirm(`Удалить все офлайн-пакеты страны «${country.title}» с устройства?`))return;
  const cache=await caches.open(state.offline.cache_name),installed=installedState();
  for(const packageId of packageIds){
    const manifest=offlinePackage(packageId);if(manifest)await deletePackageFiles(cache,manifest);
    delete installed.cities[packageId];
  }
  const common=offlinePackage(country.package_id);if(common)await deletePackageFiles(cache,common);
  saveInstalled(installed);toast(`${country.title}: все офлайн-пакеты удалены.`);await renderPackageManager();renderRoute(false);
}
async function storageText() {
  if(!navigator.storage?.estimate)return 'Браузер не сообщает объём хранилища.';
  const {usage=0}=await navigator.storage.estimate();
  return `Хранилище браузера: занято ${formatBytes(usage)}. Не очищайте данные сайта перед поездкой.`;
}
async function renderPackageManager() {
  if(!state.offline)return;
  $('storage-card').textContent=await storageText();
  const build=state.buildInfo;
  $('build-version').textContent=build
    ? `Версия ${build.version} · контент ${build.content_revision} · сборка ${build.build_id}`
    : 'Версия публикации недоступна.';
  const installed=installedState();
  $('package-manager-list').innerHTML=state.catalog.countries.map(country=>{
    const common=offlinePackage(country.package_id);
    const installedIds=countryInstalledCityIds(country.id),commonReady=isCommonInstalled(country);
    const commonStatus=commonReady?'На устройстве':installedIds.length?'Требуется обновление':'Не на устройстве';
    return `<section class="manager-country"><div class="manager-country-head"><div><h3>${escapeHtml(country.title)}</h3><small><span class="package-status ${commonReady?'installed':''}">${commonStatus}</span><span>·</span><span>Контент страны: ${formatBytes(common?.bytes||0)}</span></small></div>
      ${installedIds.length?`<button class="danger-button" type="button" data-remove-country="${escapeHtml(country.id)}" ${state.downloading?'disabled':''}>Удалить всё</button>`:''}</div>
      ${country.cities.map(city=>{
        const pack=offlinePackage(city.package_id),ready=isCityInstalled(city.package_id),hasRecord=!!installed.cities[city.package_id];
        const incomplete=(pack?.missing.length||0)+(pack?.requires||[]).reduce((sum,id)=>sum+(offlinePackage(id)?.missing.length||0),0);
        const status=ready?`На устройстве · ${formatBytes(pack?.bytes||0)}`:incomplete?`Не опубликовано файлов: ${incomplete}`:hasRecord?`Требуется обновление · ${formatBytes(pack?.bytes||0)}`:`Не на устройстве · ${formatBytes(pack?.bytes||0)}`;
        return `<div class="manager-package"><div><strong>${escapeHtml(city.title)}</strong><small>${status}</small></div>
          <div class="manager-actions">${ready?`<button class="danger-button" type="button" data-remove="${escapeHtml(city.package_id)}">Удалить</button>`:`<button class="primary-button" type="button" data-install="${escapeHtml(city.package_id)}" ${incomplete||state.downloading?'disabled':''}>${hasRecord?'Обновить':'Скачать'}</button>`}</div></div>`;
      }).join('')}
      ${common?.missing.length?`<p class="manager-warning">Общий пакет страны пока неполный: ${common.missing.length} файлов отсутствуют.</p>`:''}
    </section>`;
  }).join('');
}
async function openManager() {
  const dialog=$('downloads-dialog');await renderPackageManager();
  if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();else dialog.setAttribute('open','');
}

async function registerServiceWorker() {
  if(location.protocol==='file:'||!('serviceWorker'in navigator))return;
  try { await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready; }
  catch(error){console.warn('Service worker:',error);}
}
function updateNetwork() {
  $('network-state').classList.toggle('offline',!navigator.onLine);
  $('network-state').title=navigator.onLine?'Есть интернет':'Офлайн';
}
function setupEvents() {
  $('back-button').addEventListener('click',event=>{location.hash=event.currentTarget.dataset.href||'#/';});
  $('point-dialog-close').addEventListener('click',()=>$('point-dialog').close());
  $('point-dialog').addEventListener('click',event=>{
    if(event.target===$('point-dialog')){$('point-dialog').close();return;}
    const play=event.target.closest('[data-play]');if(play){event.preventDefault();playAudio(play.dataset.play,play.dataset.title,{nextPath:play.dataset.nextPlay||'',nextTitle:play.dataset.nextTitle||''});}
  });
  $('downloads-button').addEventListener('click',openManager);$('downloads-nav').addEventListener('click',openManager);
  $('downloads-close').addEventListener('click',()=>$('downloads-dialog').close());
  $('downloads-dialog').addEventListener('click',event=>{if(event.target===$('downloads-dialog'))$('downloads-dialog').close();});
  $('app-main').addEventListener('click',event=>{
    const play=event.target.closest('[data-play]');if(play){event.preventDefault();playAudio(play.dataset.play,play.dataset.title,{nextPath:play.dataset.nextPlay||'',nextTitle:play.dataset.nextTitle||''});return;}
    const install=event.target.closest('[data-install]');if(install){event.preventDefault();installCity(install.dataset.install);return;}
  });
  $('package-manager-list').addEventListener('click',event=>{
    const install=event.target.closest('[data-install]');if(install)installCity(install.dataset.install);
    const remove=event.target.closest('[data-remove]');if(remove)removeCity(remove.dataset.remove);
    const removeCountryButton=event.target.closest('[data-remove-country]');if(removeCountryButton)removeCountry(removeCountryButton.dataset.removeCountry);
  });
  addEventListener('hashchange',()=>renderRoute());addEventListener('online',updateNetwork);addEventListener('offline',updateNetwork);
}

async function init() {
  setupPlayer();setupEvents();updateNetwork();
  try {
    [state.catalog,state.offline,state.buildInfo]=await Promise.all([
      fetchJson(CATALOG_URL),fetchJson(OFFLINE_URL),fetchJson(BUILD_INFO_URL),
    ]);
    if(state.catalog.schema_version!==2||state.offline.schema_version!==2)throw new Error('Неподдерживаемая версия каталога');
    await registerServiceWorker();renderRoute();
  } catch(error){showError(error);}
}

init();
})();
