import type {FixedMotionAsset} from '../web/src/fixedAnnyMotion';
import type {MotionStep} from './motion-planner.mjs';
export function composeFixedMotion(definition:{id:string;label:string;version:string;basis:string;steps:MotionStep[]},sources:Map<string,FixedMotionAsset>):FixedMotionAsset;
