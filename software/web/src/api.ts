export interface User { id: string; username: string }
export interface SavedRecord { id: string; kind: 'text' | 'video'; text: string; mime: string | null; byte_length: number; duration: number | null; created_at: number }
export interface PracticeAttempt {
  id:string;recordId:string;status:'candidate'|'uncertain'|'unsupported'|'no_hands';candidateId:string|null;candidate:string|null;
  snapshot:{modelId:string;modelVersion:string;modelSha256:string;featureId:string;dictionaryVersion:string;dictionaryHash:string;motionVersion:string|null;pipelineId?:string;pipelineSha256?:string;pipelineModels?:{modelId:string;modelVersion:string;modelSha256:string;featureId:string;signId:string;text:string}[]};
  feedback:'agree'|'disagree'|'uncertain'|null;correction:string;revision:number;createdAt:number;updatedAt:number;
}
export const practiceChangedEvent='yuqiao-practice-changed';
export function notifyPracticeChanged(recordId:string){window.dispatchEvent(new CustomEvent(practiceChangedEvent,{detail:{recordId}}));}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Yuqiao-Request', '1');
  if (typeof options.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new ApiError('暂时无法连接服务，请稍后重试。', 0); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || '服务暂时不可用，请稍后重试。', response.status);
  return body;
}
