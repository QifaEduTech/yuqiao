export type CompletedParagraph={id:number;text:string;words:string[];wordCount:number;startMs:number;endMs:number;partial:boolean};
export type ParagraphResult={state:'empty'|'collecting'|'needs_review';text:string;words:string[];wordCount:number;final:CompletedParagraph|null};
export function formatParagraphWords(words:string[]):string;
export function validParagraph(value:unknown,labels:string[]):value is ParagraphResult;
