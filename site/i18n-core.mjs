// 공용 번역기(opencad-site-kit)에 이 앱의 사이트 정보와 OpenCAD 언어 주소 규칙을 넘긴다. 사전은 site/i18n.mjs(빌드·시험)와 앱(src/app/i18n.ts)이 넣는다.
import metadata from './metadata.json' with { type: 'json' };
import { configureI18n } from 'opencad-site-kit/i18n/core';
import { OPENCAD_SITE } from 'opencad-site-kit/presets/opencad';
configureI18n({ metadata, ...OPENCAD_SITE });
export * from 'opencad-site-kit/i18n/core';
