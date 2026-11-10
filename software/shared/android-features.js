/* Portable feature math. Input coordinates already use the mirrored image.
 * No labels, imputed points, recordings, networking or persistent storage.
 */
((scope)=>{
 const F=Math.fround,clip=(x,a,b)=>Math.max(a,Math.min(b,x));
 const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.sqrt(dot(a,a));
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const cross32=(a,b)=>[F(F(a[1]*b[2])-F(a[2]*b[1])),F(F(a[2]*b[0])-F(a[0]*b[2])),F(F(a[0]*b[1])-F(a[1]*b[0]))];
 const validHand=h=>h&&['Left','Right'].includes(h.side)&&Number.isFinite(h.score)&&Array.isArray(h.points)&&h.points.length===21&&h.points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));
 function chosen(hands){const out={};for(const h of hands??[])if(validHand(h)&&(!out[h.side]||h.score>out[h.side].score))out[h.side]=h;return out;}
 function angle(a,b,c,epsilon=1e-8){const u=sub(a,b),v=sub(c,b),d=norm(u)*norm(v);return d<epsilon?null:Math.acos(clip(dot(u,v)/d,-1,1))*180/Math.PI;}
 function bend(a,b,c){const a0=angle(a,b,c,1e-10);return a0===null?null:180-a0;}
 function normalize(points){const raw=points.map(p=>p.map(F)),local=raw.map(p=>p.map((v,i)=>F(v-raw[0][i]))),scale=Math.max(...local.flat().map(Math.abs));if(scale>0)for(const p of local)for(let i=0;i<3;i++)p[i]=F(p[i]/scale);return {raw,local,scale};}
 function legacy126(hands){
  const out=new Float32Array(126);for(const h of hands??[])if(validHand(h)){const {local}=normalize(h.points);out.set(local.flat(),h.side==='Left'?0:63);}return out.some(v=>v!==0)?out:null;
 }
 function training153(hands,delta){
  if(!Number.isFinite(delta)||delta<0)throw Error('invalid_frame_delta');
  const out=new Float32Array(153),selected=chosen(hands);
  for(const [side,name] of ['Left','Right'].entries()){
   const hand=selected[name];if(!hand)continue;const {raw,local:h,scale}=normalize(hand.points),offset=side*76;if(scale<=1e-8)continue;
   out.set(h.flat(),offset);out[offset+63]=raw[0][0];out[offset+64]=raw[0][1];out[offset+65]=scale;
   const a=sub(raw[5],raw[0]).map(F),b=sub(raw[17],raw[0]).map(F),n=cross32(a,b),size=F(Math.sqrt(F(F(F(n[0]*n[0])+F(n[1]*n[1]))+F(n[2]*n[2]))));
   if(size>1e-8)out.set(n.map(v=>F(v/size)),offset+66);
   const bends=[bend(h[0],h[1],h[2]),bend(h[1],h[2],h[3]),bend(h[2],h[3],h[4]),bend(h[9],h[0],h[0].map((v,i)=>v+h[4][i]-h[2][i]))];
   if(bends.every(v=>v!==null))out.set(bends.map(v=>v/180),offset+69);
   const palm=(norm(sub(h[5],h[0]))+norm(sub(h[9],h[0]))+norm(sub(h[17],h[0])))/3,span=norm(sub(h[4],h[2]));if(palm>=1e-8&&span>=1e-8)out[offset+73]=Math.min(span/palm,4)/4;
   out[offset+74]=1;out[offset+75]=clip(hand.score,0,1);
  }
  out[152]=Math.min(delta,1)*30;return out;
 }
 function body178(hands,pose,delta,aspect,rules,base=training153(hands,delta)){
  if(!Number.isFinite(aspect)||aspect<=0)throw Error('invalid_aspect');
  const out=new Float32Array(178);out.set(base);
  if(!pose||pose.length!==33)return out;
  const shoulders=[11,12].map(i=>[pose[i].x,pose[i].y*aspect,pose[i].visibility]);
  if(!shoulders.flat().every(Number.isFinite)||Math.min(shoulders[0][2],shoulders[1][2])<rules.minShoulderVisibility)return out;
  const center=[(shoulders[0][0]+shoulders[1][0])/2,(shoulders[0][1]+shoulders[1][1])/2],span=norm(sub(shoulders[0].slice(0,2),shoulders[1].slice(0,2)));if(span<rules.minShoulderSpan)return out;
  out[177]=1;const selected=chosen(hands);
  for(const [side,name] of ['Left','Right'].entries()){
   if(!selected[name])continue;const h=selected[name].points.map(p=>[p[0],p[1]*aspect,p[2]]),angles=[5,9,13,17].map(i=>angle(h[i],h[i+1],h[i+3]));if(angles.some(a=>a===null))continue;
   const direction=sub(h[8].slice(0,2),h[5].slice(0,2)),target=sub(center,h[5].slice(0,2)),cos=dot(direction,target)/Math.max(norm(direction)*norm(target),1e-8);
   out.set([...sub(h[0].slice(0,2),center).map(v=>clip(v/span,-4,4)),...sub(h[8].slice(0,2),center).map(v=>clip(v/span,-4,4)),...angles.map(a=>a/180),clip(cos,-1,1),Math.min(norm(sub(h[8].slice(0,2),center))/span,4)/4,Math.min(norm(sub(h[9].slice(0,2),h[0].slice(0,2)))/span,2)/2,1],153+side*12);
  }return out;
 }
 function directional171(frames,times,aspect){
  if(!Array.isArray(frames)||frames.length!==times.length||!Number.isFinite(aspect)||aspect<.1||aspect>10||times.some((t,i)=>!Number.isFinite(t)||(i>0&&t<=times[i-1])))throw Error('invalid_directional_input');
  const input=frames.map(f=>{if(f.length!==153||!Array.from(f).every(Number.isFinite))throw Error('invalid_directional_input');return Float32Array.from(f);}),result=input.map(f=>{const a=new Float32Array(171);a.set(f);return a;});
  for(const [side,sign] of [[0,-1],[1,1]]){
   let history=[],origin=null;
   for(let i=0;i<input.length;i++){
    const f=input[i],t=times[i],offset=side*76;if(f[offset+74]<=0||f[offset+65]<=1e-8){history=[];origin=null;continue;}
    const h=Array.from({length:21},(_,j)=>[f[offset+j*3]*f[offset+65],f[offset+j*3+1]*f[offset+65]*aspect,f[offset+j*3+2]*f[offset+65]]),width=norm(sub(h[5].slice(0,2),h[17].slice(0,2))),wrist=[f[offset+63],f[offset+64]*aspect];
    if(width<1e-6){history=[];origin=null;continue;}if(history.length&&t-history.at(-1).t>.2){history=[];origin=null;}
    const normal=cross(h[5],h[17]),length=Math.max(norm(normal),1e-8);if(origin===null)origin=width;
    const a=result[i],start=153+side*9;a[start]=width;a[start+1]=sign*normal[1]/length;a[start+2]=clip(Math.log(width/origin),-3,3);
    for(const [lag,index] of [[.2,3],[.5,4]]){
     const prior=history.filter(r=>t-r.t>=lag).at(-1);if(!prior)continue;a[start+index]=clip(Math.log(width/prior.width),-3,3);a[start+index+4]=1;if(index===3)a.set(sub(wrist,prior.wrist).map(v=>clip(v/prior.width,-5,5)),start+5);
    }
    history.push({t,width,wrist});history=history.filter(r=>t-r.t<=.75);
   }
  }return result;
 }
 scope.YuqiaoFeatures={legacy126,training153,body178,directional171};
})(globalThis);
