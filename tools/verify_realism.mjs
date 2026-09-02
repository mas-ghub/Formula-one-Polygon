/* Verifies the new realism features against the game's own built world:
   width per track, banking on the physics surface, water meshes, grass tufts */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import * as THREE from '../node_modules/three/build/three.module.js';
const ROOT = '/home/user/Formula-one-Polygon';
const game = fs.readFileSync(path.join(ROOT,'src/game.js'),'utf8');
const slice=(a,b)=>{const i=game.search(a);if(i<0)throw new Error('anchor '+a);const r=game.slice(i);const j=r.search(b);if(j<0)throw new Error('end '+b);return r.slice(0,j);};
const stub=()=>new Proxy(function(){}, {get:(t,k)=>k===Symbol.toPrimitive?()=>0:stub(),apply:()=>stub(),construct:()=>stub()});
const ctx2d=()=>new Proxy({_p:{}},{get(t,k){if(k in t._p)return t._p[k];if(k==='measureText')return()=>({width:8});if(k==='getImageData')return(x,y,w,h)=>({data:new Uint8ClampedArray(Math.max(1,w*h*4)),width:w,height:h});if(k==='createImageData')return(w,h)=>({data:new Uint8ClampedArray(Math.max(1,w*h*4)),width:w,height:h});return()=>({addColorStop(){},setTransform(){}});},set(t,k,v){t._p[k]=v;return true;}});
globalThis.document={createElement:(t)=>t==='canvas'?{width:0,height:0,style:{},getContext:()=>ctx2d()}:{style:{},classList:{add(){},remove(){}},appendChild(){},setAttribute(){}},getElementById:()=>null,body:{classList:{add(){},remove(){}},appendChild(){}},addEventListener(){}} ;
globalThis.window={devicePixelRatio:1,innerWidth:1280,innerHeight:720,addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),location:{search:''}};
globalThis.navigator={userAgent:'node',maxTouchPoints:0};
globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const tex={repeat:{set(){}},offset:{x:0,y:0},anisotropy:0};
const V3=(x,y,z)=>new THREE.Vector3(x,y,z);
globalThis.THREE=THREE; globalThis.V3=V3;

// borrow the WebGL stub straight from all_tracks_contact.mjs
{
 const harness=fs.readFileSync(path.join(ROOT,'tools/all_tracks_contact.mjs'),'utf8');
 const a=harness.indexOf('const GL_ENUMS');
 const b=harness.indexOf('globalThis.mkGlCanvas = mkGlCanvas;')+'globalThis.mkGlCanvas = mkGlCanvas;'.length;
 (0,eval)(harness.slice(a,b));
}
const { TRACKS } = await import(path.join(ROOT,'src/tracks.js'));
const { QUALITY_PRESETS } = await import(path.join(ROOT,'src/quality.js'));
const helpers=game.split('\n').filter(l=>/^(const clamp=|const lerp=|const smoothstep01=|const damp=|const rand=|const pick=)/.test(l)).join('\n');
const prelude=slice(/const _sv=V3\(0,0,0\)/,/^function buildWorld\(/m)
 +'\n'+slice(/function getTrackHAtCoords\(/,/\/\* =+ weather =+ \*\//)
 +'\n'+slice(/function getTrackElevation\(/,/\/\* =+ weather =+ \*\//)
 +'\n'+slice(/export function getBodyGeo\(/,/function makePointsSys\(/)
 +'\n'+slice(/\/\* =+ renderer \/ scene =+ \*\//,/\/\* =+ canvas textures =+ \*\//)
 +'\n'+slice(/\/\* =+ canvas textures =+ \*\//,/\/\* =+ car geometry =+ \*\//)
 +'\n'+slice(/\/\* =+ weather state =+ \*\//,/\/\* =+ thunderstorm/);
const srcTxt=(helpers+'\n'+prelude+'\n'
 +'const matBody=new THREE.MeshStandardMaterial();const matWheel=new THREE.MeshStandardMaterial();\n'
 +'const mergeGeometries=(l)=>l[0];\nvar world=null;var T=null;var timeSec=0;\n'
 +slice(/function buildWorld\(/,/buildMinimapPath\(\);\n/).replace(/buildMinimapPath\(\);\n$/,'')+'\n}'
 +'\nbuildWorld(0);globalThis.__out={buildWorld,TOf:()=>T,worldOf:()=>world};')
 .replace(/^export /gm,'').replace(/^import[ \t].*$/gm,'').replace(/^const V3=[^\n]*$/gm,'')
 .replace(/\$\('gl'\)/g,'mkGlCanvas()').replace(/\$\('[^']*'\)/g,'null');
const NOOPS=['PostFX','buildMinimapPath','updateGriminess','initTunnel','updSkid','addSkid','clearSkids','spawnParticles','sparkBurst','confetti','puff','smk','showToast','makeDamageSprite','accentFor','applyLivery','updateWeatherFX','Speech','sfx','commentator','playSfx','state','audio','gyro','gyroLab','qualityMgr','cam','director','cars','player','race','heli','weather','env','drivers'];
const STUB='function stub(){return new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>0:stub(),apply:()=>stub(),construct:()=>stub()});}\n';
let wrapped=(STUB+NOOPS.map(n=>`var ${n}=stub();`).join('\n')+'\n'+srcTxt)
 .replace(/^const postfx=new PostFX.*$/m,'const postfx={ok:false,enabled:false,setMood(){},render(){return false},setSize(){},apply(){return false}};');
let missing=new Set(),err=null;
for(let a=0;a<40;a++){
 try{err=null;new Function('THREE','tex','effQuality','TRACKS','V3','QUALITY_PRESETS',
  wrapped.replace('globalThis.__out=',[...missing].map(n=>`var ${n}=stub();`).join('\n')+'\nglobalThis.__out='))(THREE,tex,()=>'MED',TRACKS,V3,QUALITY_PRESETS);break;}
 catch(e){err=e;const m=/(\w+) is not defined/.exec(String(e));if(m&&!missing.has(m[1])){missing.add(m[1]);continue;}break;}
}
if(err){console.log('build failed:',String(err).split('\n').slice(0,3).join(' | '));process.exit(1);}
const {buildWorld,TOf,worldOf}=globalThis.__out;

for(const name of ['Monaco','Circuit Zandvoort','Silverstone','Marina Bay']){
 const idx=TRACKS.findIndex(t=>t.name===name);
 const def=TRACKS[idx];
 const file=path.join(ROOT,'public/data/circuits',`${def.openf1CircuitKey}.json`);
 if(fs.existsSync(file))def.realPts=JSON.parse(fs.readFileSync(file,'utf8'));
 buildWorld(idx);
 const T=TOf(),world=worldOf();
 // 1. width: physics half-width
 // 2. banking: find the sample with max |bk|, compare surface heights ±(halfW-0.5)
 let bi=0;for(let i=0;i<T.N;i++)if(Math.abs(T.samples[i].bk||0)>Math.abs(T.samples[bi].bk||0))bi=i;
 const s=T.samples[bi],hw=T.halfW-0.5;
 const yOut=T.trueTrackHeightAt(s.p.x+s.n.x*hw,s.p.z+s.n.z*hw);
 const yIn =T.trueTrackHeightAt(s.p.x-s.n.x*hw,s.p.z-s.n.z*hw);
 const bankDeg=Math.atan(Math.abs(yOut-yIn)/(2*hw))*180/Math.PI;
 // 3. water + boats + tufts
 let waterTris=0,boats=0,tuftCount=0;
 world.traverse(o=>{
  if(o.isMesh&&o.material&&o.material.transparent&&o.material.metalness===0.22)waterTris+=o.geometry.index?o.geometry.index.count/3:0;
  if(o.isInstancedMesh&&o.geometry.type==='PlaneGeometry'&&o.material.side===THREE.DoubleSide&&o.count>50)tuftCount=o.count;
 });
 world.children.forEach(o=>{if(o.userData&&o.userData.isBoat)boats++;});
 console.log(`${name.padEnd(18)} width ${T.halfW*2}m · max banking ${bankDeg.toFixed(1)}° (sample ${bi}) · water tris ${waterTris} · boats ${boats} · grass tufts ${tuftCount}`);
}
