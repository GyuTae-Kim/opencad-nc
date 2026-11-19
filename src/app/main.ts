import { installLocalization } from './i18n';
/**
 * OpenCAD NC 뷰어 진입점: 스타일을 불러오고 #app에 앱을 세운다.
 */
import '../view/vlist.css';
import './styles.css';
import { initAnalytics } from 'opencad-site-kit/analytics';
import { OPENCAD_ANALYTICS } from 'opencad-site-kit/presets/opencad';
import { NcViewerApp } from './app';

const root = document.getElementById('app');
if (root) {
  initAnalytics(OPENCAD_ANALYTICS, 'nc');
  new NcViewerApp(root);
}

if (root) void installLocalization(root);
