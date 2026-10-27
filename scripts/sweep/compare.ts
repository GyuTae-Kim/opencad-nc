/**
 * 두 훑기 결과 비교: npm run sweep:compare -- <전 결과 폴더> <후 결과 폴더> [--top N] [--json <파일>] [--fail-on-change]
 * 같은 내용 해시끼리 분류(ok·warn·empty·error)·지표·경고 코드를 견준다. --fail-on-change면 바뀐 것이 있을 때 1로 끝난다(core.ts compareMain).
 */
import { compareMain } from './core';

process.exit(compareMain(process.argv.slice(2)));
