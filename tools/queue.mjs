import {chromium} from 'playwright';
const br=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const pg=await br.newPage({viewport:{width:800,height:450}});
pg.on('pageerror',e=>console.log('ERR',e.message));
await pg.goto('http://localhost:3000/',{waitUntil:'load'});
const ivl=setInterval(()=>pg.evaluate(()=>{window.__pgp&&window.__pgp.noDemo&&window.__pgp.noDemo();}).catch(()=>{}),1500);
await pg.waitForFunction(()=>window.__pgp&&document.getElementById('tStart'),{timeout:60000});
await pg.evaluate(()=>{window.__pgp.noDemo();document.getElementById('tStart').click();});
await pg.waitForTimeout(9000);console.log('mode',await pg.evaluate(()=>window.__pgp.state.mode));
await pg.evaluate(()=>{const g=window.__pgp;g.keys.up=false;g._rec=0;g.pole();g.go();const p=g.player;p.throttle=0;p.brake=1;
 // instrument recovery spins
 for(const c of g.cars){c.__recSeen=0;}
 g._tick=setInterval(()=>{for(const c of g.cars){if(c===g.player)continue;if(c.recT>0&&!c.__inRec){c.__inRec=true;g._rec++;}if(c.recT<=0)c.__inRec=false;}},100);});
for(let t=5;t<=30;t+=5){await pg.waitForTimeout(5000);
 const r=await pg.evaluate(()=>{const g=window.__pgp,p=g.player;p.throttle=0;p.brake=1;p.vx=p.vz=p.vF=0;let ahead=0,behind=0,slow=0;for(const c of g.cars){if(c===p)continue;let dk=c.f-p.f;dk=((dk%g.state._N||dk)+0);const NN=g.N;let d=((c.f-p.f)%NN+NN)%NN;if(d<NN/2)ahead++;else behind++;if(Math.abs(c.vF)<3)slow++;}const det=g.cars.filter(c=>c!==p).map(c=>{const NN=g.N;let d=((c.f-p.f)%NN+NN)%NN;if(d>NN/2)d-=NN;return [Math.round(d*g.segLen),Math.round(c.vF),c.lat.toFixed(1),c.recT>0?'R':''].join('/');}).join(' ');return{det,ahead,behind,slow,rec:g._rec,plat:p.lat.toFixed(1),pv:p.vF.toFixed(1),pf:p.f.toFixed(1),lap:p.lap};});
 console.log('t='+t,JSON.stringify(r));}
clearInterval(ivl);await br.close();
