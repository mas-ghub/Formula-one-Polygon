/* ============ Shared car geometry ============
   Kept independent from game.js so the optional gyro lab cannot create a
   circular module dependency during the initial boot. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
 const key=colA+colB+':openTub';if(bodyCache.has(key))return bodyCache.get(key);
 const P=[];const B=(w,h,d,c,x,y,z,rx=0,ry=0,rz=0)=>P.push(part(new THREE.BoxGeometry(w,h,d),c,x,y,z,rx,ry,rz));
 const C=(rt,rb,h,seg,c,x,y,z,rx=0)=>P.push(part(new THREE.CylinderGeometry(rt,rb,h,seg),c,x,y,z,rx));
 B(1.55,0.07,3.6,'#15161a',0,0.14,0.15);
 // Split the monocoque so the cockpit is a real OPENING, not a solid slab.
 // The old 2.2 m brick filled the tub and swallowed the steering wheel from
 // helmet-cam (the "big black space"). Nose volume sits AHEAD of the wheel;
 // the seat bulkhead sits BEHIND it.
 B(0.72,0.26,1.05,colA,0,0.34,1.42);
 B(0.72,0.22,0.85,colA,0,0.30,-0.18);
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
 // Low nose deck — sits below the visor so helmet-cam looks OVER it, not into it.
 B(0.70,0.12,0.85,colA,0,0.38,1.35);
 B(0.48,0.06,0.50,'#101114',0,0.46,1.28);
 // Halo protection structure — modelled after the real open FIA halo: two
 // side rails, two chassis feet, a front crown and one central forward pillar.
 // It is deliberately not a closed hoop; the driver sits inside the open gap
 // between the two rails and sees the central bar ahead of the visor.
 // Halo protection is a separate assembly below. Keeping it out of the
 // merged body mesh prevents the cockpit shell from swallowing the rails or
 // the front splitter in side and helmet views.
 // Rear impact structure behind the driver's head, tying the two sides of the
 // cockpit together — it is what makes the ring read as part of a chassis.
 B(0.30, 0.16, 0.10, '#15161a', 0, 0.72, -0.10);
 // Cockpit surround: rim the driver sits inside, mirror stalks and the dashboard
 // under the nose of the halo, so the opening is a cockpit and not a gap.
 for (const sx of [1, -1]) {
  // Low, short cockpit lips — not visor-height walls.
  B(0.08, 0.10, 0.55, colA, sx * 0.58, 0.50, 0.18);
  C(0.018, 0.018, 0.20, 5, '#101114', sx * 0.62, 0.62, 0.42, 0, 0, sx * 1.1);
  B(0.13, 0.06, 0.03, '#0b0d10', sx * 0.72, 0.64, 0.44);
 }
 B(0.58, 0.03, 0.12, '#101114', 0, 0.56, 0.82);            // thin dash lip ahead of the wheel
 
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
export function makeDriverMesh(colA, helmetCol, material){
  const driverMaterial=material||new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:0.25,metalness:0.35,envMapIntensity:1.1});
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

  // F1-style yoke: carbon rim, grips, coloured rotary knobs, LED shift lights
  // and a live LCD. Geometry stays cheap (boxes); the screen is one 256×128
  // canvas texture updated only for the player in helmet-cam on HIGH/ULTRA.
  const steering = new THREE.Group();
  steering.position.set(0, 0.80, 0.62);
  steering.rotation.x = 0.42;
  const carbonMat = new THREE.MeshStandardMaterial({color:0x121417,roughness:0.42,metalness:0.28,flatShading:true});
  const gripMat = new THREE.MeshStandardMaterial({color:0x0a0b0d,roughness:0.72,metalness:0.08,flatShading:true});
  const addBox=(w,h,d,mat,x,y,z,rx=0,ry=0,rz=0)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    m.position.set(x,y,z);m.rotation.set(rx,ry,rz);steering.add(m);return m;
  };
  // Main yoke body + lower clutch-paddle zone
  addBox(0.34, 0.20, 0.045, carbonMat, 0, 0.01, 0);
  addBox(0.22, 0.10, 0.04, carbonMat, 0, -0.12, 0.005);
  addBox(0.08, 0.16, 0.04, carbonMat, -0.18, -0.02, 0);
  addBox(0.08, 0.16, 0.04, carbonMat,  0.18, -0.02, 0);
  // Rubberised side grips (the "Sparco" hands sit on these)
  addBox(0.055, 0.22, 0.07, gripMat, -0.205, -0.01, 0.01, 0, 0, 0.12);
  addBox(0.055, 0.22, 0.07, gripMat,  0.205, -0.01, 0.01, 0, 0,-0.12);
  // Coloured top buttons (N / P / DRS / +/-)
  const btn=(col,x,y)=>{
    const m=new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.016,0.012,8),
      new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.35,roughness:0.4}));
    m.rotation.x=Math.PI/2;m.position.set(x,y,0.028);steering.add(m);
  };
  btn(0x1ad15a,-0.11, 0.07);
  btn(0x2a6bff,-0.07, 0.085);
  btn(0xffd23f, 0.07, 0.085);
  btn(0xe10600, 0.11, 0.07);
  btn(0xf4f4f0,-0.14,-0.04);
  btn(0x7a3cff, 0.14,-0.04);
  // Rotary barrels on the lower rim
  for(const sx of[-1,1]){
    const rot=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.018,10),
      new THREE.MeshStandardMaterial({color:0x1a3d22,emissive:0x145c28,emissiveIntensity:0.25,roughness:0.45}));
    rot.rotation.x=Math.PI/2;rot.position.set(sx*0.08,-0.145,0.02);steering.add(rot);
  }
  // Shift-light bar across the top of the yoke (10 LEDs, RPM-driven)
  const leds=[];
  const LED_COLS=[0x1ad15a,0x1ad15a,0x1ad15a,0xffd23f,0xffd23f,0xffd23f,0xff7a00,0xff7a00,0xe10600,0xe10600];
  for(let i=0;i<10;i++){
    const col=LED_COLS[i];
    const mat=new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.08,roughness:0.3});
    const led=new THREE.Mesh(new THREE.BoxGeometry(0.018,0.012,0.008),mat);
    led.position.set(-0.09+i*0.02, 0.108, 0.026);
    steering.add(led);leds.push(mat);
  }
  // Live LCD — canvas texture, 256×128, cheap even when redrawn
  const lcdC=document.createElement('canvas');lcdC.width=256;lcdC.height=128;
  const lcdX=lcdC.getContext('2d');
  lcdX.fillStyle='#05080c';lcdX.fillRect(0,0,256,128);
  const lcdTex=new THREE.CanvasTexture(lcdC);
  lcdTex.minFilter=THREE.LinearFilter;lcdTex.magFilter=THREE.LinearFilter;
  const lcdMat=new THREE.MeshBasicMaterial({map:lcdTex,depthWrite:true,side:THREE.DoubleSide});
  const lcd=new THREE.Mesh(new THREE.PlaneGeometry(0.20,0.10),lcdMat);
  lcd.position.set(0,0.012,0.026);steering.add(lcd);
  // Bezel around the screen
  addBox(0.178, 0.094, 0.01, carbonMat, 0, 0.012, 0.018);

  // Gloves parented to the wheel so they rotate with lock
  const gloveMat=new THREE.MeshStandardMaterial({color:0x111318,roughness:0.7,flatShading:true});
  for(const sx of[-1,1]){
    const gl=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.055,0.09),gloveMat);
    gl.position.set(sx*0.21,-0.02,0.04);gl.rotation.z=sx*-0.25;steering.add(gl);
  }

  steering.userData.leds=leds;
  steering.userData.lcd={canvas:lcdC,ctx:lcdX,tex:lcdTex};
  steering.userData.detail=true;
  driverGroup.userData.steering = steering;

  const suitMesh = new THREE.Mesh(mergeGeometries(suitParts, false), driverMaterial);
  suitMesh.castShadow = true;
  driverGroup.add(suitMesh);
  driverGroup.add(steering);
  driverGroup.userData.suit = suitMesh;

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

  const helmetMesh = new THREE.Mesh(mergeGeometries(hParts, false), driverMaterial);
  helmetMesh.castShadow = true;
  helmetGroup.add(helmetMesh);

  driverGroup.add(helmetGroup);

  return { driverGroup, helmetGroup };
}

// Tyre compounds. Real F1 distinguishes them by a coloured band on the
// sidewall: soft=red, medium=yellow, hard=white, intermediate=green,
// full-wet=blue. The tread geometry is identical; only the ring colour
// changes, and each compound caches its own single shared geometry so every
// car on that compound still shares one BufferGeometry.
const COMPOUND_RING={
 soft:'#e10600', medium:'#f7d117', hard:'#f4f4f0',
 inter:'#00a651', wet:'#1e6fd9'
};
const axleGeoCache=new Map();
let brakeGeo=null;
export function getAxleGeo(compound='medium'){if(axleGeoCache.has(compound))return axleGeoCache.get(compound);
 // Build one clean wheel at the origin and duplicate it at the two axle ends.
 // Previously suspension pieces for both sides were merged into this single
 // wheel and then the whole assembly was duplicated again. Those extra rods
 // rotated through the tyre and appeared as sharp vertices sticking out.
 const parts=[];
 // Rounded slick tyre, recessed alloy rim and hub. More radial segments remove
 // the conspicuously faceted twelve-sided outline without making the grid
 // expensive (all cars share this geometry).
 const TIRE_R=0.37, TIRE_W=0.34, HALF_W=TIRE_W/2, BEVEL=0.05;
 // Tread cylinder.
 parts.push(part(new THREE.CylinderGeometry(TIRE_R,TIRE_R,TIRE_W,24,1,false),'#151619',0,0,0,0,0,Math.PI/2));
 // BEVELLED SHOULDERS — a torus fillet ring on each side seats its outer face
 // tangent to BOTH the tread radius and the sidewall plane, so the tread rolls
 // into the sidewall through a smooth rounded shoulder instead of a sharp 90°
 // edge (the old flat-sided disc look). The ring's plane is rotated to face the
 // axle (TorusGeometry defaults to a Z-facing ring; rotateY maps it onto X).
 for(const sx of[1,-1]){
  parts.push(part(new THREE.TorusGeometry(TIRE_R-BEVEL,BEVEL,10,24),'#151619',sx*(HALF_W-BEVEL),0,0,0,Math.PI/2,0));
 }
 parts.push(part(new THREE.CylinderGeometry(0.225,0.225,0.352,20,1,false),'#34383e',0,0,0,0,0,Math.PI/2));
 parts.push(part(new THREE.CylinderGeometry(0.072,0.072,0.365,16),'#aeb3ba',0,0,0,0,0,Math.PI/2));
 parts.push(part(new THREE.CylinderGeometry(0.030,0.030,0.378,12),'#ffd23f',0,0,0,0,0,Math.PI/2));
 // Slim spokes stop well inside the 0.225 m rim, so no corner can pierce the
 // rubber even while the wheels spin and steer.
 for(let s=0;s<10;s++){
  const a=s*Math.PI/5;
  parts.push(part(new THREE.BoxGeometry(0.105,0.26,0.026),'#d5dae0',0,Math.cos(a)*0.125,Math.sin(a)*0.125,a,0,0));
 }
 // TREAD BLOCKS — a band of raised blocks around the circumference in a
 // slightly lighter rubber, so the wheels visibly turn with road speed from
 // ANY camera. A featureless dark cylinder spins invisibly; these studs catch
 // the light and read as directional tread. Columns are staggered so the
 // pattern reads as a real block tread rather than a ring of uniform studs.
 const TREAD_COLS=[-0.085,-0.028,0.028,0.085], N_BLOCKS=20;
 for(let c=0;c<TREAD_COLS.length;c++){
  const stagger=(c%2)?Math.PI/N_BLOCKS:0;
  for(let s=0;s<N_BLOCKS;s++){
   const a=s*Math.PI*2/N_BLOCKS+stagger;
   // Box axes: X along the axle (block width), Y radial (thickness), Z around
   // the rim (block length); rotated about X so the thickness points outward.
   // Centred at TIRE_R + half the thickness so each block sits FLUSH on the
   // tread surface and stands ~0.024 m proud of the rubber.
   parts.push(part(new THREE.BoxGeometry(0.052,0.024,0.05),'#26292f',TREAD_COLS[c],Math.cos(a)*(TIRE_R+0.012),Math.sin(a)*(TIRE_R+0.012),a,0,0));
  }
 }
 // COMPOUND RING — a thin coloured band on the sidewall between the rim and
 // the tread shoulder, the way Pirelli marks soft/medium/hard and the wet
 // compounds. Placed a whisker proud of the sidewall plane so it never
 // z-fights the rubber; axis runs along X (the axle) like the bevel rings.
 const ring=COMPOUND_RING[compound]||COMPOUND_RING.medium;
 for(const sx of[1,-1]){
  parts.push(part(new THREE.TorusGeometry(0.29,0.02,10,28),ring,sx*(HALF_W+0.002),0,0,0,Math.PI/2,0));
 }
 const wheel=mergeGeometries(parts,false);
 const left=wheel.clone();left.translate(-0.82,0,0);
 const right=wheel.clone();right.translate(0.82,0,0);
 const geo=mergeGeometries([left,right],false);
 axleGeoCache.set(compound,geo);

 // Brake discs are centred once and then placed directly behind each rim.
 // The old code applied two lateral translations, leaving duplicate discs at
 // the axle centre and beyond the outside edge of the tyres.
 if(!brakeGeo){
  const disc=part(new THREE.CylinderGeometry(0.205,0.205,0.045,20), '#3a2018',0,0,0,0,0,Math.PI/2);
  const d1=disc.clone();d1.translate(-0.82,0,0);
  const d2=disc.clone();d2.translate(0.82,0,0);
  brakeGeo=mergeGeometries([d1,d2],false);
 }
 return geo;}
export function getBrakeGeo(){getAxleGeo();return brakeGeo;}

/* Player-only LCD + LED update. Cheap 2-D canvas; skip when `detail` is false
   (LOW/MED helmet cam keeps the static last frame). */
export function updateSteeringHUD(steering, info){
  if(!steering||!steering.userData)return;
  const leds=steering.userData.leds;
  const rpm01=info.rpm01||0;
  if(leds){
    const n=leds.length, lit=Math.round(rpm01*n);
    for(let i=0;i<n;i++)leds[i].emissiveIntensity=i<lit?(i>=n-2?1.4:0.85):0.06;
  }
  const lcd=steering.userData.lcd;if(!lcd||!info.drawLcd)return;
  const cx=lcd.ctx,w=256,h=128;
  cx.fillStyle='#070b10';cx.fillRect(0,0,w,h);
  // RPM ticks
  cx.fillStyle='#1ad15a';
  const ticks=12,litT=Math.round(rpm01*ticks);
  for(let i=0;i<ticks;i++){
    cx.fillStyle=i<litT?(i>8?'#e10600':i>5?'#ffd23f':'#1ad15a'):'#1a2228';
    cx.fillRect(18+i*18,10,14,6);
  }
  cx.fillStyle='#8fa0aa';cx.font='700 11px sans-serif';cx.textAlign='left';
  cx.fillText((info.speed|0)+' KPH',16,36);
  cx.textAlign='right';cx.fillText(info.pos||'P–',240,36);
  cx.fillStyle='#f4f4f0';cx.font='800 52px sans-serif';cx.textAlign='center';
  cx.fillText(String(info.gear??'N'),128,86);
  cx.fillStyle='#6a7880';cx.font='700 10px sans-serif';
  cx.fillText('L'+(info.lap||1),48,86);
  cx.fillStyle=info.drs?'#1ad15a':'#334048';
  cx.fillText(info.drs?'DRS':'DRS',208,86);
  // Tyre temps
  cx.fillStyle='#e24a2a';cx.font='700 9px sans-serif';cx.textAlign='left';
  cx.fillText((info.tyre||98)+'°C',16,112);
  cx.textAlign='right';cx.fillText((info.tyre||98)+'°C',240,112);
  // Energy bar
  cx.fillStyle='#1a2228';cx.fillRect(48,104,160,12);
  cx.fillStyle='#7adf3a';cx.fillRect(48,104,160*Math.max(0,Math.min(1,info.ers??1)),12);
  cx.fillStyle='#070b10';cx.font='700 9px sans-serif';cx.textAlign='center';
  cx.fillText(((info.ers??1)*100|0)+'%',128,114);
  lcd.tex.needsUpdate=true;
}
