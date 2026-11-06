/**
 * 퍼징 씨앗(직접 만든 작은 합성 프로그램 — 실제 작업 파일이 아니다). 형식·방언마다 하나 이상: Fanuc 밀링(부프로그램·매크로·고리)·선반(G71·G70·G76),
 * Haas, LinuxCNC(o-code), Siemens(R 변수·PROC·REPEAT·사이클), Heidenhain(LBL·Q·FN·사이클 200·SL 14/20/22), woodWOP MPR, WangShi PGI·KDT XML.
 * tests/fuzz.test.ts와 로컬 대량 퍼징이 함께 쓴다.
 */
import { ncSampleProgram } from '../src/view/sample';

export const NC_SEEDS: readonly { name: string; text: string }[] = [
  { name: 'sample.nc', text: ncSampleProgram() },
  {
    name: 'fanuc-macro.nc',
    text: `%
O2001 (FANUC MACRO SUB LOOP)
G21 G17 G90 G40 G49 G80
T1 M6
S3000 M3
G0 X0 Y0 Z25.
G43 H1 Z5.
#100=0
#101=4
WHILE[#100LT#101]DO1
#102=#100*5.
G1 X#102 Y[#102/2] Z-1. F300
#100=#100+1
END1
M98 P2002 L2
G65 P2003 A10. B2.
IF[#101EQ4]GOTO50
G1 X99.
N50 G0 Z25.
M30
O2002
G91 G1 X5. F200
G90
M99
O2003
#3=#1/#2
G1 X#3 Y#1
G2 X[#3+2.] Y#1 R1.
M99
%
`,
  },
  {
    name: 'fanuc-lathe.nc',
    text: `%
O3001 (LATHE G71 G70 G76)
G21 G18 G40 G99
T0101
G96 S200 M3
G50 S2000
G0 X52. Z2.
G71 U1.5 R0.5
G71 P10 Q20 U0.4 W0.1 F0.25
N10 G0 X20.
G1 Z-15. F0.1
X30. Z-25.
G2 X40. Z-30. R5.
G1 Z-45.
N20 X52.
G70 P10 Q20
G0 X100. Z100.
T0303
G97 S800
G0 X42. Z5.
G76 P020060 Q100 R0.05
G76 X37.4 Z-20. P1300 Q300 F2.
G0 X100. Z100.
M30
%
`,
  },
  {
    name: 'haas-mill.nc',
    text: `%
O4001 (HAAS)
G20 G17 G90 G40 G80
T2 M6
S5000 M3
G0 G54 X0. Y0.
G43 H2 Z1.
G1 Z-0.1 F10.
G12 I0.5 K1. Q0.2 D2 F20.
G0 Z1.
G83 X1. Y1. Z-0.5 R0.1 Q0.1 F5.
X2.
G80
G0 Z2.
M30
%
`,
  },
  {
    name: 'linuxcnc.ngc',
    text: `( LINUXCNC O-CODE )
G21 G17 G90
#<_depth> = -1
o100 sub
  G1 X#1 Y#2 F200
  G1 Z#<_depth>
  G0 Z5
o100 endsub
T1 M6
S2000 M3
G0 Z5
#<i> = 0
o101 while [#<i> LT 3]
  o100 call [#<i>*10] [5]
  #<i> = [#<i> + 1]
o101 endwhile
o102 repeat [2]
  G91 G1 X2 F100
  G90
o102 endrepeat
o103 if [#<i> EQ 3]
  G2 X10 Y0 I5 J0
o103 endif
M2
`,
  },
  {
    name: 'siemens.mpf',
    text: `; SIEMENS
DEF REAL TIEFE=-5
G17 G90 G71
T1 D1
M6
S3000 M3
G0 X0 Y0 Z50
R1=10
R2=R1*2
TRANS X10 Y5
MARKE1:
G1 X=R1 Y=R2 F500
R1=R1+5
IF R1<30 GOTOB MARKE1
TRANS
CYCLE81(10,0,2,TIEFE,0)
X20 Y20
X30 Y20
MCALL
POCKET1(10,0,2,-5,,40,20,5,50,50,0,500,200,3,1,0.5,1,0,0,0)
REPEAT MARKE1 MARKE1 P=1
G0 Z50
M30
`,
  },
  {
    name: 'heid-sl.h',
    text: `0 BEGIN PGM SEED MM
1 BLK FORM 0.1 Z X+0 Y+0 Z-20
2 BLK FORM 0.2 X+100 Y+100 Z+0
3 TOOL DEF 1 L+0 R+5
4 TOOL CALL 1 Z S3000 F500
5 L Z+50 R0 FMAX
6 Q10 = +3
7 FN 1: Q11 = +Q10 + +2
8 LBL 5
9 L X+Q11 Y+10 R0 FMAX
10 L Z-2 F200
11 L IX+5
12 FN 2: Q10 = +Q10 - +1
13 FN 11: IF +Q10 GT +0 GOTO LBL 5
14 CYCL DEF 200 DRILLING ~
  Q200=+2 ~
  Q201=-10 ~
  Q206=+150 ~
  Q202=+5 ~
  Q210=+0 ~
  Q203=+0 ~
  Q204=+50 ~
  Q211=+0
15 L X+20 Y+20 R0 FMAX M99
16 CALL LBL 6 REP 2
17 CYCL DEF 14.0 CONTOUR
18 CYCL DEF 14.1 CONTOUR LABEL 7
19 CYCL DEF 20 CONTOUR DATA ~
  Q1=-5 ~
  Q2=+1 ~
  Q3=+0.2 ~
  Q4=+0 ~
  Q5=+0 ~
  Q6=+2 ~
  Q7=+50 ~
  Q8=+0 ~
  Q9=+1
20 CYCL DEF 22 ROUGH-OUT ~
  Q10=-5 ~
  Q11=+150 ~
  Q12=+500 ~
  Q18=+0 ~
  Q19=+0 ~
  Q208=+99999 ~
  Q401=+100 ~
  Q404=+0
21 CYCL CALL
22 M30
23 LBL 6
24 L IX+1 F100
25 LBL 0
26 LBL 7
27 L X+10 Y+10 RR
28 L X+10 Y+60
29 CR X+40 Y+60 R+20 DR-
30 L X+60 Y+10
31 L X+10 Y+10
32 LBL 0
33 END PGM SEED MM
`,
  },
  {
    name: 'seed.mpr',
    text: `[H
VERSION="4.0 Alpha"
INCH="0"
_BSX=600
_BSY=400
_BSZ=18

[001
L="600"
KM="Laenge"
B="400"

<100 \\WerkStck\\
LA="L"
BR="B"
DI="18"

<102 \\BohrVert\\
XA="32"
YA="37"
TI="13"
DU="5"
AN="3"
AB="32"

<112 \\Tasche\\
XA="300"
YA="200"
LA="80"
BR="40"
RD="5"
WI="0"
TI="6"
ZT="0"
XY="80"
T_="0"
F_="STANDARD"
DS="1"
KO="00"
!
`,
  },
  {
    name: 'seed.pgi',
    text: `<?xml version="1.0" encoding="utf-8"?>
<pgi>
 <params>
  <param key="L" value="600" description=""/>
  <param key="W" value="400" description=""/>
  <param key="E" value="W-37" description=""/>
 </params>
 <panel length="600" width="400" thickness="18" name="seed" quantity="1">
  <outlines>
   <outline x="0" y="400" bulge="0" banding="1"/>
   <outline x="600" y="400" bulge="0" banding="1"/>
   <outline x="600" y="0" bulge="-0.4" banding="0"/>
   <outline x="0" y="0" bulge="0" banding="0"/>
   <outline x="0" y="400" bulge="0" banding="0"/>
  </outlines>
  <hole x="32" y="E" z="0" diameter="5" depth="13" direction="z-" no="5" xi="32" yi="0" zi="0" enable="1" order="1"/>
  <hole x="600" y="200" z="9" diameter="8" depth="30" direction="x-" enable="1" order="2"/>
  <line startX="20" startY="380" startZ="0" endX="480" endY="380" endZ="0" width="4" depth="7" direction="z+" isSaw="1" enable="1" order="3"/>
 </panel>
</pgi>
`,
  },
  {
    name: 'seed.xml',
    text: `<KDTPanelFormat>
 <PANEL>
  <PanelLength>600</PanelLength>
  <PanelWidth>400</PanelWidth>
  <PanelThickness>18</PanelThickness>
  <PanelName>seed</PanelName>
  <PanelQuantity>1</PanelQuantity>
  <Inch>0</Inch>
  <Params>
   <Param Comment="" Key="L" Value="600.00"/>
   <Param Comment="" Key="W" Value="400.00"/>
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
 <CAD><TypeNo>2</TypeNo><TypeName>Horizontal Hole</TypeName><X1>L</X1><Y1>20</Y1><Z1>9</Z1><Quadrant>1</Quadrant><Depth>12</Depth><Diameter>3</Diameter><Enable>1</Enable></CAD>
 <CAD><TypeNo>3</TypeNo><TypeName>Vertical Line</TypeName><BeginX>10</BeginX><BeginY>380</BeginY><EndX>590</EndX><EndY>380</EndY><Width>4</Width><Depth>7</Depth><UseSaw>1</UseSaw><Enable>1</Enable></CAD>
</KDTPanelFormat>
`,
  },
];
