export type MotionStep={id:string;version:string;from:number;to:number;transition:number};
export type SequencePreview={id:string;label:string;version:string;status:'authored_unverified';kind:'sequence';steps:MotionStep[];duration:number};
export function planMotionText(input:unknown):
 |{status:'unsupported';missing:string[];reason:string}
 |{status:'single';entry:{id:string;label:string;version:string}}
 |{status:'sequence';preview:SequencePreview};
