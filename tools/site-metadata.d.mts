export function renderMetadata(language?: string): string;
export function sitemapXml(): string;
export function manifestPath(language?: string): string;
export function fileHandling(extensions: readonly string[]): Record<string, unknown>;
export function manifestFor(language?: string, extensions?: readonly string[] | null): Record<string, unknown>;
