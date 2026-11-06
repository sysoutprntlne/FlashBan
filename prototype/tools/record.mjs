import {chromium} from 'playwright';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),out=path.join(root,'artifacts'),raw=path.join(out,'raw');
await mkdir(raw,{recursive:true});
const base=process.env.BASE_URL||'http://127.0.0.1:8787';
const scenes=[
 ['A calmer web','FlashBan is a local-first browser protection prototype. This walkthrough shows the working demo, real measurements, and the extension. No flashing source will be revealed.','intro'],
 ['01 · Start with a clean signal','First, a calm source. FlashBan samples real pixels and covers new content while the first measurement window fills. A clean source is allowed, and monitoring continues.','calm'],
 ['02 · Measure rapid changes','Next, a synthetic rapid-change source. It stays covered. The shared detector counts opposing luminance transitions, then stops the source behind a static shield. These numbers come from the sampled pixels.','flash'],
 ['03 · Choose the sensitivity','Standard sensitivity waits for more than three completed general flashes in the last second. This is a general-flash prototype, not a certification of compliance or safety.','standard'],
 ['04 · Fail closed','Unreadable media is guarded too. This scene triggers a real cross-origin canvas restriction in the browser. FlashBan does not pretend to have measured pixels it cannot read.','unreadable'],
 ['05 · Respect reduced motion','Reduced-motion preferences disable visual tests. A measurements-only replay runs the detector on an off-screen source. The result stays readable without displaying the test pattern.','replay'],
 ['06 · Keep the history local','Each decision appears in this tab’s session history. There are no accounts, uploads, or analytics. The interface explains what was measured and what remains outside the prototype.','history'],
 ['07 · Install the browser extension','The fork also includes an unpacked Chrome extension using the same detector. Load the extension folder in Chrome developer mode. It covers new sources, samples them, and keeps a local event log.','install'],
 ['08 · The installed shield','This is captured evidence from the actual unpacked extension in Chromium. The extension detected the canvas source and covered it. Separate tests also verified CSS animation, generated video, and the local popup log.','extension'],
 ['Built to be tested','The prototype has repeatable unit and browser tests. Red flashes, animated-image decoding, adversarial hardening, and guaranteed protection remain out of scope. This is an engineering prototype, not a medical device.','limits']
];
let total=0;const timings=[];
for(let i=0;i<scenes.length;i++){const audio=path.join(raw,`${i}.aiff`);if(!existsSync(audio))execFileSync('say',['-r','160','-o',audio,scenes[i][1]]);const n=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',audio],{encoding:'utf8'}).trim());const duration=Math.max(n+.8,7);timings.push({start:total,duration,audio,title:scenes[i][0],text:scenes[i][1]});total+=duration}
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:raw,size:{width:1440,height:1000}}});const page=await context.newPage();await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#run').disabled);
const started=Date.now();
for(let i=0;i<scenes.length;i++){
 const [, ,action]=scenes[i],t=timings[i];
 const choose=async value=>page.locator(`input[value="${value}"]`).check();
 if(action==='calm'){await page.locator('.workspace').evaluate(el=>el.scrollIntoView({block:'start'}));await choose('calm');await page.locator('#run').click()}
 if(action==='flash'){await choose('flash');await page.locator('#run').click()}
 if(action==='standard'){await page.locator('#preset').selectOption('standard');await page.locator('#run').click()}
 if(action==='unreadable'){await choose('unreadable');await page.locator('#run').click()}
 if(action==='replay'){await page.emulateMedia({reducedMotion:'reduce'});await choose('flash');await page.locator('#replay').click()}
 if(action==='history'){await page.locator('.lower-grid').evaluate(el=>el.scrollIntoView({block:'start'}))}
 if(action==='install'){await page.goto(base+'/studio/install.html')}
 if(action==='extension'){await page.locator('#extension-evidence').scrollIntoViewIfNeeded()}
 if(action==='limits'){await page.getByRole('heading',{name:'Known boundaries'}).scrollIntoViewIfNeeded()}
 await page.evaluate(({title,text})=>{let b=document.getElementById('walkthrough-caption');if(!b){b=document.createElement('div');b.id='walkthrough-caption';document.body.append(b)}b.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:999999;background:#102f2ff5;color:#fff;padding:16px 24px;border:1px solid #91b99a;border-radius:10px;width:82%;font:17px/1.5 Arial;box-shadow:0 8px 25px #0002;pointer-events:none';b.replaceChildren();const h=document.createElement('strong'),p=document.createElement('div');h.textContent=title;h.style.cssText='font-size:12px;color:#bce5b8;letter-spacing:1px;display:block;margin-bottom:5px';p.textContent=text;b.append(h,p)},t);
 await page.waitForTimeout(Math.max(0,(t.start+t.duration)*1000-(Date.now()-started)));
}
const video=page.video();await context.close();await browser.close();const source=await video.path();
const padded=[];for(let i=0;i<timings.length;i++){const wav=path.join(raw,`${i}.wav`);execFileSync('ffmpeg',['-y','-loglevel','error','-i',timings[i].audio,'-af','apad','-t',String(timings[i].duration),'-ar','48000','-ac','1',wav]);padded.push(`file '${wav}'`)}await writeFile(path.join(raw,'audio.txt'),padded.join('\n'));
execFileSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',path.join(raw,'audio.txt'),'-c:a','pcm_s16le',path.join(raw,'narration.wav')]);
execFileSync('ffmpeg',['-y','-loglevel','error','-i',source,'-i',path.join(raw,'narration.wav'),'-c:v','libx264','-preset','medium','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-t',String(total),'-movflags','+faststart',path.join(out,'flashban-walkthrough.mp4')]);
const ts=n=>new Date(Math.round(n*1000)).toISOString().slice(11,23);
await writeFile(path.join(out,'flashban-walkthrough.vtt'),'WEBVTT\n\n'+timings.map(t=>`${ts(t.start)} --> ${ts(t.start+t.duration)}\n${t.title}\n${t.text}\n`).join('\n'));
await writeFile(path.join(out,'transcript.md'),'# FlashBan walkthrough\n\n'+timings.map(t=>`## ${t.title}\n\n${t.text}`).join('\n\n'));
console.log(`Walkthrough produced: ${Math.round(total)} seconds, narrated and captioned.`);
