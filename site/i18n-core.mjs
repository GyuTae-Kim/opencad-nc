// 공용 번역기(opencad-site-kit)에 이 앱의 사이트 정보를 넘긴다. 사전은 site/i18n.mjs(빌드·시험)와 앱(src/app/i18n.ts)이 넣는다.
import metadata from './metadata.json' with { type: 'json' };
import { configureI18n } from 'opencad-site-kit/i18n/core';
configureI18n({ metadata });
export * from 'opencad-site-kit/i18n/core';
