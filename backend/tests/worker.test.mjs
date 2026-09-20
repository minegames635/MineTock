import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{UploadGate} from '../src/index.js';
const env={ALLOWED_ORIGINS:'https://minetock-ba8dd.web.app',CLOUDINARY_CLOUD_NAME:'p68kg5lz',CLOUDINARY_API_SECRET:'test-only-not-a-real-secret',FIREBASE_PROJECT_ID:'demo-minetock'};
test('both upload endpoints reject missing authentication before reading files',async()=>{
 for(const path of ['/upload','/image']){
  const r=await worker.fetch(new Request('https://worker.example'+path,{method:'POST',headers:{Origin:'https://minetock-ba8dd.web.app'}}),env);
  assert.equal(r.status,401);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://minetock-ba8dd.web.app');
 }
});
test('CORS refuses unknown websites and preflight permits configured origin',async()=>{
 const denied=await worker.fetch(new Request('https://worker.example/image',{method:'POST',headers:{Origin:'https://evil.example'}}),env);assert.equal(denied.status,403);
 const preflight=await worker.fetch(new Request('https://worker.example/image',{method:'OPTIONS',headers:{Origin:'https://minetock-ba8dd.web.app'}}),env);assert.equal(preflight.status,204);
});
test('images have independent daily quota from videos, concurrent calls cannot exceed limits',async()=>{
 const data=new Map();let queue=Promise.resolve();const storage={transaction(fn){const next=queue.then(()=>fn({get:async key=>data.get(key),put:async(key,value)=>data.set(key,value)}));queue=next;return next}};
 const gate=new UploadGate({storage});const requests=path=>Array.from({length:35},()=>gate.fetch(new Request('https://internal'+path,{method:'POST'})));
 const images=await Promise.all(requests('/image')),videos=await Promise.all(requests('/reserve'));
 assert.equal(images.filter(r=>r.status===204).length,30);assert.equal(videos.filter(r=>r.status===204).length,3);
 const yesterday=Math.floor(Date.now()/86400000)-1;data.set('images',{day:yesterday,count:30});
 assert.equal((await gate.fetch(new Request('https://internal/image'))).status,204);
});
