export interface Language { code: string; label: string; locale: string; }
export const languages: Language[];
export const catalogs: Record<string, Record<string,string>>;
export function translate(value: string, language?: string): string;
export function currentLanguage(url: string): string;
export function languageUrl(url: string, language?: string): string;
export function metadataForLanguage(language?: string): any;
export function registerCatalog(language: string, content: Record<string,string>): void;
export function sourceMessage(value: string): string;
