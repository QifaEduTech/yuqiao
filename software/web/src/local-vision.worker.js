/* Classic worker: all inference assets are local. No recording or network frame upload. */
let hands,pose,featureConfig,recognizer,delegate='CPU',ready=false,processing=false,lastTimestamp=-1,lastSeq=0,lastAspect=null,history=[];
const base=new URL('.',self.location.href);
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
async function model(entry,root=base){const r=await fetch(new URL(entry.file,root));if(!r.ok)throw Error('asset');const bytes=await r.arrayBuffer();if(bytes.byteLength!==entry.bytes||await sha(bytes)!==entry.sha256)throw Error('checksum');return new Uint8Array(bytes);}
function validPoints(points,count){return Array.isArray(points)&&points.length===count&&points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z));}
self.onmessage=async({data})=>{
 if(data.type==='init'){
  try{
   if(ready||hands||pose)throw Error('already initialized');
   const r=await fetch(new URL('manifest.json',base));if(!r.ok)throw Error('manifest');const manifest=await r.json();if(manifest.runtimeVersion!=='1.1.1')throw Error('version');
   importScripts(new URL('vision_bundle.js',base).href);
   const configResponse=await fetch(new URL('feature-config.json',base));if(!configResponse.ok)throw Error('feature config');featureConfig=await configResponse.json();
   const featureResponse=await fetch(new URL('features.js',base));if(!featureResponse.ok)throw Error('feature code');const featureBytes=await featureResponse.arrayBuffer();if(await sha(featureBytes)!==featureConfig.featureLibrarySha256)throw Error('feature checksum');
   importScripts(new URL('features.js',base).href);
   importScripts(new URL('motion.js',base).href,new URL('recognizers.js',base).href,new URL('multi.js',base).href);
   const config=await (await fetch(new URL('recognition-config.json',base))).json(),catalog=await (await fetch(new URL('recognition-models/manifest.json',base))).json(),root=new URL('recognition-models/',base),models={};
   const {probability}=await import(new URL('tcn.js',base).href),{ThanksCNN}=await import(new URL('thanks-cnn.js',base).href);
   for(const entry of catalog.entries){const weights=await model(entry,root);if(entry.category==='thanks'){const bytes=await model({file:entry.metadata,bytes:entry.metadataBytes,sha256:entry.metadataSha256},root);const cnn=new ThanksCNN(weights.buffer,JSON.parse(new TextDecoder().decode(bytes)));models.thanks=frames=>cnn.classify(frames);}else{const buffer=weights.buffer;models[entry.category]=frames=>probability(buffer,Float32Array.from(frames.flatMap(f=>Array.from(f))).buffer,frames.length);}}
   if(!['thanks','help','need','me'].every(k=>typeof models[k]==='function'))throw Error('missing recognition model');
   const R=YuqiaoRecognizers;recognizer=new YuqiaoMulti({'谢谢':new R.Thanks(models.thanks,config),'帮助':new R.Help(models.help,config),'需要':new R.Need(models.need,config),'我':new R.Me(models.me,config)},config);
   const files=await Vision.FilesetResolver.forVisionTasks(new URL('wasm',base).href,false);
   const handEntry=manifest.models.find(m=>m.file==='hand_landmarker.task'),poseEntry=manifest.models.find(m=>m.file==='pose_landmarker_full.task');
   const handBytes=await model(handEntry),poseBytes=await model(poseEntry);
   try{const check=new OffscreenCanvas(1,1),gl=check.getContext('webgl2');if(gl){const info=gl.getExtension('WEBGL_debug_renderer_info'),renderer=info?String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)):'';if(!/swiftshader|llvmpipe|software/i.test(renderer))delegate='GPU';gl.getExtension('WEBGL_lose_context')?.loseContext();}}catch{}
   const createTrackers=async()=>{hands=await Vision.HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetBuffer:handBytes,delegate},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.7,minHandPresenceConfidence:.5,minTrackingConfidence:.5});pose=await Vision.PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetBuffer:poseBytes,delegate},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5,outputSegmentationMasks:false});};
   try{await createTrackers();}catch(error){if(delegate!=='GPU')throw error;hands?.close();pose?.close();hands=pose=null;delegate='CPU';await createTrackers();}
   ready=true;self.postMessage({type:'ready',runtime:'mediapipe-tasks-1.1.1',recognitionReady:true,trial:true,delegate});
  }catch{hands?.close();pose?.close();hands=pose=null;self.postMessage({type:'error',code:'local_tracker_start_failed'});}
  return;
 }
 if(data.type==='frame'){
  const image=data.image;
  try{
   if(!ready||processing||!Number.isSafeInteger(data.seq)||data.seq<=lastSeq||!Number.isFinite(data.timestamp)||data.timestamp<=lastTimestamp||!image||image.width>640||image.height>640)throw Error('frame');
   const delta=lastTimestamp<0?1/30:(data.timestamp-lastTimestamp)/1000;
   processing=true;lastTimestamp=data.timestamp;lastSeq=data.seq;const started=performance.now();
   const h=hands.detectForVideo(image,data.timestamp),p=pose.detectForVideo(image,data.timestamp),tracked=[];
   const observation=[];
   for(let i=0;i<Math.min(h.landmarks.length,2);i++){
    const points=h.landmarks[i],rawSide=h.handedness[i]?.[0]?.categoryName,side=featureConfig.handChannels.mapping[rawSide];if(!validPoints(points,21)||!['Left','Right'].includes(side))continue;
    tracked.push({side,points:points.map(v=>[v.x,v.y])});observation.push({side,score:h.handedness[i][0].score,points:points.map(v=>[v.x,v.y,v.z])});
   }
   let shoulders=[];const body=p.landmarks[0];if(validPoints(body,33)&&[11,12].every(i=>Number.isFinite(body[i].visibility)&&body[i].visibility>=.5))shoulders=[11,12].map(i=>[body[i].x,body[i].y]);
   const aspect=image.height/image.width,features=YuqiaoFeatures,frame153=features.training153(observation,delta),frame178=features.body178(observation,body,delta,aspect,featureConfig.meMotion,frame153),legacy=features.legacy126(observation);
   if(lastAspect!==null&&Math.abs(lastAspect-aspect)>1e-6){recognizer.clear();recognizer.pending=[];recognizer.resetDetectors();}
   if(delta>featureConfig.needWindow.resetGapSeconds||lastAspect!==null&&Math.abs(lastAspect-aspect)>1e-6)history=[];
   lastAspect=aspect;history.push({time:data.timestamp/1000,frame153,frame178,legacy});while(history.length>featureConfig.needWindow.maxSamples||history.length&&data.timestamp/1000-history[0].time>featureConfig.needWindow.maxWindowSeconds)history.shift();
   const directional=features.directional171(history.map(r=>r.frame153),history.map(r=>r.time),aspect),last=directional.at(-1);
   const meInput={frame:frame178,hands:observation.map(h=>h.points.map(p=>[p[0],p[1]*aspect,p[2]])),shoulders:body?[11,12].map(i=>[body[i].x,body[i].y*aspect,body[i].visibility]):[]};
   const recognition=recognizer.push(data.timestamp/1000,legacy,frame153,aspect,meInput);
   // Only bounded status leaves the worker; feature arrays remain ephemeral here.
   self.postMessage({type:'frame',seq:data.seq,handTracking:{width:image.width,height:image.height,mirrored:true,hands:tracked},shoulders,processingMs:performance.now()-started,recognitionReady:true,trial:true,delegate,recognition,featureSummary:{dimensions:[126,153,171,178],samples:history.length,handPresent:!!(frame153[74]||frame153[150]),bodyReference:frame178[177]===1,directionHistory:!!(last[160]||last[169])}});
  }catch{self.postMessage({type:'error',code:'local_tracker_frame_failed'});}
  finally{image?.close();processing=false;}
 }
};
