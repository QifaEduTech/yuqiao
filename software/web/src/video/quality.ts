export interface QualityMetrics {
  brightness: number;
  darkFraction: number;
  brightFraction: number;
  laplacianVariance: number;
  frameDifference: number | null;
}

/** Diagnostic thresholds at <=320px long edge, not calibrated sign-recognition gates. */
export const QUALITY_THRESHOLDS = { darkMean: 45, brightMean: 215, extremeFraction: 0.6, lowDetailVariance: 50, lowChange: 1 };

export function measureFrame(rgba: Uint8ClampedArray, width: number, height: number, previous?: Float32Array): { metrics: QualityMetrics; gray: Float32Array } {
  if (width < 3 || height < 3 || rgba.length !== width * height * 4) throw new Error('Invalid image dimensions');
  const gray = new Float32Array(width * height);
  let sum = 0, dark = 0, bright = 0, difference = 0;
  const compare = previous?.length === gray.length;
  for (let i = 0; i < gray.length; i++) {
    const value = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    gray[i] = value; sum += value;
    if (value < 30) dark++;
    if (value > 225) bright++;
    if (compare) difference += Math.abs(value - previous![i]);
  }
  let edgeSum = 0, edgeSquares = 0, count = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    const laplacian = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
    edgeSum += laplacian; edgeSquares += laplacian * laplacian; count++;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { gray, metrics: { brightness: round(sum / gray.length), darkFraction: round(dark / gray.length), brightFraction: round(bright / gray.length), laplacianVariance: round(Math.max(0, edgeSquares / count - (edgeSum / count) ** 2)), frameDifference: compare ? round(difference / gray.length) : null } };
}

export function frameWarnings(metrics: QualityMetrics): string[] {
  const warnings: string[] = [];
  if (metrics.brightness < QUALITY_THRESHOLDS.darkMean || metrics.darkFraction > QUALITY_THRESHOLDS.extremeFraction) warnings.push('画面偏暗');
  if (metrics.brightness > QUALITY_THRESHOLDS.brightMean || metrics.brightFraction > QUALITY_THRESHOLDS.extremeFraction) warnings.push('画面偏亮');
  if (metrics.laplacianVariance < QUALITY_THRESHOLDS.lowDetailVariance) warnings.push('纹理较少或可能模糊');
  return warnings;
}
