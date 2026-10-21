/**
 * NC 장면에 쓰는 작은 그물 만들기: 상자(축 나란·회전), 원기둥, 다각형 기둥, 여러 개를 한 그물로 합치기.
 * 정점·법선·번호는 형식 배열로 — 뷰어 계약(Mesh3d)에 바로 넣는다.
 */

/** 그물 조각 모음(합쳐서 한 Mesh3d로) */
export class MeshAccum {
  pos: number[] = [];
  nrm: number[] = [];
  idx: number[] = [];
  edges: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private quad(p: number[][], n: readonly number[]): void {
    const b = this.vertexCount;
    for (const q of p) {
      this.pos.push(q[0]!, q[1]!, q[2]!);
      this.nrm.push(n[0]!, n[1]!, n[2]!);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  /**
   * 방향 있는 상자: 원점 o(한 모서리), 세 변 벡터 u·v·w(서로 수직, 오른손).
   * 모서리선 12개도 edges에 넣는다.
   */
  box(o: readonly number[], u: readonly number[], v: readonly number[], w: readonly number[], withEdges = true): void {
    const P = (a: number, b: number, c: number): number[] => [
      o[0]! + a * u[0]! + b * v[0]! + c * w[0]!,
      o[1]! + a * u[1]! + b * v[1]! + c * w[1]!,
      o[2]! + a * u[2]! + b * v[2]! + c * w[2]!,
    ];
    const unit = (x: readonly number[], s = 1): number[] => {
      const l = Math.hypot(x[0]!, x[1]!, x[2]!) || 1;
      return [(s * x[0]!) / l, (s * x[1]!) / l, (s * x[2]!) / l];
    };
    // 여섯 면(바깥 법선, 반시계 감기)
    this.quad([P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0)], unit(w, -1));
    this.quad([P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)], unit(w));
    this.quad([P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)], unit(v, -1));
    this.quad([P(0, 1, 0), P(0, 1, 1), P(1, 1, 1), P(1, 1, 0)], unit(v));
    this.quad([P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)], unit(u, -1));
    this.quad([P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)], unit(u));
    if (withEdges) {
      const c = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)];
      const E = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      for (let i = 0; i < E.length; i += 2) this.edges.push(...c[E[i]!]!, ...c[E[i + 1]!]!);
    }
  }

  /** 축 나란한 상자 */
  aabb(min: readonly number[], max: readonly number[], withEdges = true): void {
    this.box(min, [max[0]! - min[0]!, 0, 0], [0, max[1]! - min[1]!, 0], [0, 0, max[2]! - min[2]!], withEdges);
  }

  /**
   * 원기둥: 시작 중심 a에서 방향 d(단위 벡터)로 길이 len, 반지름 r. 양 끝 뚜껑 포함.
   * 둘레 나누기 수 seg. 원 테두리 두 개를 edges에 넣는다.
   */
  cylinder(a: readonly number[], d: readonly number[], len: number, r: number, seg = 16, withEdges = true): void {
    // d에 수직인 두 축
    const t = Math.abs(d[2]!) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let e1 = [d[1]! * t[2]! - d[2]! * t[1]!, d[2]! * t[0]! - d[0]! * t[2]!, d[0]! * t[1]! - d[1]! * t[0]!];
    const l1 = Math.hypot(e1[0]!, e1[1]!, e1[2]!) || 1;
    e1 = e1.map((x) => x / l1);
    const e2 = [d[1]! * e1[2]! - d[2]! * e1[1]!, d[2]! * e1[0]! - d[0]! * e1[2]!, d[0]! * e1[1]! - d[1]! * e1[0]!];
    const b = [a[0]! + d[0]! * len, a[1]! + d[1]! * len, a[2]! + d[2]! * len];
    const ring = (c: readonly number[], k: number): number[] => {
      const th = (k / seg) * Math.PI * 2;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      return [c[0]! + r * (cs * e1[0]! + sn * e2[0]!), c[1]! + r * (cs * e1[1]! + sn * e2[1]!), c[2]! + r * (cs * e1[2]! + sn * e2[2]!)];
    };
    // 옆면
    const base = this.vertexCount;
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const n = [Math.cos(th) * e1[0]! + Math.sin(th) * e2[0]!, Math.cos(th) * e1[1]! + Math.sin(th) * e2[1]!, Math.cos(th) * e1[2]! + Math.sin(th) * e2[2]!];
      const p0 = ring(a, k);
      const p1 = ring(b, k);
      this.pos.push(...p0, ...p1);
      this.nrm.push(...n, ...n);
    }
    for (let k = 0; k < seg; k++) {
      const i0 = base + k * 2;
      this.idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
    }
    // 뚜껑
    for (const [c, sgn] of [
      [a, -1],
      [b, 1],
    ] as const) {
      const cb = this.vertexCount;
      this.pos.push(c[0]!, c[1]!, c[2]!);
      this.nrm.push(sgn * d[0]!, sgn * d[1]!, sgn * d[2]!);
      for (let k = 0; k < seg; k++) {
        this.pos.push(...ring(c, k));
        this.nrm.push(sgn * d[0]!, sgn * d[1]!, sgn * d[2]!);
      }
      for (let k = 0; k < seg; k++) {
        const i1 = cb + 1 + k;
        const i2 = cb + 1 + ((k + 1) % seg);
        if (sgn > 0) this.idx.push(cb, i1, i2);
        else this.idx.push(cb, i2, i1);
      }
      if (withEdges)
        for (let k = 0; k < seg; k++) {
          this.edges.push(...ring(c, k), ...ring(c, k + 1));
        }
    }
  }

  /**
   * 기둥: 면 위의 닫힌 다각형(xyz 이어 붙임, 첫 점을 되풀이하지 않음)을 dir(단위 벡터) 쪽으로 depth만큼 민다.
   * 두 뚜껑은 귀 자르기로 삼각형을 만든다(스스로 꼬인 다각형은 다 채우지 못할 수 있다). 위·아래 테두리와
   * 꺾인 꼭짓점의 세로 모서리를 edges에 넣는다.
   */
  prism(outline: ArrayLike<number>, dir: readonly number[], depth: number, withEdges = true): void {
    const d = [dir[0]!, dir[1]!, dir[2]!];
    // dir에 수직인 두 축: e1 × e2 = -dir(바깥에서 보아 반시계가 +)
    const t = Math.abs(d[2]!) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let e1 = [t[1]! * d[2]! - t[2]! * d[1]!, t[2]! * d[0]! - t[0]! * d[2]!, t[0]! * d[1]! - t[1]! * d[0]!];
    const l1 = Math.hypot(e1[0]!, e1[1]!, e1[2]!) || 1;
    e1 = e1.map((x) => x / l1);
    const e2 = [e1[1]! * d[2]! - e1[2]! * d[1]!, e1[2]! * d[0]! - e1[0]! * d[2]!, e1[0]! * d[1]! - e1[1]! * d[0]!];
    let pts: number[][] = [];
    for (let i = 0; i + 2 < outline.length; i += 3) {
      const p = [outline[i]!, outline[i + 1]!, outline[i + 2]!];
      const q = pts[pts.length - 1];
      if (!q || Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!) > 1e-9) pts.push(p);
    }
    if (pts.length > 1 && Math.hypot(pts[0]![0]! - pts[pts.length - 1]![0]!, pts[0]![1]! - pts[pts.length - 1]![1]!, pts[0]![2]! - pts[pts.length - 1]![2]!) <= 1e-9) pts.pop();
    if (pts.length < 3 || !(depth > 0)) return;
    const uv = (p: number[]): [number, number] => [p[0]! * e1[0]! + p[1]! * e1[1]! + p[2]! * e1[2]!, p[0]! * e2[0]! + p[1]! * e2[1]! + p[2]! * e2[2]!];
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = uv(pts[i]!);
      const [bx, by] = uv(pts[(i + 1) % pts.length]!);
      area += ax * by - bx * ay;
    }
    if (area < 0) pts = pts.reverse();
    const n = pts.length;
    const off = d.map((x) => x * depth);
    const low = pts.map((p) => [p[0]! + off[0]!, p[1]! + off[1]!, p[2]! + off[2]!]);
    // 뚜껑: 면 쪽(바깥 법선 -dir)은 반시계 그대로, 깊은 쪽(+dir)은 뒤집어서
    const tris = earClip(pts.map(uv));
    for (const [ring, sgn] of [
      [pts, -1],
      [low, 1],
    ] as const) {
      const b = this.vertexCount;
      for (const p of ring) {
        this.pos.push(p[0]!, p[1]!, p[2]!);
        this.nrm.push(sgn * d[0]!, sgn * d[1]!, sgn * d[2]!);
      }
      for (let k = 0; k < tris.length; k += 3) {
        if (sgn < 0) this.idx.push(b + tris[k]!, b + tris[k + 1]!, b + tris[k + 2]!);
        else this.idx.push(b + tris[k]!, b + tris[k + 2]!, b + tris[k + 1]!);
      }
    }
    // 옆면: 바깥 법선 = dir × 변
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const c = pts[(i + 1) % n]!;
      const e = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const nr = [d[1]! * e[2]! - d[2]! * e[1]!, d[2]! * e[0]! - d[0]! * e[2]!, d[0]! * e[1]! - d[1]! * e[0]!];
      const ln = Math.hypot(nr[0]!, nr[1]!, nr[2]!) || 1;
      this.quad([a, low[i]!, low[(i + 1) % n]!, c], nr.map((x) => x / ln));
    }
    if (!withEdges) return;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.edges.push(...pts[i]!, ...pts[j]!, ...low[i]!, ...low[j]!);
      // 꺾인 꼭짓점(25도 넘게)만 세로 모서리
      const [px, py] = uv(pts[(i + n - 1) % n]!);
      const [cx, cy] = uv(pts[i]!);
      const [nx, ny] = uv(pts[j]!);
      const a0 = Math.atan2(cy - py, cx - px);
      const a1 = Math.atan2(ny - cy, nx - cx);
      let turn = Math.abs(a1 - a0);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > (25 * Math.PI) / 180) this.edges.push(...pts[i]!, ...low[i]!);
    }
  }

  isEmpty(): boolean {
    return this.idx.length === 0;
  }

  /** 형식 배열로 */
  arrays(): { positions: Float32Array; normals: Float32Array; indices: Uint32Array; edges?: Float32Array } {
    const out: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; edges?: Float32Array } = {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      indices: new Uint32Array(this.idx),
    };
    if (this.edges.length) out.edges = new Float32Array(this.edges);
    return out;
  }
}

/**
 * 반시계 단순 다각형을 귀 자르기로 삼각형으로 나눈다(번호 셋씩). 일직선 꼭짓점은 빼고 넘어가며,
 * 귀를 더 찾지 못하면(꼬인 다각형) 그때까지 만든 것만 돌려준다.
 */
export function earClip(pts: readonly (readonly [number, number])[]): number[] {
  const idx = pts.map((_, i) => i);
  const out: number[] = [];
  const cross = (a: number, b: number, c: number): number => {
    const A = pts[a]!;
    const B = pts[b]!;
    const C = pts[c]!;
    return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
  };
  const scale = pts.reduce((m, p) => Math.max(m, Math.abs(p[0]), Math.abs(p[1])), 1);
  const eps = 1e-12 * scale * scale;
  while (idx.length > 3) {
    let cut = -1;
    for (let k = 0; k < idx.length && cut < 0; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length]!;
      const i1 = idx[k]!;
      const i2 = idx[(k + 1) % idx.length]!;
      if (cross(i0, i1, i2) <= eps) continue;
      let inside = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (cross(i0, i1, j) >= -eps && cross(i1, i2, j) >= -eps && cross(i2, i0, j) >= -eps) {
          inside = true;
          break;
        }
      }
      if (!inside) {
        out.push(i0, i1, i2);
        cut = k;
      }
    }
    if (cut < 0) {
      // 일직선 꼭짓점을 빼 본다
      cut = idx.findIndex((i1, k) => Math.abs(cross(idx[(k + idx.length - 1) % idx.length]!, i1, idx[(k + 1) % idx.length]!)) <= eps);
      if (cut < 0) return out;
    }
    idx.splice(cut, 1);
  }
  if (cross(idx[0]!, idx[1]!, idx[2]!) > eps) out.push(idx[0]!, idx[1]!, idx[2]!);
  return out;
}

/** 공구·가공별 색(밝은 배경·어두운 배경 모두에서 보이는 것) */
export const TOOL_COLORS: readonly (readonly [number, number, number, number])[] = [
  [0.12, 0.47, 0.71, 1],
  [0.84, 0.15, 0.16, 1],
  [0.17, 0.63, 0.17, 1],
  [1.0, 0.5, 0.05, 1],
  [0.58, 0.4, 0.74, 1],
  [0.55, 0.34, 0.29, 1],
  [0.89, 0.47, 0.76, 1],
  [0.09, 0.75, 0.81, 1],
  [0.74, 0.74, 0.13, 1],
  [0.0, 0.3, 0.6, 1],
  [0.6, 0.0, 0.3, 1],
  [0.3, 0.55, 0.0, 1],
];

/** 0~1 값을 파랑→초록→빨강으로 */
export function rampColor(t: number): [number, number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  if (x < 0.5) {
    const k = x * 2;
    return [0.1, 0.3 + 0.5 * k, 0.9 - 0.6 * k, 1];
  }
  const k = (x - 0.5) * 2;
  return [0.1 + 0.8 * k, 0.8 - 0.6 * k, 0.3 - 0.2 * k, 1];
}
