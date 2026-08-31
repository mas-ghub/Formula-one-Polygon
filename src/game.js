import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACKS } from './tracks.js';
import { loadRealCircuits } from './circuitData.js';
import { RainShaderPass } from './rainShader.js';
import { SnowShaderPass } from './snowShader.js';
import { TiltController } from './tiltControls.js';
import { QualityManager, QUALITY_PRESETS } from './quality.js';
import { GyroCalibrationLab } from './gyroLab.js';
import { accentFor } from './teamLivery.js';

/* ============ helpers ============ */
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
const damp=(a,b,l,dt)=>lerp(a,b,1-Math.exp(-l*dt));
const pick=a=>a[Math.floor(Math.random()*a.length)];
const V3=(x,y,z)=>new THREE.Vector3(x,y,z);
const nowT=()=>performance.now()/1000;
const wrapA=a=>Math.atan2(Math.sin(a),Math.cos(a));
const lerpAngle=(a,b,t)=>a+wrapA(b-a)*t;
function fmtT(t){if(t==null||!isFinite(t))return'—';const m=Math.floor(t/60),s=t-m*60;return m+':'+s.toFixed(3).padStart(6,'0');}
function fmtG(t){if(t==null)return'—';return'+'+t.toFixed(3);}

const state={mode:'boot',trackIdx:0,wx:'sun',tod:'day',laps:3,grid:20,diffMul:0.97,name:'YOU',camMode:0,muted:false,paused:false,zoom: 52,quality:'HIGH'};
// Time-of-day mood, independent of weather — mainly to give control over how
// dark a rainy day reads, without needing a whole night skybox/lighting rig.
const TOD={
 day:{sunMul:1.0,hMul:1.0,expMul:1.0,skyMul:1.0},
 dusk:{sunMul:0.72,hMul:0.8,expMul:1.08,skyMul:0.78},
 night:{sunMul:0.22,hMul:0.42,expMul:1.35,skyMul:0.3}
};
const CAM_NAMES=['CHASE','HOOD','TV','ORBIT','TOP'];

/* ============ drivers ============ */
const DRIVERS=[
['Max Verstappen','Red Bull',1.00,1,'#1b2a5e','#f5c400','#f5c400'],
['Sergio Pérez','Red Bull',0.905,11,'#1b2a5e','#f5c400','#e8402a'],
['Charles Leclerc','Ferrari',0.965,16,'#e8002d','#ffe600','#e8002d'],
['Carlos Sainz','Ferrari',0.945,55,'#e8002d','#ffe600','#f2d13d'],
['Lewis Hamilton','Mercedes',0.96,44,'#101418','#00d2be','#f5d800'],
['George Russell','Mercedes',0.94,63,'#101418','#00d2be','#cfd6dd'],
['Lando Norris','McLaren',0.955,4,'#ff8000','#47c7fc','#ffa02e'],
['Oscar Piastri','McLaren',0.935,81,'#ff8000','#47c7fc','#e8e4da'],
['Fernando Alonso','Aston Martin',0.95,14,'#1d6f57','#cedc00','#2e6fd0'],
['Lance Stroll','Aston Martin',0.86,18,'#1d6f57','#cedc00','#8fd0c0'],
['Pierre Gasly','Alpine',0.90,10,'#0093cc','#ff87bc','#ff5f8a'],
['Esteban Ocon','Alpine',0.89,31,'#0093cc','#ff87bc','#5fb8e8'],
['Alexander Albon','Williams',0.91,23,'#0a2a4a','#64c4ff','#e8e8e8'],
['Logan Sargeant','Williams',0.80,2,'#0a2a4a','#64c4ff','#9fc4e8'],
['Valtteri Bottas','Sauber',0.87,77,'#00e701','#101418','#a8e8b0'],
['Zhou Guanyu','Sauber',0.84,24,'#00e701','#101418','#5f8a68'],
['Nico Hülkenberg','Haas',0.89,27,'#b6babd','#e10600','#d8d8d8'],
['Kevin Magnussen','Haas',0.86,20,'#b6babd','#e10600','#c8c8cc'],
['Daniel Ricciardo','RB',0.88,3,'#3b5bdb','#e8b83a','#f2f2f2'],
['Yuki Tsunoda','RB',0.87,22,'#3b5bdb','#e8b83a','#e84a4a'],
];

/* ============ OpenF1 API Loading and Elevation Helpers ============ */
let openF1Drivers = [];

async function loadOpenF1Drivers() {
  // Pre-downloaded roster + local headshot images (see scripts/fetch-openf1-data.mjs)
  // — instant, no OpenF1 dependency, no rate limiting. This is what ships to players.
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/drivers/manifest.json`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        openF1Drivers = data.map(d => ({ ...d, skill: rand(0.85, 1.0) }));
        console.log('Loaded drivers from local data:', openF1Drivers.length);
        return;
      }
    }
  } catch (err) { /* fall through to a live fetch */ }

  const cacheKey = 'openf1_drivers_cache_v2';
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      openF1Drivers = JSON.parse(cached);
      console.log('Loaded OpenF1 drivers from cache:', openF1Drivers.length);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    
    const res = await fetch('https://api.openf1.org/v1/drivers?session_key=latest', { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (res.status === 420) {
      console.warn('OpenF1 API 420 rate limit hit. Managing gracefully.');
      throw new Error('Rate limit 420');
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const uniqueDrivers = [];
      const seen = new Set();
      for (const d of data) {
        if (!d.driver_number || seen.has(d.driver_number)) continue;
        seen.add(d.driver_number);
        
        let color = d.team_colour ? `#${d.team_colour}` : null;
        if (color === '#null' || !d.team_colour) color = '#888888';
        const team = d.team_name || 'F1 Team';

        uniqueDrivers.push({
          name: d.full_name || d.broadcast_name || `${d.first_name} ${d.last_name}`,
          code: d.name_acronym || (d.last_name ? d.last_name.substring(0,3).toUpperCase() : 'DRV'),
          team,
          color: color,
          colB: accentFor(team, color),
          num: d.driver_number,
          headshot: d.headshot_url || null,
          skill: rand(0.85, 1.0)
        });
      }
      
      if (uniqueDrivers.length > 0) {
        openF1Drivers = uniqueDrivers;
        localStorage.setItem(cacheKey, JSON.stringify(openF1Drivers));
        console.log('Fetched & cached OpenF1 drivers:', openF1Drivers.length);
        return;
      }
    }
  } catch (err) {
    console.warn('OpenF1 fetch failed. Fallback to hardcoded list:', err.message);
  }
  
  generateFallbackDrivers();
}

function generateFallbackDrivers() {
  openF1Drivers = DRIVERS.map(d => {
    const name = d[0];
    const team = d[1];
    const skill = d[2];
    const num = d[3];
    const colA = d[4];
    const colB = d[5];
    const helmet = d[6];
    const code = name.split(' ').pop().substring(0,3).toUpperCase();
    return {
      name,
      code,
      team,
      color: colA,
      colB,
      num,
      headshot: null,
      skill,
      helmet
    };
  });
}

function getDriverHeadshot(d) {
  if (d.headshot && d.headshot.startsWith('http')) {
    return d.headshot;
  }
  if (d.headshot && d.headshot.startsWith('/')) {
    return import.meta.env.BASE_URL + d.headshot.slice(1);
  }
  const helmetColor = d.color || '#e10600';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="48" fill="#111319" stroke="${helmetColor}" stroke-width="4"/>
    <path d="M50 18 C32 18 22 28 22 50 C22 60 28 70 36 76 C39 78 42 74 42 70 L42 64 C42 62 45 60 50 60 C55 60 58 62 58 64 L58 70 C58 74 61 78 64 76 C72 70 78 60 78 50 C78 28 68 18 50 18 Z" fill="${helmetColor}"/>
    <path d="M30 42 C30 42 40 36 50 36 C60 36 70 42 70 42 C72 43 74 46 72 50 C70 54 60 56 50 56 C40 56 30 54 28 50 C26 46 28 43 30 42 Z" fill="#080a0f" stroke="#00f0ff" stroke-width="2"/>
    <path d="M42 21 C32 25 28 31 26 41" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" opacity="0.25"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getTrackElevation(u, trackName) {
  let y = 0;
  const angle = u * Math.PI * 2;
  
  if (trackName === 'Spa-Francorchamps') {
    y = Math.sin(angle) * 7.5 + Math.sin(angle * 2) * 3.5;
    if (u > 0.05 && u < 0.18) {
      const p = (u - 0.05) / 0.13;
      y += (p * p * (3 - 2 * p)) * 14.5;
    } else if (u >= 0.18 && u < 0.6) {
      y += 14.5 - (u - 0.18) / 0.42 * 14.5;
    }
  } else if (trackName === 'Monaco') {
    y = Math.sin(angle) * 4.5 + Math.cos(angle * 2) * 2.2;
  } else if (trackName === 'Red Bull Ring') {
    y = Math.sin(angle) * 11.5 + Math.sin(angle * 3) * 3.2;
  } else if (trackName === 'Monza') {
    y = Math.sin(angle) * 1.8 + Math.sin(angle * 3) * 0.7;
  } else if (trackName === 'Silverstone') {
    y = Math.sin(angle) * 2.2 + Math.cos(angle * 2) * 1.1;
  } else if (trackName === 'Suzuka') {
    y = Math.sin(angle) * 3.2;
    if (u > 0.42 && u < 0.58) {
      const p = Math.sin((u - 0.42) / 0.16 * Math.PI);
      y += p * 7.8;
    }
  } else {
    y = Math.sin(angle) * 3.5;
  }
  
  y += Math.sin(angle * 12) * 0.35;
  y += Math.sin(angle * 56) * 0.07;
  return y;
}

// Scenery (trees/buildings) sit visually on the ground mesh, so they should
// match ITS height — including the clearance dropped below the road so
// nothing pokes through the tarmac.
function getTrackHAtCoords(x, z) {
  if (!T || !T.samples) return 0;
  if (T.terrainHeightAt) return T.terrainHeightAt(x, z);
  let bestDist = 1e9, bestH = 0;
  for (let i = 0; i < T.N; i += 8) {
    const p = T.samples[i].p;
    const d = (p.x - x)**2 + (p.z - z)**2;
    if (d < bestDist) {
      bestDist = d;
      bestH = p.y;
    }
  }
  return bestH;
}

// Cars, by contrast, must sit on the actual road surface — never offset by
// the ground mesh's clearance, or they sink below the track and disappear.
function getRoadHAtCoords(x, z) {
  if (!T || !T.samples) return 0;
  if (T.trueTrackHeightAt) return T.trueTrackHeightAt(x, z);
  return getTrackHAtCoords(x, z);
}

/* ============ weather ============ */
const WX={
sun:{label:'SUNNY',skyT:0x2f6fce,skyH:0xbfd9e8,sunC:0xfff1d0,sunI:2.6,hS:0xbdd7ee,hG:0x6f9457,hI:.8,fog:0xbfd9e8,fogD:.0005,exp:1.12,grip:1,rain:0,snow:0,wet:0},
driz:{label:'DRIZZLE',skyT:0x5f7488,skyH:0xaeb9c2,sunC:0xd9e2ea,sunI:1.8,hS:0xafc0cd,hG:0x668068,hI:.7,fog:0xaeb9c2,fogD:.0009,exp:1.04,grip:.84,rain:.35,snow:0,wet:.45},
rain:{label:'RAIN',skyT:0x5b6a76,skyH:0xacb8c1,sunC:0xd8e0e6,sunI:2.6,hS:0xc8d1d9,hG:0x8fac91,hI:1.25,fog:0xacb8c1,fogD:.0007,exp:1.5,grip:.72,rain:1,snow:0,wet:1},
snow:{label:'SNOW',skyT:0x8ea3b8,skyH:0xe8eef4,sunC:0xeef3f8,sunI:1.4,hS:0xcdd8e2,hG:0xb9c4cc,hI:.85,fog:0xe8eef4,fogD:.0018,exp:1.05,grip:.55,rain:0,snow:1,wet:.15}};
const ICONS={
sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M19.1 4.9l-1.9 1.9M6.8 17.2l-1.9 1.9"/></svg>',
driz:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 15h11a3.5 3.5 0 0 0 .6-6.95A5.5 5.5 0 0 0 7 6.6 4 4 0 0 0 6 15Z"/><path d="M9 18v1.6M13 18v2.4M17 18v1.6"/></svg>',
rain:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 14h11a3.5 3.5 0 0 0 .6-6.95A5.5 5.5 0 0 0 7 5.6 4 4 0 0 0 6 14Z"/><path d="M8 17l-1.4 3.4M12.5 17l-1.4 3.4M17 17l-1.4 3.4"/></svg>',
snow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17"/></svg>'};

/* ============ speech / commentary ============ */
const Speech={enabled:true,cool:0,voice:null,
refresh(){try{
 const vs=speechSynthesis.getVoices();if(!vs.length)return;
 const score=v=>{let s=0;
  const name=v.name.toLowerCase();
  const lang=v.lang.toLowerCase();
  if(lang.startsWith('en-gb'))s+=50;
  else if(lang.startsWith('en'))s+=20;
  if(name.includes('natural'))s+=100;
  if(name.includes('premium'))s+=80;
  if(name.includes('google'))s+=60;
  if(name.includes('neural'))s+=50;
  // Prefer a male-sounding voice for the commentator — a broadcast-caller
  // baritone reads more like a real F1 broadcast. Explicit "male"/"female"
  // tags win outright; otherwise fall back to common per-platform voice names.
  if(/\bmale\b/.test(name)&&!/female/.test(name))s+=300;
  else if(/female/.test(name))s-=300;
  else if(/(daniel|george|david|arthur|james|oliver|ryan|guy|christopher|eric|fred|alex|thomas|nathan)/i.test(name))s+=120;
  else if(/(samantha|hazel|serena|victoria|kate|karen|moira|tessa|susan|zira|aria|jenny|michelle|fiona|zoe)/i.test(name))s-=120;
  return s;};
 vs.sort((a,b)=>score(b)-score(a));
 this.voice=vs[0];
}catch(e){}},
init(){try{this.refresh();speechSynthesis.onvoiceschanged=()=>this.refresh();}catch(e){}},
say(text,force,opts){
 if(!this.enabled||!('speechSynthesis'in window))return;
 const t=nowT();if(!force&&t<this.cool)return;this.cool=t+1.4;
 try{
  if(speechSynthesis.speaking){if(force)speechSynthesis.cancel();else return;}
  const u=new SpeechSynthesisUtterance(text);
  if(this.voice)u.voice=this.voice;
  u.lang=(this.voice&&this.voice.lang)||'en-GB';
  // A punchier baseline rate/pitch than a flat narrator — individual lines
  // (lights out, overtakes, crashes) already push these higher still for
  // their moment, this just raises the resting energy level between them.
  u.rate=(opts&&opts.rate!=null)?opts.rate:1.06;
  u.pitch=(opts&&opts.pitch!=null)?opts.pitch:1.05;
  u.volume=1.0;
  speechSynthesis.speak(u);
 }catch(e){}}};
Speech.init();
const LINES={
start:['Lights out and away we go!','And it is lights out — we are racing!'],
overtake:['Lovely move! Up to P{n}!','She is through — P{n}!','Down the inside, and it sticks — P{n}!'],
podium:['That is a podium position — brilliant driving!'],
lead:['You are leading this Grand Prix. Keep it clean.'],
fastest:['Fastest lap of the race — stunning pace.'],
final:['Final lap! Give it everything you have left.'],
win:['You win the Grand Prix! What a drive!'],
finish:['Chequered flag! A superb drive to P{n}.','Chequered flag! P{n} — the team is delighted.'],
hit:['Ooh, heavy contact! She is still running, keep it together.'],
};
const ATT_LINES=[
'Welcome to {track}, for the Polygon Grand Prix.',
'{leader} leads the field around {track} this afternoon.',
'Just listen to these engines — screaming all the way to fifteen thousand.',
'Look at those skies above {loc}. A proper test of nerve.',
'Twenty cars, one apex. This is Polygon GP.'];
const ENCOURAGE_LINES=[
'Good luck out there, {name}. Take a breath, trust your lines, and enjoy every lap.',
'Alright {name}, the team believes in you. Smooth is fast — go get it.',
'{name}, you have got this. Drive your own race and the rest will follow.',
'Welcome to the grid, {name}. However it goes, be proud of getting out there.',
'{name}, nice and easy on the first lap, then let it flow. We are right behind you.'];
let lastEncouragedName='';

/* ============ renderer / scene ============ */
const renderer=new THREE.WebGLRenderer({canvas:$('gl'),antialias:true,powerPreference:'high-performance'});
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(62,1,0.3,6000);
const SUNDIR=V3(0.42,0.55,0.25).normalize();
const sunLight=new THREE.DirectionalLight(0xfff1d0,2.6);
sunLight.castShadow=true;sunLight.shadow.mapSize.set(2048,2048);
// Sized well beyond the old ~600m mini-tracks: a fast chase cam on a real,
// full-length circuit can see much further down a straight, and anything
// outside the shadow camera's frustum can come back falsely shadowed.
const sc=sunLight.shadow.camera;sc.left=-260;sc.right=260;sc.top=260;sc.bottom=-260;sc.near=40;sc.far=900;
sunLight.shadow.bias=-0.0004;sunLight.shadow.normalBias=0.5;
scene.add(sunLight,sunLight.target);
const hemi=new THREE.HemisphereLight(0xbdd7ee,0x6f9457,0.8);scene.add(hemi);
scene.fog=new THREE.FogExp2(0xbfd9e8,0.0005);
const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
uniforms:{topC:{value:new THREE.Color(0x2f6fce)},horC:{value:new THREE.Color(0xbfd9e8)},sunD:{value:SUNDIR},sunC:{value:new THREE.Color(0xfff1d0).multiplyScalar(2)}},
vertexShader:'varying vec3 vW;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vW=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}',
fragmentShader:`uniform vec3 topC;uniform vec3 horC;uniform vec3 sunD;uniform vec3 sunC;varying vec3 vW;
void main(){vec3 d=normalize(vW);float t=pow(clamp(max(d.y,0.0)*1.4,0.0,1.0),0.72);
vec3 col=mix(horC,topC,t);float s=clamp(dot(d,sunD),0.0,1.0);
col+=sunC*(pow(s,600.0)*0.9+pow(s,6.0)*0.10);
if(d.y<0.0)col=mix(col,horC*0.85,clamp(-d.y*6.0,0.0,1.0));
gl_FragColor=vec4(col,1.0);}`});
const skyGeo=new THREE.SphereGeometry(2600,24,12);
scene.add(new THREE.Mesh(skyGeo,skyMat));
const envScene=new THREE.Scene();envScene.add(new THREE.Mesh(skyGeo,skyMat));
const pmrem=new THREE.PMREMGenerator(renderer);
let envRT=null;
function refreshEnv(){try{if(envRT)envRT.dispose();envRT=pmrem.fromScene(envScene,0.05);scene.environment=envRT.texture;}catch(e){}}

/* ============ canvas textures ============ */
function ctex(c,rep){const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
 if(rep)t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;}
function mkCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return[c,c.getContext('2d')];}

// High-fidelity asphalt with rubbered racing line & bitumen aggregates.
// Fine per-pixel speckle alone mips down into a flat grey at any real camera
// distance — the larger-scale patches, streaks and cracks are what stay
// visible and keep the surface from reading as flat.
const[ac,ag]=mkCanvas(768,768);
ag.fillStyle='#3c3f43';ag.fillRect(0,0,768,768);
// Large tonal patches — sun-bleached / resurfaced sections
for(let i=0;i<26;i++){
  const g=36+Math.random()*26|0;
  ag.fillStyle=`rgba(${g+14},${g+14},${g+16},0.5)`;
  ag.beginPath();ag.ellipse(Math.random()*768,Math.random()*768,rand(40,120),rand(30,90),Math.random()*7,0,7);ag.fill();
}
for(let i=0;i<40000;i++){
  const g=38+Math.random()*48|0;
  ag.fillStyle=`rgb(${g},${g},${g})`;
  ag.fillRect(Math.random()*768,Math.random()*768,rand(1.2,2.6),rand(1.2,2.6));
}
// Hairline cracks
ag.strokeStyle='rgba(20,21,24,0.4)';ag.lineWidth=1;
for(let i=0;i<50;i++){
  let x=Math.random()*768,y=Math.random()*768;
  ag.beginPath();ag.moveTo(x,y);
  for(let k=0;k<rand(3,7);k++){x+=rand(-30,30);y+=rand(-30,30);ag.lineTo(x,y);}
  ag.stroke();
}
// Dark rubbered racing lines (left and right tire tracks)
ag.fillStyle='rgba(16,18,22,0.42)';
ag.fillRect(195,0,126,768);
ag.fillRect(447,0,126,768);
// Oil/rubber staining blotches along the racing line
for(let i=0;i<30;i++){
  ag.fillStyle='rgba(10,11,13,0.25)';
  ag.beginPath();ag.arc(pick([258,510])+rand(-40,40),Math.random()*768,rand(8,26),0,7);ag.fill();
}
// Crisp high-contrast white edge track boundary markings
ag.fillStyle='#ecebe6';
ag.fillRect(15,0,15,768);
ag.fillRect(738,0,15,768);
// Intermittent grid slot markings
ag.fillStyle='rgba(235,235,230,0.45)';
ag.fillRect(240,180,288,12);
ag.fillRect(240,570,288,12);
const asphaltT=ctex(ac,true);

// High-fidelity lush grass & soil texture — multi-scale: fine speckle for
// close-up detail, plus large mottled patches and streaks so it still reads
// as textured (not a flat green wash) from a normal driving/chase distance.
const[gc,gg]=mkCanvas(768,768);
gg.fillStyle='#4c7d3d';gg.fillRect(0,0,768,768);
// Large-scale mottled patches (dry/lush/shaded variation)
for(let i=0;i<90;i++){
  const tone=pick([[70,55,30,0.28],[95,140,70,0.22],[35,55,28,0.3],[110,150,90,0.18]]);
  gg.fillStyle=`rgba(${tone[0]},${tone[1]},${tone[2]},${tone[3]})`;
  gg.beginPath();gg.ellipse(Math.random()*768,Math.random()*768,rand(30,95),rand(20,70),Math.random()*7,0,7);gg.fill();
}
for(let i=0;i<28000;i++){
  const g=85+Math.random()*55|0;
  const r=65+Math.random()*35|0;
  const b=40+Math.random()*25|0;
  gg.fillStyle=`rgb(${r},${g},${b})`;
  gg.fillRect(Math.random()*768,Math.random()*768,rand(2.0,3.6),rand(2.0,3.6));
}
// Short directional blade strokes for a less uniform, less "flat" look
gg.strokeStyle='rgba(35,60,28,0.35)';gg.lineWidth=1.4;
for(let i=0;i<3000;i++){
  const x=Math.random()*768,y=Math.random()*768,a=rand(0,Math.PI),l=rand(2,5);
  gg.beginPath();gg.moveTo(x,y);gg.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l);gg.stroke();
}
for(let i=0;i<65;i++){
  gg.fillStyle='rgba(42,65,32,0.22)';
  gg.beginPath();
  gg.arc(Math.random()*768,Math.random()*768,rand(14,50),0,7);
  gg.fill();
}
const grassT=ctex(gc,true);grassT.repeat.set(120,120);

// High-fidelity procedurally generated Bump/Normal textures for road roughness and terrain clumping
const [acBump, agBump] = mkCanvas(128, 128);
agBump.fillStyle = '#808080';
agBump.fillRect(0,0,128,128);
for(let i=0; i<4000; i++){
  const gray = 128 + (Math.random()*40 - 20) | 0;
  agBump.fillStyle = `rgb(${gray},${gray},${gray})`;
  agBump.fillRect(Math.random()*128, Math.random()*128, rand(1, 2.5), rand(1, 2.5));
}
const asphaltBumpT = ctex(acBump, true);
asphaltBumpT.repeat.set(24, 24);

const [gcBump, ggBump] = mkCanvas(256, 256);
ggBump.fillStyle = '#808080';
ggBump.fillRect(0,0,256,256);
for(let i=0; i<250; i++){
  const r = rand(6, 18);
  const gray = 128 + rand(-25, 25) | 0;
  ggBump.fillStyle = `rgb(${gray},${gray},${gray})`;
  ggBump.beginPath();
  ggBump.arc(Math.random()*256, Math.random()*256, r, 0, Math.PI*2);
  ggBump.fill();
}
const grassBumpT = ctex(gcBump, true);
grassBumpT.repeat.set(120, 120);
const[cc,cg]=mkCanvas(64,64);
cg.fillStyle='#d81f2a';cg.fillRect(0,0,64,32);cg.fillStyle='#ecebe6';cg.fillRect(0,32,64,32);
const curbT=ctex(cc,true);
const[wc,wg]=mkCanvas(1024,128);
const ADS=[['POLYGON GP','#e9e9e9','#101114'],['APEX FUEL','#e10600','#ffffff'],['SPARKY','#ffd9af','#8c4f2c'],['VANTAGE TYRES','#ffd23f','#101114'],['NOVA ENERGY','#0f7a4a','#ffffff'],["END OF ROAD FEST '26",'#d9486b','#ffffff'],['GET THIS APP!','#efa733','#101114'],['DRIFT KING','#e10600','#ffffff']];
// A small Sparky-the-sparrow silhouette badge in the corner of every board —
// drawn in the same color as that tile's text so it always reads clearly
// against its own background.
function drawAdBird(cx,x,y,s,color){
 cx.save();cx.translate(x,y);cx.scale(s,s);cx.fillStyle=color;
 cx.beginPath();cx.ellipse(0,0,7,5,0,0,Math.PI*2);cx.fill();
 cx.beginPath();cx.arc(6.5,-3,3.4,0,Math.PI*2);cx.fill();
 cx.beginPath();cx.moveTo(9.4,-3);cx.lineTo(13.5,-1.9);cx.lineTo(9.4,-1);cx.closePath();cx.fill();
 cx.beginPath();cx.moveTo(-2,-1);cx.quadraticCurveTo(-8,-6.5,-11.5,-2);cx.quadraticCurveTo(-6,1,-2,3);cx.closePath();cx.fill();
 cx.beginPath();cx.moveTo(-7,1);cx.lineTo(-14.5,-1.2);cx.lineTo(-13,4.2);cx.closePath();cx.fill();
 cx.restore();
}
for(let i=0;i<8;i++){const[t,bg,fg]=ADS[i];wg.fillStyle=bg;wg.fillRect(i*128,0,128,128);
 wg.fillStyle=fg;wg.font='italic 700 24px sans-serif';wg.textAlign='center';wg.textBaseline='middle';
 wg.save();wg.translate(i*128+64,70);wg.rotate(-0.05);wg.fillText(t,0,0,104);wg.restore();
 drawAdBird(wg,i*128+22,26,1.2,fg);
 wg.fillStyle='rgba(0,0,0,.25)';wg.fillRect(i*128,118,128,10);}
const adsT=ctex(wc,true);
adsT.repeat.set(1/8,1);
// Building facade — richer than a flat grid of squares: panel banding,
// mullions between windows, and a few warm/cool lit-window tones instead of
// one flat gold.
const[bc,bgc]=mkCanvas(128,256);
bgc.fillStyle='#363b42';bgc.fillRect(0,0,128,256);
for(let y=0;y<32;y++){
 bgc.fillStyle=`rgba(0,0,0,${y%4===0?0.22:0.05})`;bgc.fillRect(0,y*8,128,1);
}
for(let y=0;y<32;y++)for(let x=0;x<16;x++){
 const r=Math.random();
 const litColor=r<0.16?'#f2d98a':r<0.24?'#bcd6ea':'#20242a';
 bgc.fillStyle=litColor;bgc.fillRect(x*8+1.2,y*8+1.2,5.6,5.6);
}
const winT=ctex(bc,true);winT.repeat.set(2,4);
const[kc,kg]=mkCanvas(64,16);
for(let x=0;x<8;x++)for(let y=0;y<2;y++){kg.fillStyle=(x+y)%2?'#e8e8e8':'#101114';kg.fillRect(x*8,y*8,8,8);}
const checkT=ctex(kc,true);checkT.repeat.set(4,1);
const[pc,pg]=mkCanvas(64,64);
const grd=pg.createRadialGradient(32,32,2,32,32,30);grd.addColorStop(0,'rgba(255,255,255,1)');grd.addColorStop(1,'rgba(255,255,255,0)');
pg.fillStyle=grd;pg.fillRect(0,0,64,64);
const softT=ctex(pc,false);
function bannerTex(name){const[cn,cx]=mkCanvas(1024,96);
 cx.fillStyle='#101216';cx.fillRect(0,0,1024,96);
 cx.fillStyle='#e10600';cx.fillRect(0,0,26,96);cx.fillRect(998,0,26,96);
 cx.fillStyle='#f4f1ea';cx.font='italic 700 52px sans-serif';cx.textAlign='center';cx.textBaseline='middle';
 cx.fillText(name.toUpperCase()+' · POLYGON GP',512,52,940);return ctex(cn,false);}
const numCache=new Map();
function numTex(n){if(numCache.has(n))return numCache.get(n);
 const[cn,cx]=mkCanvas(64,64);cx.clearRect(0,0,64,64);
 cx.fillStyle='#f2f2f2';cx.beginPath();cx.arc(32,32,29,0,7);cx.fill();
 cx.fillStyle='#101114';cx.font='700 36px sans-serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(n,32,34);
 const t=ctex(cn,false);numCache.set(n,t);return t;}

/* ============ car geometry ============ */
const matBody=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:0.25,metalness:0.35,envMapIntensity:1.1});
const matWheel=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.55,metalness:0.15,envMapIntensity: 0.8});
function tint(geo,color){const col=new THREE.Color(color);const n=geo.attributes.position.count;
 const a=new Float32Array(n*3);for(let i=0;i<n;i++){a[i*3]=col.r;a[i*3+1]=col.g;a[i*3+2]=col.b;}
 geo.setAttribute('color',new THREE.BufferAttribute(a,3));return geo;}
function part(geo,color,x,y,z,rx=0,ry=0,rz=0){geo.rotateZ(rz);geo.rotateY(ry);geo.rotateX(rx);geo.translate(x,y,z);tint(geo,color);return geo;}
const bodyCache=new Map();
export function getBodyGeo(colA,colB){
 const key=colA+colB;if(bodyCache.has(key))return bodyCache.get(key);
 const P=[];const B=(w,h,d,c,x,y,z,rx=0,ry=0,rz=0)=>P.push(part(new THREE.BoxGeometry(w,h,d),c,x,y,z,rx,ry,rz));
 const C=(rt,rb,h,seg,c,x,y,z,rx=0)=>P.push(part(new THREE.CylinderGeometry(rt,rb,h,seg),c,x,y,z,rx));
 B(1.55,0.07,3.6,'#15161a',0,0.14,0.15);
 B(0.72,0.34,2.2,colA,0,0.42,0.75);
 C(0.07,0.19,1.5,8,colA,0,0.42,2.1,Math.PI/2);
 B(1.95,0.045,0.62,colB,0,0.12,2.62);B(1.95,0.035,0.3,colB,0,0.2,2.42,-0.25);
 B(0.03,0.22,0.62,colB,0.97,0.18,2.62);B(0.03,0.22,0.62,colB,-0.97,0.18,2.62);
 B(0.78,0.2,1.0,colA,0,0.58,0.55);B(0.5,0.1,0.9,'#101114',0,0.66,0.55);
 // Halo protection structure — a real halo shape: a front arc, a single
 // forward spine down to the nose bulkhead, two rear struts down to the
 // chassis sides, and a rear cross-brace tying those struts together (the
 // "cross piece" that reads clearly even at a distance) — sitting close
 // over the cockpit rim rather than floating high above the driver's head.
 P.push(part(new THREE.TorusGeometry(0.29,0.045,6,14,Math.PI),'#202226',0,0.64,0.48));
 C(0.04,0.04,0.32,6,'#202226',0,0.5,0.85,-0.32);
 C(0.035,0.035,0.24,6,'#202226',0.24,0.52,0.36,0,0,0.42);
 C(0.035,0.035,0.24,6,'#202226',-0.24,0.52,0.36,0,0,-0.42);
 B(0.48,0.035,0.035,'#202226',0,0.5,0.36);
 
 // Engine cover & sidepods
 C(0.09,0.3,1.9,8,colA,0,0.5,-0.95,-Math.PI/2);
 B(0.035,0.4,1.1,colA,0,0.86,-1.35);
 B(0.5,0.32,1.5,colA,0.62,0.4,-0.25);B(0.5,0.32,1.5,colA,-0.62,0.4,-0.25);
 B(0.5,0.22,0.1,'#101114',0.62,0.45,0.52);B(0.5,0.22,0.1,'#101114',-0.62,0.45,0.52);
 B(1.5,0.05,0.42,colB,0,0.86,-2.35,0.16);
 B(1.5,0.04,0.25,'#202226',0,0.6,-2.42);
 B(0.035,0.42,0.55,colB,0.76,0.82,-2.35);B(0.035,0.42,0.55,colB,-0.76,0.82,-2.35);
 B(0.06,0.3,0.3,'#202226',0,0.7,-2.28);
 B(1.4,0.18,0.5,'#15161a',0,0.2,-2.1,0.35);
 B(0.14,0.08,0.05,colB,0.45,0.66,0.95);B(0.14,0.08,0.05,colB,-0.45,0.66,0.95);
 C(0.05,0.06,0.25,6,'#7a7d82',0.16,0.52,-2.02,Math.PI/2);
 for(const sz of[1.62,-1.62])for(const sx of[1,-1]){
  B(0.55,0.028,0.05,'#26282c',sx*0.52,0.46,sz*0.96,0,0,sx*0.28);
  B(0.55,0.028,0.05,'#26282c',sx*0.52,0.3,sz*0.96,0,0,-sx*0.2);}
 const g=mergeGeometries(P,false);bodyCache.set(key,g);return g;
}

// Build articulated Driver with Suit, Shoulders, Arms, Steering Wheel, and Helmet with Visor
export function makeDriverMesh(colA, helmetCol){
  const driverGroup = new THREE.Group();
  
  // 1. Driver Body & Racing Harness in Cockpit
  const suitParts = [];
  const SB = (w,h,d,c,x,y,z,rx=0,ry=0,rz=0)=>suitParts.push(part(new THREE.BoxGeometry(w,h,d),c,x,y,z,rx,ry,rz));
  // Torso / Shoulders
  SB(0.42, 0.32, 0.35, colA, 0, 0.46, 0.28, -0.22);
  // Harness straps
  SB(0.08, 0.34, 0.36, '#e10600', -0.12, 0.46, 0.28, -0.22);
  SB(0.08, 0.34, 0.36, '#e10600', 0.12, 0.46, 0.28, -0.22);
  // Arms reaching for steering wheel
  SB(0.09, 0.09, 0.36, colA, -0.22, 0.48, 0.48, 0.35, -0.2);
  SB(0.09, 0.09, 0.36, colA, 0.22, 0.48, 0.48, 0.35, 0.2);
  // Racing gloves
  SB(0.1, 0.08, 0.1, '#17181c', -0.18, 0.52, 0.65);
  SB(0.1, 0.08, 0.1, '#17181c', 0.18, 0.52, 0.65);
  // F1 Steering wheel with digital display
  SB(0.32, 0.16, 0.04, '#17181c', 0, 0.52, 0.68, 0.3);
  SB(0.14, 0.08, 0.05, '#00f0ff', 0, 0.53, 0.68, 0.3);

  const suitMesh = new THREE.Mesh(mergeGeometries(suitParts, false), matBody);
  suitMesh.castShadow = true;
  driverGroup.add(suitMesh);

  // 2. Articulated Head & Aerodynamic Helmet
  const helmetGroup = new THREE.Group();
  helmetGroup.position.set(0, 0.64, 0.34); // Neck pivot point
  
  const hParts = [];
  // Spherical aero shell
  hParts.push(part(new THREE.SphereGeometry(0.165, 10, 8), helmetCol, 0, 0.08, 0));
  // Chin bar / mouth guard
  hParts.push(part(new THREE.BoxGeometry(0.22, 0.12, 0.2), helmetCol, 0, 0.02, 0.09));
  // Hans device collar
  hParts.push(part(new THREE.CylinderGeometry(0.14, 0.16, 0.08, 8), '#202226', 0, -0.02, 0));
  // Top aero spoiler fin
  hParts.push(part(new THREE.BoxGeometry(0.03, 0.04, 0.16), '#17181c', 0, 0.23, -0.02));
  // Tinted Iridium Visor
  hParts.push(part(new THREE.BoxGeometry(0.24, 0.08, 0.1), '#1a1d24', 0, 0.09, 0.13, 0.08));
  hParts.push(part(new THREE.PlaneGeometry(0.22, 0.065), '#00f0ff', 0, 0.09, 0.185, 0.08));

  const helmetMesh = new THREE.Mesh(mergeGeometries(hParts, false), matBody);
  helmetMesh.castShadow = true;
  helmetGroup.add(helmetMesh);

  driverGroup.add(helmetGroup);

  return { driverGroup, helmetGroup };
}

let axleGeo=null;
export function getAxleGeo(){if(axleGeo)return axleGeo;
 const tire=part(new THREE.CylinderGeometry(0.37,0.37,0.34,10),'#17181a',0,0,0,0,0,Math.PI/2);
 const rim=part(new THREE.CylinderGeometry(0.23,0.23,0.35,9),'#b9bcc2',0,0,0,0,0,Math.PI/2);
 const w=mergeGeometries([tire,rim],false);
 const w1=w.clone();w1.translate(-0.82,0,0);const w2=w.clone();w2.translate(0.82,0,0);
 axleGeo=mergeGeometries([w1,w2],false);return axleGeo;}
const drsGeo=new THREE.BoxGeometry(1.42,0.03,0.26);
function makeCarMesh(d){
 const g=new THREE.Group();
 const body=new THREE.Mesh(getBodyGeo(d.colA,d.colB),matBody);body.castShadow=true;
 const { driverGroup, helmetGroup } = makeDriverMesh(d.colA, d.helmet);
 const axleF=new THREE.Mesh(getAxleGeo(),matWheel);axleF.rotation.order='YXZ';axleF.position.set(0,0.37,1.62);
 const axleR=new THREE.Mesh(getAxleGeo(),matWheel);axleR.position.set(0,0.37,-1.62);
 const drs=new THREE.Mesh(drsGeo,new THREE.MeshStandardMaterial({color:d.colB,flatShading:true,roughness:0.4}));
 drs.position.set(0,1.0,-2.42);
 // Rear brake light — lights up under braking in any weather, and also
 // doubles as the FIA-style flashing rain light when wet and off the
 // brakes, like the real cars' LED strip (a separate light mounted high
 // over the rear wing just read as a stray flashing blob at car scale).
 const brakeLight=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.08,0.03),new THREE.MeshStandardMaterial({color:0x2a0000,emissive:0xff0000,emissiveIntensity:0,roughness:0.4}));
 brakeLight.position.set(0,0.56,-2.56);
 const nT=numTex(d.num);
 for(const sx of[1,-1]){const p=new THREE.Mesh(new THREE.PlaneGeometry(0.3,0.3),new THREE.MeshBasicMaterial({map:nT,transparent:true}));
  p.position.set(sx*0.885,0.44,-0.25);p.rotation.y=sx*Math.PI/2;g.add(p);}
 g.add(body,driverGroup,axleF,axleR,drs,brakeLight);
 return{g,body,driverGroup,helmetGroup,axleF,axleR,drs,brakeLight};
}

/* ============ particles ============ */
function makePointsSys(n,blending){
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3).setUsage(THREE.DynamicDrawUsage));
 g.setAttribute('aSize',new THREE.BufferAttribute(new Float32Array(n),1).setUsage(THREE.DynamicDrawUsage));
 g.setAttribute('aAlpha',new THREE.BufferAttribute(new Float32Array(n),1).setUsage(THREE.DynamicDrawUsage));
 g.setAttribute('aColor',new THREE.BufferAttribute(new Float32Array(n*3),3).setUsage(THREE.DynamicDrawUsage));
 const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending,
  vertexShader:`attribute float aSize;attribute float aAlpha;attribute vec3 aColor;varying float vA;varying vec3 vC;
  void main(){vA=aAlpha;vC=aColor;vec4 mv=modelViewMatrix*vec4(position,1.0);
  gl_PointSize=aSize*(260.0/max(1.0,-mv.z));gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`varying float vA;varying vec3 vC;
  void main(){vec2 d=gl_PointCoord-0.5;float a=smoothstep(0.5,0.12,length(d))*vA;
  if(a<0.012)discard;gl_FragColor=vec4(vC,a);}`});
 const pts=new THREE.Points(g,m);pts.frustumCulled=false;scene.add(pts);
 return{g,pts,n,i:0,px:new Float32Array(n),py:new Float32Array(n),pz:new Float32Array(n),
  vx:new Float32Array(n),vy:new Float32Array(n),vz:new Float32Array(n),
  life:new Float32Array(n),dec:new Float32Array(n),s0:new Float32Array(n),grav:new Float32Array(n)};
}
const smoke=makePointsSys(700,THREE.NormalBlending);smoke.pts.renderOrder=3;
const sparks=makePointsSys(160,THREE.AdditiveBlending);
function puff(S,x,y,z,vx,vy,vz,size,life,r,g,b,grav=0){
 const i=S.i;S.i=(S.i+1)%S.n;
 S.px[i]=x;S.py[i]=y;S.pz[i]=z;S.vx[i]=vx;S.vy[i]=vy;S.vz[i]=vz;
 S.life[i]=1;S.dec[i]=1/life;S.s0[i]=size;S.grav[i]=grav;
 const c=S.g.attributes.aColor;c.array[i*3]=r;c.array[i*3+1]=g;c.array[i*3+2]=b;c.needsUpdate=true;
}
const smk=(...a)=>puff(smoke,...a);
function updPoints(S,dt,grow){
 const P=S.g.attributes.position,A=S.g.attributes.aAlpha,Sz=S.g.attributes.aSize;
 for(let i=0;i<S.n;i++){
  if(S.life[i]<=0)continue;
  S.life[i]-=S.dec[i]*dt;
  if(S.life[i]<=0){A.array[i]=0;continue;}
  S.px[i]+=S.vx[i]*dt;S.py[i]+=S.vy[i]*dt;S.pz[i]+=S.vz[i]*dt;
  S.vy[i]+=S.grav[i]*dt;S.vx[i]*=0.985;S.vz[i]*=0.985;
  P.array[i*3]=S.px[i];P.array[i*3+1]=S.py[i];P.array[i*3+2]=S.pz[i];
  A.array[i]=Math.min(S.life[i]*1.6,1)*0.5;
  Sz.array[i]=S.s0[i]*(1+(1-S.life[i])*grow);
 }
 P.needsUpdate=true;A.needsUpdate=true;Sz.needsUpdate=true;
}
function sparkBurst(x,y,z,amt){for(let i=0;i<amt*12;i++)
 puff(sparks,x,y,z,rand(-6,6),rand(1,7),rand(-6,6),rand(0.5,1.2),rand(.2,.45),1,.75,.35,-22);}
function confetti(x,y,z){for(let i=0;i<130;i++){const c=new THREE.Color().setHSL(Math.random(),0.85,0.6);
 smk(x+rand(-3,3),y+rand(2,7),z+rand(-3,3),rand(-4,4),rand(1,5),rand(-4,4),rand(1,2),rand(1.4,2.6),c.r,c.g,c.b,-3);}}

/* skid marks (ring buffer) */
const skidMax=1500;
const skidMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(0.34,1).rotateX(-Math.PI/2),
 new THREE.MeshBasicMaterial({color:0x0c0d0e,transparent:true,opacity:0.32,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),skidMax);
skidMesh.frustumCulled=false;skidMesh.renderOrder=1;
{const z=new THREE.Matrix4().makeScale(0,0,0);for(let i=0;i<skidMax;i++)skidMesh.setMatrixAt(i,z);}
scene.add(skidMesh);
let skidI=0;const skidDummy=new THREE.Object3D();
function addSkid(x,z,ang,len,isMud=false){
 skidDummy.position.set(x,0.14+(skidI%7)*0.006,z);
 skidDummy.rotation.set(0,ang,0);skidDummy.scale.set(1,1,len);skidDummy.updateMatrix();
 skidMesh.setMatrixAt(skidI%skidMax,skidDummy.matrix);
 if(isMud) skidMesh.setColorAt(skidI%skidMax, new THREE.Color(0x3e2b1d));
 else skidMesh.setColorAt(skidI%skidMax, new THREE.Color(0x0c0d0e));
 skidI++;
 skidMesh.instanceMatrix.needsUpdate=true;
 skidMesh.instanceColor.needsUpdate = true;
}
function clearSkids(){const z=new THREE.Matrix4().makeScale(0,0,0);
 for(let i=0;i<skidMax;i++)skidMesh.setMatrixAt(i,z);skidMesh.instanceMatrix.needsUpdate=true;skidI=0;}

/* rain + snow world FX */
const RAIN_N=1000;
const rainGeo=new THREE.BufferGeometry();
rainGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(RAIN_N*6),3).setUsage(THREE.DynamicDrawUsage));
const rainMat = new THREE.LineBasicMaterial({color:0x9db4c8,transparent:true,opacity:0.45});
const rainMesh=new THREE.LineSegments(rainGeo,rainMat);
rainMesh.frustumCulled=false;scene.add(rainMesh);
const rainP=new Float32Array(RAIN_N*3);
for(let i=0;i<RAIN_N;i++){rainP[i*3]=rand(-30,30);rainP[i*3+1]=rand(0,26);rainP[i*3+2]=rand(-30,30);}

const SNOW_N=1000;
const snowGeo=new THREE.BufferGeometry();
snowGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(SNOW_N*3),3).setUsage(THREE.DynamicDrawUsage));
const snowMesh=new THREE.Points(snowGeo,new THREE.PointsMaterial({map:softT,size:0.55,transparent:true,depthWrite:false,opacity:0.9}));
snowMesh.frustumCulled=false;scene.add(snowMesh);
const snowP=new Float32Array(SNOW_N*3),snowPh=new Float32Array(SNOW_N);
for(let i=0;i<SNOW_N;i++){snowP[i*3]=rand(-35,35);snowP[i*3+1]=rand(0,26);snowP[i*3+2]=rand(-35,35);snowPh[i]=rand(0,9);}

function updWeatherFX(dt){
 const cx=camera.position.x,cz=camera.position.z;
 const rp=rainGeo.attributes.position.array;
 rainMesh.visible=cur.rain>0.03;snowMesh.visible=cur.snow>0.03;
 if(rainMesh.visible){
  for(let i=0;i<RAIN_N;i++){
   rainP[i*3+1]-=(52+cur.rain*14)*dt;
   if(rainP[i*3+1]<0){rainP[i*3+1]+=26;rainP[i*3]=rand(-30,30);rainP[i*3+2]=rand(-30,30);}
   const x=cx+rainP[i*3],y=rainP[i*3+1],z=cz+rainP[i*3+2];
   rp[i*6]=x;rp[i*6+1]=y;rp[i*6+2]=z;rp[i*6+3]=x-0.6;rp[i*6+4]=y+0.9;rp[i*6+5]=z;
  }
  rainGeo.attributes.position.needsUpdate=true;
 }
 if(snowMesh.visible){
  const sp=snowGeo.attributes.position.array;
  for(let i=0;i<SNOW_N;i++){
   snowP[i*3+1]-=(2.2+cur.snow*1.6)*dt;
   snowP[i*3]+=Math.sin(nowT()*1.3+snowPh[i])*dt*1.4;
   if(snowP[i*3+1]<0){snowP[i*3+1]+=26;snowP[i*3]=rand(-35,35);snowP[i*3+2]=rand(-35,35);}
   sp[i*3]=cx+snowP[i*3];sp[i*3+1]=snowP[i*3+1];sp[i*3+2]=cz+snowP[i*3+2];
  }
  snowGeo.attributes.position.needsUpdate=true;
 }
}

/* rain on the camera lens (2D canvas) */
const dropCv=$('drops'),dropCx=dropCv.getContext('2d');
let lensDrops=[];
function sizeDrops(){dropCv.width=innerWidth;dropCv.height=innerHeight;}
function updLens(dt){
 dropCx.clearRect(0,0,dropCv.width,dropCv.height);
 const amt=Math.max(cur.rain-0.12,0)+cur.snow*0.15;
 if(amt<=0||state.mode==='title'){lensDrops.length=0;return;}
 if(Math.random()<amt*dt*38&&lensDrops.length<90)
  lensDrops.push({x:Math.random()*dropCv.width,y:Math.random()*dropCv.height,r:rand(1.5,7),life:rand(1.5,5),vy:rand(4,26)});
 const spd=player?Math.abs(player.vF):0;
 
 for(let i=lensDrops.length-1;i>=0;i--){const d=lensDrops[i];
  d.life-=dt*(1+spd*0.05);d.y+=d.vy*dt*(0.4+spd*0.03);
  if(d.life<=0||d.y>dropCv.height){lensDrops.splice(i,1);continue;}
  dropCx.globalAlpha=Math.min(d.life,1)*0.7;
  
  // Refraction effect (using a radial gradient to simulate light bending)
  const grad = dropCx.createRadialGradient(d.x - d.r*0.2, d.y - d.r*0.2, 0, d.x, d.y, d.r * (1 + spd*0.01));
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
  grad.addColorStop(0.4, 'rgba(200, 215, 228, 0.2)');
  grad.addColorStop(1, 'rgba(100, 110, 120, 0.5)');
  
  dropCx.fillStyle = grad;
  dropCx.beginPath();
  dropCx.ellipse(d.x, d.y, d.r*(1+spd*0.004), d.r*(1.6+spd*0.01), 0, 0, 7);
  dropCx.fill();
 }
 dropCx.globalAlpha=1;
}

/* ============ clouds ============ */
let cloudGrp=null,cloudMat=null;
function makeClouds(){
 cloudMat=new THREE.MeshStandardMaterial({color:0xffffff,flatShading:true,roughness:1,metalness:0});
 cloudGrp=new THREE.Group();
 const geo=new THREE.IcosahedronGeometry(1,0);
 for(let i=0;i<11;i++){
  const c=new THREE.Group();
  const n=3+Math.floor(rand(0,4));
  for(let k=0;k<n;k++){
   const m=new THREE.Mesh(geo,cloudMat);
   m.position.set(rand(-15,15),rand(-2,2),rand(-7,7));
   m.scale.set(rand(9,17),rand(3,5.5),rand(6,11));
   m.rotation.y=rand(0,6);
   c.add(m);
  }
  c.position.set(rand(-1000,1000),rand(125,205),rand(-1000,1000));
  c.userData.spd=rand(1.6,4.2);
  cloudGrp.add(c);
 }
 scene.add(cloudGrp);
}
function updClouds(dt){
 if(!cloudGrp)return;
 for(const c of cloudGrp.children){c.position.x+=c.userData.spd*dt;if(c.position.x>1080)c.position.x=-1080;}
}

/* ============ birds ============ */
const birds=[];
function makeBirds(){
 const mat=new THREE.MeshBasicMaterial({color:0x22242a,side:THREE.DoubleSide});
 const bodyG=new THREE.BoxGeometry(0.16,0.14,0.72);
 const wr=new THREE.PlaneGeometry(1.05,0.34);wr.translate(0.52,0,0);wr.rotateX(-Math.PI/2);
 const wl=wr.clone();wl.scale(-1,1,1);
 for(let i=0;i<5;i++){
  const g=new THREE.Group();
  g.add(new THREE.Mesh(bodyG,mat));
  const rw=new THREE.Mesh(wr,mat),lw=new THREE.Mesh(wl,mat);
  g.add(rw,lw);
  scene.add(g);
  birds.push({g,rw,lw,cx:rand(-200,200),cz:rand(-200,200),rad:rand(30,85),h:rand(20,45),
   ang:rand(0,6),spd:rand(0.12,0.32)*(Math.random()<0.5?-1:1),fs:rand(7,11),ph:rand(0,9),tgt:rand(8,26)});
 }
}
function updBirds(dt){
 const hide=cur.rain>0.55||cur.snow>0.45;
 for(const b of birds){
  b.g.visible=!hide;if(hide)continue;
  b.tgt-=dt;
  if(b.tgt<=0){b.tgt=rand(16,34);
   const px=player?player.x:0,pz=player?player.z:0;
   b.cx=px+rand(-180,180);b.cz=pz+rand(-180,180);
   b.rad=rand(26,85);b.h=rand(15,46);b.spd=rand(0.12,0.32)*(Math.random()<0.5?-1:1);}
  b.ang+=b.spd*dt;
  b.g.position.set(b.cx+Math.cos(b.ang)*b.rad,b.h+Math.sin(timeSec*0.6+b.ph)*1.2,b.cz+Math.sin(b.ang)*b.rad);
  const s=Math.sign(b.spd);
  b.g.rotation.y=Math.atan2(-Math.sin(b.ang)*s,Math.cos(b.ang)*s);
  const amp=(Math.sin(timeSec*0.33+b.ph*2.7)>-0.3)?0.85:0.08;
  const f=Math.sin(timeSec*b.fs+b.ph)*amp;
  b.rw.rotation.z=-f;b.lw.rotation.z=f;
 }
}

/* ============ weather state ============ */
const cur={skyT:new THREE.Color(),skyH:new THREE.Color(),sunC:new THREE.Color(),hS:new THREE.Color(),hG:new THREE.Color(),fog:new THREE.Color(),
 sunI:2.6,hI:.8,fogD:.0011,exp:1.12,grip:1,rain:0,snow:0,wet:0};
function applyWeatherVisuals(){
 const tod=TOD[state.tod]||TOD.day;
 skyMat.uniforms.topC.value.copy(cur.skyT).multiplyScalar(tod.skyMul);
 skyMat.uniforms.horC.value.copy(cur.skyH).multiplyScalar(tod.skyMul);
 skyMat.uniforms.sunC.value.copy(cur.sunC).multiplyScalar(2.2*tod.skyMul);
 scene.fog.color.copy(cur.fog).multiplyScalar(tod.skyMul);scene.fog.density=cur.fogD;
 sunLight.color.copy(cur.sunC);sunLight.intensity=cur.sunI*tod.sunMul;
 hemi.color.copy(cur.hS);hemi.groundColor.copy(cur.hG);hemi.intensity=cur.hI*tod.hMul;
 renderer.toneMappingExposure=cur.exp*tod.expMul;
 rainMesh.material.opacity=0.12+cur.rain*0.34;
 if(cloudMat){const g=Math.max(cur.rain,cur.snow*0.65);cloudMat.color.setRGB(1-g*0.45,1-g*0.43,1-g*0.40);}
 if(T){const snow=cur.snow,wet=cur.wet;
  T.groundMat.color.copy(new THREE.Color(T.def.grass)).lerp(new THREE.Color(0xe9edf2),snow*0.9);
  T.roadMat.color.copy(new THREE.Color(0x9a9da2)).lerp(new THREE.Color(0x8d9095),wet).lerp(new THREE.Color(0xc2c9d2),snow*0.75);
  T.roadMat.roughness=0.95-wet*0.08;T.roadMat.envMapIntensity=0.1;
  if(T.puddleMat)T.puddleMat.opacity=clamp(wet*0.85-snow*0.6,0,0.85);
  for(const cm of T.canopyMats){const arr=cm.instanceColor.array,base=cm.userData.base;
   for(let i=0;i<arr.length;i+=3){arr[i]=lerp(base[i],0.93,snow*0.85);arr[i+1]=lerp(base[i+1],0.95,snow*0.85);arr[i+2]=lerp(base[i+2],0.97,snow*0.85);}
   cm.instanceColor.needsUpdate=true;}
 }
}
function snapWeather(k){const p=WX[k];
 cur.skyT.set(p.skyT);cur.skyH.set(p.skyH);cur.sunC.set(p.sunC);cur.hS.set(p.hS);cur.hG.set(p.hG);cur.fog.set(p.fog);
 cur.sunI=p.sunI;cur.hI=p.hI;cur.fogD=p.fogD;cur.exp=p.exp;cur.grip=p.grip;cur.gripBase=p.grip;cur.rain=p.rain;cur.snow=p.snow;cur.wet=p.wet;
 applyWeatherVisuals();refreshEnv();}

/* ============ snow: sticks, melts, and gets harder in gusts ============ */
let snowAccum=0,snowGustT=rand(5,10),snowGustTarget=0.3,snowGustCur=0.3;
function updSnow(dt){
 // Accumulate while it's actually snowing, melt back afterwards — the
 // ground shouldn't snap to fully white/slippery the instant the weather
 // preset is selected, or back to clear the instant it stops.
 if(cur.snow>0.3){
  snowAccum=clamp(snowAccum+dt*(0.014+cur.snow*0.018),0,1);
 }else{
  snowAccum=clamp(snowAccum-dt*0.011,0,1);
 }
 if(T){
  if(T.snowMat)T.snowMat.opacity=clamp(snowAccum*0.92,0,0.92);
  if(T.snowRoadMat)T.snowRoadMat.opacity=clamp(snowAccum*0.55,0,0.55);
 }
 // Progressively slippier as it builds up, not just a fixed weather constant.
 cur.grip=(cur.gripBase||1)*lerp(1,0.6,snowAccum);

 // Gusts: alternates between lighter flurries and heavier squalls so it
 // isn't a constant, static snowfall rate.
 snowGustT-=dt;
 if(snowGustT<=0){
  const heavy=Math.random()<0.4;
  snowGustTarget=heavy?rand(0.9,1.35):rand(0.2,0.45);
  snowGustT=heavy?rand(3,6):rand(5,12);
 }
 snowGustCur=damp(snowGustCur,snowGustTarget,1.0,dt);
}

/* ============ thunderstorm: lightning flash + delayed thunder ============ */
let lightningFlash=0,lightningTimer=rand(6,14);
function updLightning(dt){
 lightningFlash=Math.max(0,lightningFlash-dt*3.2);
 if(cur.rain<0.45){lightningTimer=Math.max(lightningTimer,4);}
 else{
  lightningTimer-=dt;
  if(lightningTimer<=0){
   lightningTimer=rand(6,17)/Math.max(cur.rain,0.4);
   lightningFlash=1.0;
   const distT=rand(0.15,2.2);
   const strength=clamp(1-distT/2.2,0.15,1);
   setTimeout(()=>AudioSys.thunder(strength),distT*1000);
  }
 }
 const tod=TOD[state.tod]||TOD.day;
 sunLight.intensity=cur.sunI*tod.sunMul+lightningFlash*4.0;
 hemi.intensity=cur.hI*tod.hMul+lightningFlash*1.8;
}

/* ============ track build ============ */
let T=null,world=null,timeSec=0;
const _sv=V3(0,0,0),_sn=V3(0,0,0),_st=V3(0,0,0);
function sampleF(f){const N=T.N;f=((f%N)+N)%N;const i=Math.floor(f),fr=f-i,j=(i+1)%N;
 const a=T.samples[i],b=T.samples[j];
 _sv.copy(a.p).lerp(b.p,fr);_sn.copy(a.n).lerp(b.n,fr).normalize();_st.copy(a.t).lerp(b.t,fr).normalize();return i;}
function fixWinding(geo){if(geo.attributes.normal.getY(0)<0){
 const idx=geo.index.array;for(let i=0;i<idx.length;i+=3){const t=idx[i+1];idx[i+1]=idx[i+2];idx[i+2]=t;}
 geo.setIndex(new THREE.BufferAttribute(idx,1));geo.computeVertexNormals();}}
function buildWorld(idx){
 if(world){scene.remove(world);world.traverse(o=>{if(o.geometry)o.geometry.dispose();});}
 world=new THREE.Group();scene.add(world);
 const def=TRACKS[idx];
 const usingRealCircuit=Array.isArray(def.realPts)&&def.realPts.length>20;
 const pts=usingRealCircuit
  ? def.realPts.map(p=>V3(p[0],p[1],p[2]))
  : def.pts.map(p=>V3(p[0],0,p[1]));
 const curve=new THREE.CatmullRomCurve3(pts,true,'centripetal',0.5);
 const N=840;
 const raw=curve.getSpacedPoints(N);raw.length=N;
 if(!usingRealCircuit){
  for(let i=0;i<N;i++){
   raw[i].y = getTrackElevation(i / N, def.name);
  }
 }
 let trackMinY=Infinity;
 for(let i=0;i<N;i++)if(raw[i].y<trackMinY)trackMinY=raw[i].y;
 const samples=[];let len=0;
 for(let i=0;i<N;i++){
  const p=raw[i],pn=raw[(i+1)%N],pp=raw[(i-1+N)%N];
  const t=V3(pn.x-pp.x,pn.y-pp.y,pn.z-pp.z).normalize();
  samples.push({p,t,n:V3(t.z,0,-t.x),curv:0,v:80,line:0,cum:len});
  len+=raw[i].distanceTo(raw[(i+1)%N]);
 }
 for(let i=0;i<N;i++){const a=samples[(i-1+N)%N],c=samples[(i+1)%N];
  let d=Math.atan2(c.t.x,c.t.z)-Math.atan2(a.t.x,a.t.z);
  d=Math.atan2(Math.sin(d),Math.cos(d));
  samples[i].curv=d/(len/N*2);}
 for(let k=0;k<3;k++)for(let i=0;i<N;i++)
  samples[i].curv=(samples[(i-1+N)%N].curv+samples[i].curv*2+samples[(i+1)%N].curv)/4;
 for(let k=0;k<2*N;k++){const i=(2*N-1-k)%N,nj=(i+1)%N;
  samples[i].v=Math.min(samples[i].v,Math.sqrt(samples[nj].v**2+2*23*(len/N)));}
 for(let i=0;i<N;i++)samples[i].line=clamp(samples[i].curv*260,-4.2,4.2);
 for(let k=0;k<3;k++)for(let i=0;i<N;i++)
  samples[i].line=(samples[(i-1+N)%N].line+samples[i].line*2+samples[(i+1)%N].line)/4;
 
 const halfW=7.0;
 const runoffW=def.runoff!==undefined?def.runoff:6.5;
 const wallDist=halfW+runoffW;
 T={N,def,samples,len,halfW,segLen:len/N,canopyMats:[],flags:[],tvCams:[],lampMats:[]};
 T.latLimit=wallDist+0.25;
 T.collideLat=wallDist-0.5;
 cam.heliU=0;cam.heliPos=null;director.target=null;director.timer=0;

 // Closest point on the track's actual polyline (segment projection + linear
 // interpolation of elevation along it), not just the closest sample vertex.
 // A hairpin can put two different parts of the lap close together in world
 // space, but projecting onto whichever SEGMENT is truly closest — rather
 // than snapping to whichever isolated point happens to be nearest, or
 // IDW-blending several points into a mushy average — tracks the real road
 // height precisely (so a thin clearance is enough — no visible step at the
 // track edge) while still staying continuous through a hairpin.
 const nearestTrackY=(x,z)=>{
  let bestD2=1e18,bestY=trackMinY;
  for(let i=0;i<N;i+=2){
   const a=samples[i].p,b=samples[(i+2)%N].p;
   const abx=b.x-a.x,abz=b.z-a.z;
   const abLen2=abx*abx+abz*abz||1e-6;
   let t=((x-a.x)*abx+(z-a.z)*abz)/abLen2;
   t=clamp(t,0,1);
   const px=a.x+abx*t,pz=a.z+abz*t;
   const dx=x-px,dz=z-pz,d2=dx*dx+dz*dz;
   if(d2<bestD2){bestD2=d2;bestY=lerp(a.y,b.y,t);}
  }
  return{dist:Math.sqrt(bestD2),y:bestY};
 };
 // Scenery placement used to check distance-to-track with a coarse
 // nearest-VERTEX search (every 4th of up to 840 samples) — on a long real
 // circuit that's a 20-40m gap between checked points, so an object sitting
 // mid-straight could read as much farther from the track than it truly is
 // and slip past the clearance check onto the road. Reuse the precise
 // segment-projection distance instead.
 const minTrackDist=(x,z)=>nearestTrackY(x,z).dist;
 let cx=0,cz=0;for(const s of samples){cx+=s.p.x;cz+=s.p.z;}cx/=N;cz/=N;
 T.center={x:cx,z:cz};
 let rad=0;for(const s of samples)rad=Math.max(rad,Math.hypot(s.p.x-cx,s.p.z-cz));rad+=180;

 // Ground terrain — a heightfield that follows the track's own elevation near
 // the road, offset safely below the tarmac/runoff/kerb meshes so the grass
 // never pokes through the road surface, and settles gradually to a flat
 // baseline further out so hilly real circuits read as one continuous rolling
 // landscape (not a road on an isolated mound, and never a bridge).
 // Now that the road height is found by precise segment projection rather
 // than a broad blend, a small clearance is enough — no visible "wall"
 // between the track edge and the surrounding grass.
 const clearance=0.6;
 const nearR=T.latLimit+8,farR=nearR+420;
 const terrainHeightAt=(x,z)=>{
  const{dist,y}=nearestTrackY(x,z);
  const s=clamp((dist-nearR)/(farR-nearR),0,1);
  const sm=s*s*(3-2*s);
  return lerp(y-clearance,trackMinY-4,sm);
 };
 // The real, un-lowered road/track surface height — this is what cars must
 // sit on. It must never include the ground mesh's clearance offset.
 const trueTrackHeightAt=(x,z)=>nearestTrackY(x,z).y;
 // World-space Y offsets between ground/runoff/road/curbs are only a few cm
 // apart, which floating-point depth-buffer precision can't reliably hold at
 // real-circuit distances — that's what caused the persistent ground/road
 // seam z-fighting. polygonOffset biases depth at the rasterizer instead, so
 // the draw order stays correct (ground behind runoff behind road behind
 // curbs/lines/decals) no matter how far the camera is.
 const groundMat=new THREE.MeshStandardMaterial({map:grassT,bumpMap:grassBumpT,bumpScale:0.4,color:def.grass,roughness:1,polygonOffset:true,polygonOffsetFactor:4,polygonOffsetUnits:4});
 groundMat.envMapIntensity=0.25;
 const groundSize=Math.max(4600,rad*2.4);
 const segs=state.quality==='LOW'?44:state.quality==='MED'?64:state.quality==='ULTRA'?110:86;
 const groundGeo=new THREE.PlaneGeometry(groundSize,groundSize,segs,segs).rotateX(-Math.PI/2);
 const gpos=groundGeo.attributes.position;
 for(let i=0;i<gpos.count;i++){
  gpos.setY(i,terrainHeightAt(gpos.getX(i)+cx,gpos.getZ(i)+cz));
 }
 groundGeo.computeVertexNormals();
 const ground=new THREE.Mesh(groundGeo,groundMat);
 ground.position.set(cx,0,cz);
 ground.receiveShadow=true;world.add(ground);T.groundMat=groundMat;T.terrainHeightAt=terrainHeightAt;T.trueTrackHeightAt=trueTrackHeightAt;

 // Snow cover — a white blanket over the same terrain surface (not just a
 // color tint, which barely shows through a textured material), opacity
 // driven by how much snow has actually accumulated, not just whether the
 // weather preset says "snow".
 const snowMat=new THREE.MeshStandardMaterial({color:0xfbfdff,roughness:0.85,transparent:true,opacity:0,depthWrite:false});
 const snowGround=new THREE.Mesh(groundGeo,snowMat);
 snowGround.position.set(cx,0.015,cz);snowGround.renderOrder=1;world.add(snowGround);T.snowMat=snowMat;

 // 1. Road Tarmac Ribbon
 {
  const rep=Math.max(1,Math.round(len/9)),vS=len/rep;
  const pos=new Float32Array(N*6),uv=new Float32Array(N*4),index=[];
  for(let i=0;i<N;i++){const s=samples[i],vv=s.cum/vS;
   pos.set([s.p.x+s.n.x*halfW,s.p.y+0.05,s.p.z+s.n.z*halfW,s.p.x-s.n.x*halfW,s.p.y+0.05,s.p.z-s.n.z*halfW],i*6);
   uv.set([0,vv,1,vv],i*4);
   const a=i*2,b=a+1,c=((i+1)%N)*2,d=c+1;index.push(a,c,b,b,c,d);}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  g.setIndex(index);g.computeVertexNormals();fixWinding(g);
  const roadMat=new THREE.MeshStandardMaterial({map:asphaltT,bumpMap:asphaltBumpT,bumpScale:0.075,color:0x9a9da2,roughness:0.95,metalness:0.05,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const road=new THREE.Mesh(g,roadMat);road.receiveShadow=true;world.add(road);T.roadMat=roadMat;

  // The road only ever shows a partial snow cover (race traffic keeps the
  // racing line clearer), capped lower than the full-white grass blanket.
  const snowRoadMat=new THREE.MeshStandardMaterial({color:0xf3f6fa,roughness:0.7,transparent:true,opacity:0,depthWrite:false});
  const snowRoad=new THREE.Mesh(g,snowRoadMat);
  snowRoad.position.y=0.012;snowRoad.renderOrder=1;world.add(snowRoad);T.snowRoadMat=snowRoadMat;
 }

 // 2. Smooth Continuous Runoff Zone (Tarmac / Gravel / Painted Verge)
 if(runoffW>0.6){
  const rPos=[],rUv=[],rIdx=[];
  let rVi=0;
  for(let i=0;i<N;i++){
   const s=samples[i],s2=samples[(i+1)%N];
   const vv0=s.cum/5.0,vv1=s2.cum/5.0;
   for(const sg of[1,-1]){
    const p1x=s.p.x+s.n.x*halfW*sg, p1z=s.p.z+s.n.z*halfW*sg;
    const p2x=s.p.x+s.n.x*wallDist*sg, p2z=s.p.z+s.n.z*wallDist*sg;
    const p3x=s2.p.x+s2.n.x*halfW*sg, p3z=s2.p.z+s2.n.z*halfW*sg;
    const p4x=s2.p.x+s2.n.x*wallDist*sg, p4z=s2.p.z+s2.n.z*wallDist*sg;

    rPos.push(
      p1x,s.p.y+0.04,p1z,
      p2x,s.p.y+0.04,p2z,
      p3x,s2.p.y+0.04,p3z,
      p4x,s2.p.y+0.04,p4z
    );
    rUv.push(0,vv0, 1,vv0, 0,vv1, 1,vv1);
    if(sg>0){
      rIdx.push(rVi,rVi+2,rVi+1, rVi+1,rVi+2,rVi+3);
    }else{
      rIdx.push(rVi,rVi+1,rVi+2, rVi+1,rVi+3,rVi+2);
    }
    rVi+=4;
   }
  }
  const rGeo=new THREE.BufferGeometry();
  rGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(rPos),3));
  rGeo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(rUv),2));
  rGeo.setIndex(rIdx);rGeo.computeVertexNormals();
  const rColor=def.theme==='street'?0x3f4248:(def.theme==='forest'?0x4a473e:0x4d5158);
  const rMat=new THREE.MeshStandardMaterial({map:asphaltT,bumpMap:asphaltBumpT,bumpScale:0.075,color:rColor,roughness:0.95,polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:2});
  const rMesh=new THREE.Mesh(rGeo,rMat);rMesh.receiveShadow=true;world.add(rMesh);
 }

 // 3. Smooth FIA Curbs along Apexes
 {
  const pos=[],uv=[],index=[];let vi=0;
  for(let i=0;i<N;i++){
   if(Math.abs(samples[i].curv)<0.010)continue;
   const s=samples[i],s2=samples[(i+1)%N];
   for(const sg of[1,-1]){
    pos.push(s.p.x+s.n.x*halfW*sg,s.p.y+0.08,s.p.z+s.n.z*halfW*sg,
     s.p.x+s.n.x*(halfW+1.4)*sg,s.p.y+0.11,s.p.z+s.n.z*(halfW+1.4)*sg,
     s2.p.x+s2.n.x*halfW*sg,s2.p.y+0.08,s2.p.z+s2.n.z*halfW*sg,
     s2.p.x+s2.n.x*(halfW+1.4)*sg,s2.p.y+0.11,s2.p.z+s2.n.z*(halfW+1.4)*sg);
    const v0=s.cum/2.4,v1=s2.cum/2.4;
    uv.push(0,v0,1,v0,0,v1,1,v1);
    if(sg>0){
      index.push(vi,vi+2,vi+1,vi+1,vi+2,vi+3);
    }else{
      index.push(vi,vi+1,vi+2,vi+1,vi+3,vi+2);
    }
    vi+=4;}}
  if(pos.length>0){
   const g=new THREE.BufferGeometry();
   g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));
   g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(uv),2));
   g.setIndex(index);g.computeVertexNormals();
   const cm=new THREE.Mesh(g,new THREE.MeshStandardMaterial({map:curbT,roughness:0.7}));
   cm.receiveShadow=true;world.add(cm);
  }
 }

 // 4. Continuous Smooth Curved 3D Barrier Ribbons (TechPro Red/White / Armco Barrier)
 {
  const wPos=[],wCol=[],wIdx=[];let wVi=0;
  const wallH=0.6,wallThick=0.55;

  for(let i=0;i<N;i++){
   const s=samples[i],s2=samples[(i+1)%N];
   const blockIdx=Math.floor(s.cum/8.5);
   const isRed=(blockIdx%2===0);
   const col=isRed?new THREE.Color(0xd91624):new THREE.Color(0xf2f3f7);
   const topCol=isRed?new THREE.Color(0xad0e1a):new THREE.Color(0xd2d4dc);

   for(const sg of[1,-1]){
    const inX0=s.p.x+s.n.x*wallDist*sg, inZ0=s.p.z+s.n.z*wallDist*sg;
    const inX1=s2.p.x+s2.n.x*wallDist*sg, inZ1=s2.p.z+s2.n.z*wallDist*sg;
    const outD=wallDist+wallThick;
    const outX0=s.p.x+s.n.x*outD*sg, outZ0=s.p.z+s.n.z*outD*sg;
    const outX1=s2.p.x+s2.n.x*outD*sg, outX1_z=s2.p.z+s2.n.z*outD*sg;

    // Face 1: Front Vertical Face (Facing Track)
    wPos.push(
      inX0, s.p.y+0.05, inZ0,
      inX0, s.p.y+wallH, inZ0,
      inX1, s2.p.y+0.05, inZ1,
      inX1, s2.p.y+wallH, inZ1
    );
    for(let k=0;k<4;k++)wCol.push(col.r,col.g,col.b);
    if(sg>0){
      wIdx.push(wVi,wVi+1,wVi+2, wVi+1,wVi+3,wVi+2);
    }else{
      wIdx.push(wVi,wVi+2,wVi+1, wVi+1,wVi+2,wVi+3);
    }
    wVi+=4;

    // Face 2: Top Cap (Horizontal Bevel)
    wPos.push(
      inX0, s.p.y+wallH, inZ0,
      outX0, s.p.y+wallH, outZ0,
      inX1, s2.p.y+wallH, inZ1,
      outX1, s2.p.y+wallH, outX1_z
    );
    for(let k=0;k<4;k++)wCol.push(topCol.r,topCol.g,topCol.b);
    if(sg>0){
      wIdx.push(wVi,wVi+2,wVi+1, wVi+1,wVi+2,wVi+3);
    }else{
      wIdx.push(wVi,wVi+1,wVi+2, wVi+1,wVi+3,wVi+2);
    }
    wVi+=4;
   }
  }

  const wGeo=new THREE.BufferGeometry();
  wGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(wPos),3));
  wGeo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(wCol),3));
  wGeo.setIndex(wIdx);wGeo.computeVertexNormals();
  const wMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.75,metalness:0.12});
  const wallMesh=new THREE.Mesh(wGeo,wMat);
  wallMesh.castShadow=true;wallMesh.receiveShadow=true;
  world.add(wallMesh);
 }

 // 5. Smooth Catch Fence Posts
 {
  const fCount=Math.ceil(N/8)*2;
  const postGeo=new THREE.CylinderGeometry(0.06,0.06,2.6,5);
  const postMat=new THREE.MeshStandardMaterial({color:0x44484f,roughness:0.8,metalness:0.4});
  const postMesh=new THREE.InstancedMesh(postGeo,postMat,fCount);
  let pk=0;
  const postDummy=new THREE.Object3D();
  for(let i=0;i<N;i+=8){
   for(const sg of[1,-1]){
    sampleF(i);
    postDummy.position.set(_sv.x+_sn.x*(wallDist+0.25)*sg,1.35,_sv.z+_sn.z*(wallDist+0.25)*sg);
    postDummy.updateMatrix();
    postMesh.setMatrixAt(pk++,postDummy.matrix);
   }
  }
  postMesh.count=pk;
  world.add(postMesh);
 }

 // 6. Grid Starting Slots
 {
  const slotM=new THREE.MeshBasicMaterial({color:0xf4f1ea,transparent:true,opacity:0.85,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  const barG=new THREE.PlaneGeometry(2.2,0.14).rotateX(-Math.PI/2);
  const stemG=new THREE.PlaneGeometry(0.14,1.4).rotateX(-Math.PI/2);
  const ib=new THREE.InstancedMesh(barG,slotM,20),ist=new THREE.InstancedMesh(stemG,slotM,20);
  const dm=new THREE.Object3D();
  for(let i=0;i<20;i++){
   const f=T.N-14-i*3.6,lat=(i%2?3:-3)*0.95;
   sampleF(f);
   const yaw=Math.atan2(_st.x,_st.z);
   const x=_sv.x+_sn.x*lat,z=_sv.z+_sn.z*lat;
   dm.position.set(x,_sv.y+0.13,z);dm.rotation.set(0,yaw,0);dm.updateMatrix();ib.setMatrixAt(i,dm.matrix);
   dm.position.set(x-_st.x*0.9,_sv.y+0.13,z-_st.z*0.9);dm.updateMatrix();ist.setMatrixAt(i,dm.matrix);
  }
  ib.renderOrder=1;ist.renderOrder=1;world.add(ib,ist);
 }

 // 7. Start/Finish Gantry & Overhead Lights
 {
  sampleF(6);
  const yaw=Math.atan2(_st.x,_st.z);
  const line=new THREE.Mesh(new THREE.PlaneGeometry(halfW*2,1.8).rotateX(-Math.PI/2),
   new THREE.MeshStandardMaterial({map:checkT,roughness:0.8,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  line.position.set(_sv.x,_sv.y+0.15,_sv.z);line.rotation.y=yaw;line.receiveShadow=true;line.renderOrder=1;world.add(line);
  const gmat=new THREE.MeshStandardMaterial({color:0x2b2e33,roughness:0.6,metalness:0.3});
  const gp=new THREE.Group();
  for(const s of[1,-1]){const post=new THREE.Mesh(new THREE.BoxGeometry(0.45,8.4,0.45),gmat);
   post.position.set(s*(halfW+2.2),4.15,0);post.castShadow=true;gp.add(post);}
  const bar=new THREE.Mesh(new THREE.BoxGeometry(halfW*2+4.8,0.55,0.55),gmat);bar.position.y=8.0;gp.add(bar);
  for(let i=0;i<5;i++){const m=new THREE.MeshBasicMaterial({color:0x230c0a});
   T.lampMats.push(m);const lamp=new THREE.Mesh(new THREE.SphereGeometry(0.2,8,6),m);
   lamp.position.set((i-2)*1.15,7.55,-0.35);gp.add(lamp);}
  const ban=new THREE.Mesh(new THREE.PlaneGeometry(halfW*2+3.6,1.0),
   new THREE.MeshStandardMaterial({map:bannerTex(def.name),side:THREE.DoubleSide,roughness:0.7}));
  ban.position.set(0,7.1,-0.35);gp.add(ban);
  gp.position.set(_sv.x,0,_sv.z);gp.rotation.y=yaw;world.add(gp);
 }

 const dummy=new THREE.Object3D();

 // 8. Trackside Sponsor Billboards (Clean Straightaway Placements)
 {
  // adsT holds all 8 ads side by side in one strip; each board needs its
  // own texture instance (same image, different .offset) so it shows just
  // one ad instead of the whole crammed-together strip.
  let side=1,adIdx=0;
  for(let i=45;i<N-45;i+=38){
   if(Math.abs(samples[i].curv)>0.007)continue;
   side=-side;sampleF(i);
   const tex=adsT.clone();tex.offset.x=(adIdx++%ADS.length)/ADS.length;tex.needsUpdate=true;
   const am=new THREE.MeshStandardMaterial({map:tex,roughness:0.8});
   const w=new THREE.Mesh(new THREE.BoxGeometry(11,2.6,0.35),am);
   w.position.set(_sv.x+_sn.x*(T.latLimit+3.2)*side,_sv.y+1.35,_sv.z+_sn.z*(T.latLimit+3.2)*side);
   w.rotation.y=Math.atan2(_st.x,_st.z);w.castShadow=true;world.add(w);
  }
 }

 // 9. Grandstands & Spectators (Stepped terraced seating safely beyond runoff)
 {
  const crowdData=[];const standMat=new THREE.MeshStandardMaterial({color:0x727780,roughness:0.85});
  const seatMat=new THREE.MeshStandardMaterial({color:0x1b2838,roughness:0.8});
  const roofMat=new THREE.MeshStandardMaterial({color:0xe10600,roughness:0.5});
  const railMat=new THREE.MeshStandardMaterial({color:0x9da3ad,roughness:0.6,metalness:0.4});
  let placed=[],lastI=-999,side=1;
  for(let i=0;i<N&&placed.length<4;i+=24){
   const cv=samples[i].curv;
   if(Math.abs(cv)<0.012||Math.abs(cv)>0.055||i-lastI<110)continue;
   lastI=i;side=-Math.sign(cv)||1;placed.push(i);
   sampleF(i);const yaw=Math.atan2(_st.x,_st.z);
   const bx=_sv.x+_sn.x*(T.latLimit+9.0)*side,bz=_sv.z+_sn.z*(T.latLimit+9.0)*side;
   
   // Grandstands are deliberately placed at high-curvature (hairpin-ish)
   // points, which is exactly where a real circuit is most likely to loop
   // back close to itself — the ground terrain there can end up reading its
   // height from that OTHER nearby section instead of this one, burying or
   // detaching the stand from the terrain beneath it. Require a much larger
   // clearance so grandstands only land somewhere the surrounding terrain
   // height is unambiguous.
   if(minTrackDist(bx, bz) < T.latLimit + 35) continue;
   
   const tv=new THREE.Vector3(samples[i].t.x,0,samples[i].t.z);
   const nv=new THREE.Vector3(samples[i].n.x,0,samples[i].n.z);

   const standY=samples[i].p.y;
   const baseW=28;
   const stand=new THREE.Mesh(new THREE.BoxGeometry(baseW,0.8,9.0),standMat);
   stand.position.set(bx,standY+0.4,bz);stand.rotation.y=yaw;stand.castShadow=true;world.add(stand);

   for(let r=0;r<5;r++){
     const rowY = standY + 0.8 + r * 0.7;
     const rowOffsetZ = side * (-3.0 + r * 1.5);
     const tierPos = new THREE.Vector3(bx + nv.x * rowOffsetZ, rowY / 2 + 0.4, bz + nv.z * rowOffsetZ);
     
     const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(baseW, 0.7, 1.5), standMat);
     stepMesh.position.set(tierPos.x, rowY - 0.35, tierPos.z);
     stepMesh.rotation.y = yaw;
     stepMesh.receiveShadow = true;
     world.add(stepMesh);

     const bench = new THREE.Mesh(new THREE.BoxGeometry(baseW - 1.2, 0.12, 0.45), seatMat);
     bench.position.set(tierPos.x, rowY + 0.06, tierPos.z);
     bench.rotation.y = yaw;
     world.add(bench);

     for(let c=0;c<22;c++){
       const colSpread = (c - 10.5) * 1.18;
       const specX = tierPos.x + tv.x * colSpread;
       const specY = rowY + 0.12;
       const specZ = tierPos.z + tv.z * colSpread;
       crowdData.push({
         x: specX,
         baseY: specY,
         y: specY,
         z: specZ,
         yaw: yaw + (side < 0 ? Math.PI : 0),
         ph: rand(0, 9)
       });
     }
   }

   const frontRail = new THREE.Mesh(new THREE.BoxGeometry(baseW, 1.1, 0.08), railMat);
   frontRail.position.set(bx - nv.x * side * 4.0, standY + 1.35, bz - nv.z * side * 4.0);
   frontRail.rotation.y = yaw;
   world.add(frontRail);

   const roof=new THREE.Mesh(new THREE.BoxGeometry(baseW + 2, 0.35, 10.5), roofMat);
   roof.position.set(bx + nv.x * side * 0.5, standY + 6.2, bz + nv.z * side * 0.5);
   roof.rotation.y=yaw;
   world.add(roof);

   for(const fo of[-baseW/2 + 0.6, baseW/2 - 0.6]){
     const pillar=new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.8, 0.35), railMat);
     pillar.position.set(bx + tv.x * fo + nv.x * side * 3.8, standY + 3.2, bz + tv.z * fo + nv.z * side * 3.8);
     pillar.rotation.y = yaw;
     world.add(pillar);

     const flag=new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshStandardMaterial({color:pick([0xe10600,0xf2d13d,0x2e6fd0,0xe9e9e9]), side:THREE.DoubleSide, roughness:0.7}));
     flag.position.set(pillar.position.x + 0.9, standY + 6.4, pillar.position.z);
     flag.userData.ph=rand(0,9);world.add(flag);T.flags.push(flag);
   }
  }
  if(crowdData.length>0){
   const torso = part(new THREE.BoxGeometry(0.42, 0.52, 0.32), '#ffffff', 0, 0.26, 0);
   const head = part(new THREE.SphereGeometry(0.13, 6, 5), '#d9a07a', 0, 0.62, 0);
   const cap = part(new THREE.BoxGeometry(0.28, 0.08, 0.35), '#e10600', 0, 0.72, 0.04);
   const specGeo = mergeGeometries([torso, head, cap], false);

   const cm=new THREE.InstancedMesh(specGeo,
    new THREE.MeshStandardMaterial({vertexColors:true, roughness:0.85}), crowdData.length);
   const cCol=new THREE.Color();
   const cDummy=new THREE.Object3D();
   crowdData.forEach((p,i)=>{
     cCol.setHSL(Math.random(), rand(0.6, 0.9), rand(0.35, 0.65));
     cm.setColorAt(i,cCol);
     // Set the real position/rotation now, at creation — don't rely solely
     // on the ambient-animation loop to place them on their first frame.
     cDummy.position.set(p.x,p.y,p.z);cDummy.rotation.set(0,p.yaw,0);cDummy.updateMatrix();
     cm.setMatrixAt(i,cDummy.matrix);
   });
   cm.instanceMatrix.needsUpdate=true;
   cm.userData.crowd=crowdData;world.add(cm);T.crowd=cm;
  }
 }

 const propDensity=(QUALITY_PRESETS[state.quality]||{}).propDensity!=null?QUALITY_PRESETS[state.quality].propDensity:1;
 // 10. Trees & Scenery (Far away from track edges) — three distinct species
 // (conifer / round broadleaf / slender poplar) mixed by theme, instead of
 // one repeated cone, so the scenery doesn't look so uniform.
 {
  const nT=Math.round((def.theme==='forest'?380:def.theme==='park'?300:90)*propDensity);
  const weights=def.theme==='forest'?[0.55,0.3,0.15]:def.theme==='park'?[0.2,0.55,0.25]:[0.34,0.33,0.33];
  const species=[
   {canopyGeo:new THREE.ConeGeometry(2.1,5.2,7),canopyY:2.5,canopyScaleY:1,trunkH:2.3,trunkR0:0.32,trunkR1:0.48,trunkColor:0x6b4a2f,hue:[0.26,0.36],sat:[0.4,0.62],light:[0.22,0.36]},
   {canopyGeo:new THREE.IcosahedronGeometry(2.3,1),canopyY:2.7,canopyScaleY:0.82,trunkH:2.0,trunkR0:0.3,trunkR1:0.42,trunkColor:0x5c4530,hue:[0.22,0.32],sat:[0.45,0.68],light:[0.28,0.44]},
   {canopyGeo:new THREE.ConeGeometry(1.15,7.6,6),canopyY:4.6,canopyScaleY:1,trunkH:3.6,trunkR0:0.22,trunkR1:0.3,trunkColor:0xcbc0a8,hue:[0.21,0.29],sat:[0.4,0.6],light:[0.3,0.42]},
  ];
  const canopyMeshes=[],trunkMeshes=[];
  for(const sp of species){
   const canopy=new THREE.InstancedMesh(sp.canopyGeo,new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),nT);
   const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(sp.trunkR0,sp.trunkR1,sp.trunkH,6),new THREE.MeshStandardMaterial({color:sp.trunkColor,roughness:0.95}),nT);
   canopy.count=0;trunk.count=0;
   canopyMeshes.push(canopy);trunkMeshes.push(trunk);
  }
  let k=0,tries=0;
  const speciesIdx=()=>{const r=Math.random();let acc=0;for(let i=0;i<weights.length;i++){acc+=weights[i];if(r<=acc)return i;}return weights.length-1;};
  // Scatter in a band alongside the track itself (by picking a point along
  // the lap and offsetting laterally a bounded amount) rather than uniformly
  // across the whole huge bounding square — otherwise nearly everything
  // lands far from the road, leaving a wide empty margin right beside it.
  while(k<nT&&tries<4000){tries++;
   const ts=samples[Math.floor(Math.random()*N)];
   const side=Math.random()<0.5?1:-1;
   const lat=rand(T.latLimit+9,T.latLimit+65);
   const x=ts.p.x+ts.n.x*lat*side,z=ts.p.z+ts.n.z*lat*side;
   // The offset above only guarantees clearance from THIS sample's own
   // stretch of track — at a hairpin or chicane, that same (x,z) can still
   // land right next to a completely different part of the lap that loops
   // back nearby. Validate against the true closest point on the whole
   // track before accepting it.
   if(minTrackDist(x,z)<T.latLimit+8)continue;
   const si=speciesIdx(),sp=species[si],canopy=canopyMeshes[si],trunk=trunkMeshes[si];
   const s=rand(0.7,1.7);
   const elevation=getTrackHAtCoords(x,z);
   const ci=canopy.count;
   dummy.position.set(x,elevation+sp.canopyY*s,z);dummy.rotation.set(0,rand(0,6),0);dummy.scale.set(s,s*sp.canopyScaleY,s);dummy.updateMatrix();
   canopy.setMatrixAt(ci,dummy.matrix);
   const c=new THREE.Color().setHSL(rand(sp.hue[0],sp.hue[1]),rand(sp.sat[0],sp.sat[1]),rand(sp.light[0],sp.light[1]));
   canopy.setColorAt(ci,c);
   canopy.count++;
   dummy.position.set(x,elevation+sp.trunkH*0.5*s-0.1,z);dummy.scale.set(s,s*0.85,s);dummy.updateMatrix();
   trunk.setMatrixAt(trunk.count,dummy.matrix);trunk.count++;
   k++;
  }
  for(let i=0;i<species.length;i++){
   const canopy=canopyMeshes[i],trunk=trunkMeshes[i];
   canopy.instanceMatrix.needsUpdate=true;trunk.instanceMatrix.needsUpdate=true;
   canopy.castShadow=true;
   if(canopy.instanceColor)canopy.instanceColor.needsUpdate=true;
   canopy.userData.base=canopy.instanceColor?Float32Array.from(canopy.instanceColor.array):null;
   T.canopyMats.push(canopy);world.add(canopy,trunk);
  }
 }

 // 11. City Buildings for Street Tracks — a boxy tower plus an inset rooftop
 // cap (and, on the tallest ones, an antenna) so the skyline reads as modern
 // architecture rather than bare rectangular blocks.
 {
  const nB=Math.round((def.theme==='street'?46:def.theme==='park'?10:4)*propDensity);
  const bm=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),
   new THREE.MeshStandardMaterial({map:winT,roughness:0.9}),nB);
  const roofMat=new THREE.MeshStandardMaterial({color:0x2a2e34,roughness:0.55,metalness:0.35});
  const roofs=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),roofMat,nB);
  const antMat=new THREE.MeshStandardMaterial({color:0x555b63,roughness:0.5,metalness:0.6});
  const antennas=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08,0.12,1,6),antMat,nB);
  let antCount=0;
  let k=0,tries=0;const cCol=new THREE.Color();
  // Same track-relative scatter as the trees: a bounded band beside the
  // road, sized so each building's own footprint can never reach the track,
  // rather than a uniform scatter across the whole bounding square that
  // leaves the trackside itself empty.
  while(k<nB&&tries<4000){tries++;
   const w=rand(8,18),h=rand(8,34),d=rand(8,18);
   const ts=samples[Math.floor(Math.random()*N)];
   const side=Math.random()<0.5?1:-1;
   const latMin=T.latLimit+Math.hypot(w,d)/2+8;
   const lat=rand(latMin,latMin+90);
   const x=ts.p.x+ts.n.x*lat*side,z=ts.p.z+ts.n.z*lat*side;
   // As with the trees: clearance from this one sample doesn't guarantee
   // clearance from the whole track — a hairpin can loop back close by.
   // Validate against the true nearest point on the track before placing it.
   if(minTrackDist(x,z)<latMin)continue;
   const elevation=getTrackHAtCoords(x,z);
   const rotY=rand(0,6);
   dummy.position.set(x,elevation+h/2-0.2,z);dummy.rotation.set(0,rotY,0);dummy.scale.set(w,h,d);dummy.updateMatrix();
   bm.setMatrixAt(k,dummy.matrix);
   const tint=pick([[1.1,1.15,1.3],[1.25,1.18,1.05],[1.05,1.12,1.2],[1.3,1.3,1.3]]);
   const g=rand(1.0,1.6);bm.setColorAt(k,cCol.setRGB(g*tint[0],g*tint[1],g*tint[2]));

   const roofH=rand(1.0,2.2);
   dummy.position.set(x,elevation+h-0.2+roofH/2,z);dummy.rotation.set(0,rotY,0);dummy.scale.set(w*0.92,roofH,d*0.92);dummy.updateMatrix();
   roofs.setMatrixAt(k,dummy.matrix);

   if(h>21&&Math.random()<0.5){
    const antH=rand(4,9);
    dummy.position.set(x,elevation+h-0.2+roofH+antH/2,z);dummy.rotation.set(0,0,0);dummy.scale.set(1,antH,1);dummy.updateMatrix();
    antennas.setMatrixAt(antCount,dummy.matrix);antCount++;
   }
   k++;
  }
  bm.count=k;bm.castShadow=true;world.add(bm);
  roofs.count=k;roofs.castShadow=true;world.add(roofs);
  antennas.count=antCount;world.add(antennas);
 }

 // 12. Puddles — reflective patches on straighter sections, shown when wet
 {
  const puddleDefs=[];let lastPI=-999;
  for(let i=0;i<N;i+=17){
   if(Math.abs(samples[i].curv)>0.011)continue;
   if(i-lastPI<38)continue;
   if(Math.random()>0.42)continue;
   lastPI=i;
   const s=samples[i],off=rand(-halfW*0.55,halfW*0.55);
   puddleDefs.push({
    x:s.p.x+s.n.x*off,y:s.p.y+0.056,z:s.p.z+s.n.z*off,
    r:rand(1.5,3.4),rot:Math.atan2(s.t.x,s.t.z)
   });
  }
  T.puddles=puddleDefs;
  if(puddleDefs.length){
   const puddleMat=new THREE.MeshStandardMaterial({color:0x0c1116,roughness:0.05,metalness:0.1,transparent:true,opacity:0,depthWrite:false});
   const puddles=new THREE.InstancedMesh(new THREE.CircleGeometry(1,18),puddleMat,puddleDefs.length);
   puddleDefs.forEach((p,i)=>{
    dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(-Math.PI/2,0,p.rot);dummy.scale.set(p.r,p.r,1);dummy.updateMatrix();
    puddles.setMatrixAt(i,dummy.matrix);
   });
   puddles.renderOrder=2;world.add(puddles);T.puddleMat=puddleMat;
  }else T.puddleMat=null;
 }

 for(let i=0;i<N;i+=90){
  const sg=(i/90)%2?1:-1;sampleF(i);
  const elevation=_sv.y;
  const x=_sv.x+_sn.x*(T.latLimit+12)*sg,z=_sv.z+_sn.z*(T.latLimit+12)*sg;
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.18,7,5),new THREE.MeshStandardMaterial({color:0x3a3f46}));
  pole.position.set(x,elevation+3.45,z);world.add(pole);
  const box=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.5,0.7),new THREE.MeshStandardMaterial({color:0x14161a}));
  box.position.set(x,elevation+7.2,z);box.lookAt(_sv.x,elevation+1,_sv.z);world.add(box);
  T.tvCams.push(V3(x,elevation+6.6,z));
 }
 buildMinimapPath();
 clearSkids();
}

/* ============ cars — true heading-based physics, zero auto-steer ============ */
let cars=[],player=null;
const PH={top:79,eng:20,brk:26,drag:0.00115};
function makeCar(d,isPlayer){
 const mesh=makeCarMesh(d);scene.add(mesh.g);
 return{d,isPlayer,mesh,x:0,z:0,hdg:0,vx:0,vz:0,vF:0,ti:0,f:0,_pf:0,lat:0,
  steer:0,throttle:0,brake:0,drift:false,
  gear:1,rpm:0.15,audioRpm:0.15,wheelRot:0,wheelspin:0,drsOpen:false,slipstream:false,
  lap:0,lapStart:0,best:null,finished:false,finishTime:null,key:0,skidAcc:0,skidAmt:0,
  offT:false,onCurb:false,_pv:0,stuck:0,pDiff:0,recT:0,recPhase:0,recSteer:0,
  phase:rand(0,9),pos:1,near:null,shiftT:0,hitT:0,reactT:0,dustT:0,exT:0};
}
function setupGrid(gridSize){
 for(const c of cars)scene.remove(c.mesh.g);
 cars=[];
 const source = (openF1Drivers && openF1Drivers.length > 0) ? openF1Drivers : DRIVERS.map(d => ({
  name: d[0], team: d[1], skill: d[2], num: d[3], color: d[4], colB: d[5], helmet: d[6]
 }));
 const ais = source.slice(0, gridSize - 1);
 ais.forEach(d => {
  cars.push(makeCar({
   name: d.name,
   team: d.team,
   skill: d.skill,
   num: d.num,
   colA: d.color || d.colA || '#ffffff',
   colB: d.colB || '#888888',
   helmet: d.helmet || d.color || '#e10600',
   headshot: d.headshot || null,
   code: d.code || d.name.substring(0,3).toUpperCase()
  }, false));
 });
 player=makeCar({name:state.name,team:'POLYGON GP',skill:0.9,num:99,colA:'#f5f5f2',colB:'#e10600',helmet:'#e10600',code:state.name.substring(0,3).toUpperCase()},true);
 cars.push(player);
 gridPlace();
}
function gridPlace(){
 cars.forEach((c,i)=>{
  c.f=T.N-14-i*3.6;c._pf=c.f;c.lat=(i%2?3:-3)*0.95;
  c.lap=0;c.best=null;c.finished=false;c.finishTime=null;c.wheelspin=0;c.drsOpen=false;
  c.lapStart=0;c.stuck=0;c.hitT=0;c.recT=0;c.steer=0;c.pDiff=0;c.slipstream=false;
  placeCar(c);
  c.key=c.lap*T.N+c.f;
  c.mesh.g.updateMatrixWorld();
 });
}
function placeCar(c){
 sampleF(c.f);
 c.x=_sv.x+_sn.x*c.lat;c.z=_sv.z+_sn.z*c.lat;
 c.hdg=Math.atan2(_st.x,_st.z);
 c.vx=0;c.vz=0;c.vF=0;
 c.ti=Math.floor(c.f)%T.N;
 c.mesh.g.position.set(c.x,0.05,c.z);
 c.mesh.g.rotation.y=c.hdg;
}
/* project world position onto the centreline (local search around cached index) */
function projectCar(c,full){
 const N=T.N;
 let bi=c.ti||0,bd=1e18;
 if(full){
  for(let i=0;i<N;i++){
   const p=T.samples[i].p;
   const d=(p.x-c.x)**2+(p.z-c.z)**2;
   if(d<bd){bd=d;bi=i;}
  }
 }else{
  for(let k=-46;k<=46;k++){
   const i=(c.ti+k+N)%N;
   const p=T.samples[i].p;
   const d=(p.x-c.x)**2+(p.z-c.z)**2;
   if(d<bd){bd=d;bi=i;}
  }
 }
 c.ti=bi;
 const s=T.samples[bi];
 const dx=c.x-s.p.x,dz=c.z-s.p.z;
 const along=dx*s.t.x+dz*s.t.z;
 c.f=(bi+along/T.segLen+N)%N;
 c.lat=dx*s.n.x+dz*s.n.z;
 const al=Math.abs(c.lat);
 c.offT=al>T.halfW+1.4;
 c.onCurb=al>T.halfW&&al<=T.halfW+1.4;
}

/* ============ physics ============ */
const keys={};
const tiltCtrl=new TiltController();
const gyroLab=new GyroCalibrationLab(tiltCtrl);

function nearestAhead(c){
 let best=null,bd=1e9;
 for(const o of cars){if(o===c)continue;
  let dk=o.f-c.f;dk=((dk%T.N)+T.N)%T.N;
  if(dk<=0.5||dk>16)continue;
  if(Math.abs(o.lat-c.lat)>3.4)continue;
  if(dk<bd){bd=dk;best=o;}}
 return best?{c:best,dist:bd*T.segLen}:null;
}
function playerControl(){
 const p=player;
 if(tiltCtrl.enabled){
  const keySteer=(keys.left?-1:0)+(keys.right?1:0);
  const targetSteer=Math.abs(keySteer)>0.1?keySteer:tiltCtrl.steer;
  p.steer=damp(p.steer,targetSteer,28,dtGlobal);

  const touchGas=keys.up?1:0;
  const touchBrake=(keys.down||tiltCtrl.handBrake)?1:0;

  if(touchGas>0.05){
    p.throttle=1.0;
    p.brake=0;
  }else if(touchBrake>0.05){
    p.throttle=0;
    p.brake=1.0;
  }else if(tiltCtrl.throttleMode==='auto'){
    p.throttle=1.0;
    p.brake=0;
  }else if(tiltCtrl.throttleMode==='tilt'){
    p.throttle=tiltCtrl.throttle;
    p.brake=tiltCtrl.brake;
  }else{
    p.throttle=0;
    p.brake=0;
  }

  p.drift=tiltCtrl.drift||!!keys.space;
  tiltCtrl.updateHUD();
 }else{
  const st=(keys.left?-1:0)+(keys.right?1:0); /* left = -1, right = +1 */
  p.steer=damp(p.steer,st,st!==0?10:16,dtGlobal);
  p.throttle=keys.up?1:0;
  p.brake=keys.down?1:0;
  p.drift=!!keys.space;
 }
}
function aiThink(c,dt){
 if(state.mode==='race'&&raceT<c.reactT){c.throttle=0;c.brake=0;c.steer=damp(c.steer,0,8,dt);return;}
 /* recovery: reverse out, then go */
 if(c.recT>0){
  c.recT-=dt;
  if(c.recPhase===0){
   c.throttle=0;c.brake=1;c.steer=c.recSteer;
   if(c.recT<0.9){
    c.recPhase=1;
    // A punchy dust/smoke kick right as the car snaps into the recovery spin.
    smk(c.x,0.35,c.z,rand(-3,3),rand(1.5,3.5),rand(-3,3),rand(2.5,4),rand(.5,.8),c.offT?0.4:0.75,c.offT?0.3:0.75,c.offT?0.2:0.78);
   }
  }else{
   c.throttle=0.7;c.brake=0;c.steer=-c.recSteer*0.5;
  }
  if(c.recT<=0)c.stuck=0;
  return;
 }
 const fi=Math.floor(c.f);
 const vF=c.vF;
 if((state.mode==='race'||state.mode==='title')&&Math.abs(vF)<1.5)c.stuck+=dt;else c.stuck=Math.max(0,c.stuck-dt*2);
 const tanA=Math.atan2(T.samples[fi].t.x,T.samples[fi].t.z);
 const mis=wrapA(c.hdg-tanA);
 if(c.stuck>2.6||(Math.abs(mis)>2.35&&Math.abs(vF)<6)){
  c.recT=2.0;c.recPhase=0;c.recSteer=Math.random()<0.5?-0.9:0.9;c.stuck=0;return;
 }
 /* steer toward a look-ahead point on the racing line (with avoidance) */
 const la=6+clamp(vF*0.55,0,34);
 const lf=(c.f+la/T.segLen)%T.N;
 const li=Math.floor(lf);
 let latT=T.samples[li].line+Math.sin(timeSec*0.7+c.phase)*0.5;
 const ah=nearestAhead(c);
 if(ah&&ah.dist<24){
  const side=(c.lat-ah.c.lat)>=0?1:-1;
  latT=clamp(ah.c.lat+side*3.7,-(T.halfW-1.1),T.halfW-1.1);
 }
 latT=clamp(latT,-(T.halfW-1.0),T.halfW-1.0);
 sampleF(lf);
 const tx=_sv.x+_sn.x*latT,tz=_sv.z+_sn.z*latT;
 const des=Math.atan2(tx-c.x,tz-c.z);
 const diff=wrapA(des-c.hdg);
 const dTerm=clamp((diff-c.pDiff)/Math.max(dt,0.001)*0.05,-0.35,0.35);
 c.pDiff=diff;
 c.steer=clamp(-diff*2.7-dTerm,-1,1);
 /* speed target from curvature ahead */
 let cmax=0;
 const look=6+Math.floor(vF*0.5);
 for(let k=2;k<look;k+=3)cmax=Math.max(cmax,Math.abs(T.samples[(fi+k)%T.N].curv));
 let tv=Math.sqrt(21/Math.max(cmax,1e-4))*c.d.skill*state.diffMul*Math.sqrt(Math.max(cur.grip,0.35));
 tv=Math.min(tv,PH.top*(0.86+c.d.skill*0.13));
 if(ah&&ah.dist<20)tv=Math.min(tv,Math.min(ah.c.vF*1.02,ah.c.vF+(ah.dist-9)));
 const dv=tv-vF;
 c.throttle=dv>0.5?1:dv<-1.5?0:0.45;
 c.brake=dv<-4?clamp(-dv*0.14,0,1):0;
}
function wallHit(c,sgn,imp){
 if(imp>2&&timeSec-c.hitT>0.35){
  c.hitT=timeSec;
  c.bounceVel=(c.bounceVel||0)-Math.min(imp*0.025,0.35);
  const s=T.samples[c.ti];
  sparkBurst(c.x+s.n.x*sgn*1.1,0.5,c.z+s.n.z*sgn*1.1,1+Math.min(imp*0.1,2));
  if(c.isPlayer){
   cam.shake=Math.max(cam.shake,Math.min(0.7,imp*0.06));
   AudioSys.thump(Math.min(imp*0.09,0.9)+0.1);
   if(imp>7)Speech.say(pick(LINES.hit),false,{rate:clamp(1.1+imp*0.015,1.1,1.35),pitch:1.08});
  }
 }
}
function updCar(c,dt){
 const groundY = getRoadHAtCoords(c.x, c.z);
 if (c.y === undefined) { c.y = groundY; c.vy = 0; c.airborne = false; c.pitch = 0; c.bounceOff = 0; c.bounceVel = 0; }

 const stepAhead = 1.0;
 const groundYAhead = getRoadHAtCoords(c.x + Math.sin(c.hdg)*stepAhead, c.z + Math.cos(c.hdg)*stepAhead);
 const slope = Math.atan2(groundYAhead - groundY, stepAhead);
 
 if (c.y <= groundY + 0.01 && c.vy <= 0.01) {
  c.y = groundY;
  c.airborne = false;
  const expectedVy = c.vF * Math.sin(slope);
  if (expectedVy - c.vy < -3.5 && c.vF > 25) {
   c.airborne = true;
  } else {
   c.vy = expectedVy;
  }
 } else {
  c.airborne = true;
  c.vy -= 18.0 * dt;
  c.y += c.vy * dt;
  if (c.y < groundY) {
   c.y = groundY;
   c.airborne = false;
   if (c.vy < -3.5) {
    sparkBurst(c.x, c.y + 0.1, c.z, 2.5);
    c.bounceVel -= Math.min(Math.abs(c.vy) * 0.045, 0.55);
    if (c.isPlayer) {
     cam.shake = Math.max(cam.shake, 0.42);
     AudioSys.thump(0.85);
     if (Math.random() < 0.5) {
      Speech.say(pick(["What a jump!", "Massive airtime!", "Spectacular airborne action!"]),false,{rate:1.18,pitch:1.06});
     }
    }
   }
   c.vy = c.vF * Math.sin(slope);
  }
 }
 const targetPitch = c.airborne ? clamp(c.vy * 0.035, -0.22, 0.22) : slope;
 c.pitch = damp(c.pitch, targetPitch, 12, dt);
 // Lightweight suspension spring — landings/impacts compress it, then it
 // rebounds and settles, on top of a faint speed-linked road-surface jitter.
 c.bounceVel += (-c.bounceOff * 150 - c.bounceVel * 12) * dt;
 c.bounceOff = clamp(c.bounceOff + c.bounceVel * dt, -0.09, 0.09);

 // Puddle splashes — a spray of water kicked up when a wet-weather puddle is crossed at speed.
 if(cur.wet>0.15 && T.puddles && T.puddles.length && Math.abs(c.vF)>8){
  c.splashCd=(c.splashCd||0)-dt;
  if(c.splashCd<=0){
   for(const pu of T.puddles){
    const dx=c.x-pu.x,dz=c.z-pu.z;
    if(dx*dx+dz*dz<pu.r*pu.r){
     const speed=Math.abs(c.vF),amt=clamp(speed/40,0.3,1.4)*cur.wet;
     for(let k=0;k<6;k++){
      smk(c.x+rand(-0.6,0.6),c.y+0.15,c.z+rand(-0.6,0.6),
       rand(-3,3)-Math.sin(c.hdg)*speed*0.18,rand(3,7),rand(-3,3)-Math.cos(c.hdg)*speed*0.18,
       rand(0.5,1.1)*amt,rand(0.35,0.6),0.75,0.82,0.92,-14);
     }
     c.splashCd=0.12;
     break;
    }
   }
  }
 }

 const surface=c.offT?0.45:c.onCurb?0.8:1;
 const grip=c.airborne?0.04:(cur.grip*surface);
 const top=PH.top*(c.isPlayer?1:(0.86+c.d.skill*0.13));
 const sp0=c.vF;
 /* steering → yaw rate (speed-sensitive, grip-limited, no assists) */
 const base=3.2-1.9*clamp(Math.abs(sp0)/PH.top,0,1);
 const cap=46*grip/Math.max(Math.abs(sp0),2);
 const yawF=clamp(0.4+Math.abs(sp0)/3.8,0.4,1)*(sp0<-0.5?-1:1);
 c.hdg-=c.steer*Math.min(base,cap)*yawF*dt; /* steer -1 (left) increases hdg, turning left */
 /* velocity in the NEW heading frame → slip appears naturally */
 const fx=Math.sin(c.hdg),fz=Math.cos(c.hdg),rx=-fz,rz=fx;
 let vF=c.vx*fx+c.vz*fz, vR=c.vx*rx+c.vz*rz;
 /* longitudinal */
 let aF=0;
 if(c.throttle>0)aF+=c.throttle*PH.eng*Math.max(0,1-Math.pow(clamp(vF/top,0,1),3))*Math.min(grip,1);
 c.wheelspin=(c.throttle>0.55&&vF<17&&vF>-1)?c.throttle*(1-clamp(vF,0,17)/17)*(1.35-grip):0;
 if(c.wheelspin>0)aF*=(1-c.wheelspin*0.45);
 if(c.brake>0){
  if(vF>0.4)aF-=c.brake*PH.brk*grip;
  else if(vF>-11)aF-=8; /* reverse */
 }
 const k=PH.drag*(c.drsOpen?0.78:1)*(c.slipstream?0.85:1);
 aF-=k*vF*Math.abs(vF)+vF*0.045;
 if(c.offT)aF-=vF*0.14;
 vF+=aF*dt;
 if(c.throttle===0&&c.brake===0&&Math.abs(vF)<0.15)vF=0;
 /* lateral tyre grip pulls velocity toward the nose */
 const gLat=8.8*grip*(c.drift?0.28:1);
 vR*=Math.exp(-gLat*dt);
 /* recompose + integrate */
 c.vx=fx*vF+rx*vR;c.vz=fz*vF+rz*vR;
 c.x+=c.vx*dt;c.z+=c.vz*dt;
 /* project onto track, walls */
 projectCar(c);
 if(Math.abs(c.lat)>T.collideLat){
  const sgn=Math.sign(c.lat);
  const over=Math.abs(c.lat)-T.collideLat;
  const s=T.samples[c.ti];
  c.x-=s.n.x*sgn*over;c.z-=s.n.z*sgn*over;
  c.lat=sgn*T.collideLat;
  const vn=c.vx*s.n.x+c.vz*s.n.z;
  if(vn*sgn>0){
   const imp=Math.abs(vn);
   c.vx-=s.n.x*vn*1.3;c.vz-=s.n.z*vn*1.3;
   c.vx*=0.96;c.vz*=0.96;
   wallHit(c,sgn,imp);
  }else{
   c.vx*=1-0.4*dt;c.vz*=1-0.4*dt;
   if(Math.random()<dt*6)sparkBurst(c.x+s.n.x*sgn*1.1,0.4,c.z+s.n.z*sgn*1.1,0.4);
  }
 }
 /* lap crossing */
 if(c._pf>T.N*0.75&&c.f<T.N*0.25){c.lap++;onLap(c);}
 else if(c._pf<T.N*0.25&&c.f>T.N*0.75)c.lap--;
 c._pf=c.f;
 /* gears + rpm */
 const kmh=Math.abs(vF)*3.6;
 const bands=[0,52,88,124,162,202,244,290,340];
 let g=1;for(let b=1;b<8;b++)if(kmh>=bands[b])g=b+1;
 if(g!==c.gear&&c.isPlayer&&kmh>8){AudioSys.shift();c.shiftT=0.09;}
 c.gear=g;
 let rpm=clamp((kmh-bands[g-1])/(bands[g]-bands[g-1]),0.12,1);
 if(c.wheelspin>0.1&&g<=2)rpm=Math.max(rpm,0.6+c.wheelspin*0.4);
 if(c.shiftT>0){c.shiftT-=dt;rpm*=0.6;}
 c.rpm=rpm;
 c.audioRpm=state.mode==='countdown'?clamp(0.12+c.throttle*0.85,0.12,0.97):rpm;
 c.skidAmt=clamp((Math.abs(vR)-3.4)/5.5,0,1)*(c.offT?0.3:1)+(c.onCurb?0.12:0);
 /* DRS + slipstream */
 c.drsOpen=false;c.slipstream=false;
 if(Math.abs(vF)>36&&Math.abs(T.samples[(Math.floor(c.f)+18)%T.N].curv)<0.009){
  const ah=nearestAhead(c);
  if(ah&&ah.dist<Math.abs(vF)*1.15){c.drsOpen=true;if(ah.dist<22)c.slipstream=true;}
 }
 if(c.isPlayer){
  if(c.offT&&Math.abs(vF)>14)cam.shake=Math.max(cam.shake,0.05);
  else if(c.onCurb&&Math.abs(vF)>22)cam.shake=Math.max(cam.shake,0.03);
 }
 c.vF=vF;
}
/* clean world-space car-to-car contact (two circles per car, mild restitution) */
function carCollisions(){
 const R=2.3,RR=R*R;
 for(let a=0;a<cars.length;a++){
  const A=cars[a];
  for(let b=a+1;b<cars.length;b++){
   const B=cars[b];
   // World-space proximity alone isn't enough: a track that loops back near
   // itself (a hairpin, or two straights running close in opposite
   // directions) can put cars a full lap-fraction apart right next to each
   // other in x/z. Require them to also be close along the racing line
   // itself before treating it as an actual on-track encounter.
   let df=Math.abs(A.f-B.f);if(df>T.N/2)df=T.N-df;
   if(df*T.segLen>30)continue;
   const dx0=B.x-A.x,dz0=B.z-A.z;
   if(dx0*dx0+dz0*dz0>49)continue;
   const afx=Math.sin(A.hdg),afz=Math.cos(A.hdg);
   const bfx=Math.sin(B.hdg),bfz=Math.cos(B.hdg);
   for(const oa of[1.55,-1.55]){
    const ax=A.x+afx*oa,az=A.z+afz*oa;
    for(const ob of[1.55,-1.55]){
     const bx=B.x+bfx*ob,bz=B.z+bfz*ob;
     const dx=bx-ax,dz=bz-az;
     const d2=dx*dx+dz*dz;
     if(d2>=RR||d2===0)continue;
     const d=Math.sqrt(d2),nx=dx/d,nz=dz/d,ov=R-d;
     A.x-=nx*ov*0.5;A.z-=nz*ov*0.5;
     B.x+=nx*ov*0.5;B.z+=nz*ov*0.5;
     const rvn=(B.vx-A.vx)*nx+(B.vz-A.vz)*nz;
     if(rvn<0){
      const j=-rvn*0.62;
      A.vx-=j*nx;A.vz-=j*nz;
      B.vx+=j*nx;B.vz+=j*nz;
      const imp=-rvn;
      if(imp>3&&timeSec-A.hitT>0.4&&timeSec-B.hitT>0.4){
       A.hitT=B.hitT=timeSec;
       sparkBurst((ax+bx)/2,0.55,(az+bz)/2,1+Math.min(imp*0.12,2));
       if(A.isPlayer||B.isPlayer){
        cam.shake=Math.max(cam.shake,Math.min(0.55,imp*0.05));
        AudioSys.thump(Math.min(imp*0.09,0.9)+0.1);
        if(imp>9)Speech.say(pick(LINES.hit),false,{rate:clamp(1.1+imp*0.015,1.1,1.35),pitch:1.08});
       }
      }
     }
    }
   }
  }
 }
}

/* ============ per-car visuals ============ */
function updCarVisual(c,dt){
 const p=c.mesh.g;
 const jitter=Math.sin(timeSec*24+c.phase*7)*0.006*clamp(Math.abs(c.vF)/50,0,1);
 p.position.set(c.x, (c.y !== undefined ? c.y : 0.05) + 0.05 + (c.bounceOff||0) + jitter, c.z);
 p.rotation.set(0, c.hdg, 0);
 p.rotateX(-c.pitch || 0);
 c.wheelRot+=c.vF/0.37*dt*(1+c.wheelspin*2.2);
 // Real cars need a much smaller steering angle to hold the same line at
 // speed — the input (c.steer) is unchanged, but the visible wheel angle
 // should shrink as speed rises, not stay fixed regardless of how fast
 // you're going.
 const steerVis=clamp(1-Math.abs(c.vF)/PH.top*0.75,0.22,1);
 c.mesh.axleF.rotation.y=-c.steer*0.58*steerVis;
 c.mesh.axleF.rotation.x=c.wheelRot;
 c.mesh.axleR.rotation.x=c.wheelRot;
 c.mesh.drs.rotation.x=c.drsOpen?-1.15:0;
 if(c.brake>0.02){
  c.mesh.brakeLight.material.emissiveIntensity=4;
 }else if(cur.wet>0.25){
  c.mesh.brakeLight.material.emissiveIntensity=Math.sin(timeSec*12)>0?3.2:0;
 }else{
  c.mesh.brakeLight.material.emissiveIntensity=0;
 }
 const fx=Math.sin(c.hdg),fz=Math.cos(c.hdg),rx=-fz,rz=fx;
 const vR=c.vx*rx+c.vz*rz;
 c.mesh.body.rotation.z=damp(c.mesh.body.rotation.z,clamp(vR*0.011,-0.1,0.1),8,dt);
 const acc=dt>0?(c.vF-c._pv)/dt:0;
 c.mesh.body.rotation.x=damp(c.mesh.body.rotation.x,clamp(-acc*0.0035,-0.05,0.06),6,dt);
 c._pv=c.vF;

 // Realistic Driver & Helmet G-Force animation:
 if(c.mesh.helmetGroup){
  // 1. Steering look-ahead apex rotation (helmet turns into corner)
  const steerTurn = -c.steer * 0.42; 
  // 2. Lateral G-force head tilt (helmet rolls towards inside/counter-rolls on high Gs)
  const lateralG = clamp(-c.steer * Math.abs(c.vF) * 0.0045, -0.32, 0.32);
  // 3. Longitudinal braking/acceleration head nod (helmet pitches forward under hard braking, presses back under acceleration)
  const accelPitch = clamp(-acc * 0.008, -0.22, 0.15);
  // 4. Subtle track vibration bounce
  const bump = (c.onCurb ? Math.sin(timeSec * 45) * 0.05 : Math.sin(timeSec * 22) * 0.012) * Math.min(1.0, Math.abs(c.vF)/15);

  c.mesh.helmetGroup.rotation.y = damp(c.mesh.helmetGroup.rotation.y, steerTurn, 14, dt);
  c.mesh.helmetGroup.rotation.z = damp(c.mesh.helmetGroup.rotation.z, lateralG, 12, dt);
  c.mesh.helmetGroup.rotation.x = damp(c.mesh.helmetGroup.rotation.x, accelPitch + bump, 14, dt);
 }
 if(c.mesh.driverGroup){
  // Subtle driver torso / shoulder lean
  c.mesh.driverGroup.rotation.z = damp(c.mesh.driverGroup.rotation.z, -c.steer * 0.09, 10, dt);
 }

 if(c.onCurb)p.position.y+=Math.abs(Math.sin(timeSec*38+c.phase))*0.03;
 const sp=Math.abs(c.vF);
 // Low-speed wheelspin — a standing-start launch, or the tight spin the AI
 // does to turn around after going off — used to fall through both smoke
 // checks below since they require sp>6/sp>5, exactly the speed range where
 // launch/recovery wheelspin actually happens. Big, thick plumes from both
 // rear tires, distinct from (and on top of) the regular skid smoke.
 const launching=c.wheelspin>0.28&&sp<=9;
 if(launching){
  c.launchAcc=(c.launchAcc||0)+dt;
  if(c.launchAcc>0.028){c.launchAcc=0;
   if(p.position.distanceToSquared(camera.position)<5000){
    const amt=clamp(c.wheelspin,0.4,1);
    for(const s of[1,-1]){
     const wx=c.x-fx*1.62+rx*0.82*s,wz=c.z-fz*1.62+rz*0.82*s;
     smk(wx,0.3,wz,rand(-1.8,1.8)+rx*2*s*amt,rand(1.8,3.6)*amt,rand(-1.8,1.8)+rz*2*s*amt,rand(1.8,3.2)*amt,rand(.6,1.0),0.72,0.72,0.75);
     smk(wx,0.55,wz,rand(-1,1),rand(2.2,4)*amt,rand(-1,1),rand(1.3,2.4)*amt,rand(.7,1.2),0.85,0.86,0.88);
    }
   }
  }
 }
 const skidding=(c.wheelspin>0.25||(Math.abs(vR)>3.6&&!c.offT))&&sp>6;
 if(skidding){
  c.skidAcc+=dt;
  if(c.skidAcc>0.03){c.skidAcc=0;
   for(const s of[1,-1]){
    const wx=c.x-fx*1.62+rx*0.82*s,wz=c.z-fz*1.62+rz*0.82*s;
    addSkid(wx,wz,c.hdg,1.4,c.offT);
    if(p.position.distanceToSquared(camera.position)>4000)continue;
    
    // Mud particles on grass
    if (c.offT) {
       smk(wx,0.4,wz,rand(-2,2)-fx*3,rand(1.5,4),rand(-2,2)-fz*3,rand(2.2,4.2),rand(.3,.8),0.35,0.25,0.18);
    } else {
       smk(wx,0.28,wz,rand(-1,1)-fx*2,rand(0.5,1.8),rand(-1,1)-fz*2,rand(1.2,2.2),rand(.5,.9),0.82,0.82,0.85);
    }
   }}
 }
 if(c.offT&&sp>5){
  c.dustT=(c.dustT||0)+dt;
  if(c.dustT>0.05){c.dustT=0;
   const bx=c.x-fx*1.6+rx*rand(-0.8,0.8),bz=c.z-fz*1.6+rz*rand(-0.8,0.8);
   
   // Mud chunks!
   smk(bx,0.4,bz,rand(-2,2)-fx*2,rand(2,5),rand(-2,2)-fz*2,rand(2,4),rand(.5,.9),0.38,0.28,0.22);
   smk(bx,0.25,bz,rand(-1,1),rand(0.8,2),rand(-1,1),rand(1,2),rand(.6,1),0.5,0.42,0.3);}
 }
 // Wet-weather rooster-tail spray — real F1 cars throw up a lot of visible
 // spray in the rain, worse the harder it's raining and the faster you go,
 // which also does double duty as a visibility hazard for cars behind.
 if(cur.wet>0.3&&sp>10){
  c.skidAcc+=dt*(0.7+cur.wet*0.6+clamp(sp/40,0,1)*0.8);
  if(c.skidAcc>0.045){c.skidAcc=0;
   const intensity=clamp(cur.wet,0,1)*clamp(sp/28,0.3,1.6);
   for(const s of[1,-1]){
    const bx=c.x-fx*2.3+rx*0.7*s,bz=c.z-fz*2.3+rz*0.7*s;
    smk(bx,0.3,bz,rand(-1.5,1.5)-fx*2*intensity,rand(1.2,3.2)*intensity,rand(-1.5,1.5)-fz*2*intensity,rand(1.8,3.4)*Math.max(intensity,0.6),rand(.4,.7),0.85,0.9,0.97);
   }
   if(intensity>0.9)smk(c.x-fx*2.6,0.45,c.z-fz*2.6,rand(-0.8,0.8)-fx*3*intensity,rand(2,4)*intensity,rand(-0.8,0.8)-fz*3*intensity,rand(2.2,3.6),rand(.35,.55),0.9,0.94,1.0);
  }
 }
 if(c.isPlayer||p.position.distanceToSquared(camera.position)<2500){
  c.exT=(c.exT||0)+dt;
  if(c.exT>0.06){c.exT=0;
   const ex=c.x-fx*2.1+rx*0.16,ez=c.z-fz*2.1+rz*0.16;
   const hot=c.throttle>0.6&&c.rpm>0.75;
   if(hot&&Math.random()<0.25)smk(ex,0.55,ez,rand(-0.5,0.5)-fx*3,rand(0.2,0.8),rand(-0.5,0.5)-fz*3,rand(0.5,0.9),0.18,1,0.72,0.35);
   else smk(ex,0.52,ez,rand(-0.4,0.4),rand(0.3,0.9),rand(-0.4,0.4),rand(0.35,0.7),rand(.5,1),0.55,0.55,0.58);
  }
 }
 // Tires lose shine over time during a race!
 if(state.mode === 'race' && c.isPlayer) {
    const wear = Math.min(1.0, raceT / 180.0);
    c.mesh.axleF.material.roughness = 0.55 + wear * 0.45;
    c.mesh.axleR.material.roughness = 0.55 + wear * 0.45;
    c.mesh.body.material.roughness = 0.25 + wear * 0.15; // Body also gets dirtier
 }
}


/* ============ audio ============ */
const AudioSys={started:false,
 start(){if(this.started)return;
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
  const ctx=this.ctx=new AC();
  this.master=ctx.createGain();this.master.gain.value=0.9;
  const comp=ctx.createDynamicsCompressor();this.master.connect(comp);comp.connect(ctx.destination);
  const nb=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
  const d=nb.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;this.noiseBuf=nb;
  const eg=this.eg=ctx.createGain();eg.gain.value=0;
  const dist=ctx.createWaveShaper();const cv=new Float32Array(256);
  for(let i=0;i<256;i++){const x=i/128-1;cv[i]=Math.tanh(2.2*x);}dist.curve=cv;
  const flt=this.eflt=ctx.createBiquadFilter();flt.type='lowpass';flt.frequency.value=800;flt.Q.value=1.1;
  eg.connect(dist);dist.connect(flt);flt.connect(this.master);
  const mk=(type,g)=>{const o=ctx.createOscillator();o.type=type;const og=ctx.createGain();og.gain.value=g;
   o.connect(og);og.connect(eg);o.start();return o;};
  this.o1=mk('sawtooth',0.5);this.o2=mk('sawtooth',0.28);this.o3=mk('square',0.34);this.o4=mk('sawtooth',0.14);
  const en=ctx.createBufferSource();en.buffer=nb;en.loop=true;
  const ef=ctx.createBiquadFilter();ef.type='bandpass';ef.frequency.value=180;
  this.eng=ctx.createGain();this.eng.gain.value=0;
  en.connect(ef);ef.connect(this.eng);this.eng.connect(this.master);en.start();
  const sk=ctx.createBufferSource();sk.buffer=nb;sk.loop=true;
  this.skf=ctx.createBiquadFilter();this.skf.type='bandpass';this.skf.frequency.value=820;this.skf.Q.value=1.4;
  this.skg=ctx.createGain();this.skg.gain.value=0;
  sk.connect(this.skf);this.skf.connect(this.skg);this.skg.connect(this.master);sk.start();
  const wn=ctx.createBufferSource();wn.buffer=nb;wn.loop=true;
  this.wff=ctx.createBiquadFilter();this.wff.type='lowpass';
  this.wfg=ctx.createGain();this.wfg.gain.value=0;
  wn.connect(this.wff);this.wff.connect(this.wfg);this.wfg.connect(this.master);wn.start();
  const rn=ctx.createBufferSource();rn.buffer=nb;rn.loop=true;
  const rf=ctx.createBiquadFilter();rf.type='lowpass';rf.frequency.value=1200;
  this.rag=ctx.createGain();this.rag.gain.value=0;
  rn.connect(rf);rf.connect(this.rag);this.rag.connect(this.master);rn.start();
  this.wso=ctx.createOscillator();this.wso.type='triangle';
  this.wsg=ctx.createGain();this.wsg.gain.value=0;
  this.wso.connect(this.wsg);this.wsg.connect(this.master);this.wso.start();
  this.ro1=ctx.createOscillator();this.ro1.type='sawtooth';
  const rf2=ctx.createBiquadFilter();rf2.type='lowpass';rf2.frequency.value=2400;
  this.rg=ctx.createGain();this.rg.gain.value=0;
  this.ro1.connect(rf2);rf2.connect(this.rg);this.rg.connect(this.master);this.ro1.start();
  // Whole-grid engine roar — a broadband noise bed representing the other
  // ~19 cars revving around you, not just your own engine. Loudest on the
  // grid before lights out (a real F1 start is deafening), fading back once
  // the race is under way and the mix should focus on your own car again.
  const gn=ctx.createBufferSource();gn.buffer=nb;gn.loop=true;
  this.gridf=ctx.createBiquadFilter();this.gridf.type='bandpass';this.gridf.frequency.value=220;this.gridf.Q.value=0.7;
  this.gridg=ctx.createGain();this.gridg.gain.value=0;
  gn.connect(this.gridf);this.gridf.connect(this.gridg);this.gridg.connect(this.master);gn.start();
  this.started=true;},
 shift(){if(!this.started)return;const t=this.ctx.currentTime;
  this.eg.gain.cancelScheduledValues(t);
  this.eg.gain.setValueAtTime(this.eg.gain.value,t);
  this.eg.gain.linearRampToValueAtTime(0.04,t+0.05);
  this.eg.gain.linearRampToValueAtTime(0.3,t+0.18);
  const n=this.ctx.createBufferSource();n.buffer=this.noiseBuf;
  const g=this.ctx.createGain();g.gain.setValueAtTime(0.13,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.12);
  const f=this.ctx.createBiquadFilter();f.type='highpass';f.frequency.value=1400;
  n.connect(f);f.connect(g);g.connect(this.master);n.start(t);n.stop(t+0.14);},
 beep(freq,vol){if(!this.started)return;const t=this.ctx.currentTime;
  const o=this.ctx.createOscillator();o.type='square';o.frequency.value=freq;
  const g=this.ctx.createGain();g.gain.setValueAtTime(0.0001,t);
  g.gain.exponentialRampToValueAtTime(vol||0.22,t+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001,t+0.16);
  o.connect(g);g.connect(this.master);o.start(t);o.stop(t+0.18);},
 thump(v){if(!this.started)return;const t=this.ctx.currentTime;
  const o=this.ctx.createOscillator();o.type='sine';
  o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(38,t+0.18);
  const g=this.ctx.createGain();g.gain.setValueAtTime(Math.min(0.5,0.1+v*0.25),t);
  g.gain.exponentialRampToValueAtTime(0.001,t+0.22);
  o.connect(g);g.connect(this.master);o.start(t);o.stop(t+0.24);},
 thunder(strength){if(!this.started)return;const t=this.ctx.currentTime;
  strength=clamp(strength,0.1,1);
  const o=this.ctx.createOscillator();o.type='sine';
  o.frequency.setValueAtTime(58,t);o.frequency.exponentialRampToValueAtTime(16,t+1.3);
  const g=this.ctx.createGain();g.gain.setValueAtTime(0.0001,t);
  g.gain.exponentialRampToValueAtTime(Math.min(0.55,0.15+strength*0.5),t+0.06);
  g.gain.exponentialRampToValueAtTime(0.001,t+1.7+strength*0.8);
  o.connect(g);g.connect(this.master);o.start(t);o.stop(t+2.6);
  const n=this.ctx.createBufferSource();n.buffer=this.noiseBuf;
  const f=this.ctx.createBiquadFilter();f.type='bandpass';f.frequency.value=850;f.Q.value=0.6;
  const ng=this.ctx.createGain();ng.gain.setValueAtTime(Math.min(0.6,0.2+strength*0.5),t);
  ng.gain.exponentialRampToValueAtTime(0.001,t+0.35);
  n.connect(f);f.connect(ng);ng.connect(this.master);n.start(t);n.stop(t+0.4);},
 update(){if(!this.started||!player)return;
  const t=this.ctx.currentTime,p=player;
  const run=(state.mode==='race'||state.mode==='countdown'||state.mode==='finished')&&!state.paused;
  // Aggregate the rest of the grid's audioRpm into one broadband bed so the
  // start actually sounds like ~20 F1 engines, not just your own idling one.
  let gridActivity=0.15;
  if(cars.length){let s=0;for(const c of cars)s+=c.audioRpm||0.15;gridActivity=s/cars.length;}
  const gridTarget=state.mode==='countdown'?0.16+gridActivity*0.42:(run?gridActivity*0.05:0);
  this.gridg.gain.setTargetAtTime(gridTarget,t,0.08);
  this.gridf.frequency.setTargetAtTime(140+gridActivity*380,t,0.1);
  const f=55+p.audioRpm*640;
  this.o1.frequency.setTargetAtTime(f,t,0.02);
  this.o2.frequency.setTargetAtTime(f*1.5,t,0.02);
  this.o3.frequency.setTargetAtTime(f*0.5,t,0.02);
  this.o4.frequency.setTargetAtTime(f*2.03,t,0.02);
  this.eflt.frequency.setTargetAtTime(260+p.throttle*2300+p.audioRpm*1400,t,0.03);
  this.eg.gain.setTargetAtTime(run?0.13+p.throttle*0.16+p.audioRpm*0.05:0,t,0.05);
  this.eng.gain.setTargetAtTime(run?0.02+p.throttle*0.05:0,t,0.05);
  this.wso.frequency.setTargetAtTime(f*5.2,t,0.02);
  this.wsg.gain.setTargetAtTime(run?p.wheelspin*0.08:0,t,0.03);
  this.skg.gain.setTargetAtTime(run?p.skidAmt*0.16:0,t,0.04);
  this.skf.frequency.setTargetAtTime(600+p.skidAmt*500,t,0.05);
  const w=clamp(Math.abs(p.vF)/80,0,1);
  this.wfg.gain.setTargetAtTime(run?w*w*0.12:0,t,0.1);
  this.wff.frequency.setTargetAtTime(300+w*2600,t,0.1);
  this.rag.gain.setTargetAtTime(cur.rain*0.11+cur.snow*0.02,t,0.2);
  if(p.near&&run){const g=clamp(1-p.near.dist/55,0,1)*0.05;
   this.rg.gain.setTargetAtTime(g,t,0.1);
   this.ro1.frequency.setTargetAtTime(60+p.near.rpm*520,t,0.05);}
  else this.rg.gain.setTargetAtTime(0,t,0.1);},
 setMute(m){if(this.started)this.master.gain.value=m?0:0.9;}
};

/* ============ Title screen theme ============
   A quiet, original moody blues-rock instrumental for the menu/attract
   screen — its own chord progression, walking bassline and rhythm, not an
   arrangement of any existing song. Built the same way as the rest of
   AudioSys (raw oscillators/noise through filters and gain envelopes,
   scheduled ahead of the audio clock so JS-thread jitter can't cause
   glitches), and mixed through AudioSys.master so the game's mute/volume
   controls cover it too. */
const TitleTheme={
 playing:false,gain:null,nextNoteTime:0,step:0,barIdx:0,stepDur:0.3,
 // Em - C - G - D: a common rock progression, deliberately not the one
 // that makes any specific existing song recognizable. Each chord carries
 // its own 8-step walking bass line (eighth notes at ~100bpm) and triad.
 chords:[
  {tones:[164.81,196.00,246.94],bass:[82.41,82.41,98.00,110.00,123.47,110.00,98.00,82.41]},
  {tones:[130.81,164.81,196.00],bass:[65.41,65.41,82.41,98.00,82.41,73.42,65.41,65.41]},
  {tones:[98.00,123.47,146.83],bass:[98.00,98.00,123.47,146.83,123.47,110.00,98.00,98.00]},
  {tones:[73.42,92.50,110.00],bass:[73.42,73.42,92.50,110.00,92.50,82.41,73.42,73.42]},
 ],
 ensureGain(){
  if(this.gain||!AudioSys.ctx)return;
  this.gain=AudioSys.ctx.createGain();this.gain.gain.value=0;
  this.gain.connect(AudioSys.master);
 },
 start(){
  if(!AudioSys.ctx||this.playing)return;
  this.ensureGain();
  this.playing=true;this.step=0;this.barIdx=0;
  this.nextNoteTime=AudioSys.ctx.currentTime+0.15;
  const t=AudioSys.ctx.currentTime;
  this.gain.gain.cancelScheduledValues(t);
  this.gain.gain.setValueAtTime(this.gain.gain.value,t);
  this.gain.gain.linearRampToValueAtTime(0.15,t+3);
 },
 stop(){
  if(!this.playing)return;
  this.playing=false;
  if(this.gain&&AudioSys.ctx){
   const t=AudioSys.ctx.currentTime;
   this.gain.gain.cancelScheduledValues(t);
   this.gain.gain.setValueAtTime(this.gain.gain.value,t);
   this.gain.gain.linearRampToValueAtTime(0,t+1.1);
  }
 },
 bassNote(freq,time,dur){
  const ctx=AudioSys.ctx;
  const o=ctx.createOscillator();o.type='sawtooth';o.frequency.value=freq;
  const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=420;f.Q.value=0.8;
  const g=ctx.createGain();g.gain.setValueAtTime(0.0001,time);
  g.gain.exponentialRampToValueAtTime(0.11,time+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001,time+dur*0.92);
  o.connect(f);f.connect(g);g.connect(this.gain);
  o.start(time);o.stop(time+dur);
 },
 pad(tones,time,dur){
  const ctx=AudioSys.ctx;
  tones.forEach((freq,i)=>{
   const o=ctx.createOscillator();o.type=i===0?'triangle':'sine';
   o.frequency.value=freq;o.detune.value=(i-1)*4;
   const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=1100;
   const g=ctx.createGain();g.gain.setValueAtTime(0.0001,time);
   g.gain.linearRampToValueAtTime(0.045,time+0.9);
   g.gain.linearRampToValueAtTime(0.0001,time+dur);
   o.connect(f);f.connect(g);g.connect(this.gain);
   o.start(time);o.stop(time+dur+0.05);
  });
 },
 tick(time){
  const ctx=AudioSys.ctx;
  const n=ctx.createBufferSource();n.buffer=AudioSys.noiseBuf;
  const f=ctx.createBiquadFilter();f.type='highpass';f.frequency.value=5000;
  const g=ctx.createGain();g.gain.setValueAtTime(0.018,time);
  g.gain.exponentialRampToValueAtTime(0.0001,time+0.05);
  n.connect(f);f.connect(g);g.connect(this.gain);
  n.start(time);n.stop(time+0.06);
 },
 update(){
  if(!this.playing||!AudioSys.ctx)return;
  const ctx=AudioSys.ctx;
  while(this.nextNoteTime<ctx.currentTime+0.2){
   const chord=this.chords[this.barIdx%this.chords.length];
   this.bassNote(chord.bass[this.step],this.nextNoteTime,this.stepDur*0.95);
   if(this.step===0)this.pad(chord.tones,this.nextNoteTime,this.stepDur*8);
   if(this.step%2===1)this.tick(this.nextNoteTime);
   this.step++;
   if(this.step>=8){this.step=0;this.barIdx++;}
   this.nextNoteTime+=this.stepDur;
  }
 }
};

/* ============ cameras (5 modes incl. top-down, active one always labelled) ============ */
const cam={pos:V3(0,20,0),shake:0,orbA:0,smHdg:0,heliU:0,heliPos:null};
// Title-screen "director": cuts between a helicopter establishing shot, a
// close chase cam, a trackside TV angle and a slow orbit — like a real
// broadcast director cutting live between cameras on the leading pack —
// instead of one static flyover, so the attract screen actually looks like
// a race in progress.
const director={shot:'heli',timer:5,target:null};
function pickDirectorShot(){
 const shots=['heli','chase','chase','tv','tv','orbit'];
 director.shot=pick(shots);
 director.timer=director.shot==='heli'?rand(7,11):rand(4,7);
 if(cars.length){
  const sorted=[...cars].sort((a,b)=>b.key-a.key);
  const n=Math.min(4,sorted.length);
  director.target=sorted[Math.random()<0.6?0:Math.floor(rand(0,n))];
 }
}
function updCamera(dt){
 camera.up.set(0,1,0);
 if(!player||state.mode==='title'){
  director.timer-=dt;
  if(director.timer<=0||!director.target)pickDirectorShot();
  const tc=director.target&&cars.includes(director.target)?director.target:cars[0];
  if(tc&&director.shot==='chase'){
   const tp=tc.mesh.g.position,yaw=tc.hdg,fx=Math.sin(yaw),fz=Math.cos(yaw),sp=Math.abs(tc.vF);
   const back=8.4+sp*0.05,up=3.2+sp*0.014;
   cam.pos.x=damp(cam.pos.x,tp.x-fx*back,7,dt);
   cam.pos.y=damp(cam.pos.y,tp.y+up,6,dt);
   cam.pos.z=damp(cam.pos.z,tp.z-fz*back,7,dt);
   camera.position.copy(cam.pos);
   camera.lookAt(tp.x+fx*6,tp.y+1.2,tp.z+fz*6);
   camera.fov=damp(camera.fov,clamp(60+sp*0.24,60,80),4,dt);camera.updateProjectionMatrix();return;
  }else if(tc&&director.shot==='tv'&&T.tvCams.length){
   const tp=tc.mesh.g.position;
   let best=T.tvCams[0],bd=1e18;
   for(const c2 of T.tvCams){const d=(c2.x-tp.x)**2+(c2.z-tp.z)**2;if(d<bd){bd=d;best=c2;}}
   camera.position.copy(best);camera.lookAt(tp.x,tp.y+1,tp.z);
   camera.fov=damp(camera.fov,clamp(3200/(Math.sqrt(bd)+30),22,55),4,dt);camera.updateProjectionMatrix();return;
  }else if(tc&&director.shot==='orbit'){
   cam.orbA+=dt*0.45;
   const tp=tc.mesh.g.position;
   camera.position.set(tp.x+Math.sin(cam.orbA)*14,tp.y+5.5,tp.z+Math.cos(cam.orbA)*14);
   camera.lookAt(tp.x,tp.y+0.8,tp.z);
   camera.fov=damp(camera.fov,58,4,dt);camera.updateProjectionMatrix();return;
  }
  // Helicopter establishing shot: sweep along the whole circuit from high
  // above. Positions are interpolated between track samples (via sampleF)
  // rather than snapped to the nearest one, and the whole camera position is
  // then critically damped — real telemetry-derived tracks have some
  // sample-to-sample noise in their local normal, and swaying the camera
  // along that noisy, rapidly-rotating frame was what made it look "all over
  // the place". A slow, independent world-space drift plus damping fixes it.
  const N=T.N;
  cam.heliU=(cam.heliU+dt/40)%1;
  const f=cam.heliU*N;
  sampleF(f);
  const px=_sv.x,py=_sv.y,pz=_sv.z;
  sampleF((f+55)%N);
  const ax=_sv.x,ay=_sv.y,az=_sv.z;
  const swayX=Math.sin(timeSec*0.11)*30,swayZ=Math.cos(timeSec*0.077)*22;
  if(!cam.heliPos)cam.heliPos=V3(px+swayX,py+62,pz+swayZ);
  cam.heliPos.x=damp(cam.heliPos.x,px+swayX,3,dt);
  cam.heliPos.y=damp(cam.heliPos.y,py+62,3,dt);
  cam.heliPos.z=damp(cam.heliPos.z,pz+swayZ,3,dt);
  camera.position.copy(cam.heliPos);
  camera.lookAt(ax,ay+4,az);
  camera.fov=damp(camera.fov,50,4,dt);camera.updateProjectionMatrix();return;}
 const p=player,pp=p.mesh.g.position;
 const sp=Math.abs(p.vF);
 let tf=62;
 if(state.camMode===0){
  const yaw=p.hdg,fx=Math.sin(yaw),fz=Math.cos(yaw);
  const back=8.4+sp*0.05,up=3.2+sp*0.014;
  cam.pos.x=damp(cam.pos.x,pp.x-fx*back,7,dt);
  cam.pos.y=damp(cam.pos.y,pp.y+up,6,dt);
  cam.pos.z=damp(cam.pos.z,pp.z-fz*back,7,dt);
  camera.position.copy(cam.pos);
  camera.lookAt(pp.x+fx*6,pp.y+1.2,pp.z+fz*6);
  tf=clamp(60+sp*0.24,60,80);
 }else if(state.camMode===1){
  // "T-cam": mounted near the airbox/halo, behind the front axle, like the
  // real onboard camera — not out ahead of the front wheels. Putting the
  // camera forward of the axle (as before) meant a close, wide-FOV view
  // where the steering wheels' close-range parallax visibly swept over the
  // nose on lock; sitting behind and above the wheels with a narrower FOV
  // keeps them in view without that distortion.
  const yaw=p.hdg,fx=Math.sin(yaw),fz=Math.cos(yaw);
  camera.position.set(pp.x+fx*0.15,pp.y+1.42,pp.z+fz*0.15);
  camera.lookAt(pp.x+fx*40,pp.y+1.05,pp.z+fz*40);
  tf=58+sp*0.06;
 }else if(state.camMode===2){
  let best=T.tvCams[0],bd=1e18;
  for(const c of T.tvCams){const d=(c.x-pp.x)**2+(c.z-pp.z)**2;if(d<bd){bd=d;best=c;}}
  camera.position.copy(best);camera.lookAt(pp.x,pp.y+1,pp.z);
  tf=clamp(3200/(Math.sqrt(bd)+30),22,55);
 }else if(state.camMode===3){
  cam.orbA+=dt*0.4;
  camera.position.set(pp.x+Math.sin(cam.orbA)*13,pp.y+5.5,pp.z+Math.cos(cam.orbA)*13);
  camera.lookAt(pp.x,pp.y+0.8,pp.z);tf=58;
 }else{ /* top-down 2D — car always points up the screen */
  cam.smHdg=lerpAngle(cam.smHdg,p.hdg,1-Math.exp(-5*dt));
  const fx=Math.sin(cam.smHdg),fz=Math.cos(cam.smHdg);
  const cx0=pp.x+fx*8,cz0=pp.z+fz*8;
  camera.up.set(fx,0,fz);
  camera.position.set(cx0,pp.y+state.zoom,cz0);
  camera.lookAt(cx0,pp.y,cz0);
  tf=50;
 }
 if(cam.shake>0){cam.shake=Math.max(0,cam.shake-dt*1.6);
  camera.position.x+=rand(-1,1)*cam.shake*0.35;camera.position.y+=rand(-1,1)*cam.shake*0.3;}
 camera.fov=damp(camera.fov,tf,8,dt);camera.updateProjectionMatrix();
 // Both light and target track the car's real elevation (not a hardcoded 0),
 // so the shadow camera stays correctly aimed on hilly real-world circuits
 // instead of drifting off the actual ground and under-covering the scene.
 sunLight.position.set(pp.x+SUNDIR.x*260,pp.y+SUNDIR.y*260+40,pp.z+SUNDIR.z*260);
 sunLight.target.position.set(pp.x,pp.y,pp.z);
}


/* ============ HUD / minimap ============ */
const mmCtx=$('minimap').getContext('2d');
let mmPath=null,mmScale=1,mmOff={x:0,y:0};
function buildMinimapPath(){
 mmPath=document.createElement('canvas');mmPath.width=176;mmPath.height=176;
 const c=mmPath.getContext('2d');
 let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
 for(const s of T.samples){minX=Math.min(minX,s.p.x);maxX=Math.max(maxX,s.p.x);minZ=Math.min(minZ,s.p.z);maxZ=Math.max(maxZ,s.p.z);}
 mmScale=Math.min(156/(maxX-minX),156/(maxZ-minZ));
 mmOff={x:88-((minX+maxX)/2)*mmScale,y:88-((minZ+maxZ)/2)*mmScale};
 c.strokeStyle='rgba(244,241,234,.9)';c.lineWidth=4;c.lineJoin='round';c.beginPath();
 for(let i=0;i<=T.N;i+=6){const s=T.samples[i%T.N];
  const x=s.p.x*mmScale+mmOff.x,y=s.p.z*mmScale+mmOff.y;
  i===0?c.moveTo(x,y):c.lineTo(x,y);}
 c.closePath();c.stroke();
 c.fillStyle='#e10600';
 c.fillRect(T.samples[0].p.x*mmScale+mmOff.x-3,T.samples[0].p.z*mmScale+mmOff.y-3,6,6);
}
function drawMinimap(){
 mmCtx.clearRect(0,0,176,176);mmCtx.drawImage(mmPath,0,0);
 for(const c of cars){
  const x=c.mesh.g.position.x*mmScale+mmOff.x,y=c.mesh.g.position.z*mmScale+mmOff.y;
  mmCtx.fillStyle=c.isPlayer?'#ffffff':'#'+new THREE.Color(c.d.colB).getHexString();
  mmCtx.beginPath();mmCtx.arc(x,y,c.isPlayer?4:2.5,0,7);mmCtx.fill();
  if(c.isPlayer){mmCtx.strokeStyle='#e10600';mmCtx.lineWidth=2;mmCtx.stroke();}
 }
}
let msgTimer=0;
function showMsg(main,sub,cls,dur=2.2){
 $('hMsgMain').textContent=main;$('hMsgMain').className=cls||'';
 $('hMsgSub').textContent=sub||'';$('hMsg').classList.add('show');
 msgTimer=dur;
}
const rpmBars=[];
{const hr=$('hRpm');for(let i=0;i<12;i++){const b=document.createElement('i');hr.appendChild(b);rpmBars.push(b);}}
let lastPos=0,otCool=0,resultsShown=false,wwT=0;
let hudRefreshAcc=0;
function updHUD(dt){
 const p=player;if(!p)return;
 const t=T.samples[p.ti].t;
 const along=p.vx*t.x+p.vz*t.z;
 if(along<-3&&Math.abs(p.vF)>1)wwT+=dt;else wwT=0;
 if(msgTimer>0){msgTimer-=dt;if(msgTimer<=0)$('hMsg').classList.remove('show');}
 if(otCool>0)otCool-=dt;
 lastPos=p.pos;

 // The on-screen numbers (esp. the millisecond timer) don't need a DOM write
 // every rendered frame — at 60Hz the fast-changing digits just read as
 // flicker. Refreshing at ~12Hz is still perfectly responsive and reads as
 // a steady clock instead of a blur.
 hudRefreshAcc+=dt;
 if(hudRefreshAcc<0.08)return;
 hudRefreshAcc=0;

 $('hPos').textContent='P'+p.pos;$('hPosT').textContent=' / '+cars.length;
 $('hLap').textContent=clamp(p.lap,1,state.laps);
 $('hTime').textContent=p.finished?fmtT(p.finishTime):fmtT(raceT-p.lapStart);
 $('hBest').textContent=fmtT(p.best);
 const ah=cars.find(c=>c.key>p.key&&!c.isPlayer);
 $('hGap').textContent=ah&&Math.abs(p.vF)>8?fmtG((ah.key-p.key)*T.segLen/Math.abs(p.vF)):(p.pos===1?'LEADER':'—');
 $('hGear').textContent=p.vF<-0.5?'R':(Math.abs(p.vF)<0.5&&p.throttle===0?'N':p.gear);
 $('hGear').className=p.rpm>0.95?'hot':'';
 $('hSpeed').textContent=Math.round(Math.abs(p.vF)*3.6);
 const on=Math.round(p.rpm*12);
 rpmBars.forEach((b,i)=>{b.className=i<on?('on'+(p.rpm>0.96?' max':p.rpm>0.84?' hot':'')):'';});
 $('hDrs').className='chip drs'+(p.drsOpen?' on':'');
 $('slipTag').className=p.slipstream?'on':'';
 $('hWrong').className=(wwT>0.7&&!p.finished)?'':'hidden';
 drawMinimap();
}

/* ============ race flow ============ */
let raceT=0,cdT=0,cdGo=0,posTimer=0,towerRows=null,cdLastOn=0;
function beginRace(){
 state.name=$('tName').value.trim()||'YOU';
 Speech.enabled=$('tSpeech').classList.contains('on');
 TitleTheme.stop();
 $('title').classList.add('hidden');$('results').classList.add('hidden');$('pause').classList.add('hidden');
 $('hud').classList.remove('hidden');
 $('hLaps').textContent=state.laps;
 $('hWx').innerHTML=ICONS[state.wx]+'<span>'+WX[state.wx].label+'</span>';
 $('hCam').textContent=CAM_NAMES[state.camMode];
 snapWeather(state.wx);
 setupGrid(state.grid);
 raceT=0;cdT=0;cdGo=0;cdLastOn=0;resultsShown=false;wwT=0;
 if(towerRows){towerRows.clear();}
 const timingTowerEl=$('timingTower');if(timingTowerEl)timingTowerEl.innerHTML='';
 state.mode='countdown';state.paused=false;
 for(const c of cars)if(!c.isPlayer)c.reactT=rand(0.12,0.55);
 const yw=player.hdg;
 cam.pos.set(player.x-Math.sin(yw)*10,3.4,player.z-Math.cos(yw)*10);
 camera.position.copy(cam.pos);
 cam.smHdg=yw;cam.shake=0;
 $('lights').classList.remove('hidden');
 [...$('lights').children].forEach(li=>li.className='');
 T.lampMats.forEach(m=>m.color.set(0x230c0a));
 try{speechSynthesis.cancel();}catch(e){}
}
function updCountdown(dt){
 cdT+=dt;
 const lis=[...$('lights').children];
 const nOn=clamp(Math.floor((cdT-0.4)/0.9)+1,0,5);
 for(let i=0;i<5;i++){
  const on=i<nOn;
  lis[i].className=on?'on':'';
  T.lampMats[i].color.set(on?0xff1a1a:0x230c0a);
 }
 if(nOn>cdLastOn){AudioSys.beep(520,0.22);cdLastOn=nOn;}
 if(nOn===5&&!cdGo)cdGo=cdT+rand(0.7,1.5);
 player.throttle=keys.up?1:0;player.brake=0;player.steer=0;
 for(const c of cars){
  placeCar(c);
  c.audioRpm=c.isPlayer?clamp(0.12+player.throttle*0.85,0.12,0.97)
   :clamp(0.14+0.4*(0.5+0.5*Math.sin(timeSec*(2.2+c.phase*0.3)+c.phase)),0.12,0.6);
 }
 // placeCar() only resets position/heading — without this the cars keep
 // whatever wheel angle/brake-light/suspension pose they had on the last
 // attract-mode frame, frozen through the whole lights sequence, which is
 // why they'd "sort themselves out" the instant the race actually starts.
 for(const c of cars)updCarVisual(c,dt);
 if(cdGo&&cdT>cdGo){
  lis.forEach(li=>li.className='');
  T.lampMats.forEach(m=>m.color.set(0x230c0a));
  AudioSys.beep(300,0.3);
  state.mode='race';raceT=0;
  for(const c of cars)c.lapStart=0;
  $('lights').classList.add('hidden');
  showMsg('LIGHTS OUT','GO GO GO','green',1.6);
  Speech.say(pick(LINES.start),true,{rate:1.15,pitch:1.05});
 }
}
function onLap(c){
 if(state.mode!=='race'){return;} // attract-mode cars just loop forever — gridPlace() resets laps before a real race
 if(c.lap>state.laps&&!c.finished){
  c.finished=true;c.finishTime=raceT;
  if(c.isPlayer)finishRace();
  return;
 }
 const lt=raceT-c.lapStart;c.lapStart=raceT;
 // c.lap was just incremented above: on the very first crossing since the
 // grid start it goes 0→1, which is only the short hop from the grid to
 // the line, not a completed lap — a genuine lap-1 time only exists once
 // c.lap reaches 2 (the SECOND crossing, line to line). Gating on elapsed
 // time alone was fragile: a slow-starting car easily out-lasted the old
 // 5-second cutoff and got credited with a "fastest lap" for that partial
 // hop. lt>5 stays only as a sanity floor against a degenerate track.
 if(c.lap>1&&lt>5&&(c.best==null||lt<c.best)){
  c.best=lt;
  if(c.isPlayer&&state.mode==='race'){showMsg('FASTEST LAP',fmtT(lt),'purple',2);Speech.say(LINES.fastest,false,{rate:1.06,pitch:1.02});}
 }
 if(c.isPlayer&&state.mode==='race'){
  if(c.lap===state.laps){showMsg('FINAL LAP','P'+c.pos,'red',2.2);Speech.say(LINES.final,true,{rate:1.14,pitch:1.04});}
  else if(c.lap>1)showMsg('LAP '+c.lap,'','white',1.2);
  if(c.pos===1&&c.lap>1)Speech.say(LINES.lead,false,{rate:0.94,pitch:0.96});
 }
}
function finishRace(){
 state.mode='finished';
 const pPos=player.pos;
 confetti(player.x,1,player.z);
 showMsg('CHEQUERED FLAG','P'+pPos,pPos===1?'green':'',3);
 if(pPos===1)Speech.say(LINES.win,true,{rate:1.2,pitch:1.08});
 else if(pPos<=3)Speech.say(LINES.podium,true,{rate:1.1,pitch:1.04});
 else Speech.say(pick(LINES.finish).replace('{n}',pPos),true,{rate:0.96,pitch:0.98});
 setTimeout(showResults,2800);
}
function showResults(){
 if(resultsShown)return;resultsShown=true;
 const sorted=[...cars].sort((a,b)=>b.key-a.key);
 const leader=sorted[0];
 $('rTitle').textContent=player.pos===1?'VICTORY':'CHEQUERED FLAG';
 $('rSub').textContent=TRACKS[state.trackIdx].name.toUpperCase()+' · '+WX[state.wx].label+' · '+state.laps+' LAPS';
 let html='';
 sorted.forEach((c,i)=>{
  let gap;
  if(c.finished&&leader.finished)gap=c===leader?fmtT(c.finishTime):fmtG(c.finishTime-leader.finishTime);
  else gap=c.finished?fmtT(c.finishTime):fmtG((leader.key-c.key)*T.segLen/Math.max(Math.abs(c.vF),15));
  const bl=c.best?fmtT(c.best):'—';
  html+=`<div class="rrow${c.isPlayer?' me':''}"><span class="rp">${i+1}</span>
   <span class="sw" style="background:${c.d.colB}"></span>
   <span class="rn">${c.d.name}<small>${c.d.team}</small></span>
   <span class="rt">${bl}</span><span class="rb">${gap}</span></div>`;
 });
 $('rTable').innerHTML=html;
 $('results').classList.remove('hidden');
}
function toTitle(){
 state.mode='title';state.paused=false;
 $('hud').classList.add('hidden');$('results').classList.add('hidden');$('pause').classList.add('hidden');
 $('title').classList.remove('hidden');
 try{speechSynthesis.cancel();}catch(e){}
 snapWeather(state.wx);
 setupGrid(20);
 attractT=6;
 TitleTheme.start();
}
function resetPlayer(){
 const p=player;if(!p||state.mode==='title')return;
 projectCar(p,true);
 const s=T.samples[p.ti];
 p.x=s.p.x;p.z=s.p.z;
 p.hdg=Math.atan2(s.t.x,s.t.z);
 p.vx=0;p.vz=0;p.vF=0;p.lat=0;
 p.f=p.ti;p._pf=p.f;
 p.y=getRoadHAtCoords(p.x,p.z);p.vy=0;p.airborne=false;p.pitch=0;p.bounceOff=0;p.bounceVel=0;
 placeCar(p);
}
function updRace(dt){
 raceT+=dt;
 for(const c of cars){
  if(c.isPlayer){if(!c.finished)playerControl();else aiThink(c,dt);}
  else aiThink(c,dt);
  if(c.finished){c.throttle=Math.min(c.throttle,0.35);c.brake=0;}
  updCar(c,dt);
 }
 for(const c of cars)c.key=c.lap*T.N+c.f;
 carCollisions();
 for(const c of cars)updCarVisual(c,dt);
 posTimer-=dt;
 if(posTimer<=0){posTimer=0.25;
  const sorted=[...cars].sort((a,b)=>b.key-a.key);
  sorted.forEach((c,i)=>c.pos=i+1);

  const timingTowerEl = $('timingTower');
  if (timingTowerEl) {
   if (!towerRows) towerRows = new Map();
   const leader = sorted[0];
   const seen = new Set();
   sorted.forEach((c, i) => {
    let gapText;
    if (i === 0) {
     gapText = 'LAP ' + clamp(c.lap, 1, state.laps);
    } else {
     const gapVal = (leader.key - c.key) * T.segLen / Math.max(Math.abs(c.vF), 15);
     gapText = '+' + gapVal.toFixed(1) + 's';
    }
    const headshotUrl = getDriverHeadshot(c.d);
    const driverCode = c.d.code || c.d.name.split(' ').pop().substring(0, 3).toUpperCase();
    const key = c.d.num != null ? c.d.num : c.d.name;
    seen.add(key);
    let row = towerRows.get(key);
    if (!row) {
     row = document.createElement('div');
     row.innerHTML = `<div class="tower-pos"></div><div class="tower-color"></div><img class="tower-img" referrerPolicy="no-referrer"><div class="tower-code"></div><div class="tower-gap"></div>`;
     row._els = {
      pos: row.querySelector('.tower-pos'),
      color: row.querySelector('.tower-color'),
      img: row.querySelector('.tower-img'),
      code: row.querySelector('.tower-code'),
      gap: row.querySelector('.tower-gap'),
     };
     towerRows.set(key, row);
    }
    // Only touch the <img src> when the photo actually changes, so the
    // rolling tower's per-tick refresh never forces headshots to re-decode.
    row.className = 'tower-row' + (c.isPlayer ? ' me' : '');
    row._els.pos.textContent = i + 1;
    row._els.color.style.background = c.d.colB || '#888888';
    if (row._els.img.src !== headshotUrl) row._els.img.src = headshotUrl;
    row._els.code.textContent = driverCode;
    row._els.gap.textContent = gapText;
    timingTowerEl.appendChild(row);
   });
   for (const [key, row] of towerRows) {
    if (!seen.has(key)) { row.remove(); towerRows.delete(key); }
   }
  }

  if(player.pos<lastPos&&state.mode==='race'&&otCool<=0&&player.pos>0){
   otCool=4;
   if(player.pos<=3)Speech.say(LINES.podium,false,{rate:1.12,pitch:1.05});
   else Speech.say(pick(LINES.overtake).replace('{n}',player.pos),false,{rate:1.08,pitch:1.03});
   showMsg('OVERTAKE','P'+player.pos,'green',1.4);
  }
  lastPos=player.pos;
 }
 let nd=1e9,nr=0;
 for(const c of cars){if(c.isPlayer)continue;
  const d=Math.hypot(c.x-player.x,c.z-player.z);
  if(d<nd){nd=d;nr=c.rpm;}}
 player.near=nd<60?{dist:nd,rpm:nr}:null;
 updHUD(dt);
}
function updAmbient(dt){
 for(const f of T.flags)f.rotation.y=Math.sin(timeSec*2+f.userData.ph)*0.45;
 if(T.crowd&&T.crowd.userData.crowd){
  const dummy=new THREE.Object3D();
  T.crowd.userData.crowd.forEach((p,i)=>{
   dummy.position.set(p.x,p.y+Math.abs(Math.sin(timeSec*2.6+p.ph))*0.16,p.z);
   dummy.rotation.set(0,p.yaw,0);
   dummy.updateMatrix();T.crowd.setMatrixAt(i,dummy.matrix);});
  T.crowd.instanceMatrix.needsUpdate=true;
 }
}
function updTitle(dt){
 // Attract mode: the whole grid actually races round the selected circuit
 // (AI-driven, no player) so the title screen shows a real race in progress
 // instead of cars sitting idle on the grid.
 for(const c of cars){aiThink(c,dt);updCar(c,dt);}
 for(const c of cars)c.key=c.lap*T.N+c.f;
 carCollisions();
 for(const c of cars)updCarVisual(c,dt);
 updAmbient(dt);
 attractT-=dt;
 if(attractT<=0){attractT=14+rand(0,8);
  const leader=[...cars].sort((a,b)=>b.key-a.key)[0];
  Speech.say(pick(ATT_LINES).replace('{track}',TRACKS[state.trackIdx].name).replace('{loc}',TRACKS[state.trackIdx].loc).replace('{leader}',leader?leader.d.name:DRIVERS[0][0]),false,{rate:0.92,pitch:0.96});}
}
let attractT=6;

/* ============ input ============ */
let dtGlobal=0.016;
let rainPass=null,snowPass=null;
let qualityMgr=null;

function toggleFullscreen(){
 try{
  if(!document.fullscreenElement){
   document.documentElement.requestFullscreen().catch(()=>{});
  }else{
   if(document.exitFullscreen)document.exitFullscreen().catch(()=>{});
  }
 }catch(e){}
}

addEventListener('keydown',e=>{
 if(e.repeat)return;
 const k=e.code;
 if(k==='ArrowUp'||k==='KeyW')keys.up=true;
 if(k==='ArrowDown'||k==='KeyS')keys.down=true;
 if(k==='ArrowLeft'||k==='KeyA')keys.left=true;
 if(k==='ArrowRight'||k==='KeyD')keys.right=true;
 if(k==='Space'){keys.space=true;e.preventDefault();}
 if(k==='KeyC')cycleCam();
 if(k==='KeyF')toggleFullscreen();
 if(k==='Equal'||k==='NumpadAdd')state.zoom=Math.max(20,state.zoom-5);
 if(k==='Minus'||k==='NumpadSubtract')state.zoom=Math.min(150,state.zoom+5);
 if(k==='KeyR')resetPlayer();
 if(k==='KeyM'){state.muted=!state.muted;AudioSys.setMute(state.muted);}
 if(k==='Escape')togglePause();
 if(AudioSys.started&&AudioSys.ctx.state==='suspended')AudioSys.ctx.resume();
});
addEventListener('keyup',e=>{
 const k=e.code;
 if(k==='ArrowUp'||k==='KeyW')keys.up=false;
 if(k==='ArrowDown'||k==='KeyS')keys.down=false;
 if(k==='ArrowLeft'||k==='KeyA')keys.left=false;
 if(k==='ArrowRight'||k==='KeyD')keys.right=false;
 if(k==='Space')keys.space=false;
});
addEventListener('wheel', e => {
  if (state.camMode === 4) { // Only zoom in top down view
    state.zoom += Math.sign(e.deltaY) * 5;
    state.zoom = Math.max(20, Math.min(150, state.zoom));
  }
}, {passive: true});

function cycleCam(){
 state.camMode=(state.camMode+1)%CAM_NAMES.length;
 const n=CAM_NAMES[state.camMode];
 if($('hCam'))$('hCam').textContent=n;
 if($('hCamChip'))$('hCamChip').textContent=n;
 const t=$('camToast');
 if(t){
   t.textContent=n+' CAMERA';t.classList.add('show');
   clearTimeout(cycleCam._t);cycleCam._t=setTimeout(()=>t.classList.remove('show'),1100);
 }
}
function togglePause(){
 if(state.mode==='title'||state.mode==='finished')return;
 state.paused=!state.paused;
 $('pause').classList.toggle('hidden',!state.paused);
 if(state.paused)try{speechSynthesis.cancel();}catch(e){}
}
function bindTouch(id,down,up){
 const el=$(id);
 if(!el)return;
 el.addEventListener('pointerdown',e=>{e.preventDefault();down();});
 el.addEventListener('pointerup',up);
 el.addEventListener('pointerleave',up);
 el.addEventListener('pointercancel',up);
}

bindTouch('tG',()=>keys.up=true,()=>keys.up=false);
bindTouch('tB',()=>keys.down=true,()=>keys.down=false);
bindTouch('tL',()=>keys.left=true,()=>keys.left=false);
bindTouch('tR',()=>keys.right=true,()=>keys.right=false);
bindTouch('tDrift',()=>keys.space=true,()=>keys.space=false);

// Tilt specific controls (Ergonomic triggers)
bindTouch('tTiltGas',()=>keys.up=true,()=>keys.up=false);
bindTouch('tTiltBrake',()=>keys.down=true,()=>keys.down=false);
bindTouch('tTiltDrift',()=>tiltCtrl.drift=true,()=>tiltCtrl.drift=false);
if($('tTiltCal'))$('tTiltCal').addEventListener('pointerdown',e=>{e.preventDefault();tiltCtrl.calibrate();});

if($('tC'))$('tC').addEventListener('pointerdown',e=>{e.preventDefault();cycleCam();});
if($('hCamChip'))$('hCamChip').addEventListener('click',e=>{e.preventDefault();cycleCam();});

if($('tFs'))$('tFs').onclick=toggleFullscreen;
if($('tFootFs'))$('tFootFs').onclick=toggleFullscreen;
if($('hFsChip'))$('hFsChip').onclick=toggleFullscreen;
if($('pFs'))$('pFs').onclick=toggleFullscreen;
if($('hPauseChip'))$('hPauseChip').onclick=togglePause;

if($('hZoomIn'))$('hZoomIn').onclick=()=>{state.zoom=Math.max(20,state.zoom-8);};
if($('hZoomOut'))$('hZoomOut').onclick=()=>{state.zoom=Math.min(150,state.zoom+8);};

// Tilt mode menu buttons & chips
if($('btnTiltMode')){
 $('btnTiltMode').onclick = async (e) => {
   e.preventDefault();
   await tiltCtrl.enable();
   tiltCtrl.showToast('GYROSCOPE ACTIVE');
 };
}
if($('btnTouchMode')){
 $('btnTouchMode').onclick = (e) => {
   e.preventDefault();
   tiltCtrl.disable();
   tiltCtrl.showToast('TOUCH CONTROLS ACTIVE');
 };
}
if($('btnOpenGyroLab')){
 $('btnOpenGyroLab').onclick = async (e) => {
   e.preventDefault();
   await gyroLab.open();
 };
}
if($('pOpenGyroLab')){
 $('pOpenGyroLab').onclick = async (e) => {
   e.preventDefault();
   await gyroLab.open();
 };
}
if($('hTiltChip'))$('hTiltChip').onclick = async () => {
 await tiltCtrl.toggle();
};
if($('pTiltToggle'))$('pTiltToggle').onclick = async () => {
 await tiltCtrl.toggle();
};
if($('pSwapAxis'))$('pSwapAxis').onclick = () => {
 tiltCtrl.swapSteerAxis();
};
if($('pInvertSteer'))$('pInvertSteer').onclick = () => {
 tiltCtrl.toggleInvertSteer();
};
if($('pZeroCal'))$('pZeroCal').onclick = () => {
 tiltCtrl.calibrate();
};
if($('tiltCalBtn'))$('tiltCalBtn').onclick = () => {
 tiltCtrl.calibrate();
};
if($('tiltSensBtn'))$('tiltSensBtn').onclick = () => tiltCtrl.cycleSensitivity();

// Sensitivity selectors
if($('tTiltSens')){
 [...$('tTiltSens').children].forEach(btn => {
   btn.onclick = () => {
     const idx = parseInt(btn.dataset.idx, 10);
     tiltCtrl.setSensitivity(idx);
   };
 });
}
if($('pTiltSens')){
 [...$('pTiltSens').children].forEach(btn => {
   btn.onclick = () => {
     const idx = parseInt(btn.dataset.idx, 10);
     tiltCtrl.setSensitivity(idx);
   };
 });
}

if('ontouchstart'in window||navigator.maxTouchPoints>0)document.body.classList.add('touch');
addEventListener('blur',()=>{if(state.mode==='race'&&!state.paused)togglePause();});

/* ============ menu UI ============ */
function seg(container,items,cur,cb){
 const el=$(container);if(!el)return;el.innerHTML='';
 items.forEach((it,i)=>{const b=document.createElement('button');
  b.innerHTML=it;b.className=i===cur?'sel':'';
  b.onclick=()=>{[...el.children].forEach(x=>x.className='');b.className='sel';cb(i);};
  el.appendChild(b);});
}
function drawTrackPreview(cv,t){
 const W=cv.width,H=cv.height;
 const c=cv.getContext('2d');
 const pv=(Array.isArray(t.realPts)&&t.realPts.length>20)?t.realPts.map(p=>[p[0],p[2]]):t.pts;
 let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
 pv.forEach(p=>{minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minZ=Math.min(minZ,p[1]);maxZ=Math.max(maxZ,p[1]);});
 const spanX=Math.max(maxX-minX,1);
 const spanZ=Math.max(maxZ-minZ,1);
 const s=Math.min((W-24)/spanX,(H-16)/spanZ);
 const cx=W/2,cy=H/2;

 c.clearRect(0,0,W,H);
 c.fillStyle='rgba(18,20,24,0.6)';
 c.fillRect(0,0,W,H);
 c.strokeStyle='rgba(225,6,0,0.3)';
 c.lineWidth=Math.max(4,W*0.05);
 c.lineCap='round';
 c.lineJoin='round';
 c.beginPath();
 pv.forEach((p,j)=>{const x=cx+(p[0]-(minX+maxX)/2)*s,y=cy+(p[1]-(minZ+maxZ)/2)*s;j===0?c.moveTo(x,y):c.lineTo(x,y);});
 c.closePath();c.stroke();

 c.strokeStyle='#f4f1ea';c.lineWidth=Math.max(1.6,W*0.018);
 c.beginPath();
 pv.forEach((p,j)=>{const x=cx+(p[0]-(minX+maxX)/2)*s,y=cy+(p[1]-(minZ+maxZ)/2)*s;j===0?c.moveTo(x,y):c.lineTo(x,y);});
 c.closePath();c.stroke();

 // Start line dot
 c.fillStyle='#e10600';
 const startX=cx+(pv[0][0]-(minX+maxX)/2)*s, startY=cy+(pv[0][1]-(minZ+maxZ)/2)*s;
 c.beginPath();c.arc(startX,startY,Math.max(2,W*0.028),0,Math.PI*2);c.fill();
}
function buildMenu(){
 const dd=$('tTrack');const list=$('tTrackList');const btn=$('tTrackBtn');
 if(!dd||!list||!btn)return;
 list.innerHTML='';
 const btnPv=$('tTrackBtnPv'),btnName=$('tTrackBtnName'),btnMeta=$('tTrackBtnMeta');
 function setButton(i){
  const t=TRACKS[i];
  drawTrackPreview(btnPv,t);
  btnName.textContent=t.name;
  btnMeta.textContent=`${t.loc} — ${t.desc}`;
 }
 function closeList(){dd.classList.remove('open');list.classList.add('hidden');}
 function openList(){dd.classList.add('open');list.classList.remove('hidden');}
 TRACKS.forEach((t,i)=>{
  const card=document.createElement('div');card.className='card'+(i===state.trackIdx?' sel':'');
  const cv=document.createElement('canvas');cv.width=140;cv.height=70;
  drawTrackPreview(cv,t);
  const info=document.createElement('div');
  info.innerHTML=`<div class="cn">${t.name}</div><div class="cm">${t.loc} — ${t.desc}</div>`;
  card.append(cv,info);
  card.onclick=()=>{[...list.children].forEach(x=>x.classList.remove('sel'));card.classList.add('sel');
   state.trackIdx=i;setButton(i);closeList();
   buildWorld(i);snapWeather(state.wx);setupGrid(20);};
  list.appendChild(card);
 });
 setButton(state.trackIdx);
 btn.onclick=()=>{dd.classList.contains('open')?closeList():openList();};
 if(!dd._ddWired){
  dd._ddWired=true;
  document.addEventListener('click',e=>{if(!dd.contains(e.target))closeList();});
 }

 seg('tWeather',['SUNNY','DRIZZLE','RAIN','SNOW'].map((l,i)=>ICONS[['sun','driz','rain','snow'][i]]+'<span>'+l+'</span>'),0,
  i=>{state.wx=['sun','driz','rain','snow'][i];snapWeather(state.wx);});
 seg('tTod',['DAY','DUSK','NIGHT'],0,
  i=>{state.tod=['day','dusk','night'][i];applyWeatherVisuals();refreshEnv();});
 seg('tLaps',['3 LAPS','5 LAPS','8 LAPS'],0,i=>state.laps=[3,5,8][i]);
 seg('tGrid',['10 CARS','14 CARS','20 CARS'],2,i=>state.grid=[10,14,20][i]);
 seg('tDiff',['RELAXED','NORMAL','PRO'],1,i=>state.diffMul=[0.88,0.97,1.05][i]);
 
 const qModes=['ULTRA','HIGH','MED','LOW'];
 seg('tQuality',qModes,1,i=>{
   state.quality=qModes[i];
   if(qualityMgr)qualityMgr.apply(state.quality);
   // Rebuild immediately so prop density / terrain resolution changes are
   // visible right away on the title screen, not just next race.
   if(state.mode==='title')buildWorld(state.trackIdx);
 });
 seg('pQuality',qModes,1,i=>{
   state.quality=qModes[i];
   if(qualityMgr)qualityMgr.apply(state.quality);
 });

 $('tSpeech').onclick=()=>{const b=$('tSpeech');b.classList.toggle('on');
  b.textContent=b.classList.contains('on')?'VOICE ON':'VOICE OFF';};
 $('tName').onchange=()=>{
  const nm=$('tName').value.trim();
  if(!nm||nm===lastEncouragedName)return;
  lastEncouragedName=nm;
  Speech.enabled=$('tSpeech').classList.contains('on');
  Speech.say(pick(ENCOURAGE_LINES).replace('{name}',nm),true,{rate:0.85,pitch:1.03});
 };
 $('tName').onkeydown=e=>{if(e.key==='Enter')$('tName').blur();};
 $('tStart').onclick=()=>{AudioSys.start();
  if(AudioSys.ctx&&AudioSys.ctx.state==='suspended')AudioSys.ctx.resume();
  beginRace();};
 $('tInst').onclick=()=>{$('instructions').classList.remove('hidden');};
 if($('iClose'))$('iClose').onclick=()=>{$('instructions').classList.add('hidden');};
 if($('iStartBtn'))$('iStartBtn').onclick=()=>{$('instructions').classList.add('hidden');$('tStart').click();};
 $('rRestart').onclick=()=>beginRace();
 $('rMenu').onclick=()=>toTitle();
 $('pResume').onclick=()=>togglePause();
 $('pRestart').onclick=()=>beginRace();
 $('pQuit').onclick=()=>toTitle();
}

/* ============ main loop ============ */
let last=nowT();
function tick(){
 requestAnimationFrame(tick);
 const t=nowT();
 let dt=Math.min(t-last,0.05);last=t;
 dtGlobal=state.paused?0:dt;
 // An uncaught error anywhere in the per-mode update logic used to abort the
 // rest of tick() for every subsequent frame — including the render call
 // below — which would freeze the canvas on its last good frame with no
 // visible sign anything was wrong (e.g. attract-mode racing silently
 // dying). Catching here means a bug degrades to a console error instead of
 // a dead screen.
 try{
  if(dtGlobal>0){
   timeSec+=dtGlobal;
   if(state.mode==='countdown')updCountdown(dtGlobal);
   else if(state.mode==='race'||state.mode==='finished')updRace(dtGlobal);
   else if(state.mode==='title')updTitle(dtGlobal);
   if(state.mode!=='title')updAmbient(dtGlobal);
   updPoints(smoke,dtGlobal,2.2);
   updPoints(sparks,dtGlobal,0.4);
   updWeatherFX(dtGlobal);
   updLens(dtGlobal);
   updClouds(dtGlobal);
   updBirds(dtGlobal);
   updLightning(dtGlobal);
   updSnow(dtGlobal);
  }
  updCamera(state.paused?0.0001:dtGlobal);
  AudioSys.update();
  TitleTheme.update();
 }catch(err){
  console.error('[tick] update error:',err);
 }

 // Windshield rain — real refraction of the rendered scene, eased off at
 // speed (wind clears the glass) and boosted by thunderstorm flashes.
 try{
  const rainShaderOn=(QUALITY_PRESETS[state.quality]||{}).rainShader!==false;
  const speedKmh=player?Math.abs(player.vF)*3.6:0;
  const speedFactor=clamp(speedKmh/280,0,1);
  const effRain=cur.rain*lerp(1.0,0.22,speedFactor);
  if(rainPass && rainShaderOn && state.mode!=='title' && (effRain>0.01||lightningFlash>0.01)){
   rainPass.renderScene(scene,camera);
   rainPass.composite(timeSec,effRain,speedKmh,lightningFlash);
  }else{
   renderer.render(scene,camera);
  }
  // Falling snow — a pure screen overlay (no scene refraction needed), drawn
  // on top of whatever just rendered above. Gets harder in gusts (snowGustCur).
  if(snowPass && rainShaderOn && cur.snow>0.05){
   snowPass.composite(timeSec,clamp(cur.snow,0,1),snowGustCur);
  }
 }catch(err){
  console.error('[tick] render error:',err);
 }
}
function resize(){
 renderer.setSize(innerWidth,innerHeight);
 camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
 sizeDrops();
 if(rainPass)rainPass.resize();
 if(snowPass)snowPass.resize();
}
addEventListener('resize',resize);
addEventListener('orientationchange',()=>setTimeout(resize,120));

/* ============ boot ============ */
rainPass = new RainShaderPass(renderer);
snowPass = new SnowShaderPass(renderer);
qualityMgr = new QualityManager(renderer, sunLight, rainPass);
qualityMgr.apply('HIGH');

gyroLab.init();
resize();
buildMenu();
buildWorld(0);
makeClouds();
makeBirds();
snapWeather('sun');
setupGrid(20);
loadOpenF1Drivers().then(() => {
 setupGrid(20);
});
loadRealCircuits(TRACKS).then(() => {
 buildWorld(state.trackIdx);
 buildMenu();
 setupGrid(20);
});
state.mode='title';
tiltCtrl.updateUI();
tick();

// Browsers won't let audio play before a user gesture, so the title theme
// can't just start at boot — pick it up on whatever the player touches
// first (a settings button, a key) while still on the title screen.
function unlockAudioForTitle(){
 if(!AudioSys.started)AudioSys.start();
 if(AudioSys.ctx&&AudioSys.ctx.state==='suspended')AudioSys.ctx.resume();
 if(state.mode==='title')TitleTheme.start();
 removeEventListener('pointerdown',unlockAudioForTitle);
 removeEventListener('keydown',unlockAudioForTitle);
}
addEventListener('pointerdown',unlockAudioForTitle);
addEventListener('keydown',unlockAudioForTitle);

