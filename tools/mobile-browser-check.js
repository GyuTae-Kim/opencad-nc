async (page) => {
  const origin = new URL('./', page.url()).href;
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const ready = () => page.waitForFunction(() => window.opencadApp?.state.ready, undefined, {timeout:30000});
  const parsed = (name) => page.waitForFunction((n) => { const s = window.opencadApp?.state; return s?.parsed && (!n || s.docName === n); }, name, {timeout:30000});
  const fresh = async (query='') => { await page.goto(origin+query); await ready(); };
  // The workflow opened tools/mobile-part.nc through the native file picker before this script.
  await parsed('mobile-part.nc');
  assert(await page.evaluate(() => opencadApp.state.moves > 0 && !opencadApp.state.error), 'File picker opened the G-code program');
  assert(await page.getByRole('main').count() === 1, 'Viewer workspace has main landmark');
  assert(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY === 'none'), 'Dragging bars cannot pull-to-refresh the open program');
  const visibleTools = async () => page.evaluate(() => [...document.querySelectorAll('.toolbar .tbtn')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return { name: b.getAttribute('aria-label'), w: r.width, h: r.height }; }));
  const tools = await visibleTools();
  assert(JSON.stringify(tools.map(t => t.name)) === JSON.stringify(['전체 보기','표준 뷰','보기 설정','단면','측정','재생','패널']), 'Phone toolbar keeps one row of view, measure and playback buttons: ' + tools.map(t => t.name).join(','));
  assert(tools.every(t => t.w >= 38 && t.h >= 38), 'Toolbar buttons have 38x38 touch targets');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow with a program open');
  // Two-point measure: arc centre and the midpoint on the arc (not on the chord) of G3 X60 Y20 I0 J20 from X40 Y0
  await page.getByRole('button',{name:'측정',exact:true}).click();
  await page.locator('.measure-bar .mb-hint').waitFor();
  assert(await page.evaluate(() => opencadApp.state.measuring && opencadApp.viewer.measureSnap?.points.length === 1), 'Measuring snaps to the arc centre the parser knows');
  await page.evaluate(() => { opencadApp.viewer.setView('top', false); opencadApp.viewer.fit(false); });
  await page.waitForTimeout(300);
  const canvas = await page.locator('.view canvas').first().boundingBox();
  const at = (p) => page.evaluate((q) => { const s = opencadApp.viewer.project(q); return [s.x, s.y]; }, p);
  const centre = await at([40, 20, -1]);
  const mid = await at([40 + 20 * Math.SQRT1_2, 20 - 20 * Math.SQRT1_2, -1]);
  await page.touchscreen.tap(canvas.x + centre[0] + 4, canvas.y + centre[1] + 3);
  await page.waitForTimeout(500);
  await page.touchscreen.tap(canvas.x + mid[0] + 4, canvas.y + mid[1] + 3);
  await page.locator('.measure-bar .mb-value').waitFor();
  assert(await page.locator('.measure-bar .mb-value').textContent() === '20 mm', 'Centre to arc midpoint measures the radius');
  assert(await page.locator('.measure-bar .mb-snap').textContent() === '중심 → 가운데 점', 'Measure bar names both snapped points');
  assert(await page.evaluate(() => [...document.querySelectorAll('.measure-bar .mb-btn')].every(b => { const r = b.getBoundingClientRect(); return r.width >= 38 && r.height >= 38; })), 'Measure bar buttons have 38x38 touch targets');
  await page.screenshot({path:'.runtime/performance/measure-mobile.png'});
  await page.getByRole('button',{name:'측정 끝내기',exact:true}).click();
  assert(await page.evaluate(() => !opencadApp.state.measuring && document.querySelector('.measure-bar').hidden), 'Measure bar ends measuring without a keyboard');
  await page.getByRole('button',{name:'패널',exact:true}).click();
  assert(await page.evaluate(() => opencadApp.state.panelOpen && document.documentElement.scrollWidth <= innerWidth), 'Panel sheet opens without horizontal overflow');
  await page.screenshot({path:'.runtime/performance/panel-mobile.png'});
  await fresh();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Start screen has no horizontal overflow');
  assert(await page.locator('.start .dz-title.coarse-only').isVisible() && await page.locator('.start .dz-title.fine-only').isHidden(), 'Phone start screen asks to pick files instead of dropping them');
  assert(await page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    const manifest = await (await fetch(link.href)).json();
    const icons = await Promise.all([...manifest.icons.map(icon => new URL(icon.src, link.href)), document.querySelector('link[rel=apple-touch-icon]').href].map(url => fetch(url).then(r => r.ok && r.headers.get('content-type') === 'image/png')));
    return manifest.display === 'standalone' && icons.every(Boolean);
  }), 'Home-screen manifest and icons load');
  await page.screenshot({path:'.runtime/performance/start-mobile.png'});
  await page.locator('.recent-item').filter({hasText:'mobile-part.nc'}).locator('.recent-open').click();
  await parsed('mobile-part.nc');
  assert(await page.evaluate(() => opencadApp.state.moves > 0), 'IndexedDB recent file reopened');
  await page.goto(origin+'?sample'); await ready(); await parsed('opencad-sample.nc');
  assert(await page.evaluate(() => opencadApp.state.tools === 3 && opencadApp.state.moves > 0), 'URL sample launch preserved');
  await page.goto(origin+'en/?sample'); await ready(); await parsed('opencad-sample.nc');
  assert(await page.evaluate(() => document.documentElement.lang === 'en' && !/[가-힣]/.test(document.querySelector('.toolbar').textContent + document.querySelector('.statusbar, .status')?.textContent)), 'English page shows the sample without Korean interface text');
  return 'MOBILE_BROWSER_CHECK_PASSED';
}
