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
  const steering = new THREE.Mesh(mergeGeometries(wheelParts, false), driverMaterial);
  steering.position.set(0, 0.52, 0.68); steering.rotation.x = 0.3;
  driverGroup.userData.steering = steering;

  const suitMesh = new THREE.Mesh(mergeGeometries(suitParts, false), driverMaterial);
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

  const helmetMesh = new THREE.Mesh(mergeGeometries(hParts, false), driverMaterial);
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
export function getBrakeGeo(){getAxleGeo();return brakeGeo;}
