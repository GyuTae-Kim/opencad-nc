export function precacheable(path: string): boolean;
export function listFiles(root: string): string[];
export function precacheUrls(files: string[]): string[];
export function contentVersion(files: { name: string; content: string | Uint8Array }[]): string;
export function serviceWorkerSource(opts: { version: string; urls: string[]; recent?: { db: string; store: string; max: number; maxSize: number } }): string;
export function serviceWorker(): import('vite').Plugin;
