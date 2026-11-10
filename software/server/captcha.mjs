import {randomBytes,randomInt,createHash,timingSafeEqual} from 'node:crypto';
import {deflateSync} from 'node:zlib';

const letters='ABCDEFGHJKMNPQRSTUVWXYZ',digits='23456789';
const glyphs={
 A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01110'],H:['10001','10001','10001','11111','10001','10001','10001'],J:['00111','00010','00010','00010','10010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','11001','10101','10011','10011','10001'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','11011','10001'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],'4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','10000','11110','00001','00001','11110'],'6':['01110','10000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110']
};
export function generateCaptchaCode(){
 const alphabet=letters+digits,code=[letters[randomInt(letters.length)],digits[randomInt(digits.length)]];
 for(let i=0;i<3;i++)code.push(alphabet[randomInt(alphabet.length)]);
 for(let i=code.length-1;i>0;i--){const j=randomInt(i+1);[code[i],code[j]]=[code[j],code[i]];}return code.join('');
}
function crc32(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);name.copy(result,4);data.copy(result,8);result.writeUInt32BE(crc32(Buffer.concat([name,data])),8+data.length);return result;}
export function renderCaptcha(code){
 const width=180,height=60,pixels=Buffer.alloc(width*height*3);
 const paint=(x,y,color)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&x<width&&y>=0&&y<height)for(let k=0;k<3;k++)pixels[(y*width+x)*3+k]=color[k];};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)paint(x,y,[238+randomInt(12),245+randomInt(8),239+randomInt(12)]);
 for(let i=0;i<5;i++){const y=randomInt(8,52),phase=randomInt(100);for(let x=0;x<width;x++)paint(x,y+5*Math.sin((x+phase)/19),[155,190,179]);}
 for(let i=0;i<100;i++)paint(randomInt(width),randomInt(height),[143,177,165]);
 [...code].forEach((c,index)=>{const font=glyphs[c];if(!font)throw Error('Unsupported CAPTCHA glyph');const ox=14+index*32,oy=randomInt(12,20),shear=(randomInt(9)-4)/15,color=[randomInt(20,60),randomInt(75,120),randomInt(65,105)];
  for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(font[row][col]==='1')for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++)paint(ox+col*4+dx+(row*4+dy-14)*shear,oy+row*4+dy,color);
 });
 const scan=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)pixels.copy(scan,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
const hash=s=>createHash('sha256').update(s).digest();
export class CaptchaStore{
 constructor({now=Date.now,makeCode=generateCaptchaCode,ttlMs=300000,maxEntries=1000,rateLimit=60}={}){this.now=now;this.makeCode=makeCode;this.ttlMs=ttlMs;this.maxEntries=maxEntries;this.rateLimit=rateLimit;this.entries=new Map();this.rates=new Map();}
 issue(client,previousId){
  const now=this.now();for(const [id,e]of this.entries)if(e.expiresAt<=now)this.entries.delete(id);for(const [id,e]of this.rates)if(e.until<=now)this.rates.delete(id);
  const rate=this.rates.get(client)||{count:0,until:now+60000};
  if(rate.count>=this.rateLimit||(!this.rates.has(client)&&this.rates.size>=this.maxEntries)||(this.entries.size>=this.maxEntries&&!this.entries.has(previousId)))throw Object.assign(Error('验证码请求较多，请稍后再试。'),{status:429});
  rate.count++;this.rates.set(client,rate);if(previousId)this.entries.delete(previousId);
  const code=this.makeCode(),id=randomBytes(24).toString('hex'),expiresAt=now+this.ttlMs;
  if(!/^[A-Z0-9]{5}$/.test(code)||!/[A-Z]/.test(code)||!/[0-9]/.test(code))throw Error('Invalid CAPTCHA generator');
  const image='data:image/png;base64,'+renderCaptcha(code).toString('base64');this.entries.set(id,{digest:hash(code),expiresAt});
  return {id,image,expiresAt};
 }
 consume(id,answer,browserId){
  if(typeof id!=='string'||id!==browserId)return false;
  const entry=this.entries.get(id);this.entries.delete(id);
  if(!entry||entry.expiresAt<=this.now()||typeof answer!=='string'||!/^[a-zA-Z0-9]{5}$/.test(answer.trim()))return false;
  return timingSafeEqual(entry.digest,hash(answer.trim().toUpperCase()));
 }
 close(){this.entries.clear();this.rates.clear();}
}
