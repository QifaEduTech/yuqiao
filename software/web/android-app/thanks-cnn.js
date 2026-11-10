/** Exact graph subset exported from the pinned TFLite classifier; no learned changes. */
export class ThanksCNN {
 constructor(bytes,metadata){
  if(new TextDecoder().decode(new Uint8Array(bytes,0,8))!=='YQTHX001'||bytes.byteLength!==8+metadata.floatCount*4)throw Error('Invalid thanks CNN artifact');
  this.meta=metadata;const view=new DataView(bytes);this.weights=new Float32Array(metadata.floatCount);for(let i=0;i<this.weights.length;i++){const v=view.getFloat32(8+i*4,true);if(!Number.isFinite(v))throw Error('Invalid thanks weights');this.weights[i]=v;}
 }
 classify(frames){
  if(frames.length!==30||frames.some(f=>f.length!==126||Array.from(f).some(v=>!Number.isFinite(v))))throw Error('Invalid thanks features');
  let length=30,channels=126,x=Float32Array.from(frames.flatMap(f=>Array.from(f)));const F=Math.fround,w=this.weights;
  for(const layer of this.meta.layers){
   if(layer.kind==='conv'){
    const output=layer.weights.shape[0];if(layer.weights.shape[3]!==channels)throw Error('Conv dimensions');const y=new Float32Array(length*output);
    for(let t=0;t<length;t++)for(let o=0;o<output;o++){let sum=0;for(let k=0;k<3;k++){const index=t+k-1;if(index<0||index>=length)continue;const offset=layer.weights.offset+(o*3+k)*channels;for(let c=0;c<channels;c++)sum=F(sum+F(x[index*channels+c]*w[offset+c]));}y[t*output+o]=Math.max(0,F(sum+w[layer.bias.offset+o]));}x=y;channels=output;
   }else if(layer.kind==='pool'){const next=Math.floor(length/2),y=new Float32Array(next*channels);for(let t=0;t<next;t++)for(let c=0;c<channels;c++)y[t*channels+c]=Math.max(x[t*2*channels+c],x[(t*2+1)*channels+c]);x=y;length=next;
   }else if(layer.kind==='mean'){const y=new Float32Array(channels);for(let c=0;c<channels;c++){let sum=0;for(let t=0;t<length;t++)sum=F(sum+x[t*channels+c]);y[c]=sum/length;}x=y;length=1;
   }else if(layer.kind==='dense'){const output=layer.weights.shape[0],y=new Float32Array(output);for(let o=0;o<output;o++){let sum=0;for(let c=0;c<channels;c++)sum=F(sum+F(x[c]*w[layer.weights.offset+o*channels+c]));sum=F(sum+w[layer.bias.offset+o]);y[o]=layer.relu?Math.max(0,sum):sum;}x=y;channels=output;
   }else if(layer.kind==='softmax'){const max=Math.max(...x),exp=Array.from(x,v=>Math.exp(v-max)),sum=exp.reduce((a,b)=>a+b,0);x=Float32Array.from(exp,v=>v/sum);}
   else throw Error('Unsupported CNN layer');
  }return Array.from(x);
 }
}
