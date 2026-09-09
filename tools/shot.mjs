// Headless screenshot harness: node tools/shot.mjs <name> [wx] [tod] [quality] [cam] [waitSec]
// cam: -1 = stay on title (attract), else press START and cycle to camMode.
import { chromium } from 'playwright';
const [name='shot', wx='rain', tod='day', quality='ULTRA', cam='-1', waitS='8'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'] });
const pg = await b.newPage({ viewport: { width: 800, height: 450 } });
const errs=[]; pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); pg.on('console', m => { if (m.type()==='error'||m.type()==='warning') errs.push(m.type()+': '+m.text().slice(0,200)); });
await pg.goto('http://localhost:3000/', { waitUntil: 'load' });
await pg.waitForFunction(()=>document.getElementById('tWeather')&&document.getElementById('tWeather').children.length>0,null,{timeout:60000});
await pg.waitForTimeout(800);
const ivl=setInterval(()=>pg.evaluate(()=>{window.__pgp&&window.__pgp.noDemo&&window.__pgp.noDemo();}).catch(()=>{}),1500);
await pg.evaluate(()=>{const g=document.getElementById('splashGate');if(g)g.remove();});
const clickSeg = async (id, label) => { await pg.evaluate(([id,label])=>{const s=document.getElementById(id);if(!s)return;for(const c of s.children){if(c.textContent.trim().toUpperCase().includes(label))c.click();}},[id,label]); };
if(process.env.TRACK){await pg.evaluate(n=>window.__pgp.track(n),process.env.TRACK);await pg.waitForTimeout(3000);}
await clickSeg('tQuality', quality);
await pg.waitForTimeout(1500);
await clickSeg('tWeather', {sun:'SUNNY',driz:'DRIZZLE',rain:'RAIN',mist:'FOG',snow:'SNOW'}[wx]);
await clickSeg('tTod', tod.toUpperCase());
if (process.env.SHOT) { await pg.waitForTimeout(3000); await pg.evaluate(n=>window.__pgp.shot(n),process.env.SHOT); }
if (parseInt(cam) >= 0) {
  await pg.evaluate(()=>{window.__pgp.noDemo();document.getElementById('tStart').click();});
  await pg.waitForTimeout(500);
  await pg.waitForTimeout(4500);
  await pg.evaluate((cam)=>{window.__pgp.state.camMode=parseInt(cam);window.__pgp.keys.up=true;if(cam.split(':')[1]==='wreck')setTimeout(()=>window.__pgp.wreckOne(),4500);},cam);
  const bi=setInterval(()=>pg.evaluate(()=>window.__pgp.behind()).catch(()=>{}),300);
}
for(let i=0;i<+waitS;i++){await pg.waitForTimeout(1000);if(+cam<0){await pg.mouse.move(10+i,300);await pg.mouse.down();await pg.mouse.up();}}
await pg.screenshot({ path: `/home/user/shots/${name}.png`, timeout: 90000, animations: 'disabled' });
const info = await pg.evaluate(()=>({ probe: window.__pgp.probe(), mirrorDark: window.__pgp.mirrorPix&&window.__pgp.mirrorPix(), mode: document.querySelector('#hCam')?.textContent, ticker: document.querySelector('#titleTicker')?.textContent, tag: document.querySelector('#shotTag')?.textContent }));
console.log(JSON.stringify(info), errs.filter(e=>!/404|429|Madring|Sepang/.test(e)).slice(0,6).join('\n'));
clearInterval(ivl);try{clearInterval(bi)}catch(e){}await b.close();process.exit(0);
