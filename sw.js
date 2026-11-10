/* Atlas v2 service worker: small shell plus explicit country/city packages. */
'use strict';

const BUILD_ID='__ATLAS_BUILD_ID__';
const SHELL=`atlas-shell-${BUILD_ID}`;
const CONTENT='atlas-content-v2';
const ROOT=new URL('./',self.registration.scope);
const SHELL_FILES=[
 './','./index.html','./styles.css','./app.js','./map-logic.js','./manifest.webmanifest',
 './content-data/catalog.json','./content-data/offline-packages.json','./content-data/build-info.json',
 './vendor/maplibre-gl.js','./vendor/maplibre-gl.css','./vendor/pmtiles.js',
 './icons/icon-192.png','./icons/icon-512.png'
];

self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(SHELL);
 await cache.addAll(SHELL_FILES.map(path=>new URL(path,ROOT).href));
 await self.skipWaiting();
})()));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 await Promise.all(keys.filter(key=>(key.startsWith('atlas-shell-')&&key!==SHELL)||key.startsWith('egypt-atlas-')).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));

async function rangeResponse(request,response){
 const header=request.headers.get('Range');
 if(!header||!response||!response.ok)return response;
 const match=/^bytes=(\d*)-(\d*)$/i.exec(header.trim());if(!match)return response;
 const bytes=await response.arrayBuffer(),total=bytes.byteLength;
 let from=match[1]?Number(match[1]):0,to=match[2]?Number(match[2]):total-1;
 if(match[1]===''&&match[2]!==''){from=Math.max(0,total-Number(match[2]));to=total-1;}
 if(from<0||from>=total||to<from)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${total}`}});
 to=Math.min(total-1,to);
 return new Response(bytes.slice(from,to+1),{status:206,headers:{
  'Content-Type':response.headers.get('Content-Type')||'application/octet-stream',
  'Accept-Ranges':'bytes','Content-Range':`bytes ${from}-${to}/${total}`,'Content-Length':String(to-from+1)
 }});
}

self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);if(url.origin!==self.location.origin)return;
 if(request.headers.get('X-Atlas-Download')==='1'){event.respondWith(fetch(request));return;}

 const isRangeAsset=url.pathname.endsWith('.mp3')||url.pathname.endsWith('.pmtiles');
 if(isRangeAsset){event.respondWith((async()=>{
  const content=await caches.open(CONTENT),cached=await content.match(url.href);
  if(cached)return rangeResponse(request,cached);
  try{return await fetch(request);}catch(_){return Response.error();}
 })());return;}

 if(request.mode==='navigate'){event.respondWith((async()=>{
  try{const response=await fetch(request);if(response.ok)return response;}catch(_){/* offline */}
  const shell=await caches.open(SHELL);return await shell.match(new URL('./index.html',ROOT).href)||Response.error();
 })());return;}

 const isCatalog=/\/content-data\/(catalog|offline-packages|build-info)\.json$/.test(url.pathname);
 if(isCatalog){event.respondWith((async()=>{
  const shell=await caches.open(SHELL);
  try{const response=await fetch(request,{cache:'no-store'});if(response.ok){await shell.put(url.href,response.clone());return response;}}catch(_){/* offline */}
  return await shell.match(url.href)||Response.error();
 })());return;}

 const isPackage=url.pathname.includes('/content-data/packages/');
 const isContentAsset=url.pathname.includes('/content/countries/');
 if(isPackage||isContentAsset){event.respondWith((async()=>{
  const content=await caches.open(CONTENT),cached=await content.match(url.href);if(cached)return cached;
  try{return await fetch(request);}catch(_){return Response.error();}
 })());return;}

 event.respondWith((async()=>{
  const shell=await caches.open(SHELL),cached=await shell.match(url.href);if(cached)return cached;
  try{const response=await fetch(request);if(response.ok)await shell.put(url.href,response.clone());return response;}catch(_){return Response.error();}
 })());
});
