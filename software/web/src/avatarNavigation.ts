import {MOUSE,TOUCH,type Vector3} from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';

/** Same navigation contract on the homepage and the standalone preview. */
export function configureAvatarNavigation(controls:OrbitControls){
  controls.enableRotate=true;controls.enablePan=true;controls.enableZoom=true;
  controls.enableDamping=true;controls.dampingFactor=.12;
  controls.screenSpacePanning=true;
  controls.minAzimuthAngle=-Infinity;controls.maxAzimuthAngle=Infinity;
  controls.minPolarAngle=.01;controls.maxPolarAngle=Math.PI-.01;
  controls.minDistance=.08;controls.maxDistance=12;
  controls.mouseButtons={LEFT:MOUSE.ROTATE,MIDDLE:MOUSE.DOLLY,RIGHT:MOUSE.PAN};
  controls.touches={ONE:TOUCH.ROTATE,TWO:TOUCH.DOLLY_PAN};
}

/** Drain pending damping before a deliberate reset/shortcut, so an old drag
 * cannot pull the camera away again immediately after repositioning it. */
export function positionAvatarView(controls:OrbitControls,position:Vector3,target:Vector3){
  const damping=controls.enableDamping;
  controls.enableDamping=false;controls.update();
  controls.object.position.copy(position);controls.target.copy(target);
  controls.object.lookAt(target);controls.update();
  controls.enableDamping=damping;
}
