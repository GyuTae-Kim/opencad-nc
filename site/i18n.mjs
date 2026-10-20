import en from './locales/en.json' with { type: 'json' };
import ja from './locales/ja.json' with { type: 'json' };
import zh from './locales/zh-CN.json' with { type: 'json' };
import de from './locales/de.json' with { type: 'json' };
import { registerCatalog } from './i18n-core.mjs';
for (const [language,content] of Object.entries({en,ja,'zh-CN':zh,de})) registerCatalog(language,content);
export * from './i18n-core.mjs';
