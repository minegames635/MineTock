import {createRemoteJWKSet,jwtVerify} from 'jose';
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const MAX=50*1024*1024;
function json(data,status=200,headers={}){return Response.json(data,{status,headers})}
async function signature(params,secret){const str=Object.keys(params).sort().map(k=>`${k}=${params[k]}`).join('&')+secret;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',new TextEncoder().encode(str)))).map(n=>n.toString(16).padStart(2,'0')).join('')}
async function cloud(env,action,params,file,resource="video"){const form=new FormData();for(const [k,v] of Object.entries(params))form.set(k,String(v));form.set('api_key',env.CLOUDINARY_API_KEY);form.set('signature',await signature(params,env.CLOUDINARY_API_SECRET));if(file)form.set('file',file);const response=await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resource}/${action}`,{method:'POST',body:form});const body=await response.json();if(!response.ok)throw Error('Хранилище не приняло файл. Проверьте формат и бесплатный лимит.');return body}
export default {async fetch(request,env){
 const origin=request.headers.get('Origin');const allowed=env.ALLOWED_ORIGINS.split(',').map(x=>x.trim());
 const cors={'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Cache-Control':'no-store'};
 if(origin&&!allowed.includes(origin))return json({error:'Недопустимый адрес сайта'},403);
 if(origin)cors['Access-Control-Allow-Origin']=origin;
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const imageUpload=new URL(request.url).pathname==='/image';const max=imageUpload?4*1024*1024:MAX;
 if(request.method!=='POST'||!['/upload','/image'].includes(new URL(request.url).pathname))return json({error:'Not found'},404,cors);
 try {
  if(!env.CLOUDINARY_API_SECRET||env.CLOUDINARY_CLOUD_NAME==='REPLACE_ME')return json({error:'Хранилище ещё не подключено'},503,cors);
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token)return json({error:'Сначала войдите'},401,cors);
  let user;try{({payload:user}=await jwtVerify(token,keys,{issuer:`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,audience:env.FIREBASE_PROJECT_ID,algorithms:['RS256']}))}catch{return json({error:'Войдите повторно'},401,cors)}
  if(!user.email_verified)return json({error:'Подтвердите электронную почту'},403,cors);
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(user.sub))return json({error:'Неверный идентификатор'},400,cors);
  const size=Number(request.headers.get('Content-Length'));if(!Number.isFinite(size)||size>max+65536)return json({error:imageUpload?'Максимум 4 МБ':'Максимум 50 МБ'},413,cors);
  const gate=env.UPLOAD_GATE.get(env.UPLOAD_GATE.idFromName(user.sub));const permit=await gate.fetch(imageUpload?'https://internal/image':'https://internal/reserve',{method:'POST'});
  if(!permit.ok)return json({error:imageUpload?'Лимит: 30 изображений в сутки':'Лимит: 3 видео в сутки'},429,cors);
  // Enforce streaming size before parsing multipart, including clients without Content-Length.
  const reader=request.body.getReader();const chunks=[];let total=0;
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max+65536){await reader.cancel();return json({error:imageUpload?'Максимум 4 МБ':'Максимум 50 МБ'},413,cors)}chunks.push(value)}
  const form=await new Response(new Blob(chunks),{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();const file=form.get('file'),id=form.get('videoId');
  if(imageUpload) {
   if(!(file instanceof File)||file.size===0||file.size>max||!['image/jpeg','image/png','image/webp'].includes(file.type)||! /^[A-Za-z0-9]{20}$/.test(id))return json({error:'Выберите JPG, PNG или WebP до 4 МБ'},400,cors);
   const publicId=`minetock_media/${user.sub}/${id}`;
   const result=await cloud(env,'upload',{public_id:publicId,timestamp:Math.floor(Date.now()/1000),overwrite:false,transformation:'c_limit,w_1024,h_1024',format:'webp'},file,'image');
   return json({url:result.secure_url,publicId:result.public_id},200,cors);
  }
  if(!(file instanceof File)||file.size>MAX||file.size===0||!['video/mp4','video/quicktime','video/webm','video/x-matroska'].includes(file.type)||! /^[A-Za-z0-9]{20}$/.test(id))return json({error:'Выберите MP4, MOV или WebM до 50 МБ'},400,cors);
  const publicId=`minetock/${user.sub}/${id}`;
  const result=await cloud(env,'upload',{public_id:publicId,timestamp:Math.floor(Date.now()/1000),overwrite:false},file);
  if(!result.duration||result.duration>180||result.bytes>MAX||!['mp4','mov','webm','mkv'].includes(result.format)){
   await cloud(env,'destroy',{public_id:publicId,timestamp:Math.floor(Date.now()/1000),invalidate:true});return json({error:'Видео должно быть короче 3 минут, до 50 МБ, в формате MP4/MOV/WebM'},400,cors)
  }
  return json({url:result.secure_url,publicId:result.public_id},200,cors);
 }catch(error){console.error('Upload failed:',error.message);return json({error:'Не удалось загрузить файл. Проверьте настройки хранилища и формат.'},500,cors)}
}};
export class UploadGate {
 constructor(ctx){this.ctx=ctx}
 async fetch(request){const imageUpload=new URL(request.url).pathname==='/image';const key=imageUpload?'images':'quota';const day=Math.floor(Date.now()/86400000);const permitted=await this.ctx.storage.transaction(async tx=>{const state=await tx.get(key);const count=state?.day===day?state.count:0;if(count>=(imageUpload?30:3))return false;await tx.put(key,{day,count:count+1});return true});return new Response(null,{status:permitted?204:429})}
}
