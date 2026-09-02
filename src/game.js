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
import { PostFX } from './postfx.js';

/* ============ helpers ============ */
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const smoothstep01=(t)=>{const x=t<0?0:t>1?1:t;return x*x*(3-2*x);};
const rand=(a,b)=>a+Math.random()*(b-a);
const damp=(a,b,l,dt)=>lerp(a,b,1-Math.exp(-l*dt));
const pick=a=>a[Math.floor(Math.random()*a.length)];
const V3=(x,y,z)=>new THREE.Vector3(x,y,z);
const nowT=()=>performance.now()/1000;
const wrapA=a=>Math.atan2(Math.sin(a),Math.cos(a));
const lerpAngle=(a,b,t)=>a+wrapA(b-a)*t;
function fmtT(t){if(t==null||!isFinite(t))return'—';const m=Math.floor(t/60),s=t-m*60;return m+':'+s.toFixed(3).padStart(6,'0');}
function fmtG(t){if(t==null)return'—';return'+'+t.toFixed(3);}
// The concrete graphics tier actually in use — resolves AUTO (which adapts to
// the device's measured FPS) down to one of ULTRA/HIGH/MED/LOW for the
// rendering decisions (ground resolution, prop density, rain shader, etc.).
function effQuality(){ return (qualityMgr&&qualityMgr.resolvedLevel)?qualityMgr.resolvedLevel():state.quality; }

const state={mode:'boot',trackIdx:0,wx:'sun',tod:'day',laps:3,grid:20,diffMul:0.97,name:'YOU',driverPhoto:'',camMode:0,muted:false,paused:false,zoom: 52,quality:'AUTO'};
const PROFILE_KEY='polygon_gp_driver_profile_v1';
function loadDriverProfile(){try{const p=JSON.parse(localStorage.getItem(PROFILE_KEY)||'{}');state.name=p.name||'YOU';state.driverPhoto=p.photo||'';}catch(e){}}
function saveDriverProfile(){try{localStorage.setItem(PROFILE_KEY,JSON.stringify({name:state.name,photo:state.driverPhoto}));}catch(e){console.warn('Driver profile could not be stored',e);}}
loadDriverProfile();
// Time-of-day mood, independent of weather — mainly to give control over how
// dark a rainy day reads, without needing a whole night skybox/lighting rig.
/* Each time of day carries the direction the light comes from as well as its
   strength: a low sun is not just a dimmer sun, it is long shadows, warm
   raking light on the cars and a horizon that burns. */
const TOD={
 day :{sunMul:1.0,hMul:1.0,expMul:1.0,skyMul:1.0,el:0.92,az:0.7 ,haze:0.0 ,stars:0.0,cool:0.0},
 dusk:{sunMul:0.72,hMul:0.8,expMul:1.08,skyMul:0.78,el:0.13,az:1.9 ,haze:0.9 ,stars:0.15,cool:0.15},
 night:{sunMul:0.22,hMul:0.42,expMul:1.35,skyMul:0.3,el:0.28,az:3.6 ,haze:0.25,stars:1.0,cool:0.55}
};
const CAM_NAMES=['CHASE','HOOD','HELMET','TV','ORBIT','TOP'];

/* ============ drivers ============ */
// 2026 season grid — real team colours (OpenF1 / F1 live-timing hexes).
// [name, team, skill, num, colA, colB, helmet]
const DRIVERS=[
['Lando Norris','McLaren',1.00,1,'#F47600','#47C7FC','#F47600'],
['Oscar Piastri','McLaren',0.955,81,'#F47600','#47C7FC','#47C7FC'],
['Max Verstappen','Red Bull Racing',0.99,3,'#4781D7','#FFC800','#FFC800'],
['Isack Hadjar','Red Bull Racing',0.88,6,'#4781D7','#FFC800','#1b2a5e'],
['Charles Leclerc','Ferrari',0.96,16,'#ED1131','#FFE600','#ED1131'],
['Lewis Hamilton','Ferrari',0.955,44,'#ED1131','#FFE600','#FFE600'],
['George Russell','Mercedes',0.94,63,'#00D7B6','#0A0E12','#00D7B6'],
['Kimi Antonelli','Mercedes',0.90,12,'#00D7B6','#0A0E12','#0A0E12'],
['Fernando Alonso','Aston Martin',0.93,14,'#229971','#CEDC00','#CEDC00'],
['Lance Stroll','Aston Martin',0.86,18,'#229971','#CEDC00','#229971'],
['Alexander Albon','Williams',0.90,23,'#1868DB','#E8EEF5','#E8EEF5'],
['Carlos Sainz','Williams',0.93,55,'#1868DB','#E8EEF5','#1868DB'],
['Nico Hülkenberg','Audi',0.89,27,'#F50537','#101418','#101418'],
['Gabriel Bortoleto','Audi',0.86,5,'#F50537','#101418','#F50537'],
['Pierre Gasly','Alpine',0.90,10,'#00A1E8','#FF87BC','#FF87BC'],
['Franco Colapinto','Alpine',0.87,43,'#00A1E8','#FF87BC','#00A1E8'],
['Esteban Ocon','Haas F1 Team',0.88,31,'#9C9FA2','#E10600','#E10600'],
['Oliver Bearman','Haas F1 Team',0.86,87,'#9C9FA2','#E10600','#9C9FA2'],
['Liam Lawson','Racing Bulls',0.87,30,'#6C98FF','#F2F2F2','#6C98FF'],
['Arvid Lindblad','Racing Bulls',0.84,41,'#6C98FF','#F2F2F2','#F2F2F2'],
['Sergio Pérez','Cadillac',0.88,11,'#909090','#101418','#101418'],
['Valtteri Bottas','Cadillac',0.87,77,'#909090','#101418','#909090'],
];
/* ============ driver personas ============
   agg — how aggressively they attack/commit to overtakes
   defend — how hard they defend position when attacked (blocking the
            inside line, breaking the slipstream)
   risk — how often they crack under pressure and make a mistake
   The famous names get their real-world styles; everyone else gets a
   sensible default derived from skill. */
const DRIVER_PERSONA={
 'VERSTAPPEN':{agg:1.0,defend:1.0,risk:0.85},
 'HADJAR':{agg:0.85,defend:0.65,risk:0.8},
 'NORRIS':{agg:0.9,defend:0.8,risk:0.6},
 'HAMILTON':{agg:0.8,defend:0.9,risk:0.5},
 'LECLERC':{agg:0.95,defend:0.65,risk:0.8},
 'PIASTRI':{agg:0.8,defend:0.85,risk:0.45},
 'RUSSELL':{agg:0.8,defend:0.75,risk:0.55},
 'ANTONELLI':{agg:0.85,defend:0.6,risk:0.75},
 'ALONSO':{agg:0.6,defend:1.0,risk:0.35},
 'SAINZ':{agg:0.7,defend:0.8,risk:0.5},
 'STROLL':{agg:0.6,defend:0.7,risk:0.5},
 'ALBON':{agg:0.7,defend:0.7,risk:0.5},
 'HULKENBERG':{agg:0.55,defend:0.75,risk:0.4},
 'BORTOLETO':{agg:0.75,defend:0.65,risk:0.6},
 'GASLY':{agg:0.85,defend:0.7,risk:0.7},
 'COLAPINTO':{agg:0.85,defend:0.6,risk:0.8},
 'OCON':{agg:0.65,defend:0.8,risk:0.5},
 'BEARMAN':{agg:0.8,defend:0.7,risk:0.7},
 'LAWSON':{agg:0.9,defend:0.7,risk:0.8},
 'LINDBLAD':{agg:0.8,defend:0.6,risk:0.75},
 'PEREZ':{agg:0.6,defend:0.85,risk:0.45},
 'BOTTAS':{agg:0.5,defend:0.8,risk:0.35},
};
function personaFor(d){
 const pn=(d.name||'').split(' ').pop().toUpperCase();
 const P=DRIVER_PERSONA[pn];
 if(P)return P;
 return{agg:clamp(0.45+(d.skill-0.85)*2.5,0.35,0.95),
        defend:clamp(0.4+(d.skill-0.85)*2,0.3,0.9),
        risk:clamp(0.35+d.skill*0.3,0.35,0.9)};
}

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
  // Player portraits are compressed data URLs stored with the local PWA
  // profile, so they remain available offline and never leave the device.
  if (d.headshot && d.headshot.startsWith('data:image/')) return d.headshot;
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

// Scenery (trees, buildings, boards, grandstands) sits ON the ground mesh,
// so it must be planted with the terrain heightfield's own bilinear sample —
// the same surface the eye sees — rather than the raw road height. That is the
// only way a prop on a hillside, an embankment or inside a hairpin loop can
// be guaranteed to touch down instead of floating over (or sinking under) the
// slope the road climbs.
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
 /* Fog is the opposite kind of nasty to rain: the road is nearly dry and the
    grip is there, but you cannot see the corner you are braking for. So it
    gets a thick fog, a flattened sky and no rain at all, and the lamps come
    on because in real mist they always do. */
mist:{label:'FOG',skyT:0x8f989e,skyH:0xc6cdd2,sunC:0xe8eaec,sunI:1.05,hS:0xb9c1c6,hG:0x74807a,hI:.95,fog:0xc6cdd2,fogD:.0045,exp:1.02,grip:.9,rain:.05,snow:0,wet:.18},
snow:{label:'SNOW',skyT:0x93a0ae,skyH:0xd4dbe2,sunC:0xeef2f6,sunI:1.15,hS:0xc3ccd6,hG:0xaeb6bd,hI:.85,fog:0xd4dbe2,fogD:.0022,exp:1.08,grip:.55,rain:.55,snow:1,wet:.55},
};
const ICONS={
sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M19.1 4.9l-1.9 1.9M6.8 17.2l-1.9 1.9"/></svg>',
driz:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 15h11a3.5 3.5 0 0 0 .6-6.95A5.5 5.5 0 0 0 7 6.6 4 4 0 0 0 6 15Z"/><path d="M9 18v1.6M13 18v2.4M17 18v1.6"/></svg>',
rain:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 14h11a3.5 3.5 0 0 0 .6-6.95A5.5 5.5 0 0 0 7 5.6 4 4 0 0 0 6 14Z"/><path d="M8 17l-1.4 3.4M12.5 17l-1.4 3.4M17 17l-1.4 3.4"/></svg>',
mist:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9h16M6 12.5h13M4.5 16h15M7 19.5h10"/></svg>',
snow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.4 5.2 12 7.8l2.6-2.6M9.4 18.8 12 16.2l2.6 2.6"/></svg>'};

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
  if(name.includes('enhanced'))s+=40;
  if(name.includes('online'))s+=25;
  if(name.includes('multilingual'))s+=20;
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
crash:['Oh no! They have come together!','Contact! Big moment in the midfield!','Ooh, that was a heavy hit!'],
lost:['{d} gets back through — you are down to P{n}.','And {d} retakes the position!','{d} sweeps past! Down to P{n} you go.'],
close:['They are side by side into the corner!','This is brilliant racing — door to door!','The crowd is on their feet, side by side!'],
rain:['The track is treacherous out there now.','Rain is lashing down — keep it on the black stuff.','This is a proper wet-weather test!'],
finishClose:['What a finish! Absolute scenes at the line!','They cross the line together — that was a classic!'],
giveBack:['That overtake was off the track — give the place back to {d}!','{d} is furious! You cut the corner — hand the position back!','Off track! Give {d} the place back right now!','The stewards are watching — hand that place back to {d}!','{d} is absolutely raging! That was illegal — give it back!','You gained an advantage off track — {d} wants it back!'],
angry:['{d} is livid — he will remember that!','{d} waves his fist — that was a divebomb!','{d} is seeing red after that hit!','{d} is furious — you are on thin ice!'],
apology:['Stewards are taking a look at that one.','Getting messy out there — the stewards are onto it.'],
};
const ATT_LINES=[
'Welcome to {track}, for the Polygon Grand Prix.',
'{leader} leads the field around {track} this afternoon.',
'Just listen to these engines — screaming all the way to fifteen thousand.',
'Look at those skies above {loc}. A proper test of nerve.',
'Twenty cars, one apex. This is Polygon GP.'];
const RACE_HYPE_LINES=[
'What a joy to be here — listen to this crowd and these magnificent cars!',
'This is why we love Grand Prix racing — speed, commitment and pure theatre!',
'Absolutely glorious racing today! Every lap is alive with possibility!',
'The atmosphere is electric — what a privilege to call this race!',
'Look at the speed out there! This is a wonderful motor race!',
'Brilliant commitment from the whole field — I am loving every second of this!'];
const ENCOURAGE_LINES=[
'Good luck out there, {name}. Take a breath, trust your lines, and enjoy every lap.',
'Alright {name}, the team believes in you. Smooth is fast — go get it.',
'{name}, you have got this. Drive your own race and the rest will follow.',
'Welcome to the grid, {name}. However it goes, be proud of getting out there.',
'{name}, nice and easy on the first lap, then let it flow. We are right behind you.'];
let lastEncouragedName='';

/* ============ renderer / scene ============ */
const renderer=new THREE.WebGLRenderer({canvas:$('gl'),antialias:true,powerPreference:'high-performance'});
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(62,1,0.3,6000);
const SUNDIR=V3(0.42,0.55,0.25).normalize();
// The live sun direction (SUNDIR is the default; the time of day re-aims it)
// and how cool the shade side of the image should read.
const sunVec=SUNDIR.clone();let shadowWarm=0,sunBase=2.6;
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
uniforms:{topC:{value:new THREE.Color(0x2f6fce)},horC:{value:new THREE.Color(0xbfd9e8)},sunD:{value:SUNDIR},
 sunC:{value:new THREE.Color(0xfff1d0).multiplyScalar(2)},haze:{value:0.0},stars:{value:0.0},
 gndC:{value:new THREE.Color(0x6f9457)},night:{value:0.0}},
vertexShader:'varying vec3 vW;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vW=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}',
fragmentShader:`uniform vec3 topC;uniform vec3 horC;uniform vec3 sunD;uniform vec3 sunC;
uniform float haze;uniform float stars;uniform vec3 gndC;uniform float night;
varying vec3 vW;
float h11(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec3 d=normalize(vW);
 float t=pow(clamp(max(d.y,0.0)*1.4,0.0,1.0),0.72);
 vec3 col=mix(horC,topC,t);
 float s=clamp(dot(d,sunD),0.0,1.0);
 // the disc itself, a tight halo around it, and a wide scatter that washes the
 // whole half of sky it sits in — that last term is what sells a low sun
 col+=sunC*(pow(s,3000.0)*6.0+pow(s,42.0)*0.55+pow(s,4.0)*0.16+pow(s,1.4)*0.07*haze);
 // ground haze: the horizon band brightens and takes the sun's colour when the
 // light is raking through the air sideways
 float band=exp(-abs(d.y)*7.0);
 col=mix(col,horC*1.18+sunC*0.22,band*haze*0.75);
 if(d.y<0.0){
  float g=clamp(-d.y*5.0,0.0,1.0);
  col=mix(col,mix(horC*0.85,gndC*0.55,0.45),g);
 }
 if(stars>0.01){
  vec2 sp=floor(d.xz/max(abs(d.y),0.06)*260.0);
  float st=h11(sp);
  float tw=0.55+0.45*sin(st*90.0);
  col+=vec3(0.85,0.9,1.0)*step(0.9965,st)*tw*stars*clamp(d.y*3.0,0.0,1.0);
 }
 // light pollution keeps the horizon of a night circuit from going black
 col+=vec3(0.16,0.13,0.10)*night*band*0.9;
 gl_FragColor=vec4(col,1.0);}`});
const skyGeo=new THREE.SphereGeometry(2600,24,12);
scene.add(new THREE.Mesh(skyGeo,skyMat));
const envScene=new THREE.Scene();envScene.add(new THREE.Mesh(skyGeo,skyMat));
const pmrem=new THREE.PMREMGenerator(renderer);
let envRT=null;
function refreshEnv(){try{if(envRT)envRT.dispose();
 // Current three.js caps PMREM's blur kernel at 20 samples. A sigma of .05
 // asks for 25 and emits one warning per cube face/mip every weather change.
 // .035 stays inside the supported kernel while retaining a soft environment.
 envRT=pmrem.fromScene(envScene,0.035);scene.environment=envRT.texture;}catch(e){console.warn('[environment] PMREM refresh failed:',e);}}
/* Bloom + film grade. Only the two top quality tiers opt in; below that the
   extra full-screen targets cost more than they give. */
const postfx=new PostFX(renderer,scene,camera);
const BASE_TONE=THREE.ACESFilmicToneMapping;
function postfxActive(){return postfx.enabled&&postfx.ok;}

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
// Mowed stripes — the broad alternating light/dark bands of a groomed GP
// verge (the mower flattens the blades in opposite directions pass by pass).
for(let b=0;b<8;b++){
 gg.fillStyle=b%2?'rgba(235,245,225,0.05)':'rgba(18,38,14,0.055)';
 gg.fillRect(b*96,0,96,768);
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

// Gravel-trap texture — a coarse, speckled tan-and-grey bed of rounded
// pebbles, so a car that runs wide into the run-off visibly digs into gravel
// rather than sliding across more asphalt.
const[glc,glg]=mkCanvas(128,128);
glg.fillStyle='#8a7f6b';glg.fillRect(0,0,128,128);
for(let i=0;i<34;i++){ // large tonal drifts of light/dark gravel
 const light=Math.random()<0.5;
 glg.fillStyle=light?'rgba(120,108,88,0.5)':'rgba(72,64,50,0.5)';
 glg.beginPath();glg.ellipse(Math.random()*128,Math.random()*128,rand(10,30),rand(8,22),rand(0,7),0,7);glg.fill();
}
for(let i=0;i<1600;i++){ // individual pebbles
 const g=rand(0.55,0.95)*150;
 const r=g*1.05,gg=g,b=g*0.8;
 glg.fillStyle=`rgba(${r|0},${gg|0},${b|0},1)`;
 glg.beginPath();glg.arc(Math.random()*128,Math.random()*128,rand(1,3.2),0,7);glg.fill();
 glg.fillStyle='rgba(30,26,20,0.35)';
 glg.beginPath();glg.arc(Math.random()*128,Math.random()*128,rand(0.8,2.2),0,7);glg.fill();
}
const gravelT=ctex(glc,true);gravelT.repeat.set(8,8);

// Water texture — a subtle caustic ripple (blue base + light streaks) used by
// the flat lake/harbour discs, kept mostly for a shimmering highlight layer.
const[wtc,wtg]=mkCanvas(128,128);
wtg.fillStyle='#14556f';wtg.fillRect(0,0,128,128);
for(let i=0;i<40;i++){
 wtg.strokeStyle=`rgba(180,225,240,${rand(0.05,0.2)})`;wtg.lineWidth=rand(1,3);
 const y=Math.random()*128;wtg.beginPath();wtg.moveTo(0,y);
 for(let x=0;x<=128;x+=16)wtg.lineTo(x,y+Math.sin(x*0.2+Math.random()*6)*3);
 wtg.stroke();
}
const waterT=ctex(wtc,true);waterT.repeat.set(6,6);

// Tyre tread texture — circumferential grooves and tread blocks over a dark
// rubber base, so the wheels read as proper race tyres rather than plain
// black cylinders when they spin.
const[tyc,tyg]=mkCanvas(128,64);
tyg.fillStyle='#131417';tyg.fillRect(0,0,128,64);
for(let y=6;y<64;y+=14){tyg.fillStyle='#050607';tyg.fillRect(0,y,128,5);tyg.fillStyle='#26282d';tyg.fillRect(0,y+5,128,2);}
for(let x=0;x<128;x+=10){tyg.fillStyle='rgba(0,0,0,0.4)';tyg.fillRect(x,0,1.6,64);}
for(let i=0;i<1200;i++){const g=18+Math.random()*22|0;tyg.fillStyle=`rgb(${g},${g},${g+2})`;tyg.fillRect(Math.random()*128,Math.random()*64,1.4,1.4);}
const tyreT=ctex(tyc,true);tyreT.repeat.set(6,1);

const ADS=[['POLYGON GP','#e9e9e9','#101114'],['APEX FUEL','#e10600','#ffffff'],['SPARKY','#ffd9af','#8c4f2c'],['VANTAGE TYRES','#ffd23f','#101114'],['NOVA ENERGY','#0f7a4a','#ffffff'],["END OF ROAD FEST '26",'#d9486b','#ffffff'],['GET THIS APP!','#efa733','#101114'],['DRIFT KING','#e10600','#ffffff'],
 ['STEVE SAUSAGES ARE GGGGGREAT!','#c0392b','#fff3d6'],['LEWIS CHEATS (A LOT) :)','#FFE600','#101114'],['PIT LANE TAKEAWAY','#2e6fd0','#fff'],['BIG STEAMY PUDDINGS','#8e44ad','#fff']];
const NA=ADS.length;
const[wc,wg]=mkCanvas(NA*128,128);
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
// Text is drawn mirrored so it reads the correct way round on the face the
// card/board presents to the driver (the user asked for the writing to be the
// other way around).
for(let i=0;i<NA;i++){const[t,bg,fg]=ADS[i];wg.fillStyle=bg;wg.fillRect(i*128,0,128,128);
 wg.fillStyle=fg;wg.font='italic 700 22px sans-serif';wg.textAlign='center';wg.textBaseline='middle';
 // Draw normally. The old negative X scale baked mirrored lettering into the
 // texture; board orientation is handled in 3D instead.
 wg.save();wg.translate(i*128+64,70);wg.rotate(-0.025);wg.fillText(t,0,0,116);wg.restore();
 drawAdBird(wg,i*128+22,26,1.2,fg);
 wg.fillStyle='rgba(0,0,0,.25)';wg.fillRect(i*128,118,128,10);}
const adsT=ctex(wc,true);
adsT.repeat.set(1/NA,1);
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
// One shared additive material for every pool of lamp light on the tarmac.
// Built at module level because buildWorld() re-runs on every track switch,
// and the lamps of each new world are registered into T.nightMats.
const nightPoolMat=new THREE.MeshBasicMaterial({map:softT,color:0xffd9a4,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:0});
let nightLevel=0;
function bannerTex(name){const[cn,cx]=mkCanvas(1024,96);
 cx.fillStyle='#101216';cx.fillRect(0,0,1024,96);
 cx.fillStyle='#e10600';cx.fillRect(0,0,26,96);cx.fillRect(998,0,26,96);
 cx.fillStyle='#f4f1ea';cx.font='italic 700 52px sans-serif';cx.textAlign='center';cx.textBaseline='middle';
 // Mirrored so the banner reads the correct way round when you approach the
 // line (the plane's facing means a normal draw comes out backwards).
 cx.save();cx.translate(512,52);cx.scale(-1,1);cx.fillText(name.toUpperCase()+' · POLYGON GP',0,0,940);cx.restore();
 return ctex(cn,false);}
const numCache=new Map();
function numTex(n){if(numCache.has(n))return numCache.get(n);
 const[cn,cx]=mkCanvas(64,64);cx.clearRect(0,0,64,64);
 cx.fillStyle='#f2f2f2';cx.beginPath();cx.arc(32,32,29,0,7);cx.fill();
 cx.fillStyle='#101114';cx.font='700 36px sans-serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(n,32,34);
 const t=ctex(cn,false);numCache.set(n,t);return t;}

/* ============ car geometry ============ */
const matBody=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:0.25,metalness:0.35,envMapIntensity:1.1});
const matWheel=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.55,metalness:0.15,envMapIntensity: 0.8,bumpMap:tyreT,bumpScale:0.55});
const woodLegMat=new THREE.MeshStandardMaterial({color:0x6b4a2f,roughness:0.9});
function tint(geo,color){const col=new THREE.Color(color);const n=geo.attributes.position.count;
 const a=new Float32Array(n*3);for(let i=0;i<n;i++){a[i*3]=col.r;a[i*3+1]=col.g;a[i*3+2]=col.b;}
 geo.setAttribute('color',new THREE.BufferAttribute(a,3));return geo;}
function part(geo,color,x,y,z,rx=0,ry=0,rz=0){geo.rotateZ(rz);geo.rotateY(ry);geo.rotateX(rx);geo.translate(x,y,z);tint(geo,color);return ensureUV(geo);}
// mergeGeometries refuses to mix attributes, and TubeGeometry brings no UVs
// of its own, so anything merged into the body gets a neutral set.
function ensureUV(geo){if(!geo.attributes.uv){const n=geo.attributes.position.count;
 geo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(n*2),2));}return geo;}
// Tapered, forward-drooping beak for the 2026-style nose — a four-sided
// frustum whose front face is narrower AND drops lower than its back face, so
// the nose is a sculpted aerodynamic beak rather than a pointy cone.
function noseGeo(wB,hB,wF,hF,len,drop){
 const hb=wB/2,vb=hB/2,hf=wF/2,vf=hF/2,l=len/2;
 const verts=new Float32Array([
  -hb,-vb,-l, hb,-vb,-l, hb,vb,-l, -hb,vb,-l,   // back face (z=-l)
  -hf,-vf-drop,l, hf,-vf-drop,l, hf,vf-drop,l, -hf,vf-drop,l // front face (z=+l, drooped)
 ]);
 const idx=[0,1,2,0,2,3, 4,6,5,4,7,6, 0,4,5,0,5,1, 1,5,6,1,6,2, 2,6,7,2,7,3, 3,7,4,3,4,0];
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(verts,3));
 g.setIndex(idx);g.computeVertexNormals();
 // Simple planar UVs so the geometry merges cleanly with the box/cylinder
 // parts that carry UVs (matBody itself is untextured, so values are cosmetic)
 const uvs=new Float32Array(16);for(let i=0;i<4;i++){uvs[i*2]=(i%2);uvs[i*2+1]=i<2?0:1;}for(let i=0;i<4;i++){uvs[8+i*2]=(i%2);uvs[8+i*2+1]=i<2?0:1;}
 g.setAttribute('uv',new THREE.BufferAttribute(uvs,2));return g;
}
const bodyCache=new Map();
export function getBodyGeo(colA,colB){
 const key=colA+colB;if(bodyCache.has(key))return bodyCache.get(key);
 const P=[];const B=(w,h,d,c,x,y,z,rx=0,ry=0,rz=0)=>P.push(part(new THREE.BoxGeometry(w,h,d),c,x,y,z,rx,ry,rz));
 const C=(rt,rb,h,seg,c,x,y,z,rx=0)=>P.push(part(new THREE.CylinderGeometry(rt,rb,h,seg),c,x,y,z,rx));
 B(1.55,0.07,3.6,'#15161a',0,0.14,0.15);
 B(0.72,0.34,2.2,colA,0,0.42,0.75);
 // 2026-style drooping nose beak (replaces the old pointy cone).
 P.push(part(noseGeo(0.62,0.30,0.46,0.12,1.12,0.18),colA,0,0.46,2.13));
 // 2026 narrower, two-element active front wing + simplified endplates (the
 // 2026 rules cut front-wing width to 1850mm and introduced a two-element flap).
 B(1.70,0.05,0.50,colB,0,0.11,2.72);                    // main plane
 B(1.58,0.04,0.30,colB,0,0.17,2.54,-0.26);              // second (active) element
 B(0.04,0.30,0.52,colB,0.83,0.17,2.72);                 // right endplate
 B(0.04,0.30,0.52,colB,-0.83,0.17,2.72);                // left endplate
 B(0.09,0.12,0.09,'#202226',0.17,0.26,2.50);            // centre pylons
 B(0.09,0.12,0.09,'#202226',-0.17,0.26,2.50);
 B(0.78,0.2,1.0,colA,0,0.58,0.55);B(0.5,0.1,0.9,'#101114',0,0.66,0.55);
 // Halo protection structure — a real halo shape: a thick front arc running
 // over the driver's head, a single forward spine down to the nose bulkhead,
 // two rear struts down to the chassis sides, and a rear cross-brace tying
 // those struts together (the "cross piece" that reads clearly even at a
 // distance). The arc sits just above the helmet crown like the real
 // titanium piece, and the helmet shows behind/under it from chase cams.
 // Halo — modelled as the real titanium ring, not a decoration. It is a single
 // closed hoop that springs from the chassis on the driver's LEFT, sweeps up and
 // OVER the crown, comes down on the RIGHT, and is bolted forward to the nose
 // bulkhead by one strong pillar. The old version was a half torus laid down in
 // the wrong plane, which is why it read as "half a hoop" from a chase cam.
 const HALO_R = 0.05;                       // 50 mm tube, like the real piece
 const haloPts = [];
 {
  // side of the cockpit the ring lands on, just ahead of the helmet
  const my = 0.60, mz = 0.28, topY = 1.10, topZ = 0.22;
  haloPts.push([0.60, my, mz]);              // left mount, on the tub
  for (let k = 1; k <= 7; k++) {             // left root rising into the hoop
   const t = k / 7;
   haloPts.push([0.60 - 0.60 * t * t, my + (topY - my) * Math.pow(t, 0.85), mz - 0.10 * Math.sin(t * Math.PI)]);
  }
  haloPts.push([0, topY, topZ]);              // crown, sitting over the helmet
  for (let k = 7; k >= 1; k--) {             // mirror down to the right mount
   const t = k / 7;
   haloPts.push([-(0.60 - 0.60 * t * t), my + (topY - my) * Math.pow(t, 0.85), mz - 0.10 * Math.sin(t * Math.PI)]);
  }
  haloPts.push([-0.60, my, mz]);
 }
 {const hg=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(haloPts.map(v => new THREE.Vector3(v[0], v[1], v[2])), false, 'catmullrom', 0.35), 44, HALO_R, 6, false);
  tint(hg, '#1e2024'); P.push(ensureUV(hg));}
 // The forward pillar that carries the load into the chassis, with its foot
 // plate — from the front of the ring, angled down to the bulkhead.
 C(0.055, 0.07, 0.46, 7, '#1e2024', 0, 0.78, 0.68, 1.02);
 B(0.26, 0.05, 0.22, '#15161a', 0, 0.58, 0.84);
 // Moulded winglets either side of the ring (the aero fairings real teams
 // bonded on) and the mounting pads the hoop is bolted through.
 for (const sx of [1, -1]) {
  P.push(part(new THREE.BoxGeometry(0.30, 0.05, 0.16), '#1e2024', sx * 0.50, 0.86, 0.20, 0, 0, sx * 0.22));
  B(0.17, 0.06, 0.24, '#15161a', sx * 0.60, 0.57, 0.28);
 }
 // Rear impact structure behind the driver's head, tying the two sides of the
 // cockpit together — it is what makes the ring read as part of a chassis.
 B(0.30, 0.16, 0.10, '#15161a', 0, 0.72, -0.10);
 // Cockpit surround: rim the driver sits inside, mirror stalks and the dashboard
 // under the nose of the halo, so the opening is a cockpit and not a gap.
 for (const sx of [1, -1]) {
  B(0.07, 0.16, 1.10, colA, sx * 0.50, 0.66, 0.30);
  C(0.018, 0.018, 0.20, 5, '#101114', sx * 0.55, 0.74, 0.58, 0, 0, sx * 1.1);
  B(0.13, 0.06, 0.03, '#0b0d10', sx * 0.66, 0.76, 0.60);   // mirror faces
 }
 B(0.60, 0.06, 0.44, '#101114', 0, 0.63, 0.52);            // dash / cockpit floor lip
 
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

  // The steering wheel is its own mesh so it can actually turn — a yoke with
  // a rim, three spokes and a lit display, angled back like the real thing.
  const wheelParts = [];
  const WB = (w,h,d,c,x,y,z,rx=0,ry=0,rz=0)=>wheelParts.push(part(new THREE.BoxGeometry(w,h,d),c,x,y,z,rx,ry,rz));
  WB(0.30, 0.035, 0.03, '#101114', 0, 0.075, 0);              // top of the rim
  WB(0.26, 0.035, 0.03, '#101114', 0, -0.065, 0, 0, 0, 0);   // bottom of the rim
  WB(0.035, 0.10, 0.03, '#101114', -0.145, 0.005, 0);
  WB(0.035, 0.10, 0.03, '#101114', 0.145, 0.005, 0);
  WB(0.05, 0.11, 0.03, '#1a1d22', 0, 0.0, 0.005);             // centre spoke
  WB(0.045, 0.055, 0.03, '#1a1d22', -0.10, -0.03, 0.005, 0, 0, 0.6);
  WB(0.045, 0.055, 0.03, '#1a1d22', 0.10, -0.03, 0.005, 0, 0, -0.6);
  WB(0.15, 0.075, 0.012, '#00f0ff', 0, 0.02, 0.03);           // lap-time display
  WB(0.03, 0.028, 0.02, '#e10600', -0.075, 0.055, 0.02);
  WB(0.03, 0.028, 0.02, '#ffd23f', 0.075, 0.055, 0.02);
  const steering = new THREE.Mesh(mergeGeometries(wheelParts, false), matBody);
  steering.position.set(0, 0.52, 0.68); steering.rotation.x = 0.3;
  driverGroup.userData.steering = steering;

  const suitMesh = new THREE.Mesh(mergeGeometries(suitParts, false), matBody);
  suitMesh.castShadow = true;
  driverGroup.add(suitMesh);
  driverGroup.add(steering);

  // 2. Articulated Head & Aerodynamic Helmet — raised so the crown of the
  // helmet sits just under the halo arc and clearly shows above the cockpit
  // rim, the way it reads on a real car from the chase camera.
  const helmetGroup = new THREE.Group();
  helmetGroup.position.set(0, 0.73, 0.36); // Neck pivot point
  
  const hParts = [];
  // Spherical aero shell
  hParts.push(part(new THREE.SphereGeometry(0.165, 10, 8), helmetCol, 0, 0.08, 0));
  // Chin bar / mouth guard
  hParts.push(part(new THREE.BoxGeometry(0.22, 0.12, 0.2), helmetCol, 0, 0.02, 0.09));
  // Hans device collar
  hParts.push(part(new THREE.CylinderGeometry(0.14, 0.16, 0.08, 8), '#202226', 0, -0.02, 0));
  // Top aero spoiler fin
  hParts.push(part(new THREE.BoxGeometry(0.03, 0.04, 0.16), '#17181c', 0, 0.23, -0.02));
  // Sun-visour above the eyeline and the onboard camera pod on the crown —
  // two features that make a helmet read as an F1 helmet at 100 m.
  hParts.push(part(new THREE.BoxGeometry(0.24, 0.028, 0.09), '#101114', 0, 0.155, 0.10, -0.30));
  hParts.push(part(new THREE.BoxGeometry(0.07, 0.05, 0.07), '#0d0f12', 0, 0.205, -0.03));
  hParts.push(part(new THREE.BoxGeometry(0.20, 0.05, 0.05), '#17181c', 0, -0.03, 0.10));  // HANS tether
  hParts.push(part(new THREE.BoxGeometry(0.05, 0.19, 0.20), '#f2f2f0', 0, 0.09, -0.10));  // centre stripe
  // Tinted Iridium Visor
  hParts.push(part(new THREE.BoxGeometry(0.24, 0.08, 0.1), '#1a1d24', 0, 0.09, 0.13, 0.08));
  hParts.push(part(new THREE.PlaneGeometry(0.22, 0.065), '#00f0ff', 0, 0.09, 0.185, 0.08));

  const helmetMesh = new THREE.Mesh(mergeGeometries(hParts, false), matBody);
  helmetMesh.castShadow = true;
  helmetGroup.add(helmetMesh);

  driverGroup.add(helmetGroup);

  return { driverGroup, helmetGroup };
}

let axleGeo=null, brakeGeo=null;
export function getAxleGeo(){if(axleGeo&&brakeGeo)return axleGeo;
 // Build one clean wheel at the origin and duplicate it at the two axle ends.
 // Previously suspension pieces for both sides were merged into this single
 // wheel and then the whole assembly was duplicated again. Those extra rods
 // rotated through the tyre and appeared as sharp vertices sticking out.
 const parts=[];
 // Rounded slick tyre, recessed alloy rim and hub. More radial segments remove
 // the conspicuously faceted twelve-sided outline without making the grid
 // expensive (all cars share this geometry).
 parts.push(part(new THREE.CylinderGeometry(0.37,0.37,0.34,24,1,false),'#151619',0,0,0,0,0,Math.PI/2));
 parts.push(part(new THREE.CylinderGeometry(0.225,0.225,0.352,20,1,false),'#34383e',0,0,0,0,0,Math.PI/2));
 parts.push(part(new THREE.CylinderGeometry(0.072,0.072,0.365,16),'#aeb3ba',0,0,0,0,0,Math.PI/2));
 parts.push(part(new THREE.CylinderGeometry(0.030,0.030,0.378,12),'#ffd23f',0,0,0,0,0,Math.PI/2));
 // Slim spokes stop well inside the 0.225 m rim, so no corner can pierce the
 // rubber even while the wheels spin and steer.
 for(let s=0;s<10;s++){
  const a=s*Math.PI/5;
  parts.push(part(new THREE.BoxGeometry(0.105,0.26,0.026),'#d5dae0',0,Math.cos(a)*0.125,Math.sin(a)*0.125,a,0,0));
 }
 const wheel=mergeGeometries(parts,false);
 const left=wheel.clone();left.translate(-0.82,0,0);
 const right=wheel.clone();right.translate(0.82,0,0);
 axleGeo=mergeGeometries([left,right],false);

 // Brake discs are centred once and then placed directly behind each rim.
 // The old code applied two lateral translations, leaving duplicate discs at
 // the axle centre and beyond the outside edge of the tyres.
 const disc=part(new THREE.CylinderGeometry(0.205,0.205,0.045,20), '#3a2018',0,0,0,0,0,Math.PI/2);
 const d1=disc.clone();d1.translate(-0.82,0,0);
 const d2=disc.clone();d2.translate(0.82,0,0);
 brakeGeo=mergeGeometries([d1,d2],false);
 return axleGeo;}
const drsGeo=new THREE.BoxGeometry(1.42,0.03,0.26);
/* Animated spanner placeholder that floats over a car blown off into the
   gravel / clouted by another car. A wrench + a depleting gold countdown
   ring, redrawn each frame onto a shared canvas texture. */
function makeDamageSprite(){
 const [cv,cx]=mkCanvas(128,128);
 const tex=new THREE.CanvasTexture(cv);
 const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false});
 const spr=new THREE.Sprite(mat);
 spr.scale.set(2.4,2.4,1);spr.renderOrder=10;spr.visible=false;
 spr.userData.draw=(frac)=>{
  cx.clearRect(0,0,128,128);
  // Recovering ring: depletes from full (1) down to empty (0).
  cx.beginPath();cx.arc(64,64,40,0,Math.PI*2);
  cx.strokeStyle='rgba(0,0,0,0.5)';cx.lineWidth=11;cx.stroke();
  cx.beginPath();cx.arc(64,64,40,-Math.PI/2,-Math.PI/2+Math.PI*2*frac);
  cx.strokeStyle='#ffd23f';cx.lineWidth=8;cx.lineCap='round';cx.stroke();
  // Spanner: a handle with an open C-jaw, angled for a "working on it" look.
  cx.save();cx.translate(64,64);cx.rotate(Math.PI*0.24 - (1-frac)*Math.cos(timeSec*14)*0.1);
  cx.strokeStyle='#f4f1ea';cx.lineCap='round';
  cx.lineWidth=8;cx.beginPath();cx.moveTo(-20,0);cx.lineTo(18,0);cx.stroke(); // handle
  cx.lineWidth=6;cx.beginPath();cx.arc(20,0,11,-0.7,0.7);cx.stroke();        // jaw back
  cx.beginPath();cx.arc(20,0,11,2.44,3.82);cx.stroke();                      // jaw opening
  cx.lineWidth=8;cx.beginPath();cx.moveTo(-20,-5);cx.lineTo(-28,-11);cx.stroke(); // pommel
  cx.restore();
  tex.needsUpdate=true;
 };
 return spr;
}
function makeCarMesh(d){
 const g=new THREE.Group();
 const body=new THREE.Mesh(getBodyGeo(d.colA,d.colB),matBody);body.castShadow=true;
 const { driverGroup, helmetGroup } = makeDriverMesh(d.colA, d.helmet);
 getAxleGeo();
 const axleF=new THREE.Mesh(axleGeo,matWheel);axleF.rotation.order='YXZ';axleF.position.set(0,0.37,1.62);
 const axleR=new THREE.Mesh(getAxleGeo(),matWheel);axleR.position.set(0,0.37,-1.62);
 // Brake discs sit behind the rims and do NOT spin with the axle — instead
 // their emissive colour climbs from cold grey to cherry red under braking
 // and fades back over a couple of seconds, which is what makes a car
 // visibly slowing into a corner read as slowing.
 const brakeMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.5,metalness:0.2,emissive:0xff4a12,emissiveIntensity:0});
 const brakes=new THREE.Mesh(brakeGeo,brakeMat);brakes.position.set(0,0.37,0);
 // Night & rain lights, done the cheap way round: an additive beam cone, a
 // pool of light on the road and a red tail glow. Real spotlights for a 20
 // car grid would blow the light budget and cost a shader recompile per
 // material; these are three quads, and bloom does the rest.
 const beamGeo=(()=>{const g=new THREE.ConeGeometry(1.35,15,10,1,true);g.rotateX(Math.PI/2);g.translate(0,-0.15,7.7);return ensureUV(g);})();
 const beam=new THREE.Mesh(beamGeo,new THREE.MeshBasicMaterial({color:0xfff0cc,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
 beam.position.set(0,0.52,1.75);beam.renderOrder=3;
 const pool=new THREE.Mesh(new THREE.PlaneGeometry(13,19),new THREE.MeshBasicMaterial({map:softT,color:0xffe9c4,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
 pool.rotation.x=-Math.PI/2;pool.position.set(0,0.06,9.4);pool.renderOrder=3;
 const tailGlow=new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.5),new THREE.MeshBasicMaterial({map:softT,color:0xff2a10,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
 tailGlow.position.set(0,0.6,-2.6);tailGlow.renderOrder=3;
 beam.userData.fx=1;pool.userData.fx=1;tailGlow.userData.fx=1;   // not bodywork
 g.add(beam,pool,tailGlow);
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
 const dmgSprite=makeDamageSprite();
 g.add(dmgSprite);
 g.add(body,driverGroup,axleF,axleR,brakes,drs,brakeLight);
 return{g,body,driverGroup,helmetGroup,axleF,axleR,brakes,brakeMat,drs,brakeLight,beam,pool,tailGlow,dmgSprite,steering:driverGroup.userData.steering||null};
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
// Big spark budget — sparks are the universal language of an F1 game, so the
// point cloud needs real headroom for a wall of them on a big shunt.
const sparks=makePointsSys(600,THREE.AdditiveBlending);
const debris=[];
function shedCarParts(c){
 const fx=Math.sin(c.hdg),fz=Math.cos(c.hdg);
 for(let i=0;i<9;i++){
  const mat=new THREE.MeshStandardMaterial({color:i%3===0?c.d.colB:(i%2?c.d.colA:0x17181b),roughness:0.55,metalness:0.45});
  const m=new THREE.Mesh(new THREE.BoxGeometry(rand(.12,.48),rand(.025,.12),rand(.18,.65)),mat);
  m.position.set(c.x+rand(-.7,.7),c.y+rand(.25,.9),c.z+rand(-1.5,1.5));scene.add(m);
  debris.push({m,vx:c.vx+rand(-9,9)-fx*4,vy:rand(3,10),vz:c.vz+rand(-9,9)-fz*4,rx:rand(-9,9),rz:rand(-9,9),life:8});
 }
}
function updDebris(dt){for(let i=debris.length-1;i>=0;i--){const d=debris[i];d.life-=dt;d.vy-=18*dt;
 d.m.position.x+=d.vx*dt;d.m.position.y+=d.vy*dt;d.m.position.z+=d.vz*dt;d.m.rotation.x+=d.rx*dt;d.m.rotation.z+=d.rz*dt;
 const floor=T?getTrackHAtCoords(d.m.position.x,d.m.position.z):0;if(d.m.position.y<floor+.04){d.m.position.y=floor+.04;d.vy=Math.abs(d.vy)*.18;d.vx*=.82;d.vz*=.82;}
 if(d.life<=0){scene.remove(d.m);d.m.geometry.dispose();d.m.material.dispose();debris.splice(i,1);}}}
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
function sparkBurst(x,y,z,amt){const n=Math.round(amt*18);
 // Small white-hot metal points with fast ballistic motion and short lives.
 // The former large orange particles read as a soft fire cloud and bloomed
 // excessively; these stay crisp, with only a few dimmer cooling embers.
 for(let i=0;i<n;i++)
  puff(sparks,x,y,z,rand(-13,13),rand(2,13),rand(-13,13),rand(0.22,0.62),rand(.10,.28),1.0,0.92,0.48,-31);
 for(let i=0;i<Math.ceil(n*0.28);i++)
  puff(sparks,x,y,z,rand(-9,9),rand(1,9),rand(-9,9),rand(0.18,0.42),rand(.22,.48),1.0,0.48,0.06,-28);}
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

/* rain world FX */
const RAIN_N=1000;
const rainGeo=new THREE.BufferGeometry();
rainGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(RAIN_N*6),3).setUsage(THREE.DynamicDrawUsage));
// Darker, glassier streaks — the old near-white 0x9db4c8 at 0.45 opacity read
// as a curtain of white noise; real rain is mostly transparent.
const rainMat = new THREE.LineBasicMaterial({color:0x6e879c,transparent:true,opacity:0.26});
const rainMesh=new THREE.LineSegments(rainGeo,rainMat);
rainMesh.frustumCulled=false;scene.add(rainMesh);
const rainP=new Float32Array(RAIN_N*3);
for(let i=0;i<RAIN_N;i++){rainP[i*3]=rand(-30,30);rainP[i*3+1]=rand(0,26);rainP[i*3+2]=rand(-30,30);}

function updWeatherFX(dt){
 // Snow builds up and melts back on a slow time constant — an inch of snow does
 // not appear or vanish in a frame. Everything visible (flake density, gust
 // strength, how white the road is, how little grip there is) reads off this one
 // number, so the ground and the air always agree with each other.
 const snowing=(cur.snow||0)>0.25;
 snowAccum=clamp(snowAccum+(snowing?dt*0.055:-dt*0.035),0,1);
 snowGustT-=dt;
 if(snowing&&snowGustT<=0){snowGustT=rand(7,16);snowGust=1;}
 snowGust=Math.max(0,snowGust-dt*0.55);
 cur.grip=cur.gripBase*(1-snowAccum*0.4);
 if(T&&T.roadMat){
  T.roadMat.color.lerp(new THREE.Color(0xe9eef4),snowAccum*0.55);
  T.roadMat.roughness=Math.min(1,T.roadMat.roughness+snowAccum*0.25);
 }
 const cx=camera.position.x,cz=camera.position.z;
 const rp=rainGeo.attributes.position.array;
 rainMesh.visible=cur.rain>0.03;
 /* Snow uses the same particle system as rain (it is the only one built) but
    it must not look like rain: the flakes fall at a fifth of the speed, drift
    sideways on the wind and stop being drawn as streaks. */
 const flake=cur.snow>0.4, fall=flake?(4+cur.snow*5):(52+cur.rain*14);
 if(rainMesh.visible){
  for(let i=0;i<RAIN_N;i++){
   rainP[i*3+1]-=fall*dt;
   if(flake){rainP[i*3]+=Math.sin(timeSec*0.8+i)*dt*2.4;rainP[i*3+2]+=Math.cos(timeSec*0.6+i*0.7)*dt*2.4;}
   if(rainP[i*3+1]<0){rainP[i*3+1]+=26;rainP[i*3]=rand(-30,30);rainP[i*3+2]=rand(-30,30);}
   const x=cx+rainP[i*3],y=rainP[i*3+1],z=cz+rainP[i*3+2];
   rp[i*6]=x;rp[i*6+1]=y;rp[i*6+2]=z;rp[i*6+3]=x-0.6;rp[i*6+4]=y+0.9;rp[i*6+5]=z;
  }
  rainGeo.attributes.position.needsUpdate=true;
 }
}

/* rain on the camera lens (2D canvas) */
const dropCv=$('drops'),dropCx=dropCv.getContext('2d');
let lensDrops=[];
function sizeDrops(){dropCv.width=innerWidth;dropCv.height=innerHeight;}
function updLens(dt){
 dropCx.clearRect(0,0,dropCv.width,dropCv.height);
 // HIGH/MED/ULTRA use the Heartfelt/Shadertoy refraction pass. Do not draw the
 // old 2D gradient ellipses over it: those soft blobs obscured the shader's
 // sharp beads, trails and glass distortion and were what made the new rain
 // look less realistic than the original effect.
 if((QUALITY_PRESETS[effQuality()]||{}).rainShader!==false){lensDrops.length=0;return;}
 const amt=Math.max(cur.rain-0.12,0);
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
let flybyPlane=null,planeTimer=rand(45,105);
function makeFlybyPlane(){
 const g=new THREE.Group();
 const bodyMat=new THREE.MeshStandardMaterial({color:0xe8edf2,roughness:.32,metalness:.55});
 const accentMat=new THREE.MeshStandardMaterial({color:0xd71920,roughness:.38,metalness:.45,side:THREE.DoubleSide});
 const fus=new THREE.Mesh(new THREE.CylinderGeometry(.34,.15,5.2,12),bodyMat);fus.rotation.x=Math.PI/2;g.add(fus);
 const nose=new THREE.Mesh(new THREE.ConeGeometry(.34,1.25,12),bodyMat);nose.rotation.x=Math.PI/2;nose.position.z=3.18;g.add(nose);
 // Swept delta wings and tailplanes make this read as a fast display jet, not
 // a small airliner made from rectangular boxes.
 const delta=new THREE.BufferGeometry();delta.setAttribute('position',new THREE.Float32BufferAttribute([0,0,1.35,-4.0,0,-1.15,0,0,-.55, 0,0,1.35,0,0,-.55,4.0,0,-1.15],3));delta.computeVertexNormals();
 g.add(new THREE.Mesh(delta,accentMat));
 const tail=new THREE.Mesh(new THREE.BoxGeometry(2.35,.07,.55),accentMat);tail.position.z=-2.30;g.add(tail);
 for(const sx of[-1,1]){const fin=new THREE.Mesh(new THREE.BoxGeometry(.08,1.05,.75),accentMat);fin.position.set(sx*.28,.50,-2.20);fin.rotation.z=sx*.12;g.add(fin);}
 g.userData.bodyMat=bodyMat;g.userData.accentMat=accentMat;g.visible=false;scene.add(g);return g;
}
function updFlybyPlane(dt){
 if(!flybyPlane)flybyPlane=makeFlybyPlane();
 if(!flybyPlane.visible){planeTimer-=dt;if(planeTimer>0)return;
  const px=player?player.x:0,pz=player?player.z:0,a=(player?player.hdg:rand(0,Math.PI*2))+rand(-.16,.16);
  const side=rand(-95,95),fx=Math.sin(a),fz=Math.cos(a),rx=Math.cos(a),rz=-Math.sin(a);
  // Appear as a close, obvious overhead pass in front of the player, then fly
  // away along the viewing direction until perspective makes the jet tiny.
  flybyPlane.position.set(px+fx*75+rx*side,(player?player.y:0)+rand(62,92),pz+fz*75+rz*side);
  const speed=rand(135,175);flybyPlane.userData.vx=fx*speed;flybyPlane.userData.vz=fz*speed;flybyPlane.userData.smokeAcc=0;
  const schemes=[[0xd71920,0xffffff,0x2456d8],[0xff6a00,0xffffff,0x22a447],[0x8b2be2,0xffffff,0x00c8e8]];
  const scheme=pick(schemes);flybyPlane.userData.smoke=scheme.map(c=>new THREE.Color(c));
  flybyPlane.userData.bodyMat.color.set(pick([0xf2f4f7,0x202936,0xf0c419,0x39a7d8]));flybyPlane.userData.accentMat.color.set(scheme[0]);
  flybyPlane.rotation.y=a;flybyPlane.visible=true;
  if(AudioSys.started)AudioSys.jetFlyby();
 }
 flybyPlane.position.x+=flybyPlane.userData.vx*dt;flybyPlane.position.z+=flybyPlane.userData.vz*dt;
 // Red-Arrows-style three-colour smoke from three outlets. It hangs and
 // expands after the jet has gone, forming a long, readable vapour ribbon.
 flybyPlane.userData.smokeAcc+=dt;
 if(flybyPlane.userData.smokeAcc>.025){flybyPlane.userData.smokeAcc=0;
  const a=flybyPlane.rotation.y,rx=Math.cos(a),rz=-Math.sin(a),fx=Math.sin(a),fz=Math.cos(a);
  for(let i=0;i<3;i++){const off=(i-1)*.24,col=flybyPlane.userData.smoke[i];
   smk(flybyPlane.position.x-fx*2.7+rx*off,flybyPlane.position.y,flybyPlane.position.z-fz*2.7+rz*off,-fx*2,rand(-.05,.18),-fz*2,rand(1.1,1.6),rand(4.5,7),col.r,col.g,col.b,.02);}
 }
 const px=player?player.x:0,pz=player?player.z:0;if(Math.hypot(flybyPlane.position.x-px,flybyPlane.position.z-pz)>1050){flybyPlane.visible=false;planeTimer=rand(65,145);}
}
function makeBirds(){
 const feather=new THREE.MeshStandardMaterial({color:0x252a31,roughness:0.92,side:THREE.DoubleSide});
 const lightFeather=new THREE.MeshStandardMaterial({color:0xb8c0c8,roughness:0.9,side:THREE.DoubleSide});
 const beakMat=new THREE.MeshStandardMaterial({color:0xe2a72e,roughness:0.8});
 // A tapered triangular wing whose root is at x=0, allowing a convincing
 // shoulder-pivot flap instead of rotating a flat rectangle around its centre.
 const wingGeo=(side)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([
  0,0,-.18, side*1.35,0,-.05, side*.78,0,.48,
  0,0,-.18, side*.78,0,.48, 0,0,.28],3));g.computeVertexNormals();return g;};
 for(let i=0;i<7;i++){
  const g=new THREE.Group();g.scale.setScalar(rand(1.0,1.45));
  const body=new THREE.Mesh(new THREE.SphereGeometry(.22,8,6),feather);body.scale.set(.62,.58,1.75);g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.16,8,6),lightFeather);head.position.set(0,.06,.36);g.add(head);
  const beak=new THREE.Mesh(new THREE.ConeGeometry(.07,.24,5),beakMat);beak.rotation.x=Math.PI/2;beak.position.set(0,.04,.56);g.add(beak);
  const tail=new THREE.Mesh(new THREE.ConeGeometry(.20,.55,4),feather);tail.rotation.x=-Math.PI/2;tail.position.z=-.55;g.add(tail);
  const rw=new THREE.Group(),lw=new THREE.Group();
  rw.add(new THREE.Mesh(wingGeo(1),feather));lw.add(new THREE.Mesh(wingGeo(-1),feather));
  rw.position.y=lw.position.y=.05;g.add(rw,lw);scene.add(g);
  const a=rand(0,Math.PI*2),speed=rand(10,18);
  birds.push({g,rw,lw,x:rand(-260,260),z:rand(-260,260),h:rand(16,38),
   vx:Math.sin(a)*speed,vz:Math.cos(a)*speed,fs:rand(5.5,8.5),ph:rand(0,9)});
 }
}
function updBirds(dt){
 const hide=cur.rain>0.55;
 for(const b of birds){
  b.g.visible=!hide;if(hide)continue;
  // Continuous fly-by trajectories. Birds are never teleported on a timer:
  // they cross the circuit, recede naturally until tiny, and are recycled only
  // when hundreds of metres away (well outside fog/view) to begin another pass.
  b.x+=b.vx*dt;b.z+=b.vz*dt;
  const px=player?player.x:0,pz=player?player.z:0,dx=b.x-px,dz=b.z-pz;
  if(dx*dx+dz*dz>650*650){
   const camA=player?player.hdg:0;
   const ahead=rand(380,520),side=rand(-320,320);
   b.x=px+Math.sin(camA)*ahead+Math.cos(camA)*side;
   b.z=pz+Math.cos(camA)*ahead-Math.sin(camA)*side;
   const tx=px+rand(-80,80),tz=pz+rand(-80,80),d=Math.hypot(tx-b.x,tz-b.z)||1,speed=rand(10,19);
   b.vx=(tx-b.x)/d*speed;b.vz=(tz-b.z)/d*speed;b.h=rand(18,42);
  }
  b.g.position.set(b.x,b.h+Math.sin(timeSec*.7+b.ph)*1.1,b.z);
  b.g.rotation.y=Math.atan2(b.vx,b.vz);
  // Three energetic flaps followed by a short glide. Wing groups pivot at the
  // shoulder, with a little fore/aft sweep, so the silhouette is unmistakable.
  const cycle=(timeSec*.42+b.ph)%1,amp=cycle<.68?1.0:.12;
  const f=Math.sin(timeSec*b.fs+b.ph)*amp;
  b.rw.rotation.z=-f*1.05;b.lw.rotation.z=f*1.05;
  b.rw.rotation.y=-.12+f*.10;b.lw.rotation.y=.12-f*.10;
 }
}

/* ============ weather state ============ */
const cur={skyT:new THREE.Color(),skyH:new THREE.Color(),sunC:new THREE.Color(),hS:new THREE.Color(),hG:new THREE.Color(),fog:new THREE.Color(),
 sunI:2.6,hI:.8,fogD:.0011,exp:1.12,grip:1,rain:0,snow:0,wet:0};
function applyWeatherVisuals(){
 const tod=TOD[state.tod]||TOD.day;
 // Place the light: azimuth/elevation per time of day, so dusk really does rake
 // the scene sideways instead of only dimming.
 const el=tod.el*(1-cur.rain*0.35),az=tod.az;
 SUNDIR.set(Math.cos(az)*Math.cos(el),Math.max(0.06,Math.sin(el)),Math.sin(az)*Math.cos(el)).normalize();
 sunVec.copy(SUNDIR);
 scene.fog.color.copy(cur.fog).lerp(new THREE.Color(0x8d949c),cur.rain*0.35);
 skyMat.uniforms.haze.value=tod.haze+cur.rain*0.45;
 skyMat.uniforms.stars.value=tod.stars*(1-cur.rain*0.8);
 skyMat.uniforms.night.value=state.tod==='night'?1:state.tod==='dusk'?0.35:0;
 sunLight.shadow.radius=state.tod==='day'?1.6:3.4;
 hemi.groundColor.copy(cur.hG).lerp(new THREE.Color(0x1a2230),state.tod==='night'?0.55:0);
 shadowWarm=tod.cool+cur.rain*0.2;
 skyMat.uniforms.topC.value.copy(cur.skyT).multiplyScalar(tod.skyMul);
 skyMat.uniforms.horC.value.copy(cur.skyH).multiplyScalar(tod.skyMul);
 skyMat.uniforms.sunC.value.copy(cur.sunC).multiplyScalar(2.2*tod.skyMul);
 scene.fog.color.copy(cur.fog).multiplyScalar(tod.skyMul);scene.fog.density=cur.fogD;
 sunLight.color.copy(cur.sunC).lerp(new THREE.Color(0xffb066),clamp(tod.el<0.3?0.55:0.12,0,1)*(1-cur.rain*0.6));
 sunBase=cur.sunI*tod.sunMul*(0.55+0.45*clamp(sunVec.y*1.6,0,1));
 sunLight.intensity=sunBase;
 hemi.color.copy(cur.hS);hemi.groundColor.copy(cur.hG);hemi.intensity=cur.hI*tod.hMul;
 renderer.toneMappingExposure=cur.exp*tod.expMul;
 rainMesh.material.opacity=0.055+cur.rain*0.185;
 if(cloudMat){const g=cur.rain;cloudMat.color.setRGB(1-g*0.45,1-g*0.43,1-g*0.40);}
 if(T){const wet=cur.wet;
  // A wet road is not merely a damp one: it goes darker, glassier and it
  // mirrors the sky, which is exactly the effect that makes rain read as
  // rain from a chase camera.
  T.roadMat.color.copy(new THREE.Color(0x9a9da2)).lerp(new THREE.Color(0x4c5157),wet);
  T.roadMat.roughness=0.95-wet*0.78;T.roadMat.metalness=wet*0.32;
  T.roadMat.envMapIntensity=0.1+wet*1.5;
  if(T.puddleMat)T.puddleMat.opacity=clamp(wet*0.85,0,0.85);
 }
 setNightGlow();
}
/* Night is not just a dimmer sun: dusk starts the lamps, a storm pushes the
   scene down further. One function owns that level and feeds it to every
   lamp material in the world, so a weather change lights the whole circuit
   consistently instead of only making the sky darker. */
function setNightGlow(){
 const L=clamp((state.tod==='night'?0.78:state.tod==='dusk'?0.34:0)+cur.rain*0.30+(cur.snow||0)*0.25,0,1);
 nightLevel=L;
 nightPoolMat.opacity=L*0.50;
 if(T&&T.nightMats)for(const m of T.nightMats)m.color.setRGB(0.16+L*0.84,0.15+L*0.79,0.11+L*0.58);
}
function snapWeather(k){const p=WX[k];
 cur.skyT.set(p.skyT);cur.skyH.set(p.skyH);cur.sunC.set(p.sunC);cur.hS.set(p.hS);cur.hG.set(p.hG);cur.fog.set(p.fog);
 cur.sunI=p.sunI;cur.hI=p.hI;cur.fogD=p.fogD;cur.exp=p.exp;cur.grip=p.grip;cur.gripBase=p.grip;cur.rain=p.rain;cur.snow=p.snow||0;cur.wet=p.wet;
 applyWeatherVisuals();refreshEnv();}

/* ============ thunderstorm: lightning flash + delayed thunder ============ */
let lightningFlash=0,lightningTimer=rand(6,14);
function updLightning(dt){
 lightningFlash=Math.max(0,lightningFlash-dt*3.2);
 if(cur.wet<0.7){lightningTimer=Math.max(lightningTimer,4);}
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
 // flashes lift the whole scene, not just the key light, or the cars go
 // black between strikes while the sky is white
 sunLight.intensity=sunBase+lightningFlash*4.0;
 hemi.intensity=cur.hI*tod.hMul+lightningFlash*1.8;
 if(scene.fog)scene.fog.density=cur.fogD*(1-lightningFlash*0.35);
}

/* ============ track build ============ */
let T=null,world=null,timeSec=0;
const _sv=V3(0,0,0),_sn=V3(0,0,0),_st=V3(0,0,0),_camHead=V3(0,0,0);
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
 let trackMinY=Infinity,trackMaxY=-Infinity;
 for(let i=0;i<N;i++){if(raw[i].y<trackMinY)trackMinY=raw[i].y;if(raw[i].y>trackMaxY)trackMaxY=raw[i].y;}
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
 
 // Per-track road width. Real circuits differ enormously: Monaco's streets are
 // barely 9-10 m wide while Silverstone's runway-born tarmac is 15 m+. def.width
 // is the full tarmac width in metres (default 14 — the old constant behaviour).
 const halfW=(def.width!==undefined?def.width:14)/2;
 // The AI racing line amplitude was tuned for a 7 m half-width; on a tight
 // street circuit it has to breathe in with the road or the ideal line would
 // ride the kerbs everywhere.
 {const lineMax=Math.max(1.6,halfW-1.15);
  for(let i=0;i<N;i++)samples[i].line=clamp(samples[i].line,-lineMax,lineMax);}
 // BANKED CORNERS ("speed banks"). Real corners are cambered — the outside
 // edge sits higher than the inside so the road itself pushes the car around
 // the bend. def.bank is the maximum banking in DEGREES (Zandvoort's
 // Hugenholtz/Luyendyk bowls run ~18°; a normal GP corner carries 4-7° of
 // camber; city streets are nearly flat). Per-sample bank ramps up with
 // curvature and is heavily smoothed so the road twists into and out of a
 // banked bowl gradually instead of snapping.
 {
  const bankMaxDeg=def.bank!==undefined?def.bank:(def.theme==='street'?2.2:5.5);
  const bankMax=bankMaxDeg*Math.PI/180;
  for(let i=0;i<N;i++){
   const cv=samples[i].curv;
   const mag=clamp(Math.abs(cv)*34,0,1);
   // tan(bank) per metre of lateral offset, signed so the OUTSIDE of the
   // corner (the +n side when curv>0 — same convention as the gravel traps)
   // is the raised edge.
   samples[i].bk=Math.tan(bankMax*mag)*Math.sign(cv||1)*(cv?1:0);
  }
  for(let k=0;k<26;k++)for(let i=0;i<N;i++)
   samples[i].bk=(samples[(i-1+N)%N].bk+samples[i].bk*2+samples[(i+1)%N].bk)/4;
 }
 const runoffW=def.runoff!==undefined?def.runoff:6.5;
 // Thinner margins: pull the barrier in closer to the tarmac so you can put
 // all four wheels right at the edge before you hit the wall — the racing
 // line feels tighter and the kerb-edge gamble is more of a real call.
 const wallDist=halfW+runoffW*0.66;
 T={N,def,samples,len,halfW,segLen:len/N,canopyMats:[],flags:[],tvCams:[],lampMats:[]};
 T.latLimit=wallDist+0.25;
 T.collideLat=wallDist-0.45;
 // Height the banked surface adds at a signed lateral offset from the
 // centreline. Full camber across the tarmac (|lat| ≤ halfW), then fading to
 // zero at the wall so the barriers and the terrain they stand on stay level.
 // Used by the road/kerb/run-off meshes AND by nearestTrackY (what the cars
 // physically sit on), so the rendered surface and the physics surface are
 // the same surface by construction.
 const bankOffAt=(bk,lat)=>{
  const a=Math.abs(lat);
  const f=a<=halfW?1:Math.max(0,1-(a-halfW)/Math.max(0.5,wallDist-halfW));
  return bk*clamp(lat,-halfW,halfW)*f;
 };
 T.bankOffAt=bankOffAt;
 cam.heliU=0;cam.heliPos=null;cam.heliLook=null;director.target=null;director.timer=0;director.swoop=0;

 // Closest point on the track's actual polyline (segment projection + linear
 // interpolation of elevation along it), not just the closest sample vertex.
 // A hairpin can put two different parts of the lap close together in world
 // space, but projecting onto whichever SEGMENT is truly closest — rather
 // than snapping to whichever isolated point happens to be nearest, or
 // IDW-blending several points into a mushy average — tracks the real road
 // height precisely (so a thin clearance is enough — no visible step at the
 // track edge) while still staying continuous through a hairpin.
 //
 // A proper terrain heightfield needs this query at tens of thousands of
 // vertices, so segments are additionally bucketed into a uniform spatial
 // hash: an interior lookup then only tests the handful of segments sharing
 // the cells around the point instead of all 420. A point whose whole
 // neighbourhood is empty is provably far from every segment, so it can
 // short-circuit to the conservative far-field answer.
 const HASH_PAD=140; // wider than the terrain grid's outer margin, so every heightfield vertex is queried inside the hash
 let tbMinX=Infinity,tbMaxX=-Infinity,tbMinZ=Infinity,tbMaxZ=-Infinity;
 let hashCell=0,hashW=0,hashH=0,hashMinX=0,hashMinZ=0,hashBuckets=null;
 {
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const s of samples){minX=Math.min(minX,s.p.x);maxX=Math.max(maxX,s.p.x);minZ=Math.min(minZ,s.p.z);maxZ=Math.max(maxZ,s.p.z);}
  tbMinX=minX;tbMaxX=maxX;tbMinZ=minZ;tbMaxZ=maxZ;
  const spanX=maxX-minX+HASH_PAD*2,spanZ=maxZ-minZ+HASH_PAD*2;
  const target=Math.max(8,Math.round(Math.sqrt(N)/1.7)); // ~15 buckets on a side
  hashCell=Math.max(spanX,spanZ)/target;
  hashMinX=minX-HASH_PAD;hashMinZ=minZ-HASH_PAD;
  hashW=Math.max(1,Math.ceil(spanX/hashCell));hashH=Math.max(1,Math.ceil(spanZ/hashCell));
  hashBuckets=new Array(hashW*hashH);
  for(let i=0;i<N;i++){
   const a=samples[i].p,b=samples[(i+1)%N].p;
   const i0=clamp(Math.floor((Math.min(a.x,b.x)-8-hashMinX)/hashCell),0,hashW-1);
   const i1=clamp(Math.floor((Math.max(a.x,b.x)+8-hashMinX)/hashCell),0,hashW-1);
   const j0=clamp(Math.floor((Math.min(a.z,b.z)-8-hashMinZ)/hashCell),0,hashH-1);
   const j1=clamp(Math.floor((Math.max(a.z,b.z)+8-hashMinZ)/hashCell),0,hashH-1);
   for(let j=j0;j<=j1;j++)for(let ii=i0;ii<=i1;ii++){
    const ci=j*hashW+ii;(hashBuckets[ci]||(hashBuckets[ci]=[])).push(i);
   }
  }
 }
 const nearestTrackY=(x,z)=>{
  let bestD2=1e18,bestY=trackMinY;
  let bestSi=-1,bestSj=0,bestTt=0,bestPx=0,bestPz=0;
  // Camber-corrected surface height: the flat centreline height plus the
  // banking offset at this point's lateral distance from the centreline.
  const bankedY=()=>{
   if(bestSi<0)return bestY;
   // (tools slice this function out without the outer helper — degrade to the
   // flat centreline height there rather than throwing)
   if(typeof bankOffAt!=='function')return bestY;
   const A=samples[bestSi],B=samples[bestSj];
   let nx=A.n.x+(B.n.x-A.n.x)*bestTt,nz=A.n.z+(B.n.z-A.n.z)*bestTt;
   const nl=Math.hypot(nx,nz)||1;nx/=nl;nz/=nl;
   const lat=(x-bestPx)*nx+(z-bestPz)*nz;
   const bk=(A.bk||0)+((B.bk||0)-(A.bk||0))*bestTt;
   return bestY+bankOffAt(bk,lat);
  };
  let tested=0;
  if(hashBuckets){
   const gi=Math.floor((x-hashMinX)/hashCell),gj=Math.floor((z-hashMinZ)/hashCell);
   if(gi>=0&&gj>=0&&gi<hashW&&gj<hashH){
    // Nothing in the 3×3 neighbourhood → provably farther from the track than
    // the distance any segment could have produced, so skip the scan.
    let any=false;
    for(let j=gj-1;j<=gj+1&&!any;j++){
     if(j<0||j>=hashH)continue;
     const row=j*hashW;
     for(let i=gi-1;i<=gi+1;i++){if(i<0||i>=hashW)continue;if(hashBuckets[row+i]){any=true;break;}}
    }
    if(!any)return{dist:hashCell*1.2,y:trackMinY,far:true};
    for(let j=gj-1;j<=gj+1;j++){
     if(j<0||j>=hashH)continue;
     const row=j*hashW;
     for(let i=gi-1;i<=gi+1;i++){
      if(i<0||i>=hashW)continue;
      const bkt=hashBuckets[row+i];
      if(!bkt)continue;
      for(let k=0;k<bkt.length;k++){
       const si=bkt[k],a=samples[si].p,b=samples[(si+1)%N].p;
       const abx=b.x-a.x,abz=b.z-a.z;
       const abLen2=abx*abx+abz*abz||1e-6;
       let t=((x-a.x)*abx+(z-a.z)*abz)/abLen2;
       t=clamp(t,0,1);
       const px=a.x+abx*t,pz=a.z+abz*t;
       const dx=x-px,dz=z-pz,d2=dx*dx+dz*dz;
       tested++;
       if(d2<bestD2){bestD2=d2;bestY=lerp(a.y,b.y,t);bestSi=si;bestSj=(si+1)%N;bestTt=t;bestPx=px;bestPz=pz;}
      }
     }
    }
    if(tested)return{dist:Math.sqrt(bestD2),y:bankedY(),far:false};
   }
  }
  // outside the hash bounds → exact full scan
  for(let i=0;i<N;i+=2){
   const a=samples[i].p,b=samples[(i+2)%N].p;
   const abx=b.x-a.x,abz=b.z-a.z;
   const abLen2=abx*abx+abz*abz||1e-6;
   let t=((x-a.x)*abx+(z-a.z)*abz)/abLen2;
   t=clamp(t,0,1);
   const px=a.x+abx*t,pz=a.z+abz*t;
   const dx=x-px,dz=z-pz,d2=dx*dx+dz*dz;
   if(d2<bestD2){bestD2=d2;bestY=lerp(a.y,b.y,t);bestSi=i;bestSj=(i+2)%N;bestTt=t;bestPx=px;bestPz=pz;}
  }
  return{dist:Math.sqrt(bestD2),y:bankedY(),far:false};
 };
 const minTrackDist=(x,z)=>nearestTrackY(x,z).dist;
 let cx=0,cz=0;for(const s of samples){cx+=s.p.x;cz+=s.p.z;}cx/=N;cz/=N;
 T.center={x:cx,z:cz};
 let rad=0;for(const s of samples)rad=Math.max(rad,Math.hypot(s.p.x-cx,s.p.z-cz));rad+=180;
 // ---------------------------------------------------------------------------
 // GROUND / TERRAIN — elevation belongs to the LAND, not just to the tarmac.
 // The old ground was one flat plane grid at ~50 m per cell, while a real
 // OpenF1 circuit changes height every few metres (Spa climbs ~102 m, up to a
 // 14% grade at Eau Rouge/Raidillon), so the road visibly lifted off the grass
 // and looked like it was driving up a ramp of its own. The ground is now a
 // genuine heightfield:
 //   • sampled at a cell size tied to a vertex budget — 6-15 m next to the
 //     road, so the terrain cannot lag the tarmac's slope by much;
 //   • locked to the road bed inside the run-off, propped up where a node
 //     falls between two stretches of the same road and capped so it can never
 //     overtop the ribbon — which keeps a climb on solid ground without burying
 //     a lower road that passes beside it;
 //   • smoothed by a cone-limited fill, so the dips between sections that loop
 //     back on each other become embankments instead of slits;
 //   • wrapped by a coarse outer band that shares the grid's exact border
 //     vertices (one continuous surface, no T-junction cracks), out to a flat
 //     plane that holds the horizon;
 //   • and given rolling hills of its own, so the countryside is not a dead
 //     plane that the circuit climbs away from.
 // Everything — props, cars, physics, this mesh — reads height through the
 // same functions, so nothing can disagree with anything else. The surface
 // stays a little under the road so it can never poke through the tarmac; that
 // clearance widens across the run-off, where the walls stand, and narrows
 // beyond it, which is where grandstands, boards and trees are anchored.
 // ---------------------------------------------------------------------------
 const baseY=trackMinY-4; // the landscape floor
 const nearR=T.latLimit+14,farR=nearR+200;
 // How far below the tarmac the land is held, as a function of distance from
 // the centre line. It has to start at nothing on the asphalt itself — a
 // clearance here is a step of earth alongside the road, and a step is exactly
 // what made the cars look like they were flying — then open up across the
 // run-off so the surface can never puncture the ribbon, and reach its full
 // depth past the walls where the countryside is free to roll.
 const groundClearance=(lat)=>{
  const t=clamp((Math.abs(lat)-halfW)/Math.max(2,wallDist-halfW),0,1);
  // Max drop trimmed from 2.15 m to 1.1 m: from the old value the road stood
  // on a visible plateau in any aerial/helicopter shot, which read as "the
  // track is floating in the air". The embankment skirts (built with the
  // run-off) close the remaining gap so the tarmac is always visually
  // connected to the countryside.
  return 0.04+1.1*(1-Math.exp(-2.6*t))*smoothstep01(t*1.15);
 };
 // Deterministic value noise, seeded per circuit, for the distant hills.
 const seedHash=((idx*2654435761)>>>0)||9781;
 const vnoise=(x,z)=>{
  const xi=Math.floor(x),zi=Math.floor(z),fx=x-xi,fz=z-zi;
  const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
  const h=(a,b)=>{let n=(Math.imul(a,374761393)+Math.imul(b,668265263)+seedHash)>>>0;
   n=Math.imul(n^(n>>>13),1274126177)>>>0;return((n^(n>>>16))>>>0)/4294967295;};
  const a=h(xi,zi),b=h(xi+1,zi),c=h(xi,zi+1),d=h(xi+1,zi+1);
  return(a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v)*2-1;
 };
 const reliefAmp=clamp((trackMaxY-trackMinY)*0.18,2.5,16);
 // The hills fade out with distance: the outer horizon is a flat plane, and
 // a noise field that kept its full amplitude out there would send ridges
 // poking through it — a floating landscape in the far distance.
 const reliefAt=(x,z)=>{
  const dR=Math.hypot(x-cx,z-cz),fade=1-smoothstep01((dR-(farR+260))/900);
  return (vnoise(x*0.0022,z*0.0022)*0.65+vnoise(x*0.0061+11.3,z*0.0061-7.7)*0.28+vnoise(x*0.019-3.1,z*0.019+5.3)*0.07)*reliefAmp*fade;
 };
 // --- support raise / corridor carve ----------------------------------------
 // A heightfield only knows the road where it has nodes, so on a circuit that
 // winds, climbs and doubles back a ribbon can straddle two cells whose heights
 // were read from two different stretches — the tarmac then looks like it is
 // driving off a ramp of its own. Two per-cell rules settle it in both
 // directions, and they bracket the height rather than replace it:
 //   • FLOOR — the land under a stretch of road is propped up to that road's
 //     bed. This is what stops the tarmac floating on a hillside, and what
 //     turns the empty space inside a loop into a supportable embankment.
 //   • CEILING — a cell a road runs over stays at or below that road's
 //     surface, because tarmac and run-off are a flat band and ground higher
 //     than them would punch straight through the track. Where two ribbons
 //     overlap in plan view (a hairpin passing a climb, a road under a
 //     bridge), the CEILING is taken from the lower of them, so each keeps
 //     its own cutting; the upper one simply stands above the ground there,
 //     which is what that stretch of a real circuit does.
 let raiseMap=null,capMap=null,supW=0,supH=0,supX0=0,supZ0=0,supDx=1,supDz=1;
 const buildSupportMaps=(g)=>{
  const w=g.w,h=g.h,nPts=w*h;
  const raise=new Float32Array(nPts).fill(-1e9);
  const cap=new Float32Array(nPts).fill(1e9);
  const reach=wallDist+4,reach2=reach*reach+g.dx*g.dx,tol=g.dx*0.75;
  // one ownership test per cell (which stretch the raw rule is reading),
  // shared by every road sample that reaches it
  const ownDist=new Float32Array(nPts).fill(-1),ownY=new Float32Array(nPts);
  for(let i=0;i<N;i++){
   const s=samples[i];
   const gi0=clamp(Math.floor((s.p.x-reach-g.x0)/g.dx),0,w-1);
   const gi1=clamp(Math.floor((s.p.x+reach-g.x0)/g.dx),0,w-1);
   const gj0=clamp(Math.floor((s.p.z-reach-g.z0)/g.dz),0,h-1);
   const gj1=clamp(Math.floor((s.p.z+reach-g.z0)/g.dz),0,h-1);
   for(let j=gj0;j<=gj1;j++){
    const nzp=g.z0+g.dz*j,dz=s.p.z-nzp;
    for(let k2=gi0;k2<=gi1;k2++){
     const id=j*w+k2,nxp=g.x0+g.dx*k2;
     const dx=s.p.x-nxp,d2=dx*dx+dz*dz;
     if(d2>reach2)continue;
     let nd=ownDist[id];
     if(nd<0){const r=nearestTrackY(nxp,nzp);nd=r.dist;ownY[id]=r.y;ownDist[id]=nd;}
     // FLOOR: inside the owning stretch's corridor the cell is its bed
     if(d2<=(nd+tol)*(nd+tol)){
      const lvl=ownY[id]-groundClearance(nd);
      if(lvl>raise[id])raise[id]=lvl;
     }
     // CEILING: any stretch running over the cell keeps the ground below it,
     // and the lowest of them wins, so a ribbon that passes a climb on the
     // side (or under it) keeps its own cutting. The embankment the fill
     // builds then stops at the far edge of that corridor instead of
     // swallowing the track.
     const capR=Math.min(Math.max(wallDist,nd+tol),reach);
     if(d2<=capR*capR){
      const cv=s.p.y-groundClearance(Math.sqrt(d2));
      if(cv<cap[id])cap[id]=cv;
     }
    }
   }
  }
  raiseMap=raise;capMap=cap;
  supW=w;supH=h;supX0=g.x0;supZ0=g.z0;supDx=g.dx;supDz=g.dz;
 };
 // Both maps are read whole-cell, never interpolated: smoothing across the
 // border of a corridor cell would drag the floor or the cut out into the
 // hillside beside the track, which is the opposite of what they are for.
 const mapAt=(m,x,z,sentinel)=>{
  if(!m)return sentinel;
  const fi=(x-supX0)/supDx,fj=(z-supZ0)/supDz;
  if(fi<0||fj<0||fi>supW-1||fj>supH-1)return sentinel;
  return m[Math.min(Math.floor(fj),supH-1)*supW+Math.min(Math.floor(fi),supW-1)];
 };
 // Exact terrain height at any world point (no cache) — what the meshes and
 // the fill are built from. Raw terrain is the nearest stretch's bed, blended
 // out to rolling hills; the two support maps then bracket it.
 const rawTerrainAt=(x,z)=>{
  const r=nearestTrackY(x,z);
  const d=r.dist;
  // Inside the run-off the land IS the road bed: locked to its height, never
  // more than the small clearance below it, so the tarmac can neither float
  // above the grass nor be buried by it on a climb.
  let h=r.y-groundClearance(d);
  if(d>nearR){
   const s=clamp((d-nearR)/(farR-nearR),0,1),sm=s*s*(3-2*s);
   h=lerp(h,baseY+reliefAt(x,z),sm);
  }
  return h;
 };
 // Bracket a raw terrain height by the two support rules. Kept in one place so
 // the exact function, the fill and the far band can never disagree about a
 // crossing.
 let terrainHeightAt=(x,z)=>{
  const h=rawTerrainAt(x,z);
  const up=mapAt(raiseMap,x,z,-1e9);
  const cap=mapAt(capMap,x,z,1e9);
  let v=Math.max(Math.min(h,cap),up);
  // The same hard invariant as the grid fill, for callers outside it (the far
  // band, anything that asks the land for a height directly).
  const nr=nearestTrackY(x,z);
  if(nr.dist<halfW+6){const lim=nr.y-0.04;if(v>lim)v=lim;}
  return v;
 };
 const groundSize=Math.max(4600,rad*2.4);
 const q=effQuality();
 // --- height grid -----------------------------------------------------------
 const sampleGrid=(g,x,z)=>{
  let fx=(x-g.x0)/g.dx,fz=(z-g.z0)/g.dz;
  if(fx<0)fx=0;else if(fx>g.w-1)fx=g.w-1;
  if(fz<0)fz=0;else if(fz>g.h-1)fz=g.h-1;
  const i=Math.min(Math.floor(fx),g.w-2),j=Math.min(Math.floor(fz),g.h-2);
  const tx=fx-i,tz=fz-j;
  const a=g.data[j*g.w+i],b=g.data[j*g.w+i+1],c=g.data[(j+1)*g.w+i],d=g.data[(j+1)*g.w+i+1];
  return a+(b-a)*tx+(c-a)*tz+(a-b-c+d)*tx*tz;
 };
 const mkGrid=(cell,x0,z0,nx,nz)=>({x0,z0,dx:cell,dz:cell,w:nx,h:nz,data:new Float32Array(nx*nz)});
 // Cone-limited fill (a two-way distance transform): the surface may not fall
 // away from the road faster than a natural bank, which turns the dips between
 // sections that loop back on each other into embankments and spreads every
 // support raise into a slope instead of a step. Each sweep is bracketed by the
 // two maps, so an embankment stops exactly at the corridor it runs into
 // instead of being smoothed over the track — or into a hill a tunnel passes
 // through.
 const groundRelief=0.62;
 const gridFill2=(g,fn,maxCell)=>{
  const n=g.data.length;
  const floorArr=new Float32Array(n),ceilArr=new Float32Array(n);
  {let k=0;
   for(let j=0;j<g.h;j++){const z=g.z0+g.dz*j;
    for(let i=0;i<g.w;i++,k++){
     const x=g.x0+g.dx*i,h=fn(x,z);
     floorArr[k]=h;ceilArr[k]=h;
     const up=mapAt(raiseMap,x,z,-1e9);if(up>floorArr[k])floorArr[k]=up;
     const cap=mapAt(capMap,x,z,1e9);if(cap<ceilArr[k])ceilArr[k]=cap;
     // Hard invariant, applied to every cell rather than only to the ones a
     // support map happens to cover: no vertex of the landscape may sit above
     // a piece of tarmac running under it. Without it a circuit that loops
     // back on itself (Suzuka's chicane, Interlagos' back straight) can end up
     // with a hill standing in the middle of the track.
     const nr=nearestTrackY(x,z);
     if(nr.dist<halfW+6){const lim=nr.y-0.04;if(ceilArr[k]>lim)ceilArr[k]=lim;}
     g.data[k]=Math.max(floorArr[k],Math.min(ceilArr[k],h));
    }
   }
  }
  const out=new Float32Array(n);
  for(let pass=0;pass<2;pass++){
   out.set(g.data);
   for(let j=0;j<g.h;j++)for(let i=0;i<g.w;i++){
    const k=j*g.w+i;let v=g.data[k];
    if(i>0&&out[k-1]-maxCell>v)v=out[k-1]-maxCell;
    if(j>0&&out[k-g.w]-maxCell>v)v=out[k-g.w]-maxCell;
    out[k]=Math.max(floorArr[k],Math.min(ceilArr[k],v));
   }
   for(let j=g.h-1;j>=0;j--)for(let i=g.w-1;i>=0;i--){
    const k=j*g.w+i;let v=out[k];
    if(i<g.w-1&&out[k+1]-maxCell>v)v=out[k+1]-maxCell;
    if(j<g.h-1&&out[k+g.w]-maxCell>v)v=out[k+g.w]-maxCell;
    out[k]=Math.max(floorArr[k],Math.min(ceilArr[k],v));
   }
   g.data.set(out);
  }
 };
 // Vertex budget, not a fixed resolution: a tight street circuit gets a fine
 // mesh and a 7 km monster a coarser one, and neither blows the triangle
 // budget on a tablet. Cell size still stays well under the distance over
 // which the road itself changes height appreciably.
 // Keep ULTRA detailed but below the synchronous mesh/allocation spike that
 // can starve a tablet GPU while quality is switched from the live menu.
 const hfBudget=q==='LOW'?9000:q==='MED'?15000:q==='ULTRA'?30000:26000;
 const fineBuf=(farR-T.latLimit)+150;
 const spanX=tbMaxX-tbMinX+fineBuf*2,spanZ=tbMaxZ-tbMinZ+fineBuf*2;
 const fineCell=Math.max(6,Math.sqrt((spanX*spanZ)/hfBudget));
 const fineNX=clamp(Math.round(spanX/fineCell)+1,4,460);
 const fineNZ=clamp(Math.round(spanZ/fineCell)+1,4,460);
 const fineG=mkGrid(fineCell,tbMinX-fineBuf,tbMinZ-fineBuf,fineNX,fineNZ);
 buildSupportMaps(fineG);
 gridFill2(fineG,terrainHeightAt,fineCell*groundRelief);
 T.hf=fineG;
 // Everything that stands on grass reads terrain through this: O(1), bilinear
 // over the very grid being rendered, so a prop on a bank is on the bank.
 T.terrainSample=(x,z)=>{
  const g=fineG;
  if(x>=g.x0&&z>=g.z0&&x<=g.x0+g.dx*(g.w-1)&&z<=g.z0+g.dz*(g.h-1))return sampleGrid(g,x,z);
  return terrainHeightAt(x,z);
 };
 // --- meshes ----------------------------------------------------------------
 const groundMat=new THREE.MeshStandardMaterial({map:grassT,bumpMap:grassBumpT,bumpScale:0.4,color:def.grass,roughness:1,polygonOffset:true,polygonOffsetFactor:4,polygonOffsetUnits:4});
 groundMat.envMapIntensity=0.25;
 // Textures tile at a constant real-world size (≈38 m per tile, the scale the
 // old full-circuit plane produced) rather than stretching over the extent.
 const GROUND_UV=38;
 const groundUVs=(pos)=>{
  const n=pos.length/3,uv=new Float32Array(n*2);
  for(let k=0;k<n;k++){uv[k*2]=pos[k*3]/GROUND_UV;uv[k*2+1]=pos[k*3+2]/GROUND_UV;}
  return uv;
 };
 // Grass must face the sky: a down-facing triangle is culled by this
 // single-sided material and would open a hole onto the void underneath. The
 // two ground layers wind their loops independently (and a coarse band can
 // fold at a corner), so orientation is asserted triangle by triangle.
 const orientUp=(pos,idx)=>{
  for(let k=0;k<idx.length;k+=3){
   const a=idx[k]*3,b=idx[k+1]*3,c=idx[k+2]*3;
   const crY=(pos[b+2]-pos[a+2])*(pos[c]-pos[b])-(pos[b]-pos[a])*(pos[c+2]-pos[b+2]);
   if(crY<0){const t=idx[k+1];idx[k+1]=idx[k+2];idx[k+2]=t;}
  }
 };
 const makeGroundMesh=(pos,idx,mat)=>{
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));
  g.setAttribute('uv',new THREE.BufferAttribute(groundUVs(pos),2));
  orientUp(pos,idx);
  g.setIndex(idx);g.computeVertexNormals();
  const m=new THREE.Mesh(g,mat);m.receiveShadow=true;world.add(m);return m;
 };
 const {pos:gPos,idx:gIdx}=(()=>{
  const pos=[],idx=[],g=fineG;
  for(let j=0;j<g.h;j++){const z=g.z0+g.dz*j,row=j*g.w;
   for(let i=0;i<g.w;i++)pos.push(g.x0+g.dx*i,g.data[row+i],z);}
  for(let j=0;j<g.h-1;j++)for(let i=0;i<g.w-1;i++){
   const a=j*g.w+i,b=a+1,c=a+g.w,d=c+1;
   idx.push(a,b,c,b,d,c);
  }
  return{pos,idx};
 })();
 makeGroundMesh(gPos,gIdx,groundMat);
 // Border of that grid, walked in the same corner order, so the outer band can
 // start from exactly the same vertices.
 const border=[],borderY=[];
 for(let i=0;i<fineG.w;i++){border.push([fineG.x0+fineG.dx*i,fineG.z0]);borderY.push(fineG.data[i]);}
 for(let j=0;j<fineG.h;j++){border.push([fineG.x0+fineG.dx*(fineG.w-1),fineG.z0+fineG.dz*j]);borderY.push(fineG.data[j*fineG.w+fineG.w-1]);}
 for(let i=0;i<fineG.w;i++){border.push([fineG.x0+fineG.dx*(fineG.w-1-i),fineG.z0+fineG.dz*(fineG.h-1)]);borderY.push(fineG.data[(fineG.h-1)*fineG.w+(fineG.w-1-i)]);}
 for(let j=0;j<fineG.h;j++){border.push([fineG.x0,fineG.z0+fineG.dz*(fineG.h-1-j)]);borderY.push(fineG.data[(fineG.h-1-j)*fineG.w]);}
 // One coarse band carries the surface out past the fog. The first ring has
 // one vertex per grid edge, offset outward, so the shared border stays exactly
 // coincident; further rings are uniform rectangles, out where the land is
 // flat enough that a T-junction is millimetres rather than a gap onto the void.
 {
  const bx0=fineG.x0,bx1=fineG.x0+fineG.dx*(fineG.w-1);
  const bz0=fineG.z0,bz1=fineG.z0+fineG.dz*(fineG.h-1);
  const reachOut=Math.max(groundSize/2,Math.max(bx1-bx0,bz1-bz0)/2+600)-Math.max(bx1-cx,cz-bz0);
  const ringLevels=q==='LOW'?4:q==='ULTRA'?7:6;
  const ringPer=q==='LOW'?8:q==='ULTRA'?14:11;
  const ringStep0=Math.max(110,reachOut/ringLevels*0.5);
  const loops=[border];
  for(let l=0;l<ringLevels;l++){
   const step=ringStep0*Math.pow(1.55,l),L=loops[loops.length-1],out=[];
   if(l===0){
    for(let k=0;k<L.length;k++){
     const a=L[k],b=L[(k+1)%L.length];
     const nx=b[0]-a[0],nz=b[1]-a[1],nl=Math.hypot(nx,nz)||1;
     out.push([a[0]+nz/nl*step,a[1]-nx/nl*step]);
    }
   }else{
    const grow=ringStep0*((Math.pow(1.55,l+1)-1)/0.55);
    const r={x0:bx0-grow,x1:bx1+grow,z0:bz0-grow,z1:bz1+grow};
    for(let i=0;i<ringPer;i++){const t=i/ringPer;out.push([r.x0+(r.x1-r.x0)*t,r.z0]);}
    for(let i=0;i<ringPer;i++){const t=i/ringPer;out.push([r.x1,r.z0+(r.z1-r.z0)*t]);}
    for(let i=0;i<ringPer;i++){const t=i/ringPer;out.push([r.x1-(r.x1-r.x0)*t,r.z1]);}
    for(let i=0;i<ringPer;i++){const t=i/ringPer;out.push([r.x0,r.z1-(r.z1-r.z0)*t]);}
   }
   loops.push(out);
  }
  const bandPos=[],bandIdx=[],starts=[],counts=[];
  let base=0;
  for(let l=0;l<loops.length;l++){
   const L=loops[l];
   starts.push(base);counts.push(L.length);
   for(let k=0;k<L.length;k++)
    bandPos.push(L[k][0],l===0?borderY[k]:terrainHeightAt(L[k][0],L[k][1]),L[k][1]);
   base+=L.length;
  }
  for(let l=0;l<loops.length-1;l++){
   const n0=counts[l],n1=counts[l+1],s0=starts[l],s1=starts[l+1];
   const count=n0===n1?n0:n1;
   for(let k=0;k<count;k++){
    const t0=k/count,t1=(k+1)/count;
    const a=s0+Math.floor(t0*n0),b=s0+Math.min(n0-1,Math.floor(t1*n0));
    const c=s1+k,d=s1+((k+1)%n1);
    if(a===b||c===d)continue;
    bandIdx.push(a,c,b,b,c,d);
   }
  }
  makeGroundMesh(bandPos,bandIdx,groundMat);
  const farMat=new THREE.MeshStandardMaterial({color:new THREE.Color(def.grass).multiplyScalar(0.8),roughness:1,metalness:0});
  farMat.envMapIntensity=0.2;
  const farSize=Math.max(groundSize*3.2,9000);
  const farPlane=new THREE.Mesh(new THREE.PlaneGeometry(farSize,farSize).rotateX(-Math.PI/2),farMat);
  farPlane.position.set(cx,baseY-2.5,cz);
  world.add(farPlane);
  T.farPlane=farPlane;
 }
 T.groundMat=groundMat;
 // A single nearest-branch lookup shared by every system: the renderer, the
 // physics, the props and any diagnostic all ask the same question and get
 // the same answer, so they cannot drift apart at a crossing.
 T.nearestTrackY=(x,z)=>nearestTrackY(x,z);
 // --- one authority for "how high is the land here" -------------------------
 // The rendered surface is a fine heightfield plus a coarse ring band, and a
 // bilinear read of the fine grid alone disagrees with the band badly at the
 // scale of the band's 100 m triangles. So build a second, coarse grid over the
 // whole ground extent — sampling THAT agrees with what is drawn everywhere,
 // because it is filled from exactly the same numbers the band was.
 const coarseCell=Math.max(48,fineCell*4);
 const cSpan=Math.max(groundSize,rad*2+400);
 const cHalf=cSpan/2;
 const coarseG=mkGrid(coarseCell,cx-cHalf,cz-cHalf,Math.ceil(cSpan/coarseCell)+1,Math.ceil(cSpan/coarseCell)+1);
 {let k=0;
  for(let j=0;j<coarseG.h;j++){const z=coarseG.z0+coarseG.dz*j;
   for(let i=0;i<coarseG.w;i++,k++){
    let h=terrainHeightAt(coarseG.x0+coarseG.dx*i,z);
    // the far band draws these same numbers, so keep the invariant here too:
    // nothing in the landscape may sit above a piece of tarmac running under it
    const nr=nearestTrackY(coarseG.x0+coarseG.dx*i,z);
    if(nr.dist<halfW+6){const lim=nr.y-0.04;if(h>lim)h=lim;}
    coarseG.data[k]=h;
   }
  }
 }
 T.coarse=coarseG;
 const surfaceHeightAt=(x,z)=>{
  const g=fineG;
  if(x>=g.x0&&z>=g.z0&&x<=g.x0+g.dx*(g.w-1)&&z<=g.z0+g.dz*(g.h-1))return sampleGrid(g,x,z);
  return sampleGrid(coarseG,x,z);
 };
 // From here on, "what is the ground" means "what is the ground the player can
 // see" — raw terrain is only used to build the meshes.
 terrainHeightAt=surfaceHeightAt;
 T.terrainSample=surfaceHeightAt;
 T.trueTrackHeightAt=(x,z)=>nearestTrackY(x,z).y; // what cars sit on (no clearance)
 T.terrainHeightAt=surfaceHeightAt;               // what grass, props and stands sit on

 // 1. Road Tarmac Ribbon
 {
  const rep=Math.max(1,Math.round(len/9)),vS=len/rep;
  const pos=new Float32Array(N*6),uv=new Float32Array(N*4),index=[];
  for(let i=0;i<N;i++){const s=samples[i],vv=s.cum/vS;
   const bkE=(s.bk||0)*halfW; // banked edge lift: outside edge up, inside edge down
   pos.set([s.p.x+s.n.x*halfW,s.p.y+0.05+bkE,s.p.z+s.n.z*halfW,s.p.x-s.n.x*halfW,s.p.y+0.05-bkE,s.p.z-s.n.z*halfW],i*6);
   uv.set([0,vv,1,vv],i*4);
   const a=i*2,b=a+1,c=((i+1)%N)*2,d=c+1;index.push(a,c,b,b,c,d);}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  g.setIndex(index);g.computeVertexNormals();fixWinding(g);
  const roadMat=new THREE.MeshStandardMaterial({map:asphaltT,bumpMap:asphaltBumpT,bumpScale:0.075,color:0x9a9da2,roughness:0.95,metalness:0.05,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const road=new THREE.Mesh(g,roadMat);road.receiveShadow=true;world.add(road);T.roadMat=roadMat;
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
      p1x,s.p.y+0.04+bankOffAt(s.bk||0,halfW*sg),p1z,
      p2x,s.p.y+0.04+bankOffAt(s.bk||0,wallDist*sg),p2z,
      p3x,s2.p.y+0.04+bankOffAt(s2.bk||0,halfW*sg),p3z,
      p4x,s2.p.y+0.04+bankOffAt(s2.bk||0,wallDist*sg),p4z
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

 // 2b. EMBANKMENT SKIRTS — a continuous grassed slope from the foot of the
 //     barriers down to the terrain on both sides of the whole lap. The
 //     terrain heightfield deliberately sits below the road bed (so it can
 //     never overtop the tarmac), but that used to leave the road standing
 //     proud on an open-sided plateau: from the helicopter/TV cameras the
 //     track looked like it was FLOATING in mid-air, cars and all. These
 //     skirts close the gap the way real circuits do — with an earth bank.
 {
  const skPos=[],skUv=[],skIdx=[];let skVi=0;
  const d0=wallDist+0.56;      // just outside the barrier ribbon
  const dOut=6.5;              // how far the bank reaches before it's pure terrain
  for(let i=0;i<N;i++){
   const s=samples[i],s2=samples[(i+1)%N];
   for(const sg of[1,-1]){
    const ax=s.p.x+s.n.x*d0*sg, az=s.p.z+s.n.z*d0*sg;
    const bx=s.p.x+s.n.x*(d0+dOut)*sg, bz=s.p.z+s.n.z*(d0+dOut)*sg;
    const cx2=s2.p.x+s2.n.x*d0*sg, cz2=s2.p.z+s2.n.z*d0*sg;
    const dx2=s2.p.x+s2.n.x*(d0+dOut)*sg, dz2=s2.p.z+s2.n.z*(d0+dOut)*sg;
    // Top edge rides at the road bed (bank faded to zero at the wall);
    // bottom edge lands ON the terrain the eye sees, wherever that is.
    skPos.push(
     ax,s.p.y+0.02,az,
     bx,terrainHeightAt(bx,bz)+0.02,bz,
     cx2,s2.p.y+0.02,cz2,
     dx2,terrainHeightAt(dx2,dz2)+0.02,dz2);
    const v0=s.cum/9,v1=s2.cum/9;
    skUv.push(0,v0,1,v0,0,v1,1,v1);
    if(sg>0)skIdx.push(skVi,skVi+2,skVi+1, skVi+1,skVi+2,skVi+3);
    else skIdx.push(skVi,skVi+1,skVi+2, skVi+1,skVi+3,skVi+2);
    skVi+=4;
   }
  }
  const skGeo=new THREE.BufferGeometry();
  skGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(skPos),3));
  skGeo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(skUv),2));
  skGeo.setIndex(skIdx);skGeo.computeVertexNormals();
  const skMat=new THREE.MeshStandardMaterial({map:grassT,color:def.grass,roughness:1,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:3,polygonOffsetUnits:3});
  skMat.envMapIntensity=0.25;
  const skMesh=new THREE.Mesh(skGeo,skMat);skMesh.receiveShadow=true;world.add(skMesh);
 }

 // 3. Continuous FIA kerbs. They occupy the outer metre OF the road rather
 // than hovering beyond its edge over the lowered terrain. Their base follows
 // every road sample exactly; only the alternating rumble ribs rise above it.
 {
  const pos=[],uv=[],index=[];let vi=0;
  const curbInner=halfW-1.0,curbOuter=halfW-0.04;
  for(let i=0;i<N;i++){
   const s=samples[i],s2=samples[(i+1)%N];
   // Alternating 1.2 m ribs: enough geometry to read visually and matched by
   // the suspension/audio pulse in updCarVisual().
   const ribA=(Math.floor(s.cum/1.2)%2)?0.075:0.018;
   const ribB=(Math.floor(s2.cum/1.2)%2)?0.075:0.018;
   for(const sg of[1,-1]){
    const bIn=bankOffAt(s.bk||0,curbInner*sg),bOut=bankOffAt(s.bk||0,curbOuter*sg);
    const bIn2=bankOffAt(s2.bk||0,curbInner*sg),bOut2=bankOffAt(s2.bk||0,curbOuter*sg);
    pos.push(s.p.x+s.n.x*curbInner*sg,s.p.y+0.058+bIn,s.p.z+s.n.z*curbInner*sg,
     s.p.x+s.n.x*curbOuter*sg,s.p.y+0.058+ribA+bOut,s.p.z+s.n.z*curbOuter*sg,
     s2.p.x+s2.n.x*curbInner*sg,s2.p.y+0.058+bIn2,s2.p.z+s2.n.z*curbInner*sg,
     s2.p.x+s2.n.x*curbOuter*sg,s2.p.y+0.058+ribB+bOut2,s2.p.z+s2.n.z*curbOuter*sg);
    const v0=s.cum/2.4,v1=s2.cum/2.4;
    uv.push(0,v0,1,v0,0,v1,1,v1);
    if(sg>0)index.push(vi,vi+2,vi+1,vi+1,vi+2,vi+3);
    else index.push(vi,vi+1,vi+2,vi+1,vi+3,vi+2);
    vi+=4;
   }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));
  g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(uv),2));
  g.setIndex(index);g.computeVertexNormals();
  const cm=new THREE.Mesh(g,new THREE.MeshStandardMaterial({map:curbT,roughness:0.82}));
  cm.receiveShadow=true;world.add(cm);T.curbMesh=cm;
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

 // 5. (removed — the raised catch-fence girders that used to line the track
 //     here are gone; the low red/white barrier ribbon remains as the boundary)

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
  // A bare 0 here dropped the whole gantry to world-origin height, so on any
 // circuit whose start sits above or below zero its legs ended in mid-air.
 gp.position.set(_sv.x,terrainHeightAt(_sv.x,_sv.z),_sv.z);gp.rotation.y=yaw;world.add(gp);
 }

 /* Night lighting. What you actually see on a lit circuit at night is the
    POOL each mast throws on the tarmac plus the glare of the lamp head, not
    a spotlight cone hanging in the air. So: light rigs spaced along the
    track, each with a mast, a double lamp head and a wide additive glow on
    the road. Everything fades in with darkness (and inside tunnels). */
 T.nightMats=[];
 {
  const lm=new THREE.MeshStandardMaterial({color:0x3a3e45,roughness:0.7,metalness:0.45});
  const gm=new THREE.MeshStandardMaterial({color:0x30343a,roughness:0.6,metalness:0.3,side:THREE.DoubleSide});
  const stepN=Math.max(14,Math.min(26,Math.round(T.len/240)));
  for(let i=0;i<stepN;i++){
   const si=Math.floor(i*T.N/stepN),sa=samples[si];
   for(const sg of[1,-1]){
    const lx=sa.p.x+sa.n.x*(T.latLimit+3.4)*sg,lz=sa.p.z+sa.n.z*(T.latLimit+3.4)*sg;
    const gy=terrainHeightAt(lx,lz),yaw=Math.atan2(sa.t.x,sa.t.z);
    const grp=new THREE.Group();grp.position.set(lx,gy,lz);grp.rotation.y=yaw;
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.26,16,7),lm);mast.position.y=8;mast.castShadow=true;grp.add(mast);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.18,0.18),lm);arm.position.set(-sg*1.0,15.6,0);grp.add(arm);
    const headMat=new THREE.MeshBasicMaterial({color:0x2a2717});
    T.nightMats.push(headMat);
    for(const oz of[-0.42,0.42]){const hd=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.2,0.34),headMat);hd.position.set(-sg*1.9,15.5,oz);grp.add(hd);}
    const shade=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.34,1.06),gm);shade.position.set(-sg*1.66,15.5,0);grp.add(shade);
    world.add(grp);
    const rx=sa.p.x,rz=sa.p.z,ry=nearestTrackY(rx,rz).y;
    const pl=new THREE.Mesh(new THREE.PlaneGeometry(60,40),nightPoolMat);
    pl.rotation.order='YXZ';pl.rotation.y=yaw;pl.rotation.x=-Math.PI/2;pl.renderOrder=2;
    pl.position.set(rx,ry+0.14,rz);world.add(pl);
   }
  }
 }

 const dummy=new THREE.Object3D();

 // 8. Trackside Sponsor Billboards (Clean Straightaway Placements) — each
 // board stands on two wooden posts (real signpost legs) and carries one ad
 // tile from the strip (`adsT` holds all of them side by side; each board
 // uses a clone with a different .offset so it shows a single ad).
 {
  let side=1,adIdx=0;
  for(let i=45;i<N-45;i+=38){
   if(Math.abs(samples[i].curv)>0.007)continue;
   side=-side;sampleF(i);
   const tex=adsT.clone();tex.offset.x=(adIdx++%NA)/NA;tex.needsUpdate=true;
   tex.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());
   tex.colorSpace=THREE.SRGBColorSpace;
   // Bright, two-sided print with a slight self-lit lift: readable at dusk and
   // in rain without turning into a bloomy light source.
   const am=new THREE.MeshStandardMaterial({map:tex,roughness:0.62,side:THREE.DoubleSide,emissive:0xffffff,emissiveMap:tex,emissiveIntensity:0.12});
   const yaw=Math.atan2(_st.x,_st.z);
   // Just beyond the safety barrier, never on the driving surface, and close
   // enough that its face fills useful screen space as the player passes.
   const boardLat=T.latLimit+1.7;
   const bx=_sv.x+_sn.x*boardLat*side, bz=_sv.z+_sn.z*boardLat*side;
   const by=Math.max(terrainHeightAt(bx,bz),_sv.y-0.4);
   // A dark structural slab plus one dedicated printed plane facing the road.
   // Mapping a texture around a BoxGeometry mirrored one side, so boards on
   // alternate sides of the circuit read backwards. A front-facing plane keeps
   // every advert sharp and correctly oriented.
   const slab=new THREE.Mesh(new THREE.BoxGeometry(12.5,3.1,0.24),new THREE.MeshStandardMaterial({color:0x15171b,roughness:.7}));
   slab.position.set(bx,by+2.35,bz);slab.rotation.y=yaw+Math.PI/2;slab.castShadow=true;world.add(slab);
   const w=new THREE.Mesh(new THREE.PlaneGeometry(12.2,2.8),am);
   w.position.set(bx,by+2.35,bz);w.lookAt(_sv.x,by+2.35,_sv.z);w.translateZ(.14);w.renderOrder=2;world.add(w);
   // Wooden legs at either end along the track direction.
   const lx=_st.x,lz=_st.z;
   for(const s of[1,-1]){
    const legH=1.7;
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.11,0.13,legH,6),woodLegMat);
    leg.position.set(bx+lx*5.6*s,by+legH*0.45,bz+lz*5.6*s);
    leg.rotation.z=s*0.05;leg.castShadow=true;world.add(leg);
   }
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

   const standY=terrainHeightAt(bx,bz);
   const baseW=28;
   T.stands=T.stands||[];T.stands.push({x:bx,z:bz,y:standY,yaw});
   const stand=new THREE.Mesh(new THREE.BoxGeometry(9.0,0.8,baseW),standMat);
   stand.position.set(bx,standY+0.4,bz);stand.rotation.y=yaw;stand.castShadow=true;world.add(stand);

   for(let r=0;r<5;r++){
     const rowY = standY + 0.8 + r * 0.7;
     const rowOffsetZ = side * (-3.0 + r * 1.5);
     const tierPos = new THREE.Vector3(bx + nv.x * rowOffsetZ, rowY / 2 + 0.4, bz + nv.z * rowOffsetZ);
     
     const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, baseW), standMat);
     stepMesh.position.set(tierPos.x, rowY - 0.35, tierPos.z);
     stepMesh.rotation.y = yaw;
     stepMesh.receiveShadow = true;
     world.add(stepMesh);

     const bench = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, baseW - 1.2), seatMat);
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

   const frontRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, baseW), railMat);
   frontRail.position.set(bx - nv.x * side * 4.0, standY + 1.35, bz - nv.z * side * 4.0);
   frontRail.rotation.y = yaw;
   world.add(frontRail);

   const roof=new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.35, baseW + 2), roofMat);
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
  // Main-straight grandstands — this is where the bulk of spectators sit at
  // a real GP: one stand on each side of the start/finish straight, fronted
  // toward the racing line, so the grid launch reads as a packed stadium.
  for(const [si,sd] of [[N-16,-1],[20,1]]){
   if(placed.length>=7)break;
   let cv=0;for(let k=-6;k<=6;k++)cv=Math.max(cv,Math.abs(samples[(si+k+N)%N].curv));
   if(cv>0.008)continue; // only on a genuinely straight stretch
   placed.push(si);
   sampleF(si);const yaw=Math.atan2(_st.x,_st.z);
   const bx=_sv.x+_sn.x*(T.latLimit+10.5)*sd,bz=_sv.z+_sn.z*(T.latLimit+10.5)*sd;
   if(minTrackDist(bx,bz)<T.latLimit+32)continue;
   const tv=new THREE.Vector3(samples[si].t.x,0,samples[si].t.z);
   const nv=new THREE.Vector3(samples[si].n.x,0,samples[si].n.z);
   const standY=terrainHeightAt(bx,bz);
   const baseW=36;T.stands=T.stands||[];T.stands.push({x:bx,z:bz,y:standY,yaw}); // the main straight gets the biggest grandstand
   const stand=new THREE.Mesh(new THREE.BoxGeometry(9.0,0.8,baseW),standMat);
   stand.position.set(bx,standY+0.4,bz);stand.rotation.y=yaw;stand.castShadow=true;world.add(stand);
   for(let r=0;r<6;r++){
     const rowY = standY + 0.8 + r * 0.7;
     const rowOffsetZ = sd * (-3.4 + r * 1.4);
     const tierPos = new THREE.Vector3(bx + nv.x * rowOffsetZ, rowY / 2 + 0.4, bz + nv.z * rowOffsetZ);
     const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, baseW), standMat);
     stepMesh.position.set(tierPos.x, rowY - 0.35, tierPos.z);
     stepMesh.rotation.y = yaw;stepMesh.receiveShadow = true;world.add(stepMesh);
     const bench = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, baseW - 1.2), seatMat);
     bench.position.set(tierPos.x, rowY + 0.06, tierPos.z);bench.rotation.y = yaw;world.add(bench);
     for(let c=0;c<28;c++){
       const colSpread = (c - 13.5) * 1.18;
       crowdData.push({x: tierPos.x + tv.x * colSpread, baseY: rowY + 0.12, y: rowY + 0.12,
        z: tierPos.z + tv.z * colSpread, yaw: yaw + (sd < 0 ? Math.PI : 0), ph: rand(0, 9)});
     }
   }
   const frontRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, baseW), railMat);
   frontRail.position.set(bx - nv.x * sd * 4.0, standY + 1.35, bz - nv.z * sd * 4.0);
   frontRail.rotation.y = yaw;world.add(frontRail);
   const roof=new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.35, baseW + 2), roofMat);
   roof.position.set(bx + nv.x * sd * 0.5, standY + 6.6, bz + nv.z * sd * 0.5);
   roof.rotation.y=yaw;world.add(roof);
   for(const fo of[-baseW/2 + 0.6, baseW/2 - 0.6]){
     const pillar=new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.2, 0.35), railMat);
     pillar.position.set(bx + tv.x * fo + nv.x * sd * 3.8, standY + 3.2, bz + tv.z * fo + nv.z * sd * 3.8);
     pillar.rotation.y = yaw;world.add(pillar);
     const flag=new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshStandardMaterial({color:pick([0xe10600,0xf2d13d,0x2e6fd0,0xe9e9e9]), side:THREE.DoubleSide, roughness:0.7}));
     flag.position.set(pillar.position.x + 0.9, standY + 6.8, pillar.position.z);
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


 // 9b. Tyre barriers at corner outsides — stacked red/white/blue tyre walls
 //     like real circuits use to absorb impacts at the apex runoff.
 {
  const tyreGeo=new THREE.CylinderGeometry(0.55,0.55,0.5,10);
  const tyreMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.75});
  const tyreMesh=new THREE.InstancedMesh(tyreGeo,tyreMat,300);
  const tCols=[0xd91624,0xf2f3f7,0x2e6fd0];
  let tk=0,lastT=-999;
  const td=new THREE.Object3D();const tC=new THREE.Color();
  for(let i=0;i<N;i+=6){
   const cv=samples[i].curv;
   if(Math.abs(cv)<0.018||i-lastT<48)continue;
   lastT=i;
   const s=samples[i],sg=-Math.sign(cv)||1;
   const bx=s.p.x+s.n.x*(wallDist+2.4)*sg,bz=s.p.z+s.n.z*(wallDist+2.4)*sg;
   const yaw=Math.atan2(s.t.x,s.t.z);
   const clusters=3+Math.min(3,Math.floor(Math.abs(cv)*110));
   for(let c=0;c<clusters&&tk<300;c++){
    const off=(c-(clusters-1)/2)*2.5;
    const tx=bx+s.t.x*off,tz=bz+s.t.z*off;
    const h=terrainHeightAt(tx,tz);
    for(let ty=0;ty<3&&tk<300;ty++){
     td.position.set(tx,h+0.25+ty*0.5,tz);
     td.rotation.set(0,yaw,0);td.scale.set(1,1,1);
     td.updateMatrix();tyreMesh.setMatrixAt(tk,td.matrix);
     tyreMesh.setColorAt(tk,tC.set(tCols[(tk+Math.floor(off*2))%3]));
     tk++;
    }
   }
  }
  if(tk>0){tyreMesh.count=tk;tyreMesh.instanceMatrix.needsUpdate=true;tyreMesh.castShadow=true;world.add(tyreMesh);}
 }

 // 9b2. Gravel traps — a coarse, textured gravel bed in the run-off on the
 //      outside of the sharper corners, exactly where real circuits throw the
 //      gravel. Built as a *continuous patch* spanning the whole run-off band
 //      (halfW → wallDist) over each qualifying high-curvature stretch, so a
 //      car running wide visibly digs into gravel. `T.gravelMask` marks the
 //      samples this applies to so the physics can slow a car that's in it.
 {
  const gravelMask=new Uint8Array(N);
  const gPos=[],gIdx=[];let gVi=0;
  let inRun=false,runStart=0;
  const runs=[]; // [start,end) of corner-outsides to cover
  for(let i=0;i<N;i++){
   const cv=Math.abs(samples[i].curv);
   const active=cv>0.016;
   if(active&&!inRun){inRun=true;runStart=i;}
   else if(!active&&inRun){
    if(i-runStart>=6)runs.push([runStart,i]);
    inRun=false;
   }
  }
  if(inRun&&N-runStart>=6)runs.push([runStart,N]);
  for(const[rs,re] of runs){
   for(let i=rs;i<re;i++)gravelMask[i]=1;
   // Build a single gravel quad strip for the OUTSIDE of this corner run.
   // The outside of a corner is the side the curb tilts toward (sign of curv).
   let side=0;
   for(let i=rs;i<re;i++){if(Math.abs(samples[i].curv)>0.02){side=Math.sign(samples[i].curv)||1;break;}}
   if(side===0)side=1;
   for(let i=rs;i<re;i++){
    const s=samples[i],s2=samples[(i+1)%N];
    const gx0=s.p.x+s.n.x*(halfW+1.5)*side, gz0=s.p.z+s.n.z*(halfW+1.5)*side;
    const gx1=s.p.x+s.n.x*wallDist*side,   gz1=s.p.z+s.n.z*wallDist*side;
    const gx2=s2.p.x+s2.n.x*(halfW+1.5)*side, gz2=s2.p.z+s2.n.z*(halfW+1.5)*side;
    const gx3=s2.p.x+s2.n.x*wallDist*side,   gz3=s2.p.z+s2.n.z*wallDist*side;
    const gb0=bankOffAt(s.bk||0,(halfW+1.5)*side),gb1=bankOffAt(s.bk||0,wallDist*side);
    const gb2=bankOffAt(s2.bk||0,(halfW+1.5)*side),gb3=bankOffAt(s2.bk||0,wallDist*side);
    gPos.push(gx0,s.p.y+0.09+gb0,gz0, gx1,s.p.y+0.09+gb1,gz1, gx2,s2.p.y+0.09+gb2,gz2, gx3,s2.p.y+0.09+gb3,gz3);
    if(side>0)gIdx.push(gVi,gVi+2,gVi+1, gVi+1,gVi+2,gVi+3);
    else gIdx.push(gVi,gVi+1,gVi+2, gVi+1,gVi+3,gVi+2);
    gVi+=4;
   }
  }
  if(gVi>0){
   const gGeo=new THREE.BufferGeometry();
   gGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(gPos),3));
   gGeo.setIndex(gIdx);gGeo.computeVertexNormals();
   const gMat=new THREE.MeshStandardMaterial({map:gravelT,roughness:1,polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:2});
   const gMesh=new THREE.Mesh(gGeo,gMat);gMesh.receiveShadow=true;world.add(gMesh);
   T.gravelMask=gravelMask;
  }
 }

 // 9c. DRS zone boards — the green boards beside the straights, exactly where
 //     the in-game DRS activation logic actually allows the wing to open.
 {
  const[dcn,dcx]=mkCanvas(256,96);
  dcx.fillStyle='#0d7a3d';dcx.fillRect(0,0,256,96);
  dcx.strokeStyle='#ffffff';dcx.lineWidth=6;dcx.strokeRect(4,4,248,88);
  dcx.fillStyle='#ffffff';dcx.font='700 46px sans-serif';dcx.textAlign='center';dcx.textBaseline='middle';
  dcx.fillText('DRS',128,42);
  dcx.fillStyle='#ffe600';dcx.font='700 18px sans-serif';dcx.fillText('▼ ZONE ▼',128,80);
  const drsTex=ctex(dcn,false);
  const drsMat=new THREE.MeshStandardMaterial({map:drsTex,roughness:0.7,side:THREE.DoubleSide});
  let lastB=-999,nB=0;
  for(let i=70;i<N-70;i+=24){
   if(Math.abs(samples[i].curv)>0.006||i-lastB<120)continue;
   lastB=i;if(++nB>3)break;
   const s=samples[i],sg=nB%2?1:-1;
   const bx=s.p.x+s.n.x*(T.latLimit+3.6)*sg,bz=s.p.z+s.n.z*(T.latLimit+3.6)*sg;
   const by=terrainHeightAt(bx,bz);
   const b=new THREE.Mesh(new THREE.PlaneGeometry(5.4,2.6),drsMat);
   b.position.set(bx,by+1.6,bz);
   b.lookAt(bx-s.n.x*sg*6,by+1.6,bz-s.n.z*sg*6);
   world.add(b);
   // Two wooden legs either end, straight into the ground.
   for(const so of[1,-1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.11,1.6,6),woodLegMat);
    leg.position.set(bx+s.t.x*2.2*so,by+0.65,bz+s.t.z*2.2*so);
    leg.castShadow=true;world.add(leg);
   }
  }
 }

 // 9d. Braking marker boards ("100" / "50") on the approach to tight corners,
 //     mounted on the outside like the real FIA signage.
 {
  const mkBoard=(txt)=>{const[cn,cx]=mkCanvas(128,96);
   cx.fillStyle='#f2f2f2';cx.fillRect(0,0,128,96);
   cx.fillStyle='#d91624';cx.fillRect(0,0,128,10);cx.fillRect(0,86,128,10);
   cx.fillStyle='#101114';cx.font='700 60px sans-serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(txt,64,52);
   return ctex(cn,false);};
  const t100=mkBoard('100'),t50=mkBoard('50');
  let lastK=-999,nK=0;
  for(let i=0;i<N;i+=4){
   const cv=samples[i].curv;
   if(Math.abs(cv)<0.022||i-lastK<70)continue;
   lastK=i;if(++nK>6)break;
   const sg=-Math.sign(samples[i].curv)||1;
   for(const [dist,txtTex,big] of [[26,t100,1.0],[14,t50,0.85]]){
    const j=(i-dist+N)%N,sj=samples[j];
    const bx=sj.p.x+sj.n.x*(T.latLimit+2.8)*sg,bz=sj.p.z+sj.n.z*(T.latLimit+2.8)*sg;
    const by=terrainHeightAt(bx,bz);
    const p=new THREE.Mesh(new THREE.PlaneGeometry(2.8*big,2.1*big),new THREE.MeshStandardMaterial({map:txtTex,roughness:0.8,side:THREE.DoubleSide}));
    p.position.set(bx,by+1.15*big,bz);
    p.lookAt(bx-sj.n.x*sg*4,by+1.15*big,bz-sj.n.z*sg*4);
    world.add(p);
    // Wooden signposts holding the board up.
    for(const so of[1,-1]){
     const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.08,1.3*big,6),woodLegMat);
     leg.position.set(bx+sj.t.x*1.1*big*so,by+0.6*big,bz+sj.t.z*1.1*big*so);
     leg.castShadow=true;world.add(leg);
    }
   }
  }
 }

 const propDensity=(QUALITY_PRESETS[effQuality()]||{}).propDensity!=null?QUALITY_PRESETS[effQuality()].propDensity:1;
 // 9z. 3-D GRASS TUFTS — the verge isn't just a painted texture any more:
 //     instanced criss-cross blade cards scattered in the band beyond the
 //     barriers give the grass actual height and parallax as you drive past.
 //     Two crossed planes per tuft, one draw call for the whole circuit, so
 //     even thousands of tufts cost next to nothing.
 {
  const nTuft=Math.round((def.theme==='street'?320:def.theme==='forest'?1500:1250)*propDensity);
  if(nTuft>8){
   const bladeG=new THREE.PlaneGeometry(0.9,0.55,1,1);
   bladeG.translate(0,0.24,0);
   const gBase=new THREE.Color(def.grass!==undefined?def.grass:0x477d3b);
   const tuftMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,side:THREE.DoubleSide});
   const tufts=new THREE.InstancedMesh(bladeG,tuftMat,nTuft);
   const tDummy=new THREE.Object3D();
   const tc=new THREE.Color();
   let placed=0,tuftTries=0;
   while(placed<nTuft&&tuftTries<nTuft*4){
    tuftTries++;
    const ts=samples[Math.floor(Math.random()*N)];
    const side=Math.random()<0.5?1:-1;
    const lat=rand(T.latLimit+1.2,T.latLimit+16);
    const x=ts.p.x+ts.n.x*lat*side+rand(-1.2,1.2),z=ts.p.z+ts.n.z*lat*side+rand(-1.2,1.2);
    if(minTrackDist(x,z)<wallDist+0.9)continue; // never on the road or run-off
    const y=terrainHeightAt(x,z);
    tDummy.position.set(x,y+0.01,z);
    tDummy.rotation.set(0,rand(0,Math.PI),rand(-0.06,0.06));
    const sc=rand(0.6,1.5);
    tDummy.scale.set(sc,sc*rand(0.8,1.5),sc);
    tDummy.updateMatrix();
    tufts.setMatrixAt(placed,tDummy.matrix);
    // per-tuft tint: lusher / drier / sun-bleached variation around the
    // circuit's own grass colour
    tc.copy(gBase).multiplyScalar(rand(0.85,1.35));
    tc.g=Math.min(1,tc.g*rand(1.0,1.2));
    tufts.setColorAt(placed,tc);
    placed++;
   }
   tufts.count=placed;
   if(tufts.instanceColor)tufts.instanceColor.needsUpdate=true;
   tufts.instanceMatrix.needsUpdate=true;
   world.add(tufts);
  }
 }
 // 10. Trees & Scenery (Far away from track edges) — three distinct species
 // (conifer / round broadleaf / slender poplar) mixed by theme, instead of
 // one repeated cone, so the scenery doesn't look so uniform.
 {
  const nT=Math.round((def.theme==='forest'?640:def.theme==='park'?320:90)*propDensity);
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
   const lat=rand(T.latLimit+3,T.latLimit+55);
   const x=ts.p.x+ts.n.x*lat*side,z=ts.p.z+ts.n.z*lat*side;
   // The offset above only guarantees clearance from THIS sample's own
   // stretch of track — at a hairpin or chicane, that same (x,z) can still
   // land right next to a completely different part of the lap that loops
   // back nearby. Validate against the true closest point on the whole
   // track before accepting it.
   if(minTrackDist(x,z)<T.latLimit+4)continue;
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
    x:s.p.x+s.n.x*off,y:s.p.y+0.056+bankOffAt(s.bk||0,off),z:s.p.z+s.n.z*off,
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

 // 13. Lake / harbour water — a flat, reflective water disc in the infield for
 //     circuits that actually run beside water (Albert Park encircles a lake;
 //     Suzuka has parkland water). Computes a radius that always stays inside
 //     the lap so it can never spill onto the tarmac.
 if(def.lake){
  let minD=1e9;for(const s of samples){const d=Math.hypot(s.p.x-cx,s.p.z-cz);if(d<minD)minD=d;}
  const lr=Math.max(18,minD*(def.lake.frac||0.9)-4);
  const ly=terrainHeightAt(cx,cz)+0.12;
  const lmat=new THREE.MeshStandardMaterial({map:waterT,bumpMap:waterT,bumpScale:0.25,color:0x1b6b86,roughness:0.12,metalness:0.25,transparent:true,opacity:0.88,envMapIntensity:1.4,polygonOffset:true,polygonOffsetFactor:3,polygonOffsetUnits:3});
  const lake=new THREE.Mesh(new THREE.CircleGeometry(lr,26),lmat);
  lake.rotation.x=-Math.PI/2;lake.position.set(cx,ly,cz);
  lake.receiveShadow=true;lake.renderOrder=2;world.add(lake);
 }

 // 13b. WATERSIDE — harbour / sea / river frontage beside the stretches of
 //      track that genuinely run along water: Monaco's port (inside the lap!),
 //      Baku's Caspian promenade, Singapore's Marina Bay, Jeddah's Corniche
 //      lagoon, the Yas Marina, Miami's famous fake marina, Montreal's rowing
 //      basin. Each zone lays a strip of reflective water just past the
 //      barriers over [from..to] of the lap. side:'out' (default) faces away
 //      from the circuit's centroid; side:'in' faces the infield. Harbour
 //      zones (`boats:true`) also get a scatter of low-poly moored boats.
 if(def.water&&def.water.length){
  const wMat=new THREE.MeshStandardMaterial({map:waterT,bumpMap:waterT,bumpScale:0.22,color:0x1e6d8a,roughness:0.13,metalness:0.22,transparent:true,opacity:0.9,envMapIntensity:1.4,side:THREE.DoubleSide});
  const hullMat=new THREE.MeshStandardMaterial({color:0xf2f4f6,roughness:0.5});
  const cabinMat=new THREE.MeshStandardMaterial({color:0x2c4a5a,roughness:0.55});
  for(const zone of def.water){
   const i0=Math.round(zone.from*N),i1=Math.round(zone.to*N);
   if(i1-i0<6)continue;
   const wWide=zone.w!==undefined?zone.w:28,near=wallDist+2.2;
   const sgn=(i)=>{const sm=samples[((i%N)+N)%N];
    const outward=Math.sign((sm.p.x-cx)*sm.n.x+(sm.p.z-cz)*sm.n.z)||1;
    return zone.side==='in'?-outward:outward;};
   // Water level per cross-section: terrain sampled mid-strip, then smoothed
   // hard along the run so the surface reads as one calm sheet, not a slope.
   const lvl=[];
   for(let i=i0;i<=i1;i++){
    const sm=samples[i%N],sd=sgn(i);
    lvl.push(terrainHeightAt(sm.p.x+sm.n.x*(near+wWide*0.5)*sd,sm.p.z+sm.n.z*(near+wWide*0.5)*sd));
   }
   for(let k=0;k<30;k++)for(let j=1;j<lvl.length-1;j++)lvl[j]=(lvl[j-1]+lvl[j]*2+lvl[j+1])/4;
   const wPos=[],wUv=[],wIdx=[];let wVi=0;
   for(let i=i0;i<i1;i++){
    const A=samples[i%N],B=samples[(i+1)%N],sdA=sgn(i),sdB=sgn(i+1);
    // Taper the width in over the first/last few samples so the water ends
    // in a shoreline point instead of a hard square edge.
    const tA=clamp(Math.min(i-i0,i1-i)/7,0.1,1),tB=clamp(Math.min(i+1-i0,i1-(i+1))/7,0.1,1);
    const yA=lvl[i-i0]+0.16,yB=lvl[i+1-i0]+0.16;
    wPos.push(
     A.p.x+A.n.x*near*sdA, yA, A.p.z+A.n.z*near*sdA,
     A.p.x+A.n.x*(near+wWide*tA)*sdA, yA, A.p.z+A.n.z*(near+wWide*tA)*sdA,
     B.p.x+B.n.x*near*sdB, yB, B.p.z+B.n.z*near*sdB,
     B.p.x+B.n.x*(near+wWide*tB)*sdB, yB, B.p.z+B.n.z*(near+wWide*tB)*sdB);
    const v0=A.cum/22,v1=B.cum/22;
    wUv.push(0,v0,1,v0,0,v1,1,v1);
    wIdx.push(wVi,wVi+2,wVi+1, wVi+1,wVi+2,wVi+3);
    wVi+=4;
   }
   const wGeo=new THREE.BufferGeometry();
   wGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(wPos),3));
   wGeo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(wUv),2));
   wGeo.setIndex(wIdx);wGeo.computeVertexNormals();
   const wMesh=new THREE.Mesh(wGeo,wMat);wMesh.receiveShadow=true;wMesh.renderOrder=2;world.add(wMesh);
   if(zone.boats){
    const nBoat=Math.max(2,Math.round((i1-i0)/26));
    for(let b=0;b<nBoat;b++){
     const i=i0+4+Math.floor(Math.random()*Math.max(1,i1-i0-8));
     const sm=samples[i%N],sd=sgn(i);
     const off=near+rand(wWide*0.32,wWide*0.75);
     const bx=sm.p.x+sm.n.x*off*sd,bz=sm.p.z+sm.n.z*off*sd;
     const by=lvl[clamp(i-i0,0,lvl.length-1)]+0.16;
     const boat=new THREE.Group();
     const hl=rand(4.5,8);
     const hull=new THREE.Mesh(new THREE.BoxGeometry(hl,0.7,hl*0.32),hullMat);hull.position.y=0.28;boat.add(hull);
     const bow=new THREE.Mesh(new THREE.BoxGeometry(hl*0.26,0.55,hl*0.26),hullMat);bow.position.set(hl*0.55,0.24,0);bow.rotation.y=Math.PI/4;boat.add(bow);
     const cab=new THREE.Mesh(new THREE.BoxGeometry(hl*0.38,0.6,hl*0.24),cabinMat);cab.position.set(-hl*0.12,0.9,0);boat.add(cab);
     if(Math.random()<0.5){const mast=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.07,rand(3,5),5),cabinMat);mast.position.set(hl*0.1,2.2,0);boat.add(mast);}
     boat.position.set(bx,by,bz);boat.rotation.y=rand(0,Math.PI*2);boat.userData.isBoat=true;
     boat.traverse(o=>{if(o.isMesh)o.castShadow=true;});
     world.add(boat);
    }
   }
  }
 }

 for(let i=0;i<N;i+=90){
  const sg=(i/90)%2?1:-1;sampleF(i);
  const x=_sv.x+_sn.x*(T.latLimit+12)*sg,z=_sv.z+_sn.z*(T.latLimit+12)*sg;
  // The post stands on the GROUND, twelve metres of run-off away from the
  // tarmac — so its datum has to be the terrain height there, not the road
  // height. On a hillside the difference is several metres, which is exactly
  // the "everything is hovering" tell.
  const gy=terrainHeightAt(x,z), ry=_sv.y;
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.18,7,5),new THREE.MeshStandardMaterial({color:0x3a3f46}));
  pole.position.set(x,gy+3.45,z);pole.castShadow=true;world.add(pole);
  const box=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.5,0.7),new THREE.MeshStandardMaterial({color:0x14161a}));
  box.position.set(x,gy+7.2,z);box.lookAt(_sv.x,ry+1,_sv.z);world.add(box);
  // Marshal post flag — the yellow/red flag waved from the observation tower.
  const mflag=new THREE.Mesh(new THREE.PlaneGeometry(1.5,0.95),new THREE.MeshStandardMaterial({color:pick([0xe10600,0xf2d13d,0x2e6fd0,0xe9e9e9]),side:THREE.DoubleSide,roughness:0.7}));
  mflag.position.set(x+0.75,gy+7.55,z);mflag.userData.ph=rand(0,9);world.add(mflag);T.flags.push(mflag);
   T.tvCams.push(V3(x,gy+6.6,z));
 }

 // 14. Tunnel — a covered section over a stretch of track (used by Monaco, the
 //     Portier→Tunnel→Nouvelle Chicane run). Built as an enclosed arch that
 //     follows the track's own elevation; `T.tunnel` lets the physics/audio
 //     know when a car is inside so the engine can rumble and the lighting
 //     drops. castShadow on the roof naturally darkens the road underneath.
 if(def.tunnel){
  const i0=Math.round(def.tunnel.from*N), i1=Math.round(def.tunnel.to*N);
  const hw=halfW+1.4, roofH=5.2, wallTop=2.7;
  const tPos=[],tIdx=[];let tVi=0;
  const arcDr=(i)=>{const s=samples[((i%N)+N)%N];
   const pts=[ s.p.x+s.n.x*(-hw), s.p.y+0.05, s.p.z+s.n.z*(-hw),
               s.p.x+s.n.x*(-hw), s.p.y+wallTop, s.p.z+s.n.z*(-hw),
               s.p.x,             s.p.y+roofH,   s.p.z,
               s.p.x+s.n.x*(hw),  s.p.y+wallTop, s.p.z+s.n.z*(hw),
               s.p.x+s.n.x*(hw),  s.p.y+0.05,    s.p.z+s.n.z*(hw)];
   return pts;};
  for(let i=i0;i<=i1;i++){
   const A=arcDr(i),B=arcDr(i+1);
   tPos.push(...A,...B);
   for(let k=0;k<4;k++){
    const a=tVi+k, b=tVi+k+1, c=tVi+5+k, d=tVi+6+k;
    tIdx.push(a,c,b, b,c,d);
   }
   tVi+=10;
  }
  const tGeo=new THREE.BufferGeometry();
  tGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(tPos),3));
  tGeo.setIndex(tIdx);tGeo.computeVertexNormals();
  const tMat=new THREE.MeshStandardMaterial({color:0x3a3d43,roughness:0.7,metalness:0.2,side:THREE.DoubleSide});
  const tun=new THREE.Mesh(tGeo,tMat);tun.castShadow=true;tun.receiveShadow=true;world.add(tun);
  // A few warm tunnel lights along the ceiling for a bit of artificial glow.
  const lampMat=new THREE.MeshStandardMaterial({color:0x222,emissive:0xffd98a,emissiveIntensity:2.2});
  const lamps=new THREE.InstancedMesh(new THREE.BoxGeometry(0.5,0.08,0.6),lampMat,Math.max(2,Math.floor((i1-i0)/28)));
  let li=0;const ld=new THREE.Object3D();
  for(let i=i0;i<=i1&&li<lamps.count;i+=28){const s=samples[i];
   ld.position.set(s.p.x,s.p.y+roofH-0.18,s.p.z);ld.updateMatrix();lamps.setMatrixAt(li++,ld.matrix);}
  lamps.count=li;world.add(lamps);
  T.tunnel={i0,i1};
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
  crash:0,crashMax:0,crashSpark:0,
  onGravel:false,inTunnel:false,gravelT:0,
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
  const pers=personaFor(d);
  cars.push(makeCar({
   name: d.name,
   team: d.team,
   skill: d.skill,
   num: d.num,
   colA: d.color || d.colA || '#ffffff',
   colB: d.colB || '#888888',
   helmet: d.helmet || d.color || '#e10600',
   headshot: d.headshot || null,
   code: d.code || d.name.substring(0,3).toUpperCase(),
   agg: pers.agg, defend: pers.defend, risk: pers.risk
  }, false));
 });
 player=makeCar({name:state.name,team:'POLYGON GP',skill:0.9,num:99,colA:'#f5f5f2',colB:'#e10600',helmet:'#e10600',headshot:state.driverPhoto||null,code:state.name.substring(0,3).toUpperCase(),agg:0.95,defend:0.95,risk:0.6},true);
 cars.push(player);
 gridPlace();
}
function gridPlace(){
 cars.forEach((c,i)=>{
  c.f=T.N-14-i*3.6;c._pf=c.f;c.lat=(i%2?3:-3)*0.95;
  c.lap=0;c.best=null;c.finished=false;c.finishTime=null;c.wheelspin=0;c.drsOpen=false;
  c.lapStart=0;c.stuck=0;c.hitT=0;c.recT=0;c.crash=0;c.crashMax=0;c.wrecked=false;c.steer=0;c.pDiff=0;c.slipstream=false;
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
 // Sit the car on the ACTUAL road surface elevation — not a hardcoded 0.05.
 // A grid start on an elevated circuit (Spa, Red Bull Ring, real telemetry
 // circuits with roll) otherwise leaves the whole grid sunk below the
 // tarmac, which reads as "the cars are missing" on the lights-out grid.
 c.y=getRoadHAtCoords(c.x,c.z);
 c.vy=0;c.airborne=false;c.pitch=0;c.bounceOff=0;c.bounceVel=0;
 // The tarmac skin is drawn 0.05 above the centreline the physics sits on, so
// the car group goes at the raw road height: the tyre bottoms then press just
// into the painted surface instead of resting tangentially on top of it,
// which is what read as "the cars are flying".
// The tarmac skin is drawn 0.05 m above the centreline the cars are tracked
 // on, so the car rides with it: wheel bottoms land exactly on the visible
 // surface — no gap to read as "flying", and no sink into the paint.
 c.mesh.g.position.set(c.x,c.y+0.05,c.z);
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
 // The painted kerb is the outer metre of tarmac (matching the rendered strip),
 // not an invisible band floating in the run-off.
 c.onCurb=al>T.halfW-1.0&&al<=T.halfW+0.08;
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
function nearestBehind(c){
 let best=null,bd=1e9;
 for(const o of cars){if(o===c)continue;
  let dk=c.f-o.f;dk=((dk%T.N)+T.N)%T.N; // o is behind when o.f < c.f
  if(dk<=0.5||dk>18)continue;
  if(Math.abs(o.lat-c.lat)>3.6)continue;
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
 /* steer toward a look-ahead point on the racing line (with avoidance) —
    hold the line tightly; only leave it to attack, avoid or defend */
 const dAgg=c.d.agg||0.5,dDef=c.d.defend||0.5,dRk=c.d.risk||0.5;
 // Human-scale errors: occasional missed apex, throttle hesitation or small
 // lock-up. Pressure from a nearby car makes one more likely, but no driver
 // deliberately targets another car.
 c.mistakeT=Math.max(0,(c.mistakeT||0)-dt);
 if(c.mistakeT<=0&&Math.random()<dt*(0.004+dRk*0.008)*(c.near?1.7:1)){
  c.mistakeT=rand(.35,1.15);c.mistakeSteer=rand(-.28,.28);c.mistakeBrake=Math.random()<.45?rand(.12,.42):0;
 }
 const la=6+clamp(vF*0.55,0,34);
 const lf=(c.f+la/T.segLen)%T.N;
 const li=Math.floor(lf);
 let latT=T.samples[li].line+Math.sin(timeSec*0.7+c.phase)*0.16;
 const ah=nearestAhead(c);
 if(ah&&ah.dist<26){
  const side=(c.lat-ah.c.lat)>=0?1:-1;
  // Aggressive drivers commit to the overtake earlier and hold a tighter
  // line past the rival; cautious ones back out sooner.
  const off=lerp(4.0,2.6,dAgg);
  latT=clamp(ah.c.lat+side*off,-(T.halfW-1.1),T.halfW-1.1);
 }
 // Defensive driving: when a car is close behind and closing, block the
 // inside line into the next corner (the classic F1 move), and weave a
 // little on the straights to break their slipstream.
 const bh=nearestBehind(c);
 if(bh&&bh.dist<34){
  const closing=bh.c.vF-c.vF>1.5||bh.dist<16;
  if(closing&&dDef>0.3){
   let bestC=0,bi=fi;
   for(let k=6;k<44;k+=3){
    const idx=(fi+k)%T.N,a=Math.abs(T.samples[idx].curv);
    if(a>bestC){bestC=a;bi=idx;}
   }
   if(bestC>0.011){
    const inside=T.samples[bi].line*1.2*dDef;
    latT=lerp(latT,clamp(inside,-(T.halfW-1.0),T.halfW-1.0),0.7);
   }else if(bh.dist<17&&dDef>0.5){
    latT=clamp(latT+Math.sin(timeSec*3.0+c.phase*2)*0.75*dDef,-(T.halfW-1.0),T.halfW-1.0);
   }
  }
 }
 // Risk-takers crack under pressure occasionally — a sloppy line that
 // opens the door for the car behind.
 if(dRk>0.5&&bh&&bh.dist<24&&Math.random()<dt*0.09*dRk){
  latT=clamp(latT+(Math.random()<0.5?-1:1)*rand(0.9,2.2),-(T.halfW-1.0),T.halfW-1.0);
 }
 latT=clamp(latT,-(T.halfW-1.0),T.halfW-1.0);
 sampleF(lf);
 const tx=_sv.x+_sn.x*latT,tz=_sv.z+_sn.z*latT;
 const des=Math.atan2(tx-c.x,tz-c.z);
 const diff=wrapA(des-c.hdg);
 const dTerm=clamp((diff-c.pDiff)/Math.max(dt,0.001)*0.05,-0.35,0.35);
 c.pDiff=diff;
 c.steer=clamp(-diff*2.7-dTerm,-1,1);
 /* Speed target from curvature.  This used to be  tv = sqrt(21/cmax), a
    magic constant that had nothing to do with the car it was driving: the
    same car's own yaw authority is  cap = 46*grip/v  (see below), so the
    grip-limited corner speed is sqrt(46*grip/cmax).  Measured with
    tools/ai_pace_calib.mjs on the real OpenF1 circuit geometry, the old law
    left the front-runners crawling through every bend -- minimum corner speed
    ~5 km/h at Monaco with 31% of the lap under 28 km/h, and it cost roughly
    15% of lap time at Monza -- which is exactly the "why is everyone slowing
    down for no reason" complaint.  The new law asks the car for the speed the
    physics can actually hold, clipped by the track's own braked speed profile
    (T.samples[].v, propagated backwards at 23 m/s^2), and scales that by
    driver skill and difficulty so a 1.0-skill field sits at ~0.93 of the
    limit and RELAXED/NORMAL/PRO land at 0.82/0.90/0.97 of the same limit
    rather than being three different physics models. */
 let cmax=0,vAhead=1e9;
 const look=6+Math.floor(vF*0.5);
 for(let k=2;k<look;k+=3){const si=(fi+k)%T.N,smp=T.samples[si];
  cmax=Math.max(cmax,Math.abs(smp.curv));vAhead=Math.min(vAhead,smp.v);}
 const tvLim=Math.min(Math.sqrt(46*Math.max(cur.grip,0.3)/Math.max(cmax,1e-4)),vAhead);
 let tv=tvLim*(0.88+c.d.skill*0.05)*state.diffMul;
 tv=Math.min(tv,PH.top*(0.86+c.d.skill*0.13));
 if(ah&&ah.dist<20)tv=Math.min(tv,Math.min(ah.c.vF*1.02,ah.c.vF+(ah.dist-9)));
 const dv=tv-vF;
 c.throttle=dv>0.5?1:dv<-1.5?0:0.45;
 c.brake=dv<-4?clamp(-dv*0.14,0,1):0;
 if(c.mistakeT>0){c.steer=clamp(c.steer+c.mistakeSteer,-1,1);c.brake=Math.max(c.brake,c.mistakeBrake);c.throttle*=.62;}
}
/* Slow-motion cinematic trigger for the player's big hits — a brief time
   dilation plus a tightened lens so a shunt lands with real drama. */
let slowMo=0,slowMoDur=0.8;
/* Damage / "get the energy back" recovery. A severe hit (or being slammed
   into another car) flips a car into a limping repair phase: it can still be
   steered (otherwise you'd just spin out), but it's slower and a spanner +
   countdown ring floats above it until the energy comes back in. */
function wreckCar(c){
 if(c.wrecked)return;c.wrecked=true;c.throttle=0;c.brake=1;c.drsOpen=false;
 shedCarParts(c);sparkBurst(c.x,c.y+.35,c.z,4.5);
 if(c.isPlayer){
  state.mode='gameover';slowMo=1.2;slowMoDur=1.2;cam.shake=Math.max(cam.shake,.75);
  showMsg('CRASHED OUT','TERMINAL DAMAGE','red',4);Speech.say('Heavy impact! The car is out of the race.',true,{rate:1.08,pitch:.96});
  setTimeout(()=>{if(state.mode==='gameover')showResults();},2600);
 }
}
function triggerDamage(c,sev){
  if(c.wrecked)return;
  // Severe impacts are terminal; lighter contact produces a fixed, readable
  // five-second power-loss period with the animated spanner already attached
  // to every car.
  if(sev>=6.5){wreckCar(c);return;}
  if(c.crash>0.2)return;
  c.crashMax=5;c.crash=5;
  // Player-only cinematic & commentary while actually racing.
  if(c.isPlayer&&(state.mode==='race'||state.mode==='finished')){
   slowMo=0.8;slowMoDur=0.8;
   showMsg('MECHANICAL','SPANNER OUT · '+(Math.round(c.crash))+'s','purple',c.crashMax);
   Speech.say(pick(['Nasty hit — nurse it home!','She is still running, bring it back slowly!']),true,{rate:0.98,pitch:1.02});
  }
}
function wallHit(c,sgn,imp){
 if(imp>2&&timeSec-c.hitT>0.35){
  c.hitT=timeSec;
  c.bounceVel=(c.bounceVel||0)-Math.min(imp*0.025,0.35);
  const s=T.samples[c.ti];
  sparkBurst(c.x+s.n.x*sgn*1.1,0.5,c.z+s.n.z*sgn*1.1,1+Math.min(imp*0.1,3));
  if(imp>5.5)triggerDamage(c,imp*0.5);
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
 if(c.wrecked){c.vx*=Math.exp(-3.2*dt);c.vz*=Math.exp(-3.2*dt);c.vF*=Math.exp(-3.2*dt);c.x+=c.vx*dt;c.z+=c.vz*dt;c.y=groundY;return;}

 const stepAhead = 1.0;
 const groundYAhead = getRoadHAtCoords(c.x + Math.sin(c.hdg)*stepAhead, c.z + Math.cos(c.hdg)*stepAhead);
 const slope = Math.atan2(groundYAhead - groundY, stepAhead);
 
 if (c.y <= groundY + 0.01 && c.vy <= 0.01) {
  c.y = groundY;
  c.airborne = false;
  const expectedVy = c.vF * Math.sin(slope);
  // A modern F1 car's aero pushes it into the road with several times its
  // own weight — it does NOT take off over ordinary crests. Only a truly
  // violent drop-away at very high speed breaks contact now; everything
  // else stays sucked to the tarmac (which also fixes cars visibly
  // "flying" in the helicopter shots at Spa/Zandvoort-style crests).
  if (expectedVy - c.vy < -6.5 && c.vF > 34) {
   c.airborne = true;
  } else {
   c.vy = expectedVy;
  }
 } else {
  c.airborne = true;
  // Heavier-than-gravity fall: downforce keeps working on the airborne car,
  // so it slams back down quickly instead of floating balloon-like.
  c.vy -= 30.0 * dt;
  c.y += c.vy * dt;
  if (c.y < groundY) {
   c.y = groundY;
   c.airborne = false;
   if (c.vy < -3.5) {
    const landingImpact=Math.abs(c.vy);
    sparkBurst(c.x, c.y + 0.1, c.z,1.2+landingImpact*0.16);
    if(landingImpact>7)triggerDamage(c,landingImpact*0.55);
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

 // Gravel-trap membership: off-track areas flagged on `T.gravelMask` dig the
 // car in hard (see the run-off patches built for corners). Kerbs, on the
 // other hand, get progressively more treacherous the wetter it gets.
 c.onGravel=!c.airborne&&c.offT&&!!T.gravelMask&&!!T.gravelMask[c.ti];
 // Painted kerbs retain reasonable grip when dry but become properly slick in
 // rain: at full wetness they provide roughly a third of normal-road grip.
 const onCurbSlip=(c.onCurb&&cur.wet>0.2)?(1-cur.wet*0.58):1;
 const surface=c.onGravel?0.22:(c.offT?0.45:(c.onCurb?0.78:1));
 // Banked corners genuinely help: the camber turns part of the car's weight
 // into cornering force, so a banked bowl can be taken meaningfully faster
 // than a flat corner of the same radius (capped ≈ +35% at Zandvoort-grade
 // banking). Off-track the banking has faded out, so no bonus there.
 const bankBoost=(!c.offT&&!c.airborne)?1+Math.min(Math.abs((T.samples[c.ti]&&T.samples[c.ti].bk)||0)*1.6,0.35):1;
 const grip=(c.airborne?0.04:(cur.grip*surface*bankBoost))*onCurbSlip;
 // The player's car is a competitive-but-not-dominant package: faster than
 // the midfield and backmarkers, but a couple of km/h down on the very
 // fastest drivers (who get PH.top*(0.86+skill*0.13) ≈ up to 0.99×PH.top),
 // so you can't just blast straight past the front-runners — you have to
 // use DRS, slipstream and racecraft to get by them.
 // Damaged / recovering: the car is limping — slower and less urgent until
 // the spanner countdown finishes and the "energy comes back".
 if(c.crash>0){
  c.crash-=dt;
  if(c.crash<=0){
   c.crash=0;
   if(c.isPlayer&&state.mode==='race'){showMsg('REPAIRED','FULL ENERGY','green',1.6);AudioSys.beep(680,0.14);}
  }
 }
 const dmg=c.crash>0?(1-0.42*Math.min(c.crash/c.crashMax,1)):1;
 const top=PH.top*(c.isPlayer?0.975:(0.86+c.d.skill*0.13))*dmg;
 const sp0=c.vF;
 /* steering → yaw rate (speed-sensitive, grip-limited, no assists) */
 const base=3.2-1.9*clamp(Math.abs(sp0)/PH.top,0,1);
 const cap=46*grip/Math.max(Math.abs(sp0),2);
 const yawF=clamp(0.4+Math.abs(sp0)/3.8,0.4,1)*(sp0<-0.5?-1:1);
 // A real car cannot yaw in place — you need forward speed (or wheelspin from
 // a standing start / doughnut) to rotate. Scale the yaw rate by a speed
 // factor so pressing only left/right while stationary does nothing, while a
 // hard launch still lets the rear rotate (doughnuts).
 const rotFac=Math.min(1,clamp(Math.abs(sp0)/6,0,1)+(c.throttle>0.5&&Math.abs(sp0)<17?0.5:0));
 c.hdg-=c.steer*Math.min(base,cap)*yawF*rotFac*dt; /* steer -1 (left) increases hdg, turning left */
 /* velocity in the NEW heading frame → slip appears naturally */
 const acc=dt>0?(c.vF-c._pv)/dt:0;
 const fx=Math.sin(c.hdg),fz=Math.cos(c.hdg),rx=-fz,rz=fx;
 let vF=c.vx*fx+c.vz*fz, vR=c.vx*rx+c.vz*rz;
 /* longitudinal */
 let aF=0;
 if(c.throttle>0)aF+=c.throttle*PH.eng*Math.max(0,1-Math.pow(clamp(vF/top,0,1),3))*Math.min(grip,1)*dmg;
 c.wheelspin=(c.throttle>0.55&&vF<17&&vF>-1)?c.throttle*(1-clamp(vF,0,17)/17)*(1.35-grip):0;
 if(c.wheelspin>0)aF*=(1-c.wheelspin*0.45);
 if(c.brake>0){
  if(vF>0.4)aF-=c.brake*PH.brk*grip;
  else if(vF>-11)aF-=8; /* reverse */
 }
 const k=PH.drag*(c.drsOpen?0.78:1)*(c.slipstream?0.85:1);
 aF-=k*vF*Math.abs(vF)+vF*0.045;
 if(c.offT)aF-=vF*0.14;
 if(c.onGravel)aF-=Math.min(60,Math.abs(vF))*0.55; /* gravel traps dig in hard */
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
 // A proper 8-speed F1 gearbox. The old bands put 8th at 290 km/h — above
 // the car's own 284 km/h top speed, so it could never be reached and the
 // box behaved like a 6/7-speed. Respaced so 8th engages at 240 km/h and
 // the rev band tops out just past vmax: every gear actually gets used.
 const bands=[0,46,78,108,138,170,204,240,294];
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
      const j=-rvn*0.74; // slightly livelier rebound so impacts visibly shunt cars
      A.vx-=j*nx;A.vz-=j*nz;
      B.vx+=j*nx;B.vz+=j*nz;
      const imp=-rvn;
      if(imp>3&&timeSec-A.hitT>0.4&&timeSec-B.hitT>0.4){
       A.hitT=B.hitT=timeSec;
       // Every car-to-car contact throws sparks at the contact point, not
       // just the player's — the midfield clatters like a real GP.
       sparkBurst((ax+bx)/2,0.55,(az+bz)/2,1+Math.min(imp*0.12,2));
       AudioSys.clank(Math.min(imp*0.09,0.55));
       // Suspension jounce so a hit visibly rocks both cars.
       A.bounceVel=(A.bounceVel||0)-Math.min(imp*0.05,0.28);
       B.bounceVel=(B.bounceVel||0)-Math.min(imp*0.05,0.28);
       // A real shunt flips both cars into a brief limp-home recovery — you
       // can still steer (crash avoidance!) but the spanner is out.
       if(imp>4.6){triggerDamage(A,imp*0.5);triggerDamage(B,imp*0.5);}
       const nearPlayer=(A.isPlayer||B.isPlayer)||(player&&Math.hypot(player.x-(ax+bx)/2,player.z-(az+bz)/2)<24);
       if(nearPlayer){
        cam.shake=Math.max(cam.shake,Math.min(0.55,imp*0.05));
        AudioSys.thump(Math.min(imp*0.09,0.9)+0.1);
        if(imp>9){exCur=Math.max(exCur,0.85);Speech.say(pick(LINES.crash),true,{rate:clamp(1.15+imp*0.012,1.15,1.4),pitch:1.12});}
        // If it was you clouting them, the other driver gets properly furious.
        if(A.isPlayer!==B.isPlayer){
         const other=A.isPlayer?B:A;
         if(imp>5.2&&timeSec-(other.rageT||-99)>12){other.rageT=timeSec;rageFrom(other);}
        }
       }
      }
     }
    }
   }
  }
 }
}

/* ============ per-car visuals ============ */
/* A damped spring integrator, used for everything the driver's body does that
   should LAG the car rather than follow it: head roll under lateral load, the
   chin snapping forward under braking, the whole shell rising over a kerb.
   k is stiffness, b damping; both tuned so it settles in a couple of tenths
   of a second and rings once on an impulse, like a real helmet on a neck. */
function spring(cur,vel,target,k,b,dt){
 const a=(target-cur)*k-vel*b;
 vel+=a*dt;
 return[cur+vel*dt,vel];
}
/* The ground under a wheel, sampled at the two contact patches. Its height and
   its slope give a genuine bump/skip signal — kerbs, painted verges and the
   road's own roughness come out of the surface the car is actually driving on
   instead of a sine wave. */
const bumpAt=(c)=>{
 if(c._bT===undefined||timeSec-c._bT>0.04){
  const fx=Math.sin(c.hdg),fz=Math.cos(c.hdg),rx=-fz,rz=fx;
  let s=0,sl=0;
  for(const sg of[1,-1])for(const sd of[1,-1]){
   const wx=c.x+fx*1.62+rx*0.82*sd,wz=c.z+fz*1.62+rz*0.82*sd;
   const hh=T.terrainSample?T.terrainSample(wx,wz):0;
   const ha=T.terrainSample?T.terrainSample(wx+fx*1.6,wz+fz*1.6):hh;
   s+=hh;sl+=(ha-hh);
  }
  c._b=s/4;c._bs=sl/4;c._bT=timeSec;
 }
 return[c._b,c._bs];
};
function updCarVisual(c,dt){
 const p=c.mesh.g;
 // Lights: on at night, on in the rain, and on inside a covered section even
 // at midday. The beam brightens with speed and the tail goes red-hot under
 // braking, which is how a car slowing ahead of you reads in your mirrors.
 if(c.mesh.beam){
  const lit=clamp(nightLevel+(c.inTunnel?0.85:0)+cur.rain*0.4,0,1);
  const sp01=clamp(Math.abs(c.vF)/PH.top,0,1);
  c.mesh.beam.material.opacity=lit*(0.05+sp01*0.10);
  c.mesh.pool.material.opacity=lit*(0.10+sp01*0.26);
  const braking=c.brake>0.12?1:0;
  c.mesh.tailGlow.material.opacity=clamp(lit*0.35+braking*(0.35+sp01*0.5)+cur.wet*0.12,0,1);
  c.mesh.tailGlow.scale.setScalar(1+braking*0.35);
 }
 // Is the car inside the covered tunnel section? Used for audio + lighting.
 c.inTunnel=!!T.tunnel&&c.ti>=T.tunnel.i0&&c.ti<=T.tunnel.i1;
 const jitter=Math.sin(timeSec*24+c.phase*7)*0.006*clamp(Math.abs(c.vF)/50,0,1);
 p.position.set(c.x, (c.y !== undefined ? c.y : 0.05) + (c.bounceOff||0) + jitter, c.z);
 p.rotation.set(0, c.hdg, 0);
 p.rotateX(-c.pitch || 0);
 // Surface camber roll — on a banked corner the whole car leans with the
 // road. The banked surface rises along the track normal at tan(bank)=s.bk
 // per metre, so the slope under the car's own left-right axis is bk
 // projected onto that axis; the shell rolls to sit flush on it.
 {
  const sB=T.samples[c.ti]||T.samples[0];
  const nl=(sB.n.x*Math.cos(c.hdg)-sB.n.z*Math.sin(c.hdg));
  const rollT=c.airborne?0:Math.atan((sB.bk||0)*nl);
  c.surfRoll=damp(c.surfRoll||0,rollT,10,dt);
  p.rotateZ(c.surfRoll);
 }
 // Spanner + depleting "energy back" ring floating over a damaged car.
 if(c.mesh.dmgSprite){
  if(c.crash>0){
   c.mesh.dmgSprite.visible=true;
   c.mesh.dmgSprite.position.set(c.x,(c.y!==undefined?c.y:0)+2.1+Math.sin(timeSec*5+c.phase)*0.12,c.z);
   c.mesh.dmgSprite.userData.draw(c.crash/c.crashMax);
  }else c.mesh.dmgSprite.visible=false;
 }
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
 // A damaged car smokes and spits sparks while it nurses itself home.
 if(c.crash>0&&p.position.distanceToSquared(camera.position)<20000){
  c.crashSmoke=(c.crashSmoke||0)+dt;
  if(c.crashSmoke>0.09){c.crashSmoke=0;
   smk(c.x-fx*1.8,0.62,c.z-fz*1.8,rand(-0.7,0.7),rand(1,2.5),rand(-0.7,0.7),rand(1.1,2.1),rand(.5,.9),0.74,0.74,0.78);
   if(Math.random()<0.5)sparkBurst(c.x,0.55,c.z,0.5);
  }
 }
 c.mesh.body.rotation.z=damp(c.mesh.body.rotation.z,clamp(vR*0.011,-0.1,0.1),8,dt);
 // `acc` used to be local to updCar(), but the body/driver animation runs in
 // this separate function.  Measure it here from the previous visual frame so
 // one undefined identifier cannot abort every game tick.
 const acc=dt>0&&Number.isFinite(c._pv)?(c.vF-c._pv)/dt:0;
 c.mesh.body.rotation.x=damp(c.mesh.body.rotation.x,clamp(-acc*0.0035,-0.05,0.06),6,dt);
 c._pv=c.vF;

 /* ---- driver motion: the head is on a neck, not on a rail ----------------
    Everything below is driven by MEASURED forces, so a car that is actually
    being driven hard shakes hard and a car cruising does not twitch:
      yawG   = v² · yaw rate, i.e. the real lateral load in the cockpit
      acc    = longitudinal acceleration (braking nods the chin forward)
      vF/vb  = the surface under the front tyres (kerbs, bumps, skids)
      jolt   = an impulse from a wall scrape or a car-to-car thump           */
 if(c.mesh.helmetGroup){
  const yawRate=Math.abs(c._py!==undefined?(c.hdg-c._py)/Math.max(dt,1e-4):0);
  c._py=c.hdg;
  const yawG=clamp(c.vF*yawRate,-40,40);           // signed, m/s² toward the outside
  const gLat=clamp(-yawG*0.09,-1,1);
  const gLon=clamp(-acc*0.055,-1,1);
  const sp01=clamp(Math.abs(c.vF)/PH.top,0,1);
  const[,bsl]=bumpAt(c);
  const curbPulse=c.onCurb?Math.sin((T.samples[c.ti].cum+c.f%1*T.segLen)*Math.PI/0.6):0;
  const vib=(0.0016+sp01*0.0075)*(c.onCurb?7.5:1);
  const road=Math.sin(timeSec*47+c.phase*5)*vib+bsl*0.035+Math.abs(curbPulse)*0.022*sp01;
  // Kerb entry is a real suspension strike, followed by strong repeated rib
  // pulses rather than the former barely-visible vibration.
  if(c.onCurb&&!c._curb){c._hv=(c._hv||0)-0.10;}
  c._curb=c.onCurb;
  const[hop,hov]=spring(c._hOP||0,c._hv||0,0,190,13,dt);
  c._hOP=hop;c._hv=hov;
  const[hr,hv]=spring(c.mesh.helmetGroup.rotation.z,c._hrV||0,gLat*0.30+gLon*0.05,58,7.4,dt);
  const[hp,hpv]=spring(c.mesh.helmetGroup.rotation.x,c._hpV||0,gLon*0.20,46,6.6,dt);
  const[hy,hyv]=spring(c.mesh.helmetGroup.rotation.y,c._hyV||0,clamp(-c.steer*0.30+gLat*0.16,-0.6,0.6),34,6.0,dt);
  c._hrV=hv;c._hpV=hpv;c._hyV=hyv;
  c.mesh.helmetGroup.rotation.set(hp,hy,hr);
  // a couple of centimetres of slide in the seat, plus the vibration
  c.mesh.helmetGroup.position.set(gLat*0.022,(c._hOP||0)+road+0.73,gLon*0.018+0.36);
  // torso follows, slower and blunted; shoulders lead into the corner
  const[tr,tv2]=spring(c.mesh.driverGroup.rotation.z,c._trV||0,-gLat*0.13,26,7,dt);
  c._trV=tv2;
  c.mesh.driverGroup.rotation.z=tr;
  // the wheel itself: hands turn it, and it kicks back over a kerb
  if(c.mesh.steering)c.mesh.steering.rotation.z=-c.steer*2.1*Math.max(0.25,1-sp01*0.72)+road*2.2;
  if(c.mesh.brakes){
   c.brakeHeat=Math.max(0,(c.brakeHeat||0)-dt*0.42+(c.brake>0.02?dt*c.brake*1.9:0));
   const bh=clamp(c.brakeHeat,0,1);
   c.mesh.brakeMat.emissiveIntensity=bh*3.4;
   // discs also glow at the end of a straight when they are hot even off the
   // pedals, and go dull in the rain (water cools them)
  }
 }

 if(c.onCurb){
  // Visible chassis chatter over each rib. Player cameras receive a strong but
  // bounded shake so clipping a kerb is unmistakable without becoming blind.
  const kerbHit=Math.abs(Math.sin(timeSec*(30+Math.abs(c.vF)*0.32)+c.phase));
  p.position.y+=kerbHit*(0.045+clamp(Math.abs(c.vF)/PH.top,0,1)*0.055);
  if(c.isPlayer)cam.shake=Math.max(cam.shake,0.10+kerbHit*0.10);
 }
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
     // Clutch-dump chirp of sparks on a hard standing start.
     if(amt>0.65)sparkBurst(wx,0.28,wz,0.5);
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
 // Hard-braking tire-lock marks + glowing brake discs — four straight black
 // lines under heavy braking read as "locked the rears" instantly.
 if(c.brake>0.55&&sp>26&&!c.offT){
  c.brkAcc=(c.brkAcc||0)+dt;
  if(c.brkAcc>0.03){c.brkAcc=0;
   for(const s of[1,-1]){
    const wx=c.x-fx*1.62+rx*0.9*s,wz=c.z-fz*1.62+rz*0.9*s;
    addSkid(wx,wz,c.hdg,1.9,false);
   }
   // Glowing discs spitting embers under hard braking at speed.
   if(c.isPlayer&&p.position.distanceToSquared(camera.position)<9000)
    sparkBurst(c.x-fx*1.9,0.32,c.z-fz*1.9,0.45);
  }
 }
 if(c.offT&&sp>5){
  c.dustT=(c.dustT||0)+dt;
  if(c.dustT>0.05){c.dustT=0;
   const bx=c.x-fx*1.6+rx*rand(-0.8,0.8),bz=c.z-fz*1.6+rz*rand(-0.8,0.8);
   
   // Mud chunks!
   smk(bx,0.4,bz,rand(-2,2)-fx*2,rand(2,5),rand(-2,2)-fz*2,rand(2,4),rand(.5,.9),0.38,0.28,0.22);
   smk(bx,0.25,bz,rand(-1,1),rand(0.8,2),rand(-1,1),rand(1,2),rand(.6,1),0.5,0.42,0.3);
   // Gravel-trap spray — a dry, light-stone rooster tail, distinct from the
   // dark mud thrown up on a grass verge.
   if(c.onGravel){
    smk(bx,0.45,bz,rand(-3,3)-fx*3,rand(1.5,3.5),rand(-3,3)-fz*3,rand(1,2),rand(.5,.9),0.72,0.66,0.55);
    smk(bx,0.3,bz,rand(-1.5,1.5),rand(0.6,1.8),rand(-1.5,1.5),rand(0.8,1.6),rand(.6,1),0.6,0.55,0.46);
   }}
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
  // Layered combustion tone: strong firing fundamental, smoother intake
  // harmonic, subdued exhaust pulse and a fine high-frequency mechanical edge.
  this.o1=mk('sawtooth',0.42);this.o2=mk('triangle',0.30);this.o3=mk('square',0.12);this.o4=mk('sawtooth',0.09);
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
  // Four nearby-car voices. Each has independent pitch, filtering, stereo
  // position and distance gain, so a pack approaches loudly and individual
  // engines naturally peel away and fade as the cars leave the player.
  this.rivals=[];
  for(let i=0;i<4;i++){
   const o=ctx.createOscillator();o.type=i%2?'sawtooth':'triangle';
   const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=2200;f.Q.value=.55;
   const g=ctx.createGain();g.gain.value=0;
   const pan=ctx.createStereoPanner?ctx.createStereoPanner():null;
   o.connect(f);if(pan){f.connect(pan);pan.connect(g);}else f.connect(g);g.connect(this.master);o.start();
   this.rivals.push({o,f,g,pan});
  }
  // Whole-grid engine roar — a broadband noise bed representing the other
  // ~19 cars revving around you, not just your own engine. Loudest on the
  // grid before lights out (a real F1 start is deafening), fading back once
  // the race is under way and the mix should focus on your own car again.
  const gn=ctx.createBufferSource();gn.buffer=nb;gn.loop=true;
  this.gridf=ctx.createBiquadFilter();this.gridf.type='bandpass';this.gridf.frequency.value=220;this.gridf.Q.value=0.7;
  this.gridg=ctx.createGain();this.gridg.gain.value=0;
  gn.connect(this.gridf);this.gridf.connect(this.gridg);this.gridg.connect(this.master);gn.start();
  // Tunnel reverb — a short feedback-delay send tapped off the engine bus.
  // While driving through a covered section the engine is muffled and fed a
  // slap echo, so the tunnel reads as a big enclosed space (a small taste of
  // the real Monaco echo).
  this.tdBuf=ctx.createDelay(0.6);this.tdBuf.delayTime.value=0.14;
  this.tdFb=ctx.createGain();this.tdFb.gain.value=0;
  this.tdGain=ctx.createGain();this.tdGain.gain.value=0;
  this.tdSend=ctx.createGain();this.tdSend.gain.value=1;
  eg.connect(this.tdSend);this.tdSend.connect(this.tdBuf);
  this.tdBuf.connect(this.tdFb);this.tdFb.connect(this.tdBuf);
  this.tdFb.connect(this.tdGain);this.tdGain.connect(this.master);
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
 // Metal-on-metal "clank" for car-to-car contact — a short, bright square
 // blip that decays fast, so wheel-to-wheel touches read audibly.
 clank(v){if(!this.started)return;const t=this.ctx.currentTime;
  const o=this.ctx.createOscillator();o.type='square';
  o.frequency.setValueAtTime(190,t);o.frequency.exponentialRampToValueAtTime(55,t+0.09);
  const g=this.ctx.createGain();
  g.gain.setValueAtTime(Math.min(0.35,0.05+v*0.22),t);
  g.gain.exponentialRampToValueAtTime(0.001,t+0.13);
  o.connect(g);g.connect(this.master);o.start(t);o.stop(t+0.14);},
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
 jetFlyby(){if(!this.started)return;const t=this.ctx.currentTime;
  const n=this.ctx.createBufferSource();n.buffer=this.noiseBuf;n.loop=true;
  const f=this.ctx.createBiquadFilter();f.type='bandpass';f.frequency.setValueAtTime(520,t);f.frequency.exponentialRampToValueAtTime(1450,t+3.1);f.frequency.exponentialRampToValueAtTime(380,t+7.2);f.Q.value=.65;
  const g=this.ctx.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.08,t+.8);g.gain.exponentialRampToValueAtTime(.42,t+3.1);g.gain.exponentialRampToValueAtTime(.0001,t+7.5);
  const o=this.ctx.createOscillator();o.type='sawtooth';o.frequency.setValueAtTime(72,t);o.frequency.exponentialRampToValueAtTime(135,t+3.1);o.frequency.exponentialRampToValueAtTime(48,t+7.3);
  const og=this.ctx.createGain();og.gain.value=.10;o.connect(og);og.connect(g);n.connect(f);f.connect(g);g.connect(this.master);n.start(t);o.start(t);n.stop(t+7.6);o.stop(t+7.6);},
 update(){if(!this.started||!player)return;
  const t=this.ctx.currentTime,p=player;
  const run=(state.mode==='race'||state.mode==='countdown'||state.mode==='finished')&&!state.paused;
  // Aggregate the rest of the grid's audioRpm into one broadband bed so the
  // start actually sounds like ~20 F1 engines, not just your own idling one.
  let gridActivity=0.15;
  if(cars.length){let s=0;for(const c of cars)s+=c.audioRpm||0.15;gridActivity=s/cars.length;}
  const gridTarget=state.mode==='countdown'?0.20+gridActivity*0.48:(run?0.025+gridActivity*0.075:0);
  this.gridg.gain.setTargetAtTime(gridTarget,t,0.08);
  this.gridf.frequency.setTargetAtTime(140+gridActivity*380,t,0.1);
  // Approximate a modern V6 firing spectrum rather than sweeping one arcade
  // oscillator. Gear/load add small independent movement between harmonics;
  // the soft rev limiter flutters only at the very top of the range.
  const limiter=p.audioRpm>.975?(0.985+Math.sin(timeSec*210)*.015):1;
  const load=.92+p.throttle*.08, f=(82+p.audioRpm*760)*limiter;
  this.o1.frequency.setTargetAtTime(f*load,t,0.018);
  this.o2.frequency.setTargetAtTime(f*1.5,t,0.022);
  this.o3.frequency.setTargetAtTime(f*.75,t,0.026);
  this.o4.frequency.setTargetAtTime(f*2.48,t,0.018);
  // Inside the tunnel the engine is muffled (lower low-pass) and pushed through
  // a feedback delay for an enclosed, echoing rumble — the signature Monaco
  // tunnel sound.
  const tun=player.inTunnel?1:0;
  this.eflt.frequency.setTargetAtTime((260+p.throttle*2300+p.audioRpm*1400)*(1-tun*0.5),t,0.03);
  this.tdFb.gain.setTargetAtTime(tun*0.45,t,0.07);
  this.tdGain.gain.setTargetAtTime(tun?0.55:0,t,0.07);
  this.eg.gain.setTargetAtTime(run?0.18+p.throttle*0.22+p.audioRpm*0.08:0,t,0.05);
  this.eng.gain.setTargetAtTime(run?0.035+p.throttle*0.075:0,t,0.05);
  this.wso.frequency.setTargetAtTime(f*5.2,t,0.02);
  this.wsg.gain.setTargetAtTime(run?p.wheelspin*0.08:0,t,0.03);
  this.skg.gain.setTargetAtTime(run?p.skidAmt*0.16:0,t,0.04);
  this.skf.frequency.setTargetAtTime(600+p.skidAmt*500,t,0.05);
  const w=clamp(Math.abs(p.vF)/80,0,1);
  // Kerbs feed a loud, low mechanical rumble through the existing road-noise
  // bus. Gain follows speed and pulses over the painted ribs, so it sounds like
  // tyres hammering corrugations rather than a constant hiss.
  const curbPulse=p.onCurb?(0.55+0.45*Math.abs(Math.sin(timeSec*(28+w*34)))):0;
  const roadGain=w*w*0.12+(p.onCurb?curbPulse*(0.16+w*0.24):0);
  this.wfg.gain.setTargetAtTime(run?roadGain:0,t,p.onCurb?0.018:0.1);
  this.wff.frequency.setTargetAtTime(p.onCurb?180+w*720:300+w*2600,t,0.025);
  this.rag.gain.setTargetAtTime(cur.rain*0.11,t,0.2);
  const nearby=cars.filter(c=>!c.isPlayer).map(c=>({c,d:Math.hypot(c.x-p.x,c.z-p.z)})).sort((a,b)=>a.d-b.d).slice(0,4);
  for(let i=0;i<this.rivals.length;i++){
   const ch=this.rivals[i],hit=nearby[i];
   if(run&&hit&&hit.d<125){
    const rp=hit.c.rpm||.15;
    // Inverse-distance-like rolloff with enough near-field level to make a
    // side-by-side pack properly loud, and a smooth tail out to 125 metres.
    const near=1/(1+hit.d*.055),far=clamp(1-hit.d/125,0,1);
    ch.g.gain.setTargetAtTime((.025+rp*.075)*near*far,t,.055);
    ch.o.frequency.setTargetAtTime(72+rp*760,t,.035);
    ch.f.frequency.setTargetAtTime(700+rp*2600,t,.06);
    if(ch.pan){const rx=Math.cos(p.hdg),rz=-Math.sin(p.hdg);const side=((hit.c.x-p.x)*rx+(hit.c.z-p.z)*rz)/Math.max(hit.d,1);ch.pan.pan.setTargetAtTime(clamp(side,-1,1),t,.08);}
   }else ch.g.gain.setTargetAtTime(0,t,.12);
  }},
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
 playing:false,gain:null,nextNoteTime:0,step:0,barIdx:0,stepDur:0.25,
 // A driving 1970s rock groove in E minor. Eight eighth-notes per bar at
 // ~120bpm (stepDur 0.25s). The progression and melody are ORIGINAL — it
 // captures that 70s F1-broadcast swagger (walking bass, power chords, a
 // backbeat kit, a singable lead) without reproducing any existing song.
 chords:[
  {tones:[164.81,246.94],bass:[82.41,82.41,82.41,98.00,82.41,82.41,110.00,123.47],
   lead:[329.63,329.63,392.00,329.63,493.88,440.00,329.63,246.94]},
  {tones:[164.81,196.00,246.94],bass:[130.81,130.81,130.81,130.81,98.00,98.00,123.47,110.00],
   lead:[261.63,392.00,329.63,261.63,392.00,329.63,293.66,220.00]},
  {tones:[98.00,146.83],bass:[98.00,98.00,98.00,98.00,98.00,98.00,146.83,123.47],
   lead:[196.00,196.00,246.94,196.00,293.66,261.63,220.00,196.00]},
  {tones:[73.42,110.00],bass:[73.42,73.42,73.42,73.42,73.42,146.83,110.00,82.41],
   lead:[146.83,146.83,220.00,293.66,220.00,196.00,146.83,110.00]},
 ],
 ensureGain(){if(this.gain||!AudioSys.ctx)return;
  this.gain=AudioSys.ctx.createGain();this.gain.gain.value=0;
  this.gain.connect(AudioSys.master);},
 start(){if(!AudioSys.ctx||this.playing)return;
  this.ensureGain();
  this.playing=true;this.step=0;this.barIdx=0;
  this.nextNoteTime=AudioSys.ctx.currentTime+0.12;
  const t=AudioSys.ctx.currentTime;
  this.gain.gain.cancelScheduledValues(t);
  this.gain.gain.setValueAtTime(this.gain.gain.value,t);
  this.gain.gain.linearRampToValueAtTime(0.26,t+2.0);},
 stop(){if(!this.playing)return;
  this.playing=false;
  if(this.gain&&AudioSys.ctx){const t=AudioSys.ctx.currentTime;
   this.gain.gain.cancelScheduledValues(t);
   this.gain.gain.setValueAtTime(this.gain.gain.value,t);
   this.gain.gain.linearRampToValueAtTime(0,t+0.9);}},
 _env(ctx,time,a,pk,dur){const g=ctx.createGain();
  g.gain.setValueAtTime(0.0001,time);
  g.gain.exponentialRampToValueAtTime(Math.max(pk,0.0002),time+a);
  g.gain.exponentialRampToValueAtTime(0.0001,time+dur);
  return g;},
 kick(t){const ctx=AudioSys.ctx;
  const o=ctx.createOscillator();o.type='sine';
  o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(42,t+0.10);
  const g=this._env(ctx,t,0.006,0.5,0.16);o.connect(g);g.connect(this.gain);
  o.start(t);o.stop(t+0.18);},
 snare(t){const ctx=AudioSys.ctx;
  const n=ctx.createBufferSource();n.buffer=AudioSys.noiseBuf;
  const f=ctx.createBiquadFilter();f.type='bandpass';f.frequency.value=1800;f.Q.value=0.8;
  const g=this._env(ctx,t,0.004,0.22,0.12);n.connect(f);f.connect(g);g.connect(this.gain);
  n.start(t);n.stop(t+0.14);
  const o=ctx.createOscillator();o.type='triangle';o.frequency.value=180;
  const g2=this._env(ctx,t,0.004,0.12,0.08);o.connect(g2);g2.connect(this.gain);
  o.start(t);o.stop(t+0.1);},
 hat(t,open){const ctx=AudioSys.ctx;
  const n=ctx.createBufferSource();n.buffer=AudioSys.noiseBuf;
  const f=ctx.createBiquadFilter();f.type='highpass';f.frequency.value=open?6000:7800;
  const g=this._env(ctx,t,0.002,open?0.1:0.07,open?0.22:0.05);
  n.connect(f);f.connect(g);g.connect(this.gain);n.start(t);n.stop(t+(open?0.24:0.06));},
 bass(freq,t,dur){const ctx=AudioSys.ctx;
  const o=ctx.createOscillator();o.type='sawtooth';o.frequency.value=freq;
  const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=520;f.Q.value=0.9;
  const g=this._env(ctx,t,0.008,0.22,dur);o.connect(f);f.connect(g);g.connect(this.gain);
  o.start(t);o.stop(t+dur);},
 guitar(tones,t,dur){const ctx=AudioSys.ctx;
  tones.forEach((freq,i)=>{
   const o=ctx.createOscillator();o.type='sawtooth';o.frequency.value=freq;o.detune.value=i?-3:0;
   const sh=ctx.createWaveShaper();const cv=new Float32Array(256);
   for(let k=0;k<256;k++){const x=k/128-1;cv[k]=Math.tanh(1.8*x);}sh.curve=cv;
   const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=1600;f.Q.value=0.7;
   const g=this._env(ctx,t,0.01,0.11,dur);
   o.connect(sh);sh.connect(f);f.connect(g);g.connect(this.gain);
   o.start(t);o.stop(t+dur);});},
 lead(freq,t,dur){const ctx=AudioSys.ctx;
  const o=ctx.createOscillator();o.type='square';o.frequency.value=freq;
  const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=2700;f.Q.value=1.2;
  const g=this._env(ctx,t,0.02,0.09,dur);o.connect(f);f.connect(g);g.connect(this.gain);
  o.start(t);o.stop(t+dur);},
 update(){if(!this.playing||!AudioSys.ctx)return;
  const ctx=AudioSys.ctx;
  while(this.nextNoteTime<ctx.currentTime+0.22){
   const c=this.chords[this.barIdx%this.chords.length];
   const s=this.step;
   // Kit: kick on 1 & 3, snare on 2 & 4, hats on the eighths.
   if(s===0||s===4)this.kick(this.nextNoteTime);
   if(s===2||s===6)this.snare(this.nextNoteTime);
   this.hat(this.nextNoteTime,s===2||s===6);
   // Driving eighth-note bass.
   this.bass(c.bass[s],this.nextNoteTime,this.stepDur*0.9);
   // Power-chord guitar on the beats.
   if(s%2===0)this.guitar(c.tones,this.nextNoteTime,this.stepDur*(s===0?0.9:0.6));
   // Answering lead figure.
   if(s===0)this.lead(c.lead[0],this.nextNoteTime,this.stepDur*1.6);
   if(s===4)this.lead(c.lead[4],this.nextNoteTime,this.stepDur*1.6);
   this.step++;if(this.step>=8){this.step=0;this.barIdx++;}
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
 const sorted=[...cars].sort((a,b)=>b.key-a.key);
 // Action-aware directing: when the front runners are bunched up (small
 // gap), favour tight chase/trackside shots that show the wheel-to-wheel
 // racing; when the race is strung out, show off the circuit from the air.
 let spread=1e9;
 if(sorted.length>1)spread=(sorted[0].key-sorted[1].key)*T.segLen/Math.max(Math.abs(sorted[1].vF),12);
 let shots;
 if(spread<180)shots=['chase','chase','cine','chase','tv','tv','orbit'];
 else if(spread<500)shots=['chase','chase','cine','tv','tv','heli','orbit'];
 else shots=['heli','heli','cine','heli','chase','tv','orbit'];
 director.shot=pick(shots);
 director.timer=director.shot==='heli'?rand(6,10):rand(3.5,6);
 if(sorted.length){
  const n=Math.min(4,sorted.length);
  director.target=sorted[Math.random()<0.65?0:Math.floor(rand(0,n))];
 }
 director.swoop=0;
}
function updCamera(dt){
 camera.up.set(0,1,0);
 if(!player||state.mode==='title'||demoOn){
  director.timer-=dt;
  if(director.timer<=0||!director.target)pickDirectorShot();
  const tc=director.target&&cars.includes(director.target)?director.target:cars[0];
  if(tc&&director.shot==='chase'){
   const tp=tc.mesh.g.position,yaw=tc.hdg,fx=Math.sin(yaw),fz=Math.cos(yaw),sp=Math.abs(tc.vF);
   // Slightly tighter framing at speed, with a touch of broadcast shake so
   // the chase reads as a live camera chasing a real car.
   const back=7.6+sp*0.05,up=3.0+sp*0.014;
   cam.pos.x=damp(cam.pos.x,tp.x-fx*back,7,dt);
   cam.pos.y=damp(cam.pos.y,tp.y+up,6,dt);
   cam.pos.z=damp(cam.pos.z,tp.z-fz*back,7,dt);
   camera.position.copy(cam.pos);
   camera.position.x+=rand(-1,1)*sp*0.0012;camera.position.y+=rand(-1,1)*sp*0.0008;
   camera.lookAt(tp.x+fx*6,tp.y+1.2,tp.z+fz*6);
   // Camera rolls slightly with the car's lateral slip — a live-camera feel.
   // rotateZ rolls around the view axis only, so it can never flip the view.
   const latV=tc.vx*Math.cos(yaw)-tc.vz*Math.sin(yaw);
   camera.rotateZ(clamp(latV*0.012,-0.08,0.08));
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
  }else if(tc&&director.shot==='cine'){
   // A low, slow tracking dolly just ahead of the leader with a shallow
   // long lens — a clean, cinematic "cracking view" of the racing line.
   const tp=tc.mesh.g.position,yaw=tc.hdg,fx=Math.sin(yaw),fz=Math.cos(yaw);
   cam.cineU=(cam.cineU||0)+dt*0.13;
   const ahead=24+((cam.cineU*24)%46);
   const side=Math.sin(cam.cineU*1.2)*3.2;
   const px=tp.x+fx*ahead-Math.sin(yaw)*side;
   const pz=tp.z+fz*ahead+Math.cos(yaw)*side;
   camera.position.set(px,tp.y+1.7,pz);
   camera.lookAt(tp.x,tp.y+1.0,tp.z);
   camera.fov=damp(camera.fov,40,3,dt);camera.updateProjectionMatrix();return;
  }
  // Helicopter establishing shot: sweep along the whole circuit from high
  // above. Positions are interpolated between track samples (via sampleF)
  // rather than snapped to the nearest one, and the whole camera position is
  // then critically damped — real telemetry-derived tracks have some
  // sample-to-sample noise in their local normal, and swaying the camera
  // along that noisy, rapidly-rotating frame was what made it look "all over
  // the place". A slow, independent world-space drift plus damping fixes it.
  const N=T.N;
  // Purposeful sweep covering the whole lap; the helicopter banks into turns
  // like a broadcast bird, and periodically swoops low onto the lead car.
  cam.heliU=(cam.heliU+dt/32)%1;
  const f=cam.heliU*N;
  sampleF(f);
  const px=_sv.x,py=_sv.y,pz=_sv.z;
  director.swoop=(director.swoop||0)-dt;
  if(director.swoop<=0&&Math.random()<dt*0.14)director.swoop=rand(2.4,3.4);
  const swooping=director.swoop>0;
  const swoopT=swooping?clamp(1-director.swoop/3.4,0,1):0;
  const alt=70-(swooping?Math.sin(swoopT*Math.PI)*24:0);
  let tx,ty,tz;
  if(swooping&&tc){
   tx=tc.mesh.g.position.x;ty=tc.mesh.g.position.y+3;tz=tc.mesh.g.position.z;
  }else{
   sampleF((f+55)%N);tx=_sv.x;ty=_sv.y+4;tz=_sv.z;
  }
  // Upside-down guard: a real circuit loops back on itself (hairpins,
  // chicanes, the Parabolica), so the look point can end up nearly straight
  // beneath the camera — lookAt() then flips the orientation through
  // vertical and the whole world appears to invert. Never let the view
  // pitch steeper than ~58° below horizontal: if the raw target would be
  // too steep, lift it until the view stays shallow and stable.
  const hdx=tx-px,hdz=tz-pz;
  const horiz=Math.hypot(hdx,hdz)||1;
  const maxDown=Math.tan(58*Math.PI/180);
  const minY=py-horiz*maxDown;
  if(ty<minY)ty=minY;
  // Smooth the look target so the view direction never snaps abruptly.
  if(!cam.heliLook)cam.heliLook=V3(tx,ty,tz);
  cam.heliLook.x=damp(cam.heliLook.x,tx,4,dt);
  cam.heliLook.y=damp(cam.heliLook.y,ty,4,dt);
  cam.heliLook.z=damp(cam.heliLook.z,tz,4,dt);
  const swayX=Math.sin(timeSec*0.11)*30,swayZ=Math.cos(timeSec*0.077)*22;
  if(!cam.heliPos)cam.heliPos=V3(px+swayX,py+alt,pz+swayZ);
  cam.heliPos.x=damp(cam.heliPos.x,px+swayX,3,dt);
  cam.heliPos.y=damp(cam.heliPos.y,py+alt,3,dt);
  cam.heliPos.z=damp(cam.heliPos.z,pz+swayZ,3,dt);
  camera.position.copy(cam.heliPos);
  camera.up.set(0,1,0);
  camera.lookAt(cam.heliLook);
  // Gentle banking via a roll around the camera's own view axis only —
  // rotateZ never touches the yaw/pitch, so it can't cause a flip.
  camera.rotateZ((swooping?Math.sin(swoopT*Math.PI)*0.14:0)+Math.sin(timeSec*0.35)*0.03);
  camera.fov=damp(camera.fov,swooping?54:50,4,dt);camera.updateProjectionMatrix();return;}
 const p=player,pp=p.mesh.g.position;
 // The player's own head/arms must not be rendered in front of a camera that
 // is notionally mounted on that head. Keep the chassis/nose for immersion.
 if(p.mesh.driverGroup)p.mesh.driverGroup.visible=state.camMode!==2;
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
 }else if(state.camMode===2){
  /* Helmet cam — the camera rides ON the driver's head, so it inherits every
     bit of motion the head spring produces: it rolls under lateral load, snaps
     forward under braking, rings after a kerb strike and buzzes with speed.
     The head is followed at less than 1:1 and low-passed, because a faithful
     head-mounted camera is unwatchable at 300 km/h — this is the version that
     reads as "real" without making you ill. */
  const yaw=p.hdg,fx=Math.sin(yaw),fz=Math.cos(yaw);
  const hg=p.mesh.helmetGroup;
  const lean=hg?hg.rotation.z*0.62:0, nod=hg?hg.rotation.x*0.50:0, look=hg?hg.rotation.y*0.42:0;
  const sp01=clamp(sp/PH.top,0,1);
  // Read the helmet's WORLD position. The old code used hg.position.y, which
  // is only its local cockpit coordinate (~0.73 m); on an elevated or dipped
  // circuit that put the camera below the actual road.
  const headWorld=hg?hg.getWorldPosition(_camHead):_camHead.copy(pp).add(V3(0,1.0,0));
  // Put the lens at the visor/T-cam edge rather than inside the helmet shell.
  // It remains low and immersive, but the halo, visor and nose no longer fill
  // the lower half of the road view.
  const roadHere=getRoadHAtCoords(pp.x,pp.z)+1.12;
  const targetY=Math.max(headWorld.y+0.30,roadHere);
  // A small vibration conveys speed, but stays below a centimetre so the view
  // remains useful through braking zones and fast direction changes.
  const buzz=(0.0007+sp01*0.0060)*(p.onCurb?2.4:1);
  const bx=Math.sin(timeSec*51.3+p.phase)*buzz;
  const by=Math.cos(timeSec*63.7+p.phase*2)*buzz*0.7;
  // Lens sits just ahead of the halo's forward pillar, like a low T-cam. The
  // cockpit remains at the bottom edge for immersion but cannot cover apexes.
  const hx=headWorld.x+fx*0.96,hz=headWorld.z+fz*0.96;
  cam.pos.x=damp(cam.pos.x===undefined?hx:cam.pos.x,hx,22,dt);
  cam.pos.z=damp(cam.pos.z===undefined?hz:cam.pos.z,hz,22,dt);
  cam.pos.y=damp(cam.pos.y===undefined?targetY:cam.pos.y,targetY,22,dt);
  // Final floor clamp is deliberately after damping: smoothing must never lag
  // the camera down through the tarmac at the foot of a steep climb.
  camera.position.set(cam.pos.x+bx,Math.max(cam.pos.y+by,roadHere),cam.pos.z);

  // Look along the road rather than at a fixed world-height point. This keeps
  // crests visible and braking markers readable while head movement still
  // turns naturally into the corner.
  const ahead=30+sp*0.48;
  const fyaw=yaw+look;
  const lx=pp.x+Math.sin(fyaw)*ahead,lz=pp.z+Math.cos(fyaw)*ahead;
  const roadAhead=getRoadHAtCoords(lx,lz);
  cam.lookX=damp(cam.lookX===undefined?lx:cam.lookX,lx,16,dt);
  cam.lookZ=damp(cam.lookZ===undefined?lz:cam.lookZ,lz,16,dt);
  cam.lookY=damp(cam.lookY===undefined?roadAhead+1.0:cam.lookY,roadAhead+1.0+nod*ahead*0.22,14,dt);
  camera.up.set(Math.sin(lean),Math.cos(lean),0);
  camera.lookAt(cam.lookX,cam.lookY,cam.lookZ);
  camera.rotateZ(lean*0.24);
  // Wider FOV and gentle speed ramp create excitement without the severe
  // close-in zoom that made the mode hard to drive.
  tf=clamp(74+sp*0.22,74,92);
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
 }else if(state.camMode===3){
  let best=T.tvCams[0],bd=1e18;
  for(const c of T.tvCams){const d=(c.x-pp.x)**2+(c.z-pp.z)**2;if(d<bd){bd=d;best=c;}}
  camera.position.copy(best);camera.lookAt(pp.x,pp.y+1,pp.z);
  tf=clamp(3200/(Math.sqrt(bd)+30),22,55);
 }else if(state.camMode===4){
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
 // Cinematic: pull in closer/tighter to the crash while slow-mo runs.
 // Keep helmet view wide and driveable during impacts; the external cameras
 // may punch in for the cinematic slow-motion shot.
 if(slowMo>0&&state.camMode!==2)tf=Math.min(tf,46);
 if(cam.shake>0){cam.shake=Math.max(0,cam.shake-dt*1.6);
  camera.position.x+=rand(-1,1)*cam.shake*0.35;camera.position.y+=rand(-1,1)*cam.shake*0.3;}
 camera.fov=damp(camera.fov,tf,8,dt);camera.updateProjectionMatrix();
 // Both light and target track the car's real elevation (not a hardcoded 0),
 // so the shadow camera stays correctly aimed on hilly real-world circuits
 // instead of drifting off the actual ground and under-covering the scene.
 sunLight.position.set(pp.x+sunVec.x*300,pp.y+sunVec.y*300+45,pp.z+sunVec.z*300);
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
// Track-limits "give the place back" state: when the player completes an
// overtake while off-track, they must hand the position back — the offended
// driver's face appears on the far left with an angry board, there's a beep,
// and the commentary demands the place back.
let gbActive=0,gbCar=null;
const crossSign=new Map(),gbCool=new Map();
// Per-driver fury scale: every time you offend a driver their anger rises,
// so the meter fills up and the reaction gets angrier.
const angerByDriver=new Map();
const ANGRY='😠';
function angerFor(num){return angerByDriver.get(num)||0;}
function showDriverBoard(o,txt,dur,n){
 const gb=$('giveBack');
 if(gb){
  const img=$('gbImg'),code=$('gbCode'),name=$('gbName'),at=$('gbTxt'),ang=$('gbAngry');
  if(img)img.src=getDriverHeadshot(o.d);
  if(code)code.textContent=o.d.code||o.d.name.split(' ').pop().toUpperCase();
  if(name)name.textContent=o.d.name.toUpperCase();
  if(at)at.textContent=txt;
  if(ang){ang.innerHTML='';for(let i=0;i<5;i++){const sp=document.createElement('span');
   sp.textContent=ANGRY;sp.className=i<n?'on':'off';ang.appendChild(sp);}}
  gb.classList.add('show');
  gb.classList.remove('shake');void gb.offsetWidth;gb.classList.add('shake');
  clearTimeout(showDriverBoard._t);
  showDriverBoard._t=setTimeout(()=>gb.classList.remove('show'),dur);
 }
}
function givePlaceBack(o){
 gbActive=2.4;gbCar=o;
 const num=o.d.num!=null?o.d.num:o.d.name;
 const anger=Math.min(1+(angerByDriver.get(num)||0),5);
 angerByDriver.set(num,(angerByDriver.get(num)||0)+1);
 // Classification penalty: hold the player just behind the offended car for
 // a few seconds (their world position stays, but the race order — timing
 // tower, positions, results — treats the place as handed back).
 player.f=o.f-1.0;if(player.f<0)player.f+=T.N;
 player.lap=o.lap;
 player._pf=player.f; // keep the lap-crossing tracker consistent with the clamp
 showDriverBoard(o,'GIVE THE PLACE BACK!',3400,Math.min(anger,5));
 AudioSys.beep(680,0.16);
 setTimeout(()=>{if(state.mode==='race')AudioSys.beep(460,0.3);},180);
 Speech.say(pick(LINES.giveBack).replace('{d}',o.d.name.split(' ').pop().toUpperCase()),true,{rate:1.24+anger*0.02,pitch:1.1+anger*0.02});
 showMsg('TRACK LIMITS','OFF-TRACK OVERTAKE','red',2.4);
}
// A driver you've just clouted gets angry at you.
function rageFrom(o){
 const num=o.d.num!=null?o.d.num:o.d.name;
 const anger=Math.min(1+(angerByDriver.get(num)||0),5);
 angerByDriver.set(num,(angerByDriver.get(num)||0)+1);
 if(state.mode!=='race'&&state.mode!=='finished')return;
 showDriverBoard(o,pick(['MIND MY WHEELS!','THAT WAS DIRTY!','HEY! MY RACE!']),2400,Math.min(anger+1,5));
 AudioSys.beep(620,0.13);
 Speech.say(pick(LINES.angry).replace('{d}',o.d.name.split(' ').pop().toUpperCase()),true,{rate:1.2,pitch:1.09});
}
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
// Timing tower visibility — auto-hidden on small screens where it eats the
// view, with a HUD chip to bring it back (or drop it) at any time.
let towerHidden=innerWidth<768;
function applyTowerVisibility(){
 const el=$('timingTower');if(el)el.style.display=towerHidden?'none':'';
 const ch=$('hTowerChip');if(ch)ch.textContent=towerHidden?'TOWER OFF':'TOWER ON';
}
function beginRace(){
 state.name=$('tName').value.trim()||'YOU';
 saveDriverProfile();
 Speech.enabled=$('tSpeech').classList.contains('on');
 TitleTheme.stop();
 $('title').classList.add('hidden');$('results').classList.add('hidden');$('pause').classList.add('hidden');
 $('hud').classList.remove('hidden');
 applyTowerVisibility();
 $('hLaps').textContent=state.laps;
 $('hWx').innerHTML=ICONS[state.wx]+'<span>'+WX[state.wx].label+'</span>';
 $('hCam').textContent=CAM_NAMES[state.camMode];
 snapWeather(state.wx);
 setupGrid(state.grid);
 raceT=0;cdT=0;cdGo=0;cdLastOn=0;resultsShown=false;wwT=0;hypeLineT=-10;
 gbActive=0;gbCar=null;crossSign.clear();gbCool.clear();
 if(towerRows){towerRows.clear();}
 const timingTowerEl=$('timingTower');if(timingTowerEl)timingTowerEl.innerHTML='';
 state.mode='countdown';state.paused=false;
 // On-screen buttons are gone, so a touch device without keystrokes needs
 // the tilt/gyro path to actually drive. Auto-engage it here — the START tap
 // is a valid user gesture for iOS gyro permission — and use auto-throttle so
 // the car is drivable with just tilt-steering and no on-screen gas button.
 if((matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0)&&tiltCtrl.gyroState!=='live'){
  // No on-screen steering/gas buttons anymore, so the device tilt is the
  // whole control surface: tilt to steer, tilt forward for gas, tilt back to
  // brake. 'touch' would need buttons; 'auto' leaves no way to brake.
  tiltCtrl.throttleMode='tilt';
  try{tiltCtrl.saveSettings();}catch(e){}
  // This tap is the user gesture iOS wants, so ask here — but only celebrate
  // if the sensor really came alive. When it does not, say so and leave a
  // tappable retry on screen: the old code toasted "GYROSCOPE ACTIVE"
  // unconditionally and the car sat still with no explanation.
  tiltCtrl.enable().then((live)=>{
   if(live){
    hideGyroPrompt();
    tiltCtrl.showToast('TILT STEERING ON · TILT = GAS / BRAKE',2600);
   }else{
    showGyroPrompt();
   }
  }).catch(()=>showGyroPrompt());
 }
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
 const leader=[...cars].sort((a,b)=>b.key-a.key)[0];
 const gapToLeader=leader&&!leader.isPlayer?(leader.key-player.key)*T.segLen/Math.max(Math.abs(player.vF),15):0;
 confetti(player.x,1,player.z);
 showMsg('CHEQUERED FLAG','P'+pPos,pPos===1?'green':'',3);
 if(pPos===1){exCur=1;Speech.say(LINES.win,true,{rate:1.26,pitch:1.1});}
 else if(pPos===2&&gapToLeader<1.8){exCur=1;Speech.say(pick(LINES.finishClose),true,{rate:1.24,pitch:1.1});}
 else if(pPos<=3){exCur=0.7;Speech.say(LINES.podium,true,{rate:1.12,pitch:1.06});}
 else Speech.say(pick(LINES.finish).replace('{n}',pPos),true,{rate:0.98,pitch:1.0});
 setTimeout(showResults,2800);
}
function showResults(){
 if(resultsShown)return;resultsShown=true;
 const sorted=[...cars].sort((a,b)=>b.key-a.key);
 const leader=sorted[0];
 $('rTitle').textContent=player.wrecked?'CRASHED OUT':(player.pos===1?'VICTORY':'CHEQUERED FLAG');
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
 // In demo mode the broadcast runs its own loop: show the classification
 // for a while, then drop back to the attract title screen.
 if(demoOn)setTimeout(()=>{if(state.mode==='finished')toTitle();},9000);
}
function toTitle(){
 demoOn=false;demoArmed=0;
 const tag=$('demoTag');if(tag)tag.classList.add('hidden');
 const b=$('demoBanner');if(b)b.classList.add('hidden');
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
 // Commentator excitement meter: fast, on the limit, side-by-side or in
 // the rain → the voice gets faster, higher and more emotional.
 {
  // The commentator is delighted to be at the circuit even in a quiet phase;
  // speed, weather and action lift him from an already enthusiastic baseline.
  const exT=clamp(0.58
   +(Math.abs(player.vF)/PH.top)*0.30
   +(cur.rain>0.5?0.15:0)
   +(player.offT?0.08:0)
   +(player.drift?0.1:0)
   +(player.drsOpen?0.08:0),0.45,1);
  exCur=damp(exCur,exT,0.9,dt);
 }
 // Positive live colour at regular intervals, not only when somebody crashes
 // or overtakes. Vary the interval so it feels broadcast rather than looped.
 if(state.mode==='race'&&raceT-hypeLineT>(18+((Math.sin(hypeLineT*1.7)+1)*5))){
  hypeLineT=raceT;
  Speech.say(pick(RACE_HYPE_LINES),false,{rate:1.10+exCur*.16,pitch:1.04+exCur*.08});
 }
 for(const c of cars){
  if(c.isPlayer){if(!c.finished&&!demoOn)playerControl();else aiThink(c,dt);}
  else aiThink(c,dt);
  if(c.finished){c.throttle=Math.min(c.throttle,0.35);c.brake=0;}
  updCar(c,dt);
 }
 // Demo-mode broadcast: keep the sun tracking the race leader so shadow
 // coverage follows the director's cameras.
 if(demoOn){
  const lead=[...cars].sort((a,b)=>b.key-a.key)[0];
  if(lead){
   sunLight.position.set(lead.x+sunVec.x*300,lead.y+sunVec.y*300+45,lead.z+sunVec.z*300);
   sunLight.target.position.set(lead.x,lead.y,lead.z);
  }
 }
 // Give-the-place-back enforcement: while the penalty runs, the player is
 // classified just behind the car they cheated past (world position kept).
 if(gbActive>0){
  gbActive-=dt;
  if(gbCar&&cars.includes(gbCar)){
   player.f=gbCar.f-1.0;if(player.f<0)player.f+=T.N;
   player.lap=gbCar.lap;
   player._pf=player.f;
  }else{gbActive=0;gbCar=null;}
 }
 for(const c of cars)c.key=c.lap*T.N+c.f;
 // Track-limits overtake detection: if the player goes from behind to ahead
 // of a car while the player is off-track, that pass is illegal.
 if(state.mode==='race'&&!player.finished){
  for(const o of cars){
   if(o.isPlayer)continue;
   const k=o.d.num;
   const ps=crossSign.get(k);
   const cs=Math.sign(player.key-o.key);
   if(ps==null){crossSign.set(k,cs);continue;}
   if(ps<=0&&cs>0&&gbActive<=0&&player.offT){
    const now=nowT();
    if(now-(gbCool.get(k)||-9)>8){gbCool.set(k,now);givePlaceBack(o);}
   }
   crossSign.set(k,cs);
  }
 }
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
   // Sky-F1 broadcast style: the tower is a fixed, transparent feed that
   // auto-scrolls so YOUR position is always kept in view — whether you're
   // P1 at the top or P20 at the bottom. Centre on the player row.
   const myRow = timingTowerEl.querySelector('.tower-row.me');
   if (myRow) myRow.scrollIntoView({block:'center'});
  }

  if(player.pos<lastPos&&state.mode==='race'&&otCool<=0&&player.pos>0){
   otCool=4;
   exCur=Math.max(exCur,0.75);
   if(player.pos<=3)Speech.say(LINES.podium,false,{rate:1.18,pitch:1.08});
   else Speech.say(pick(LINES.overtake).replace('{n}',player.pos),false,{rate:1.16,pitch:1.06});
   showMsg('OVERTAKE','P'+player.pos,'green',1.4);
  }else if(player.pos>lastPos&&state.mode==='race'&&otCool<=0&&player.pos>0&&!player.finished){
   // Lost a place — find who got through and call it with emotion.
   otCool=4;
   exCur=Math.max(exCur,0.6);
   const passer=[...cars].filter(c=>!c.isPlayer&&c.key>player.key).sort((a,b)=>a.key-b.key)[0];
   const who=passer?passer.d.name.split(' ').pop().toUpperCase():'A rival';
   Speech.say(pick(LINES.lost).replace('{d}',who).replace('{n}',player.pos),true,{rate:1.18,pitch:1.1});
   showMsg('LOST POSITION','P'+player.pos,'red',1.4);
  }
  lastPos=player.pos;
  // Side-by-side drama — occasional "they are racing wheel to wheel!" call.
  if(state.mode==='race'&&timeSec-closeT>25){
   let close=false;
   for(const o of cars){if(o.isPlayer)continue;
    let df=Math.abs(o.f-player.f);if(df>T.N/2)df=T.N-df;
    if(df*T.segLen<14&&Math.abs(o.lat-player.lat)<4.2&&Math.abs(o.vF)>30&&Math.abs(player.vF)>30){close=true;break;}}
   if(close){closeT=timeSec;exCur=Math.max(exCur,0.7);Speech.say(pick(LINES.close),true,exOpts());}
  }
  // Wet-weather commentary — a tense, slower line when the rain is heavy.
  if(cur.rain>0.5&&timeSec-rainLineT>45&&state.mode==='race'){
   rainLineT=timeSec;Speech.say(pick(LINES.rain),false,exOpts());
  }
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
 // Water is alive: every lake / harbour / puddle-free water surface shares
 // the one procedural ripple texture, so scrolling its UVs makes all of it
 // drift and shimmer at once for the cost of two float writes.
 waterT.offset.y=(timeSec*0.014)%1;
 waterT.offset.x=Math.sin(timeSec*0.11)*0.035;
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

 // Live broadcast-style ticker: track, lap and the current gap at the front,
 // so the title screen reads like a TV feed rather than a menu backdrop.
 tickAcc-=dt;
 if(tickAcc<=0){
  tickAcc=0.5;
  const el=$('titleTicker');
  if(el){
   const sorted=[...cars].sort((a,b)=>b.key-a.key);
   const lead=sorted[0];
   let gap='';
   if(sorted.length>1&&lead){
    const g=(lead.key-sorted[1].key)*T.segLen/Math.max(Math.abs(sorted[1].vF),15);
    gap=' · P2 +'+g.toFixed(1)+'s';
   }
   el.innerHTML='<i class="live-dot"></i>LIVE&nbsp;&nbsp;'+TRACKS[state.trackIdx].name.toUpperCase()
    +' · LAP '+Math.max(1,Math.round(lead?lead.lap:0))
    +' · P1 '+(lead?lead.d.name.toUpperCase():'')+gap;
  }
 }

 // Demo mode: after a period of no input, count down and start the race.
 if(!demoOn){
  const idle=nowT()-lastInput;
  if(idle>16&&demoArmed===0)demoArmed=nowT();
  if(demoArmed>0){
   const remain=Math.ceil(6-(nowT()-demoArmed));
   const b=$('demoBanner');
   if(b){b.classList.remove('hidden');b.textContent='DEMO RACE STARTING IN '+Math.max(0,remain)+' — PRESS ANY KEY TO SKIP';}
   if(nowT()-demoArmed>=6)startDemo();
  }
 }
}
let attractT=6;
// Demo mode: leave the title screen alone and the game starts a full
// broadcast-style race by itself, with the whole grid (player included)
// driven by the AI under the director's cameras. Any input returns to menu.
let demoOn=false,demoArmed=0,lastInput=nowT();
// Commentator "excitement" meter — drives rate/pitch of emotional lines.
let exCur=0.62,tickAcc=0,closeT=0,rainLineT=0,hypeLineT=-12;
function exOpts(){return{rate:clamp(1.0+exCur*0.32,1.0,1.38),pitch:clamp(1.02+exCur*0.12,1.02,1.15)};}
function startDemo(){
 demoOn=true;demoArmed=0;
 const b=$('demoBanner');if(b)b.classList.add('hidden');
 const tag=$('demoTag');if(tag)tag.classList.remove('hidden');
 beginRace();
 if(player)player.reactT=0;
}

/* ============ input ============ */
let dtGlobal=0.016;
let rainPass=null;
/* src/snowShader.js existed in the project but was never wired in, so 'snow' was
   a colour grade with no snow in it. snowPass draws the flakes; snowAccum is the
   thing that makes it a *weather* rather than a particle effect: it builds while
   it snows and melts back when it stops, and it drives the road colour, the grip
   and the shader intensity together. */
let snowPass=null;
let snowAccum=0, snowGust=0, snowGustT=6;
let qualityMgr=null;

function isFullscreen(){
 const d=document;
 return !!(d.fullscreenElement||d.webkitFullscreenElement||d.msFullscreenElement||d.mozFullScreenElement);
}
function isIOS(){
 const ua=navigator.userAgent||'';
 return (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
}
function fsToast(msg){
 const t=$('fsToast');
 if(t){t.textContent=msg;t.classList.add('show');
  clearTimeout(fsToast._t);fsToast._t=setTimeout(()=>t.classList.remove('show'),3600);}
}
function toggleFullscreen(){
 const d=document, el=d.documentElement;
 // Leaving fullscreen.
 if(isFullscreen()){
  const ex=d.exitFullscreen||d.webkitExitFullscreen||d.msExitFullscreen||d.mozCancelFullScreen;
  if(ex){try{ex.call(d);}catch(e){}}
  return;
 }
 // Entering fullscreen — every vendor prefix so it works on iPad/Android,
 // Firefox and older Chromium. (iPhone Safari has NO DOM fullscreen API, so
 // this path exits empty there and we fall through to the iOS guide below.)
 const req=el.requestFullscreen||el.webkitRequestFullscreen||el.mozRequestFullScreen||el.msRequestFullscreen;
 if(req){
  try{const r=req.call(el);if(r&&r.then)r.catch(()=>{});}catch(e){}
 }
 // Lock to landscape where supported (Android, iPad).
 try{if(screen.orientation&&screen.orientation.lock)screen.orientation.lock('landscape').catch(()=>{});}catch(e){}
 // Already running from a home-screen install → it IS fullscreen.
 if(navigator.standalone){fsToast('FULLSCREEN ACTIVE');return;}
 const t0=navigator.standalone;
 setTimeout(()=>{
  if(isFullscreen()){fsToast('FULLSCREEN ACTIVE');return;}
  // iPhone Safari: no fullscreen API. Point the player at the one thing that
  // works — installing to the home screen, which the manifest makes launch
  // truly fullscreen with the bars gone.
  if(isIOS()){
   fsToast('IPHONE: TAP  ▢ RELOAD / SHARE  ➜  ADD TO HOME SCREEN  FOR TRUE FULLSCREEN');
  }else{
   fsToast('FULLSCREEN BLOCKED — ROTATE & TRY AGAIN, OR ADD TO HOME SCREEN');
  }
 },320);
}

addEventListener('keydown',e=>{
 if(e.repeat)return;
 // Any input exits demo mode back to the attract title screen.
 if(demoOn&&state.mode!=='title'){toTitle();lastInput=nowT();return;}
 lastInput=nowT();
 if(demoArmed>0){demoArmed=0;const b=$('demoBanner');if(b)b.classList.add('hidden');}
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
  if (state.camMode === 5) { // Only zoom in top down view
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
// The readable HUD camera chip doubles as the touch "C" — tap to cycle views.
if($('hCam'))$('hCam').addEventListener('click',e=>{e.preventDefault();cycleCam();});

if($('tFs'))$('tFs').onclick=toggleFullscreen;
if($('tFootFs'))$('tFootFs').onclick=toggleFullscreen;
if($('hFsChip'))$('hFsChip').onclick=toggleFullscreen;
if($('pFs'))$('pFs').onclick=toggleFullscreen;
if($('tFsTouch'))$('tFsTouch').addEventListener('pointerdown',e=>{e.preventDefault();toggleFullscreen();});
if($('hPauseChip'))$('hPauseChip').onclick=togglePause;
if($('hTowerChip'))$('hTowerChip').onclick=()=>{towerHidden=!towerHidden;applyTowerVisibility();};

if($('hZoomIn'))$('hZoomIn').onclick=()=>{state.zoom=Math.max(20,state.zoom-8);};
if($('hZoomOut'))$('hZoomOut').onclick=()=>{state.zoom=Math.min(150,state.zoom+8);};

// Tilt mode menu buttons & chips
// --- gyroscope retry prompt -------------------------------------------------
// Tilt is the only control surface on a phone, so a gyroscope that never
// delivers data has to be announced — and fixed with a tap, because iOS only
// hands out motion permission inside a user gesture. This stays up until a
// sensor event actually arrives.
const _gyroPrompt={show(t){
 const el=$('gyroPrompt');if(!el)return;
 const tx=$('gyroPromptText');if(tx)tx.textContent=t||'';
 el.classList.add('show');
},hide(){const el=$('gyroPrompt');if(el)el.classList.remove('show');}};
function showGyroPrompt(){
 _gyroPrompt.show(tiltCtrl.gyroError||'Waiting for the motion sensor…');
}
function hideGyroPrompt(){_gyroPrompt.hide();}
if($('gyroPromptBtn'))$('gyroPromptBtn').onclick=async()=>{
 const ok=await tiltCtrl.enable();
 if(ok){hideGyroPrompt();tiltCtrl.showToast('GYROSCOPE LIVE · TILT TO STEER',2600);}
 else _gyroPrompt.show((tiltCtrl.gyroError||'Still no sensor data.')+' Tap again to retry.');
};
if($('btnTiltMode')){
 $('btnTiltMode').onclick = async (e) => {
   e.preventDefault();
   const ok = await tiltCtrl.enable();
   if (ok) { hideGyroPrompt(); tiltCtrl.showToast('GYROSCOPE LIVE · TILT TO STEER', 2600); }
   else { showGyroPrompt(); tiltCtrl.showToast(tiltCtrl.gyroError || 'NO SENSOR DATA FROM THIS DEVICE', 5200); }
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
 const X=p=>cx+(p[0]-(minX+maxX)/2)*s, Y=p=>cy+(p[1]-(minZ+maxZ)/2)*s;

 c.clearRect(0,0,W,H);
 c.fillStyle='rgba(13,15,19,0.78)';
 c.fillRect(0,0,W,H);
 // subtle crosshair grid so the layout reads like a TV graphic
 c.strokeStyle='rgba(255,255,255,0.05)';c.lineWidth=1;c.beginPath();
 for(let gx=0;gx<=W;gx+=Math.max(1,Math.round(W/4))){c.moveTo(gx,0);c.lineTo(gx,H);}
 for(let gy=0;gy<=H;gy+=Math.max(1,Math.round(H/4))){c.moveTo(0,gy);c.lineTo(W,gy);}
 c.stroke();
 // track: soft red glow under a white core
 c.lineCap='round';c.lineJoin='round';
 c.strokeStyle='rgba(225,6,0,0.35)';c.lineWidth=Math.max(5,W*0.06);
 c.beginPath();
 pv.forEach((p,j)=>{j===0?c.moveTo(X(p),Y(p)):c.lineTo(X(p),Y(p));});
 c.closePath();c.stroke();
 c.strokeStyle='#f4f1ea';c.lineWidth=Math.max(1.8,W*0.02);
 c.beginPath();
 pv.forEach((p,j)=>{j===0?c.moveTo(X(p),Y(p)):c.lineTo(X(p),Y(p));});
 c.closePath();c.stroke();

 // lap-direction arrows (only when the canvas is big enough to read them)
 if(W>=90){
  const step=Math.max(6,Math.floor(pv.length/14));
  c.fillStyle='#47c7fc';
  for(let j=0;j<pv.length;j+=step){
   const a=pv[j],b=pv[(j+2)%pv.length];
   const ang=Math.atan2(Y(b)-Y(a),X(b)-X(a));
   c.save();c.translate(X(a),Y(a));c.rotate(ang);
   c.beginPath();c.moveTo(7,0);c.lineTo(-4,-4.5);c.lineTo(-4,4.5);c.closePath();c.fill();
   c.restore();
  }
 }
 // start/finish line
 const st=pv[0],st2=pv[Math.min(2,pv.length-1)];
 const dx=X(st2)-X(st),dy=Y(st2)-Y(st);
 const d=Math.hypot(dx,dy)||1;
 const nx=-dy/d,ny=dx/d;
 c.strokeStyle='#e10600';c.lineWidth=Math.max(1.5,W*0.016);
 c.beginPath();
 c.moveTo(X(st)-nx*Math.max(4,W*0.05),Y(st)-ny*Math.max(4,W*0.05));
 c.lineTo(X(st)+nx*Math.max(4,W*0.05),Y(st)+ny*Math.max(4,W*0.05));
 c.stroke();
 c.fillStyle='#ffd23f';
 c.beginPath();c.arc(X(st),Y(st),Math.max(2.5,W*0.028),0,Math.PI*2);c.fill();
 c.strokeStyle='rgba(0,0,0,.5)';c.lineWidth=1;c.stroke();
}
// Plain country codes are deliberate: the old pasted emoji bytes were decoded
// twice and rendered as strings such as "🇮🇹" in the menu. These labels
// are compact, readable and encoding-safe on every browser/PWA cache.
const TRACK_FLAGS={
'Monza':'IT','Silverstone':'GB','Spa-Francorchamps':'BE','Monaco':'MC','Red Bull Ring':'AT',
'Suzuka':'JP','Albert Park':'AU','Shanghai':'CN','Bahrain International Circuit':'BH',
'Jeddah Corniche':'SA','Miami International Autodrome':'US','Circuit Gilles Villeneuve':'CA',
'Circuit de Barcelona-Catalunya':'ES','Hungaroring':'HU','Circuit Zandvoort':'NL','Madring':'ES',
'Baku City Circuit':'AZ','Sepang':'MY','Marina Bay':'SG','Circuit of the Americas':'US',
'Autódromo Hermanos Rodríguez':'MX','Interlagos':'BR','Las Vegas Strip Circuit':'US',
'Lusail International Circuit':'QA','Yas Marina':'AE'};
function updateHero(i){
 const hpv=$('tHeroPv');if(!hpv)return;
 const t=TRACKS[i];
 drawTrackPreview(hpv,t);
 const hn=$('tHeroNameTxt');if(hn)hn.textContent=t.name.toUpperCase();
 const hf=$('tHeroFlag');if(hf)hf.textContent=TRACK_FLAGS[t.name]||'GP';
 const hm=$('tHeroMeta');if(hm)hm.textContent=`${t.loc} · ${t.desc}`;
 const hq=$('tHeroQual');if(hq)hq.textContent=`LAP RECORD ${t.lapRecord} — ${t.recordHolder}`;
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
  updateHero(i);
 }
 function selectTrack(i,rebuild){
  state.trackIdx=(i+TRACKS.length)%TRACKS.length;
  setButton(state.trackIdx);
  if(rebuild){buildWorld(state.trackIdx);snapWeather(state.wx);setupGrid(20);}
 }
 function closeList(){dd.classList.remove('open');list.classList.add('hidden');}
 function openList(){dd.classList.add('open');list.classList.remove('hidden');}
 TRACKS.forEach((t,i)=>{
  const card=document.createElement('div');card.className='card'+(i===state.trackIdx?' sel':'');
  const cv=document.createElement('canvas');cv.width=140;cv.height=70;
  drawTrackPreview(cv,t);
  const info=document.createElement('div');
  info.innerHTML=`<div class="cn">${TRACK_FLAGS[t.name]||''} ${t.name}</div><div class="cm">${t.loc} — ${t.desc}</div>`;
  card.append(cv,info);
  card.onclick=()=>{[...list.children].forEach(x=>x.classList.remove('sel'));card.classList.add('sel');
   selectTrack(i,true);closeList();};
  list.appendChild(card);
 });
 const prev=$('tPrev'),next=$('tNext');
 if(prev)prev.onclick=()=>{selectTrack(state.trackIdx-1,true);AudioSys.start();AudioSys.click&&AudioSys.click();};
 if(next)next.onclick=()=>{selectTrack(state.trackIdx+1,true);AudioSys.start();AudioSys.click&&AudioSys.click();};
 setButton(state.trackIdx);
 btn.onclick=()=>{dd.classList.contains('open')?closeList():openList();};
 if(!dd._ddWired){
  dd._ddWired=true;
  document.addEventListener('click',e=>{if(!dd.contains(e.target))closeList();});
 }

 seg('tWeather',['SUNNY','DRIZZLE','RAIN','FOG','SNOW'].map((l,i)=>ICONS[['sun','driz','rain','mist','snow'][i]]+'<span>'+l+'</span>'),0,
  i=>{state.wx=['sun','driz','rain','mist','snow'][i];snapWeather(state.wx);});
 seg('tTod',['DAY','DUSK','NIGHT'],0,
  i=>{state.tod=['day','dusk','night'][i];applyWeatherVisuals();refreshEnv();});
 seg('tLaps',['3 LAPS','5 LAPS','8 LAPS'],0,i=>state.laps=[3,5,8][i]);
 seg('tGrid',['10 CARS','14 CARS','20 CARS'],2,i=>state.grid=[10,14,20][i]);
 seg('tDiff',['RELAXED','NORMAL','PRO'],1,i=>state.diffMul=[0.88,0.97,1.05][i]);
 
 const qModes=['AUTO','ULTRA','HIGH','MED','LOW'];
 seg('tQuality',qModes.map(m=>m==='AUTO'?'⚡AUTO':m),0,i=>{
   state.quality=qModes[i];
   if(qualityMgr){qualityMgr.current='AUTO';qualityMgr.autoLevel=null;qualityMgr.apply(state.quality);postfx.apply(effQuality());resize();}
   // Rebuild immediately so prop density / terrain resolution changes are
   // visible right away on the title screen, not just next race.
   if(state.mode==='title')buildWorld(state.trackIdx);
 });
 seg('pQuality',qModes.map(m=>m==='AUTO'?'⚡AUTO':m),0,i=>{
   state.quality=qModes[i];
   if(qualityMgr){qualityMgr.current='AUTO';qualityMgr.autoLevel=null;qualityMgr.apply(state.quality);postfx.apply(effQuality());resize();}
 });

 $('tSpeech').onclick=()=>{const b=$('tSpeech');b.classList.toggle('on');
  b.textContent=b.classList.contains('on')?'VOICE ON':'VOICE OFF';};
 // Restore the locally persisted PWA driver identity and allow either the
 // front camera (`capture=user`) or photo library. Images are resized before
 // storage so a portrait cannot exhaust Safari's localStorage quota.
 $('tName').value=state.name;
 const photoPreview=$('driverPhotoPreview'),photoInput=$('driverPhotoInput');
 const cameraBtn=$('driverCameraBtn'),uploadBtn=$('driverUploadBtn');
 const cameraModal=$('cameraCapture'),cameraVideo=$('cameraVideo'),cameraStatus=$('cameraCaptureStatus');
 let cameraStream=null;
 const refreshPhoto=()=>{if(photoPreview)photoPreview.src=state.driverPhoto||getDriverHeadshot({color:'#e10600'});};
 const storePortrait=(source,w,h,mirror=false)=>{
  const cv=document.createElement('canvas');cv.width=cv.height=256;
  const cx=cv.getContext('2d'),s=Math.min(w,h),sx=(w-s)/2,sy=(h-s)/2;
  if(mirror){cx.translate(256,0);cx.scale(-1,1);}
  cx.drawImage(source,sx,sy,s,s,0,0,256,256);
  state.driverPhoto=cv.toDataURL('image/jpeg',0.78);state.name=$('tName').value.trim()||state.name;
  saveDriverProfile();refreshPhoto();
 };
 const stopCamera=()=>{if(cameraStream)cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;if(cameraVideo)cameraVideo.srcObject=null;if(cameraModal)cameraModal.classList.add('hidden');};
 refreshPhoto();
 if(uploadBtn&&photoInput)uploadBtn.onclick=()=>photoInput.click();
 if(photoInput)photoInput.onchange=()=>{
  const file=photoInput.files&&photoInput.files[0];if(!file)return;
  const img=new Image();img.onload=()=>{storePortrait(img,img.width,img.height);URL.revokeObjectURL(img.src);};img.src=URL.createObjectURL(file);
 };
 if(cameraBtn)cameraBtn.onclick=async()=>{
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){if(cameraStatus)cameraStatus.textContent='Camera access is not supported here. Use Upload instead.';if(cameraModal)cameraModal.classList.remove('hidden');return;}
  try{
   cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:1280}},audio:false});
   cameraVideo.srcObject=cameraStream;cameraModal.classList.remove('hidden');cameraStatus.textContent='Position your face in the centre';
  }catch(e){cameraModal.classList.remove('hidden');cameraStatus.textContent='Camera permission was blocked. Allow camera access or use Upload.';}
 };
 if($('cameraCancel'))$('cameraCancel').onclick=stopCamera;
 if($('cameraSnap'))$('cameraSnap').onclick=()=>{if(cameraVideo&&cameraVideo.videoWidth){storePortrait(cameraVideo,cameraVideo.videoWidth,cameraVideo.videoHeight,true);stopCamera();}};
 $('tName').onchange=()=>{
  const nm=$('tName').value.trim();
  state.name=nm||'YOU';saveDriverProfile();
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
 // Dramatic slow-motion after the player's big hit — time dilates briefly,
 // then snaps back, while the camera tightens into the action.
 let tScale=1;
 if(slowMo>0){
  slowMo=Math.max(0,slowMo-dt);
  tScale=lerp(1,0.32,clamp(slowMo/slowMoDur,0,1));
 }
 dtGlobal=state.paused?0:dt*tScale;
 // Feed the auto-quality FPS monitor (no-op unless the UI mode is AUTO).
 if(qualityMgr&&qualityMgr.current==='AUTO'&&state.mode!=='boot') qualityMgr.sample(1/Math.max(dt,0.0001));
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
   updPoints(sparks,dtGlobal,0.12);
   updDebris(dtGlobal);
   updWeatherFX(dtGlobal);
   updLens(dtGlobal);
   updClouds(dtGlobal);
   updBirds(dtGlobal);
   updFlybyPlane(dtGlobal);
   updLightning(dtGlobal);
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
  const rainShaderOn=(QUALITY_PRESETS[effQuality()]||{}).rainShader!==false;
  const speedKmh=player?Math.abs(player.vF)*3.6:0;
  const speedFactor=clamp(speedKmh/300,0,1);
  // Airflow clears some standing water but never erases the beads completely;
  // at racing speed the original 0.22 multiplier made the Shadertoy layers
  // almost disappear precisely when the sense of speed should be strongest.
  const effRain=cur.rain*lerp(1.0,0.52,speedFactor);
  if(rainPass && rainShaderOn && state.mode!=='title' && (effRain>0.01||lightningFlash>0.01)){
   // The windshield pass does its own full-screen composite, so the grade
   // chain stands down for those frames rather than fighting it for the
   // canvas. ACES is restored first, so the look stays the same either way.
   renderer.toneMapping=BASE_TONE;
   rainPass.renderScene(scene,camera);
   rainPass.composite(timeSec,effRain,speedKmh,lightningFlash);
   if(snowPass&&snowAccum>0.02)snowPass.composite(timeSec,snowAccum*(0.55+0.45*cur.snow),0.3+snowGust*0.7);
  }else{
   postfx.setMood({rain:cur.rain,wet:cur.wet,night:state.tod==='night',exposure:renderer.toneMappingExposure,time:timeSec});
   renderer.toneMapping=postfxActive()?THREE.NoToneMapping:BASE_TONE;
   if(!postfx.render(timeSec))renderer.render(scene,camera);
   if(snowPass&&snowAccum>0.02&&(QUALITY_PRESETS[effQuality()]||{}).rainShader!==false)snowPass.composite(timeSec,snowAccum*(0.55+0.45*cur.snow),0.3+snowGust*0.7);
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
 postfx.setSize(innerWidth,innerHeight,renderer.getPixelRatio());
}
addEventListener('resize',resize);
addEventListener('orientationchange',()=>setTimeout(resize,120));

/* ============ boot ============ */
rainPass = new RainShaderPass(renderer);
snowPass = new SnowShaderPass(renderer);
qualityMgr = new QualityManager(renderer, sunLight, rainPass);
qualityMgr.apply('AUTO');
postfx.apply(effQuality());
// Probe the display's real refresh rate (120Hz/144Hz/60Hz) so the autotuner
// targets the panel's max instead of assuming 60fps — on a 120Hz M5 Max the
// game now actually pushes for 120fps rather than settling at 60.
qualityMgr.init();

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
// Pointer input also resets the demo idle timer, and exits a running demo.
addEventListener('pointerdown',()=>{
 lastInput=nowT();
 if(demoArmed>0){demoArmed=0;const b=$('demoBanner');if(b)b.classList.add('hidden');}
 if(demoOn&&state.mode!=='title')toTitle();
});

