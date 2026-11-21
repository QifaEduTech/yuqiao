import type {CompletedParagraph} from './realtime-paragraph.mjs';
export type OrganizedChinese={version:string;sourceWords:string[];sourceText:string;text:string;status:'ready'|'needs_review';reason:string;inferredWords?:string[];clauses:{ruleId:string;text:string;sourceIndices:number[];inserted:string[];question:boolean}[]};
export type OrganizedParagraph=CompletedParagraph&{chinese:OrganizedChinese};
export function organizeRecognizedWords(words:unknown,options?:{partial?:boolean}):OrganizedChinese;
export function organizeUtterance(words:unknown,options?:{partial?:boolean}):OrganizedChinese;
export function organizeCompletedParagraph(paragraph:CompletedParagraph):OrganizedParagraph;
