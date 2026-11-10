import {useState} from 'react';
import {UserRound} from 'lucide-react';

export default function UserAvatar({src,size=21}:{src:string|null;size?:number}){
 const [failed,setFailed]=useState<string|null>(null);
 return <span className="user-avatar" data-avatar={src&&src!==failed?'custom':'default'}>{src&&src!==failed?<img src={src} alt="账号头像" onError={()=>setFailed(src)}/>:<UserRound size={size} aria-hidden="true"/>}</span>;
}
