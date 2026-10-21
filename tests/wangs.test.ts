import { describe, expect, it } from 'vitest';
import { detectNcFormat, loadNcFile, parseKdtXml, parseNcFile, parsePgi, type MprBoxOp, type MprContourOp, type MprDrillOp, type MprOtherOp } from '../src/index';
import { earClip } from '../src/mesh';
import { mprToScene } from '../src/scene';
import { decodeXmlBytes, parseXml, xmlRootName } from '../src/xml';
import { MPRX_MESSAGE, OTHER_XML_MESSAGE, checkNcInput, parseForView } from '../src/app/payload';
import { createDoc, docLabel, mprOps, noticeViews, panelTabs, selectionSummary, statusParts } from '../src/app/doc';
import { translate } from '../site/i18n.mjs';
import type { ParseResult } from '../src/app/protocol';

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const enc = new TextEncoder();

// 노치(오른쪽 앞 모서리 100 × 100을 따낸) 판 600 × 400 × 18
const PGI = `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <params>
  <param key="L" value="600" description="길이"/>
  <param key="W" value="400" description=""/>
  <param key="T" value="18" description=""/>
  <param key="E" value="W-37" description="앞에서"/>
 </params>
 <panel length="600" width="400" thickness="18" name="[SETUP] G54 Z- / t_min" frontID="EDGE10001" material="See nesting CSV" quantity="1">
  <outlines>
   <outline x="0" y="400" bulge="0" banding="1"/>
   <outline x="600" y="400" bulge="0" banding="1"/>
   <outline x="600" y="100" bulge="0" banding="0"/>
   <outline x="500" y="100" bulge="0" banding="0"/>
   <outline x="500" y="0" bulge="0" banding="0"/>
   <outline x="0" y="0" bulge="0" banding="0.5"/>
   <outline x="0" y="400" bulge="0" banding="0"/>
  </outlines>
  <hole x="32" y="E" z="0" diameter="5" depth="13" direction="z-" no="5" xi="32" yi="0" zi="0" enable="1" order="1"/>
  <hole x="600" y="200" z="9" diameter="8" depth="30" direction="x-" enable="1" order="2"/>
  <hole x="500" y="50" z="9" diameter="8" depth="25" direction="x-" enable="1" order="3"/>
  <hole x="0" y="200" z="5" diameter="8" depth="22" direction="x+" enable="0" order="4"/>
  <hole x="300" y="400" z="12" diameter="6" depth="12" direction="y-" enable="1" order="5"/>
  <hole x="550" y="260" z="0" diameter="10" depth="-12" direction="z+" enable="1" order="7"/>
  <line startX="20" startY="380" startZ="0" endX="480" endY="380" endZ="0" width="4" depth="7" direction="z+" isSaw="1" enable="1" order="8"/>
  <line startX="20" startY="20" startZ="0" endX="200" endY="20" endZ="0" width="8" depth="5" direction="z-" isSaw="0" enable="1" order="9"/>
  <pocket length="80" width="40" depth="10" direction="z-" cornerRadius="5" angle="30" centerX="300+(40)/2" centerY="200" centerZ="0" enable="1" order="10"/>
  <pocket length="60" width="8" depth="6" direction="y-" cornerRadius="0" angle="0" centerX="150" centerY="0" centerZ="9" enable="1" order="11"/>
  <pocket length="50" width="30" depth="4" direction="z+" cornerRadius="0" angle="0" centerZ="100" enable="1" order="12">
   <extensions><extension key="strX" value="40"/><extension key="strY" value="300"/><extension key="strLineWidth" value="6"/></extensions>
  </pocket>
  <path direction="z-" toolOffset="left" width="8" depth="18" close="0" enable="1" order="13">
   <vertex x="100" y="100" z="0" bulge="0"/>
   <vertex x="200" y="100" z="0" bulge="1"/>
   <vertex x="220" y="120" z="0" bulge="0"/>
   <vertex x="220" y="200" z="0" bulge="0.41421356"/>
   <vertex x="180" y="240" z="0" bulge="0"/>
  </path>
  <path direction="z+" toolOffset="middle" width="6" depth="8" close="1" empty="1" enable="1" order="14">
   <vertex x="350" y="250" z="0" bulge="0"/>
   <vertex x="450" y="250" z="0" bulge="0"/>
   <vertex x="450" y="330" z="0" bulge="0"/>
   <vertex x="400" y="300" z="0" bulge="0"/>
   <vertex x="350" y="330" z="0" bulge="0"/>
  </path>
  <path direction="z+" toolOffset="middle" width="0" toolName="T35" depth="13" close="1" enable="1" order="15">
   <vertex x="482.5" y="200" z="0" bulge="1"/>
   <vertex x="517.5" y="200" z="0" bulge="1"/>
  </path>
  <circle centerX="100" centerY="200" centerZ="0" radius="17.5" width="35" toolName="T35" depth="13" direction="z-" empty="1" toolOffset="in" enable="1" order="17"/>
  <circle centerX="420" centerY="150" centerZ="0" radius="20" width="8" depth="10" direction="z-" empty="1" enable="1" order="0"/>
  <circle centerX="420" centerY="60" centerZ="0" radius="15" width="6" depth="3" direction="z-" empty="0" entryL="5" enable="1" order="19"/>
  <hole x="550" y="50" z="9" diameter="8" depth="25" direction="x-" enable="1" order="30"/>
  <groove x="10" y="50" z="0" direction="z-" depth="3" enable="1" order="20"/>
  <hole x="40" y="40" diameter="5" depth="10" direction="q+" enable="1" order="21"/>
  <hole x="40" y="abc" diameter="5" depth="10" direction="z-" enable="1" order="22"/>
 </panel>
</pgi>
`;

const XML = `<KDTPanelFormat>
 <PANEL>
  <PanelLength>600</PanelLength>
  <PanelWidth>400</PanelWidth>
  <PanelThickness>18</PanelThickness>
  <PanelName>[SETUP] G59 Z+ / t_max</PanelName>
  <PanelQuantity>1</PanelQuantity>
  <Inch>0</Inch>
  <Params>
   <Param Comment="" Key="L" Value="600.00"/>
   <Param Comment="" Key="W" Value="400.00"/>
   <Param Comment="" Key="T" Value="18.00"/>
  </Params>
  <PanelOutline>
   <Vertex><X1>0</X1><Y1>400</Y1><Bulge>0</Bulge><Banding>0.5</Banding></Vertex>
   <Vertex><X1>600</X1><Y1>400</Y1><Bulge>0</Bulge><Banding>0.5</Banding></Vertex>
   <Vertex><X1>600</X1><Y1>0</Y1><Bulge>0</Bulge><Banding>0.5</Banding></Vertex>
   <Vertex><X1>0</X1><Y1>0</Y1><Bulge>0</Bulge><Banding>0.5</Banding></Vertex>
   <Vertex><X1>0</X1><Y1>400</Y1><Bulge>0</Bulge><Banding>0</Banding></Vertex>
  </PanelOutline>
 </PANEL>
 <CAD><TypeNo>1</TypeNo><TypeName>Vertical Hole</TypeName><X1>32</X1><Y1>W-37</Y1><Depth>13</Depth><Diameter>5</Diameter><Enable>1</Enable></CAD>
 <CAD><TypeNo>8</TypeNo><TypeName>Back Vertical Hole</TypeName><X1>64</X1><Y1>37</Y1><Depth>13</Depth><Diameter>5</Diameter><Enable>0</Enable></CAD>
 <CAD><TypeNo>2</TypeNo><TypeName>Horizontal Hole</TypeName><X1>L</X1><Y1>20</Y1><Z1>9</Z1><Quadrant>1</Quadrant><Depth>12</Depth><Diameter>3</Diameter><Enable>1</Enable></CAD>
 <CAD><TypeNo>2</TypeNo><TypeName>Horizontal Hole</TypeName><X1>300</X1><Y1>W</Y1><Z1>9</Z1><Quadrant></Quadrant><Depth>20</Depth><Diameter>8</Diameter><Enable>1</Enable></CAD>
 <CAD><TypeNo>3</TypeNo><TypeName>Vertical Line</TypeName><BeginX>10</BeginX><BeginY>380</BeginY><EndX>590</EndX><EndY>380</EndY><Width>4</Width><Depth>7</Depth><UseSaw>1</UseSaw><Enable>1</Enable></CAD>
 <CAD><TypeNo>5</TypeNo><TypeName>Circle</TypeName><ToolName>T35</ToolName><CenterX>22.5</CenterX><CenterY>100</CenterY><Radius>17.5</Radius><Empty>1</Empty><Width>35</Width><Depth>13</Depth><Enable>1</Enable></CAD>
 <CAD><TypeNo>6</TypeNo><TypeName>Rect</TypeName><X1>300</X1><Y1>100</Y1><Length>80</Length><Width>40</Width><Radius>4</Radius><LineWidth>8</LineWidth><Depth>10</Depth><Enable>1</Enable></CAD>
 <CAD><TypeNo>26</TypeNo><TypeName>Horizontal Rect</TypeName><X1>150</X1><Y1>W</Y1><Z1>5</Z1><Quadrant>3</Quadrant><Length>60</Length><Width>8</Width><Depth>6</Depth><Enable>1</Enable></CAD>
 <CAD><TypeNo>17</TypeNo><TypeName>Back Path</TypeName><Width>6</Width><Depth>18.5</Depth><Correction>1</Correction><Close>0</Close><Empty>0</Empty><Relative>0</Relative><Enable>1</Enable>
  <Vertexes>
   <Point><X1>-8</X1><Y1>36</Y1><Z1>0</Z1></Point>
   <Line><X1>56</X1><Y1>36</Y1><Z1>0</Z1></Line>
   <Arc><X1>64</X1><Y1>44</Y1><Z1>0</Z1><Radius>8</Radius><Direction>1</Direction></Arc>
   <Line><X1>64</X1><Y1>-8</Y1><Z1>0</Z1></Line>
  </Vertexes>
 </CAD>
 <CAD><TypeNo>7</TypeNo><TypeName>Path</TypeName><Width>8</Width><Depth>4</Depth><Close>1</Close><Empty>1</Empty><Relative>1</Relative><Enable>1</Enable>
  <Vertexes>
   <Point><X1>400</X1><Y1>250</Y1></Point>
   <Line><X1>100</X1><Y1>0</Y1></Line>
   <Arc><X1>0</X1><Y1>80</Y1><Direction>1</Direction></Arc>
   <Line><X1>-100</X1><Y1>0</Y1></Line>
  </Vertexes>
 </CAD>
 <CAD><TypeNo>121</TypeNo><TypeName>Vertical FlatAnglePull</TypeName><X>0</X><Y>50</Y><Depth>5</Depth><Enable>1</Enable></CAD>
 <CAD><TypeNo>99</TypeNo><TypeName>Mystery</TypeName><Enable>1</Enable></CAD>
 <CAD><TypeNo>1</TypeNo><TypeName>Vertical Hole</TypeName><X1>10</X1><Depth>13</Depth><Diameter>5</Diameter><Enable>1</Enable></CAD>
</KDTPanelFormat>
`;

describe('XML 읽기', () => {
  it('요소·속성·글과 줄 번호(0부터), 개체·CDATA, 주석·선언은 건너뜀', () => {
    const { root, problems } = parseXml('<?xml version="1.0"?>\n<!-- c -->\n<a k="1 &amp; 2">\n <b>x &lt; y</b><c/>\n <d><![CDATA[<raw>]]>&#65;</d>\n</a>\n');
    expect(problems).toEqual([]);
    expect(root.name).toBe('a');
    expect(root.attrs.k).toBe('1 & 2');
    expect([root.line, root.endLine]).toEqual([2, 5]);
    expect(root.children.map((c) => [c.name, c.line, c.endLine, c.text])).toEqual([
      ['b', 3, 3, 'x < y'],
      ['c', 3, 3, ''],
      ['d', 4, 4, '<raw>A'],
    ]);
  });

  it('끊긴 문서는 닫힌 요소까지 쓰고 알린다, DOCTYPE은 읽지 않는다', () => {
    const { root, problems } = parseXml('<!DOCTYPE a [<!ENTITY x "boom">]>\n<a><b/><c>&x;\n<d k="1"');
    expect(root.children.map((c) => [c.name, c.endLine])).toEqual([
      ['b', 1],
      ['c', -1],
    ]);
    expect(root.children[1]!.text).toContain('&x;');
    expect(problems.map((p) => p.message)).toEqual(['DOCTYPE 선언은 읽지 않음(개체 선언도 풀지 않음)', '<d> 태그를 끝까지 읽지 못함', '문서가 <c> 안에서 끊김 — 그 앞까지 닫힌 요소만 씀']);
  });

  it('뿌리 이름: XML 선언·주석 뒤, MPR 매크로 줄은 XML이 아님', () => {
    expect(xmlRootName('﻿<?xml version="1.0"?>\n<!-- x --><pgi>\n')).toBe('pgi');
    expect(xmlRootName('<KDTPanelFormat>')).toBe('KDTPanelFormat');
    expect(xmlRootName('<100 \\WerkStck\\\n')).toBeNull();
    expect(xmlRootName('G0 X1')).toBeNull();
  });

  it('인코딩: UTF-8, 선언한 GBK, UTF-16 BOM', () => {
    expect(decodeXmlBytes(enc.encode('<a>판</a>'))).toBe('<a>판</a>');
    // "门" = GBK C3 C5
    const gbk = new Uint8Array([...enc.encode('<?xml version="1.0" encoding="gb2312"?><a>'), 0xc3, 0xc5, ...enc.encode('</a>')]);
    expect(decodeXmlBytes(gbk)).toContain('<a>门</a>');
    const u16 = new Uint8Array([0xff, 0xfe, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e, 0]);
    expect(decodeXmlBytes(u16)).toBe('<a/>');
  });
});

describe('WangShi PGI', () => {
  const p = parsePgi(PGI, { name: 'edge.pgi' });
  const op = <T>(i: number): T => p.operations[i] as T;

  it('판·변수·외곽선', () => {
    expect(p.format).toBe('pgi');
    expect(p.name).toBe('edge.pgi');
    expect([p.workpiece!.length, p.workpiece!.width, p.workpiece!.thickness]).toEqual([600, 400, 18]);
    expect(p.variables.map((v) => [v.name, v.value, v.comment])).toEqual([
      ['L', 600, '길이'],
      ['W', 400, undefined],
      ['T', 18, undefined],
      ['E', 363, '앞에서'],
    ]);
    // 노치 판: 외곽선을 싣는다(닫힌 점열)
    expect(p.workpiece!.outline!.map((q) => [q.x, q.y])).toEqual([
      [0, 400],
      [600, 400],
      [600, 100],
      [500, 100],
      [500, 0],
      [0, 0],
      [0, 400],
    ]);
    expect(p.lines[0]).toBe('<?xml version="1.0" encoding="utf-8"?>');
  });

  it('구멍: 줄(no·xi), 여섯 면, 노치 벽, 꺼짐, 음수 깊이', () => {
    const row = op<MprDrillOp>(0);
    expect([row.kind, row.label, row.face, row.line]).toEqual(['drillV', '수직 드릴 Ø5 × 13 (5개)', 'top', 18]);
    expect(row.holes.map((h) => h.start)).toEqual([32, 64, 96, 128, 160].map((x) => [x, 363, 18]));
    expect(row.holes[0]!.dir).toEqual([0, 0, -1]);
    expect(op<MprDrillOp>(1).holes[0]).toEqual({ start: [600, 200, 9], dir: [-1, 0, 0], depth: 30 });
    // 노치 벽(x 500) 위의 오른쪽면 구멍은 그 벽에서 뚫는다
    expect(op<MprDrillOp>(2).holes[0]!.start).toEqual([500, 50, 9]);
    expect([op<MprDrillOp>(3).label, op<MprDrillOp>(3).enabled]).toEqual(['수평 드릴 Ø8 × 22 (왼쪽면)', false]);
    expect(op<MprDrillOp>(4).holes[0]).toEqual({ start: [300, 400, 12], dir: [0, -1, 0], depth: 12 });
    expect([op<MprDrillOp>(5).label, op<MprDrillOp>(5).depth, op<MprDrillOp>(5).holes[0]!.start]).toEqual(['수직 드릴 Ø10 × 12 (아랫면)', 12, [550, 260, 0]]);
    expect(p.warnings).toContain('24번 줄: <hole>: 깊이가 음수(-12)여서 절댓값으로 읽음');
    // 노치로 따낸 자리(x 550)의 오른쪽면 구멍은 드릴이 처음 만나는 벽(x 500)에서 뚫고 알린다
    const off = op<MprDrillOp>(17);
    expect(off.holes[0]!.start).toEqual([500, 50, 9]);
    expect(p.warnings).toContain('53번 줄: <hole>: 옆면 구멍 좌표(x 550)가 면 위에 있지 않음 — x 500 면에서 뚫는 것으로 그림');
  });

  it('톱 선은 폭 있는 홈 상자, 톱이 아닌 선은 깊이의 직선 경로', () => {
    const saw = op<MprBoxOp>(6);
    expect([saw.kind, saw.label]).toEqual(['groove', '톱 홈 460 × 7 · 폭 4 (아랫면)']);
    expect(saw.box).toEqual({ origin: [20, 378, 0], u: [460, 0, 0], v: [0, 4, 0], w: [0, 0, 7] });
    const line = op<MprContourOp>(7);
    expect([line.kind, line.label, line.diameter]).toEqual(['contour', '직선 경로 Ø8 × 5', 8]);
    expect(line.path!.map((q) => [q.x, q.y, q.z])).toEqual([
      [20, 20, 13],
      [200, 20, 13],
    ]);
  });

  it('사각 포켓: 식 가운데·회전·둥근 모서리, 옆면, strX·strY 모서리', () => {
    const rot = op<MprBoxOp>(8);
    expect([rot.kind, rot.label, rot.prism!.depth, rot.prism!.dir]).toEqual(['pocket', '포켓 80 × 40 × 10 (회전 30°)', 10, [0, 0, -1]]);
    const pts = rot.prism!.outline;
    const xs = pts.filter((_, i) => i % 3 === 0);
    const ys = pts.filter((_, i) => i % 3 === 1);
    // 가운데 (320, 200), 30° 돌린 80 × 40(모서리 R5) — 둥근 모서리가 꼭짓점 범위를 안쪽으로 줄인다
    expect(r3((Math.min(...xs) + Math.max(...xs)) / 2)).toBe(320);
    expect(r3((Math.min(...ys) + Math.max(...ys)) / 2)).toBe(200);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80 * Math.cos(Math.PI / 6) + 40 * Math.sin(Math.PI / 6) - 10 * (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6) - 1), 1);
    const side = op<MprBoxOp>(9);
    expect([side.label, side.prism!.dir, side.prism!.outline.slice(0, 3)]).toEqual(['포켓 60 × 8 × 6 (뒷면)', [0, -1, 0], [120, 400, 5]]);
    const corner = op<MprBoxOp>(10);
    expect(corner.prism!.outline).toEqual([40, 300, 0, 90, 300, 0, 90, 330, 0, 40, 330, 0]);
  });

  it('경로: bulge ±1은 접선을 잇는 호, 참 bulge, 닫힌 empty 경로는 포켓, T35 원 경로는 도어 컵', () => {
    const route = op<MprContourOp>(11);
    expect([route.label, route.comp, route.depth, route.face]).toEqual(['라우팅 Ø8 × 18', 'left', 18, 'top']);
    expect(route.path!.map((q) => [q.x, q.y, q.z, q.arc ? [r3(q.arc.cx), r3(q.arc.cy), r3(q.arc.sweep)] : null])).toEqual([
      [100, 100, 0, null],
      [200, 100, 0, null],
      [220, 120, 0, [200, 120, r3(Math.PI / 2)]],
      [220, 200, 0, null],
      [180, 240, 0, [180, 200, r3(Math.PI / 2)]],
    ]);
    const pocket = op<MprBoxOp>(12);
    expect([pocket.kind, pocket.label, pocket.prism!.outline.length / 3]).toEqual(['pocket', '포켓 경로 × 8 (아랫면)', 5]);
    const cup = op<MprDrillOp>(13);
    expect([cup.kind, cup.label, cup.holes[0]!.start]).toEqual(['drillV', '도어 컵 Ø35 × 13 (아랫면)', [500, 200, 0]]);
  });

  it('원: 공구가 다 채우면 구멍, empty면 원형 포켓, 아니면 원 경로', () => {
    expect([op<MprDrillOp>(14).label, op<MprDrillOp>(14).holes[0]!.start]).toEqual(['도어 컵 Ø35 × 13', [100, 200, 18]]);
    const pocket = op<MprBoxOp>(15);
    expect([pocket.label, pocket.diameter, pocket.prism!.outline.length / 3]).toEqual(['원형 포켓 Ø40 × 10', 40, 48]);
    const path = op<MprContourOp>(16);
    expect([path.label, path.path!.length, path.path![1]!.arc]).toEqual(['원형 경로 Ø30 × 3', 3, { cx: 420, cy: 60, sweep: Math.PI }]);
  });

  it('모르는 요소는 위치 점, 해석 실패는 목록에, 순서·진입 값은 한 번 알림', () => {
    const other = op<MprOtherOp>(18);
    expect([other.kind, other.label, other.at, other.face]).toEqual(['other', '<groove>', [10, 50, 18], 'top']);
    expect([op<MprOtherOp>(19).label, op<MprOtherOp>(20).label]).toEqual(['<hole> (해석 실패)', '<hole> (해석 실패)']);
    expect(p.warnings).toEqual(
      expect.arrayContaining([
        '54번 줄: <groove>: 모양을 몰라 위치만 점으로 표시',
        '55번 줄: <hole>: 방향(direction="q+")을 몰라 해석하지 못함',
        "56번 줄: <hole>: y 값('abc')을 숫자로 읽을 수 없어 해석하지 못함",
        '52번 줄: PGI: 진입 값(entryL·entryZ)·공구 추가 오프셋(toolExtraOffset)은 그리지 않음',
        '51번 줄: PGI: 가공 순서(order)가 문서 순서와 다른 요소 2개 — 문서 순서대로 그림',
      ]),
    );
    expect(p.stats).toEqual({ holes: 12, drillOps: 8, contourOps: 3, grooves: 1, pockets: 5, disabled: 1, other: 3 });
  });

  it('판이 없거나 뿌리가 다르면 오류', () => {
    expect(() => parsePgi('<pgi><params/></pgi>')).toThrow('판(<panel>)이 없습니다');
    expect(() => parsePgi('<other/>')).toThrow('뿌리 요소가 <pgi>가 아닙니다');
    expect(() => parsePgi('<pgi><panel length="0" width="1" thickness="1"/></pgi>')).toThrow('판 크기(length) 값이 없거나');
  });
});

describe('WangShi KDT XML', () => {
  const p = parseKdtXml(XML, { name: 'edge.xml' });
  const op = <T>(i: number): T => p.operations[i] as T;

  it('판·변수, 직사각형 외곽선은 싣지 않음', () => {
    expect(p.format).toBe('xml');
    expect([p.workpiece!.length, p.workpiece!.width, p.workpiece!.thickness, p.workpiece!.outline]).toEqual([600, 400, 18, undefined]);
    expect(p.variables.map((v) => v.name)).toEqual(['L', 'W', 'T']);
    expect(p.header.PanelName).toBe('[SETUP] G59 Z+ / t_max');
  });

  it('TypeNo 1·8·2: 구멍, 식 좌표(W-37·L), Quadrant 없으면 원점 경계로', () => {
    expect([op<MprDrillOp>(0).label, op<MprDrillOp>(0).holes[0]!.start]).toEqual(['수직 드릴 Ø5 × 13', [32, 363, 18]]);
    expect([op<MprDrillOp>(1).label, op<MprDrillOp>(1).enabled, op<MprDrillOp>(1).holes[0]!.start]).toEqual(['수직 드릴 Ø5 × 13 (아랫면)', false, [64, 37, 0]]);
    expect(op<MprDrillOp>(2).holes[0]).toEqual({ start: [600, 20, 9], dir: [-1, 0, 0], depth: 12 });
    expect([op<MprDrillOp>(3).label, op<MprDrillOp>(3).holes[0]!.start]).toEqual(['수평 드릴 Ø8 × 20 (뒷면)', [300, 400, 9]]);
    expect(p.warnings).toContain("25번 줄: CAD 2 Horizontal Hole: Quadrant 값('')을 몰라 원점 위치로 옆면을 정함");
  });

  it('TypeNo 3·5·6·26: 톱 홈, 도어 컵, 최소 모서리 사각, 옆면 사각', () => {
    const saw = op<MprBoxOp>(4);
    expect([saw.label, saw.box!.origin, saw.box!.w]).toEqual(['톱 홈 580 × 7 · 폭 4', [10, 382, 18], [0, 0, -7]]);
    expect([op<MprDrillOp>(5).label, op<MprDrillOp>(5).holes[0]!.start]).toEqual(['도어 컵 Ø35 × 13', [22.5, 100, 18]]);
    const rect = op<MprBoxOp>(6);
    const xs = rect.prism!.outline.filter((_, i) => i % 3 === 0);
    expect([rect.label, Math.min(...xs), Math.max(...xs)]).toEqual(['포켓 80 × 40 × 10', 300, 380]);
    const side = op<MprBoxOp>(7);
    expect([side.label, side.prism!.outline]).toEqual(['포켓 60 × 8 × 6 (뒷면)', [150, 400, 5, 150, 400, 13, 210, 400, 13, 210, 400, 5]]);
  });

  it('TypeNo 17·7: 반지름 호, 상대 좌표와 접선 호의 닫힌 포켓', () => {
    const back = op<MprContourOp>(8);
    expect([back.label, back.comp, back.face]).toEqual(['라우팅 Ø6 × 18.5 (아랫면)', 'left', 'bottom']);
    expect(back.path!.map((q) => [q.x, q.y, q.z, q.arc ? [q.arc.cx, q.arc.cy] : null])).toEqual([
      [-8, 36, 18.5, null],
      [56, 36, 18.5, null],
      [64, 44, 18.5, [56, 44]],
      [64, -8, 18.5, null],
    ]);
    const rel = op<MprBoxOp>(9);
    const xs = rel.prism!.outline.filter((_, i) => i % 3 === 0);
    // (400,250) → (500,250) → 반원(중심 500, 290) → (400,330): 반원이 x 540까지 나간다
    expect([rel.label, r3(Math.max(...xs))]).toEqual(['포켓 경로 × 4', 540]);
    expect(p.warnings).toContain('38번 줄: CAD 7 Path: 상대 좌표 경로(Relative=1) — 꼭짓점을 앞 꼭짓점에서의 증분으로 읽음');
  });

  it('모르는 TypeNo: 한국어 이름·위치 점, 위치가 없으면 목록만, 값이 없으면 해석 실패', () => {
    expect([op<MprOtherOp>(10).label, op<MprOtherOp>(10).at, op<MprOtherOp>(10).macroId]).toEqual(['반매립 손잡이 홈 (미지원)', [0, 50, 18], 121]);
    expect([op<MprOtherOp>(11).label, op<MprOtherOp>(11).at]).toEqual(['CAD 99 Mystery', undefined]);
    expect(op<MprOtherOp>(12).label).toBe('CAD 1 Vertical Hole (해석 실패)');
    expect(p.warnings).toContain('48번 줄: CAD 1 Vertical Hole: Y1 값이 없어 해석하지 못함');
  });

  it('인치 판은 단위를 inch로', () => {
    const q = parseKdtXml('<KDTPanelFormat><PANEL><PanelLength>24</PanelLength><PanelWidth>12</PanelWidth><PanelThickness>0.75</PanelThickness><Inch>1</Inch></PANEL></KDTPanelFormat>');
    expect([q.units, q.workpiece!.thickness]).toEqual(['inch', 0.75]);
  });
});

describe('판별·장면·화면', () => {
  it('형식 판별: 내용(뿌리 요소) 우선, .pgi는 확장자로도, .xml은 내용으로만', () => {
    expect(detectNcFormat('a.txt', PGI)).toBe('pgi');
    expect(detectNcFormat('a.dat', XML)).toBe('xml');
    expect(detectNcFormat('a.pgi', 'garbage')).toBe('pgi');
    expect(detectNcFormat('a.xml', '<config/>')).toBeNull();
    const parsed = parseNcFile('dir/edge.pgi', enc.encode(PGI));
    expect(parsed.kind).toBe('pgi');
    if ('part' in parsed) expect(parsed.part.name).toBe('edge.pgi');
  });

  it('열기 확인: WangShi가 아닌 XML·MPRX는 G-code로 읽지 않는다', () => {
    expect(checkNcInput('board.pgi', enc.encode(PGI))).toEqual({ ok: true, kind: 'pgi' });
    expect(checkNcInput('board.xml', enc.encode(XML))).toEqual({ ok: true, kind: 'xml' });
    expect(checkNcInput('settings.xml', enc.encode('<?xml version="1.0"?><settings/>'))).toEqual({ ok: false, message: OTHER_XML_MESSAGE });
    expect(checkNcInput('part.xml', enc.encode('not xml'))).toEqual({ ok: false, message: OTHER_XML_MESSAGE });
    expect(checkNcInput('part.mprx', enc.encode('<MprxDocument/>'))).toEqual({ ok: false, message: MPRX_MESSAGE });
  });

  it('장면: 기둥 포켓·홈 상자·구멍 원기둥, 노치 판 외곽선, 면에서 경로까지의 깊이 선', () => {
    const p = parsePgi(PGI);
    const s = mprToScene(p);
    expect((s.meta as { format?: string }).format).toBe('pgi');
    // 노치 판은 외곽선 기둥: 따낸 모서리(x > 500, y < 100)에 판 정점이 없다
    const board = s.meshes.find((m) => m.id === 'mpr-board')!.positions;
    const inNotch = [];
    for (let i = 0; i < board.length; i += 3) if (board[i]! > 500.5 && board[i + 1]! < 99.5) inNotch.push(i);
    expect([board.length / 3 > 24, inNotch]).toEqual([true, []]);
    expect(s.meshes.find((m) => m.id === 'mpr-op-8')!.group).toBe('포켓');
    expect(s.meshes.find((m) => m.id === 'mpr-op-6')!.group).toBe('홈');
    expect(s.meshes.some((m) => m.id === 'mpr-op-3')).toBe(false); // 꺼진 가공
    // 라우팅(윗면, 깊이 18): 마지막 선분이 윗면(z 18)에서 경로 시작(z 0)까지
    const route = s.lines.find((l) => l.id === 'mpr-op-11')!.positions;
    expect(Array.from(route.slice(-6))).toEqual([100, 100, 18, 100, 100, 0]);
    expect(s.points!.find((x) => x.id === 'mpr-other-pos')!.positions.length).toBe(3);
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [600, 400, 18] });
  });

  it('귀 자르기: 오목 다각형도 넓이가 맞게 나눈다', () => {
    const poly: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 4],
      [0, 10],
    ];
    const tris = earClip(poly);
    let area = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [poly[tris[i]!]!, poly[tris[i + 1]!]!, poly[tris[i + 2]!]!];
      area += ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    expect(tris.length).toBe(9);
    expect(r3(area)).toBe(70);
  });

  it('화면 문서: 가공·변수 탭, 형식 이름, 상태 막대', () => {
    for (const [name, text, label] of [
      ['edge.pgi', PGI, 'WangShi PGI'],
      ['edge.xml', XML, 'WangShi XML'],
    ] as const) {
      const { parsed, scene } = loadNcFile(name, enc.encode(text));
      const res: ParseResult = { kind: parsed.kind, scene, ms: 3 };
      if ('part' in parsed) res.mpr = { lines: parsed.part.lines };
      const d = createDoc(name, text.length, res);
      expect(d.panelTab).toBe('ops');
      expect(panelTabs(d).map(([k]) => k)).toEqual(['ops', 'vars', 'code', 'info']);
      expect(docLabel(d)).toBe(label);
      expect(statusParts(d)).toContain(`가공 ${mprOps(d.scene).length}개`);
    }
  });

  it('화면 길(parseForView): PGI·XML은 판재 패널 자료로 열리고, 여러 파일 작업에는 잇지 않는다(G-code와 함께 골라도)', () => {
    const stages: string[] = [];
    const pgi = parseForView('board.pgi', enc.encode(PGI), {}, (_f, st) => stages.push(st));
    expect(pgi.kind).toBe('pgi');
    expect(pgi.mpr!.lines.length).toBeGreaterThan(10);
    expect(pgi.nc).toBeUndefined();
    expect(pgi.job).toBeUndefined();
    expect(stages).toContain('WangShi PGI 읽는 중');
    const xml = parseForView('board.xml', enc.encode(XML));
    expect(xml.kind).toBe('xml');
    expect(mprOps(xml.scene).length).toBeGreaterThan(0);
    // 판재 파일 + G-code 파일: 판재 파일은 주 프로그램이 되지 않고 G-code에 잇지도 않는다
    const job = parseForView('main.nc', enc.encode('G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nX10\nM30\n'), {}, () => {}, [{ name: 'board.pgi', bytes: enc.encode(PGI) }]);
    expect(job.kind).toBe('gcode');
    expect(job.job).toMatchObject({ main: 'main.nc', files: ['main.nc'], skipped: ['board.pgi'] });
    const d = createDoc('main.nc', 1, job);
    expect(noticeViews(d).map((n) => n.key)).toEqual(['job']);
    const pd = createDoc('board.pgi', 1, pgi);
    expect(pd.panelTab).toBe('ops');
    expect(noticeViews(pd)).toEqual([]);
  });

  it('다른 언어: 가공을 고른 상태 막대 요약(앱이 지은 가공 이름·꺼짐까지)이 한국어 없이', () => {
    for (const [name, text] of [['board.pgi', PGI], ['board.xml', XML]] as const) {
      const d = createDoc(name, 1, parseForView(name, enc.encode(text)));
      const ops = mprOps(d.scene);
      expect(ops.some((o) => !o.enabled)).toBe(true);
      const lines = ops.map((_, i) => {
        d.selKey = String(i);
        return selectionSummary(d);
      });
      lines.push(...statusParts(d).filter((p) => p.startsWith('가공 ')));
      for (const lang of ['en', 'ja', 'zh-CN', 'de']) for (const t of lines) expect(translate(t, lang), `${lang}: ${t}`).not.toMatch(/[가-힣]/);
    }
    expect(translate('가공 1 · 수직 드릴 Ø5 × 13 (5개)', 'en')).toBe('Operation 1 · Vertical drill Ø5 × 13 (5 holes)');
    expect(translate('반매립 손잡이 홈 (미지원)', 'de')).toBe('Griffmulde, halbversenkt (nicht unterstützt)');
  });
});
