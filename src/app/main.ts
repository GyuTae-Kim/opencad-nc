/**
 * OpenCAD NC 뷰어 진입점: 스타일을 불러오고 #app에 앱을 세운다.
 */
import '../view/vlist.css';
import './styles.css';
import { NcViewerApp } from './app';

const root = document.getElementById('app');
if (root) new NcViewerApp(root);
