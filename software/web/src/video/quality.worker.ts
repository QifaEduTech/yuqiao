import { measureFrame, frameWarnings } from './quality';

let previous: Float32Array | undefined;
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ rgba: ArrayBuffer; width: number; height: number }>) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = event => {
  try {
    const { rgba, width, height } = event.data;
    const result = measureFrame(new Uint8ClampedArray(rgba), width, height, previous);
    previous = result.gray;
    scope.postMessage({ metrics: result.metrics, warnings: frameWarnings(result.metrics) });
  } catch { scope.postMessage({ error: '画面分析失败，请重新处理。' }); }
};
