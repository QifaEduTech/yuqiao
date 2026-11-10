type NativeView={show:(animation?:string)=>void;close:()=>void;addEventListener:(name:string,callback:(event?:{url?:string})=>void)=>void;overrideUrlLoading:(options:{mode:string;match:string},callback:(event:{url:string})=>void)=>void};
type PlusRuntime={webview:{create:(url:string,id:string,styles:Record<string,unknown>)=>NativeView}};
const key='yuqiao-account-service';
export const packagedPage=()=>location.protocol==='file:';
export function accountOrigin(value:string){
 const url=new URL(value.trim());
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw Error('请输入 HTTPS 服务地址；电脑模拟器联调可用 http://127.0.0.1:5173。不要填写数据库地址。');
 return url.origin;
}
export function savedAccountOrigin(){try{return accountOrigin(localStorage.getItem(key)||'http://127.0.0.1:5173');}catch{return 'http://127.0.0.1:5173';}}
export function openNativeAccount(value:string,onError:(message:string)=>void){
 const origin=accountOrigin(value),plus=(window as unknown as {plus?:PlusRuntime}).plus;
 if(!plus)throw Error('请在HBuilderX的App运行环境中打开账号服务；浏览器预览直接使用当前网站账号。');
 localStorage.setItem(key,origin); // Connection address only. Credentials stay in the remote service's HttpOnly cookie.
 const child=plus.webview.create(origin+'/android-account.html?native=1','yuqiao-account-service',{top:'0px',bottom:'0px',bounce:'none',plusrequire:'none'});
 const pattern='^'+origin.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/.*';
 child.overrideUrlLoading({mode:'allow',match:pattern},event=>{if(event.url==='yuqiao-account://close')child.close();else onError('账号窗口只允许访问你配置的服务。');});
 child.addEventListener('loaded',()=>child.show('slide-in-right'));
 child.addEventListener('error',()=>{child.close();onError('无法打开账号服务，请检查服务地址、网络和电脑模拟器端口转发。');});
 return ()=>child.close();
}
