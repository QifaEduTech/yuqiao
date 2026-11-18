import type {SequencePreview} from './motion-planner.mjs';
type Preview={id:string;label:string;version:string;status:'authored_unverified';kind?:'fixed'}|SequencePreview;
export type HospitalSceneLine={role:string;text:string;signText:string;motionIds:string[];coverageNote?:string;preview:Preview;duration:number};
export function planHospitalScene():HospitalSceneLine[];
export function hospitalScenePlaylist(id:string):Preview[];
