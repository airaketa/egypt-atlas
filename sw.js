/* Egypt Atlas v0.26: resilient app shell plus explicitly downloaded media and PMTiles. */
'use strict';
const SHELL='egypt-atlas-v026-shell';
const MEDIA='egypt-atlas-media-v1';
const ROOT=new URL('./',self.registration.scope);
const APP_FILES=[
  './','./index.html','./styles.css','./app.js','./catalog.js','./audio-ready.js',
  './offline-manifest.json','./manifest.webmanifest','./map-logic.js','./nearby.js',
  './cartouche-inline-ui.js','./cartouche-integrated-data.js',
  './vendor/maplibre-gl.js','./vendor/maplibre-gl.css','./vendor/pmtiles.js',
  './icons/icon-192.png','./icons/icon-512.png','./photos/visual-fallback.svg',
  './assets/hieroglyphs/N005.png','./assets/hieroglyphs/C010.png',
  './assets/hieroglyphs/Y005.png','./assets/hieroglyphs/F012.png',
  './assets/hieroglyphs/D028.png','./assets/hieroglyphs/F031.png',
  './assets/hieroglyphs/S029.png','./assets/hieroglyphs/M023.png',
  './assets/hieroglyphs/U021.png','./assets/hieroglyphs/N035.png',
  './assets/hieroglyphs/N036.png','./assets/hieroglyphs/M017.png',
  './maps/karnak.svg','./maps/route-giza.svg','./maps/route-gem.svg',
  './maps/route-cairo.svg','./maps/route-valley.svg','./maps/route-hatshepsut.svg',
  './maps/route-medinet-habu.svg','./maps/route-memnon.svg',
  './maps/route-luxor-temple.svg','./maps/route-alex-library.svg',
  './maps/route-qaitbay.svg','./maps/route-catacombs.svg',
  './maps/giza-overview.svg','./maps/gem-overview.svg','./maps/cairo-overview.svg',
  './maps/valley-overview.svg','./maps/hatshepsut-overview.svg',
  './maps/medinet-habu-overview.svg','./maps/memnon-overview.svg',
  './maps/luxor-temple-overview.svg','./maps/alex-library-overview.svg',
  './maps/qaitbay-overview.svg','./maps/catacombs-overview.svg'
];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(SHELL);
 await cache.addAll(APP_FILES.map(p=>new URL(p,ROOT).href));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 // IMPORTANT: preserve all media caches while updating the app shell.
 await Promise.all(keys.filter(k=>k.startsWith('egypt-atlas-v')&&k!==SHELL).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
async function respondRange(request,response){
 const spec=request.headers.get('Range');
 if(!spec||!response||!response.ok)return response;
 const match=/^bytes=(\d*)-(\d*)$/i.exec(spec.trim());
 if(!match)return response;
 const bytes=await response.arrayBuffer();const total=bytes.byteLength;
 let from=match[1]?Number(match[1]):0;
 let to=match[2]?Number(match[2]):total-1;
 if(match[1]===''&&match[2]!==''){from=Math.max(0,total-Number(match[2]));to=total-1;}
 if(from<0||from>=total||to<from)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${total}`}});
 to=Math.min(total-1,to);
 const mime=response.headers.get('Content-Type')||'audio/mpeg';
 return new Response(bytes.slice(from,to+1),{status:206,headers:{
  'Content-Type':mime,'Accept-Ranges':'bytes',
  'Content-Range':`bytes ${from}-${to}/${total}`,'Content-Length':String(to-from+1)
 }});
}
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);if(url.origin!==self.location.origin)return;
 // Explicit offline download must bypass SW cache so files can be replaced atomically.
 if(request.headers.get('X-Atlas-Download')==='1'){
  event.respondWith(fetch(request));return;
 }
 const isAudio=url.pathname.endsWith('.mp3');
 const isPmtiles=url.pathname.endsWith('.pmtiles');
 if(isAudio){
  event.respondWith((async()=>{
   const cache=await caches.open(MEDIA);
   const cached=await cache.match(url.href);
   if(cached)return respondRange(request,cached);
   try{
    // Range partial responses cannot be cached as full MP3s.
    const full=await fetch(new Request(url.href,{method:'GET'}));
    if(full.ok&&full.status===200){await cache.put(url.href,full.clone());return respondRange(request,full);}
    return await fetch(request);
   }catch(_){return Response.error();}
  })());return;
 }
 if(isPmtiles){
  event.respondWith((async()=>{
   const cache=await caches.open(MEDIA);
   const cached=await cache.match(url.href);
   if(cached)return respondRange(request,cached);
   try{return await fetch(request);}catch(_){return Response.error();}
  })());return;
 }
 const dynamic=/\/(catalog|audio-ready)\.js$|\/offline-manifest\.json$/.test(url.pathname);
 if(dynamic){
  event.respondWith((async()=>{
   const cache=await caches.open(SHELL);
   try{const r=await fetch(request,{cache:'no-store'});if(r.ok){await cache.put(url.href,r.clone());return r;}}catch(_){/* offline */}
   return await cache.match(url.href)||Response.error();
  })());return;
 }
 if(request.mode==='navigate'){
  event.respondWith((async()=>{
   try{const result=await fetch(request);if(result.ok)return result;}catch(_){/* offline */}
   const cache=await caches.open(SHELL);
   return await cache.match(new URL('./index.html',ROOT).href)||Response.error();
  })());return;
 }
 event.respondWith((async()=>{
  const media=await caches.open(MEDIA),shell=await caches.open(SHELL);
  const hit=(await media.match(url.href))||(await shell.match(url.href));
  if(hit)return hit;
  try{return await fetch(request);}catch(_){return Response.error();}
 })());
});
