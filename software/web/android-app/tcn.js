function erf(x){const sign=x<0?-1:1;x=Math.abs(x);const t=1/(1+.3275911*x);return sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x));}
export function probability(bytes,features,frames){
 const view=new DataView(bytes);if(new TextDecoder().decode(new Uint8Array(bytes,0,8))!=='YQTCN001')throw Error('模型格式错误');
 const dim=view.getInt32(8,true);if(![153,171,178].includes(dim)||frames<2||frames>384||features.byteLength!==frames*dim*4)throw Error('特征协议不匹配');
 let offset=12;const read=n=>{const a=new Float32Array(n);for(let i=0;i<n;i++){a[i]=view.getFloat32(offset,true);offset+=4;if(!Number.isFinite(a[i]))throw Error('无效模型参数');}return a;};
 const mean=read(dim),std=read(dim),w1=read(32*dim*3),b1=read(32),w2=read(32*32*3),b2=read(32),head=read(64),bias=read(1);
 if(offset!==bytes.byteLength||std.some(x=>x<.00999))throw Error('模型参数检查失败');
 const source=new DataView(features),x=new Float32Array(frames*dim);for(let i=0;i<x.length;i++){const value=source.getFloat32(i*4,true);if(!Number.isFinite(value))throw Error('特征值无效');x[i]=Math.fround(value-mean[i%dim])/std[i%dim];}
 function conv(input,channels,weight,base,dilation){const out=new Float32Array(frames*32);for(let t=0;t<frames;t++)for(let o=0;o<32;o++){let y=base[o];for(let k=0;k<3;k++){const index=t+(k-1)*dilation;if(index<0||index>=frames)continue;let sum=0;for(let i=0;i<channels;i++)sum=Math.fround(sum+Math.fround(input[index*channels+i]*weight[(o*channels+i)*3+k]));y=Math.fround(y+sum);}out[t*32+o]=.5*y*(1+erf(y/Math.sqrt(2)));}return out;}
 const h=conv(conv(x,dim,w1,b1,1),32,w2,b2,2);let logit=bias[0];for(let c=0;c<32;c++){let sum=0,max=-Infinity;for(let t=0;t<frames;t++){sum=Math.fround(sum+h[t*32+c]);max=Math.max(max,h[t*32+c]);}logit+=Math.fround(sum/frames)*head[c]+max*head[32+c];}return logit>=0?1/(1+Math.exp(-logit)):Math.exp(logit)/(1+Math.exp(logit));
}
