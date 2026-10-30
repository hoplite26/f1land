import * as THREE from 'three';
import { glowRingTexture, softDotTexture } from '@/three/track/textures';

/** Glowing ground ring under the followed / rival car. */
export class SelectionRing {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private t = 0;
  private flareT = 1;
  /** Short expanding flare (overtake by the followed car). */
  flare(): void {
    this.flareT = 0;
  }
  constructor(color: string, size = 9) {
    this.mat = new THREE.MeshBasicMaterial({ map: glowRingTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
  }
  update(dt: number, pos: THREE.Vector3 | null, reduced: boolean): void {
    if (!pos) {
      this.mesh.visible = false;
      return;
    }
    this.t += dt;
    this.mesh.visible = true;
    this.mesh.position.set(pos.x, 0.06, pos.z);
    this.flareT = Math.min(1, this.flareT + dt / 0.9);
    const fl = reduced ? 0 : Math.sin(this.flareT * Math.PI) * (1 - this.flareT * 0.4);
    const pulse = reduced ? 1 : 1 + Math.sin(this.t * 4) * 0.07;
    this.mesh.scale.setScalar(pulse + fl * 0.9);
    this.mat.opacity = Math.min(1, (reduced ? 0.9 : 0.75 + Math.sin(this.t * 4) * 0.2) + fl * 0.5);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** Thin cyan ribbon of the observed motion of the followed car (F1-047). */
export class MotionTrail {
  readonly mesh: THREE.Mesh;
  private readonly n: number;
  private pts: THREE.Vector3[] = [];
  private geo: THREE.BufferGeometry;
  private acc = 0;
  constructor(color = '#2fe6ff', n = 70) {
    this.n = n;
    this.geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 2 * 3);
    const alpha = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      alpha[i * 2] = alpha[i * 2 + 1] = 1 - i / (n - 1);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ float a = vA * vA * 0.5; gl_FragColor = vec4(uColor * a, a); }',
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }
  reset(): void {
    for (const v of this.pts) this.pool.push(v);
    this.pts = [];
  }
  private pool: THREE.Vector3[] = [];
  private tmp = new THREE.Vector3();
  update(dt: number, pos: THREE.Vector3 | null): void {
    if (!pos) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.acc += dt;
    if (this.acc > 0.06 || this.pts.length === 0) {
      this.acc = 0;
      // Recycle the oldest point instead of allocating.
      const v = this.pts.length >= this.n ? this.pts.pop()! : this.pool.pop() ?? new THREE.Vector3();
      this.pts.unshift(v.copy(pos));
    } else if (this.pts[0]) this.pts[0].copy(pos);
    const p = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const tmp = this.tmp;
    for (let i = 0; i < this.n; i++) {
      const a = this.pts[Math.min(i, this.pts.length - 1)] ?? pos;
      const b = this.pts[Math.min(i + 1, this.pts.length - 1)] ?? a;
      tmp.subVectors(a, b);
      if (tmp.lengthSq() < 1e-6) tmp.set(0, 0, 1);
      tmp.normalize();
      const w = 0.2 * (1 - i / this.n) + 0.04;
      p.setXYZ(i * 2, a.x - tmp.z * w, 0.12, a.z + tmp.x * w);
      p.setXYZ(i * 2 + 1, a.x + tmp.z * w, 0.12, a.z - tmp.x * w);
    }
    p.needsUpdate = true;
  }
  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Pooled additive particles: floor sparks, overtake bursts, fireworks. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private cursor = 0;
  private gravity: number;
  private bv = new THREE.Vector3();
  private active = 0;
  constructor(max = 900, gravity = 9.8) {
    this.max = max;
    this.gravity = gravity;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: { uMap: { value: softDotTexture() }, uScale: { value: 300 } },
      vertexShader: `attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vC; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, life: number, size: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const j = i * 3;
    this.pos[j] = p.x;
    this.pos[j + 1] = p.y;
    this.pos[j + 2] = p.z;
    this.vel[j] = v.x;
    this.vel[j + 1] = v.y;
    this.vel[j + 2] = v.z;
    this.col[j] = color.r;
    this.col[j + 1] = color.g;
    this.col[j + 2] = color.b;
    this.life[i] = life;
    this.size[i] = size;
    this.active = this.max;
  }
  burst(center: THREE.Vector3, color: THREE.Color, count: number, speed: number, life = 1.2, size = 1.6): void {
    for (let k = 0; k < count; k++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.5 + Math.random() * 0.5);
      this.emit(center, this.bv.set(Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp, Math.sin(ph) * Math.sin(th) * sp), color, life * (0.7 + Math.random() * 0.5), size);
    }
  }
  update(dt: number): void {
    // Idle pool: skip the loop and the buffer uploads.
    if (this.active === 0) return;
    let alive = 0;
    const g = this.gravity;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      alive++;
      const j = i * 3;
      this.vel[j + 1]! -= g * dt;
      this.pos[j]! += this.vel[j]! * dt;
      this.pos[j + 1]! += this.vel[j + 1]! * dt;
      this.pos[j + 2]! += this.vel[j + 2]! * dt;
      if (this.pos[j + 1]! < 0.02) {
        this.pos[j + 1] = 0.02;
        this.vel[j + 1] = -this.vel[j + 1]! * 0.3;
      }
      const fade = Math.min(1, this.life[i]! * 2);
      this.col[j]! *= 0.985 + fade * 0.015;
      this.col[j + 1]! *= 0.985 + fade * 0.015;
      this.col[j + 2]! *= 0.985 + fade * 0.015;
    }
    if (alive === 0) this.active = 0;
    const geo = this.points.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** Expanding shockwave ring (overtake moment). */
export class Shockwaves {
  readonly group = new THREE.Group();
  private items: Array<{ mesh: THREE.Mesh; t: number }> = [];
  private geo = new THREE.RingGeometry(0.8, 1, 48);
  spawn(pos: THREE.Vector3, color: string): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 0.2, pos.z);
    this.group.add(mesh);
    this.items.push({ mesh, t: 0 });
  }
  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      it.t += dt;
      const k = it.t / 0.9;
      it.mesh.scale.setScalar(2 + k * 16);
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.group.remove(it.mesh);
        (it.mesh.material as THREE.Material).dispose();
        this.items.splice(i, 1);
      }
    }
  }
  dispose(): void {
    this.items.forEach((i) => (i.mesh.material as THREE.Material).dispose());
    this.geo.dispose();
  }
}

/**
 * Soft light pillar above a highlighted car: readable from heli / overview
 * distances where the ground ring is only a few pixels. Fades in with distance.
 */
export class Beacon {
  readonly mesh: THREE.Mesh;
  private uniforms: { uColor: { value: THREE.Color }; uAlpha: { value: number }; uTime: { value: number } };
  constructor(color: string, height = 26, radius = 1.1) {
    this.uniforms = { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 }, uTime: { value: 0 } };
    const geo = new THREE.CylinderGeometry(radius * 0.35, radius, height, 16, 1, true).translate(0, height / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying vec2 vUv;
        void main(){
          float a = pow(1.0 - vUv.y, 1.6) * uAlpha;
          a *= 0.75 + 0.25 * sin(vUv.y * 18.0 - uTime * 4.0);
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
  }
  update(dt: number, pos: THREE.Vector3 | null, camPos: THREE.Vector3, reduced: boolean): void {
    if (!pos) {
      this.mesh.visible = false;
      return;
    }
    const d = camPos.distanceTo(pos);
    const target = THREE.MathUtils.smoothstep(d, 50, 160) * 0.42;
    this.uniforms.uAlpha.value += (target - this.uniforms.uAlpha.value) * Math.min(1, dt * 5);
    if (!reduced) this.uniforms.uTime.value += dt;
    this.mesh.visible = this.uniforms.uAlpha.value > 0.01;
    this.mesh.position.set(pos.x, 0.1, pos.z);
    // Thicker with distance so it stays a few pixels wide.
    const k = Math.max(1, d / 160);
    this.mesh.scale.set(k, 1, k);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Screen-space speed streaks (one draw call): thin radial lines converging on
 * the vanishing point, intensity driven by the subject speed in close shots.
 */
export class SpeedLines {
  readonly mesh: THREE.Mesh;
  private u = { uTime: { value: 0 }, uAmount: { value: 0 }, uCenter: { value: new THREE.Vector2(0, 0.05) }, uAspect: { value: 1 }, uColor: { value: new THREE.Color('#dff6ff') } };
  constructor() {
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform float uTime; uniform float uAmount; uniform vec2 uCenter; uniform float uAspect; uniform vec3 uColor; varying vec2 vP;
        float h(float n){ return fract(sin(n * 127.1) * 43758.5453); }
        void main(){
          vec2 d = vP - uCenter; d.x *= uAspect;
          float r = length(d);
          float a = atan(d.y, d.x);
          float cells = 150.0;
          float id = floor((a / 6.2831853 + 0.5) * cells);
          float f = fract((a / 6.2831853 + 0.5) * cells);
          float seed = h(id);
          if (seed < 0.55) discard;
          float line = smoothstep(0.5, 0.0, abs(f - 0.5) * (2.6 + seed * 3.0));
          float speed = 1.4 + seed * 1.8;
          float ph = fract(r * (0.9 + seed) - uTime * speed + seed * 7.0);
          float dash = smoothstep(0.0, 0.25, ph) * smoothstep(1.0, 0.55, ph);
          float edge = smoothstep(0.42, 1.25, r);
          float al = line * dash * edge * uAmount * (0.35 + seed * 0.4);
          gl_FragColor = vec4(uColor * al, al);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 60;
    this.mesh.visible = false;
  }
  update(dt: number, amount: number, aspect: number, cx: number, cy: number): void {
    const cur = this.u.uAmount.value;
    const a = cur + (amount - cur) * Math.min(1, dt * 4);
    this.u.uAmount.value = a;
    this.mesh.visible = a > 0.02;
    if (!this.mesh.visible) return;
    this.u.uTime.value += dt;
    this.u.uAspect.value = aspect;
    this.u.uCenter.value.set(THREE.MathUtils.clamp(cx, -0.6, 0.6), THREE.MathUtils.clamp(cy, -0.5, 0.5));
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Soft, normally blended puffs (brake smoke) that grow and fade; one draw call. */
export class SmokePuffs {
  readonly points: THREE.Points;
  private readonly max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private ageN: Float32Array;
  private cursor = 0;
  private active = 0;
  constructor(max = 160, color = '#b9c0c8') {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.ageN = new Float32Array(max).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('ageN', new THREE.BufferAttribute(this.ageN, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uMap: { value: softDotTexture() }, uColor: { value: new THREE.Color(color) } },
      vertexShader: `attribute float ageN; varying float vA; void main(){ vA = ageN; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = ageN >= 1.0 ? 0.0 : (0.8 + ageN * 3.4) * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; varying float vA; void main(){ float t = texture2D(uMap, gl_PointCoord).a; float a = t * 0.32 * (1.0 - vA) * smoothstep(0.0, 0.08, vA); gl_FragColor = vec4(uColor, a); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const j = i * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.vel[j] = vx;
    this.vel[j + 1] = vy;
    this.vel[j + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.ageN[i] = 0;
    this.active = this.max;
  }
  update(dt: number): void {
    if (this.active === 0) return;
    let alive = 0;
    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < this.max; i++) {
      if (this.ageN[i]! >= 1) continue;
      alive++;
      this.age[i]! += dt;
      this.ageN[i] = Math.min(1, this.age[i]! / this.life[i]!);
      const j = i * 3;
      this.vel[j]! *= drag;
      this.vel[j + 2]! *= drag;
      this.vel[j + 1] = this.vel[j + 1]! * drag + dt * 0.6;
      this.pos[j]! += this.vel[j]! * dt;
      this.pos[j + 1]! += this.vel[j + 1]! * dt;
      this.pos[j + 2]! += this.vel[j + 2]! * dt;
    }
    if (alive === 0) this.active = 0;
    const geo = this.points.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('ageN') as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** All car blob shadows in one instanced draw call (hidden instances are scaled to zero). */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private dirty = true;
  constructor(map: THREE.Texture, count: number) {
    const geo = new THREE.PlaneGeometry(2.5, 6.0).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map, color: 0x000000, transparent: true, opacity: 0.78, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = 'car-shadows';
    for (let i = 0; i < count; i++) this.set(i, null, 0);
  }
  set(i: number, pos: THREE.Vector3 | null, yaw: number, sx = 1, sz = 1): void {
    if (!pos) this.s.set(0, 0, 0);
    else this.s.set(sx, 1, sz);
    this.p.set(pos ? pos.x : 0, 0.03, pos ? pos.z : 0);
    this.q.setFromAxisAngle(UP_AXIS, yaw);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.dirty = true;
  }
  commit(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/**
 * Distant-car markers (F1-048 "small dots") as one point cloud: team-coloured
 * dots with a dark ring, fixed pixel size, drawn on top. Size 0 hides a dot.
 */
export class CarMarkers {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
  constructor(colors: string[], pixelRatio: number) {
    const n = Math.max(1, colors.length);
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    const c = new THREE.Color();
    colors.forEach((hex, i) => {
      c.set(hex);
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('mColor', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uPR: { value: pixelRatio } },
      vertexShader: `attribute float size; attribute vec3 mColor; uniform float uPR; varying vec3 vC; void main(){ vC = mColor; gl_PointSize = size * uPR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vC; void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p);
          if (r > 1.0) discard;
          float ring = smoothstep(0.62, 0.72, r) * (1.0 - smoothstep(0.86, 1.0, r));
          vec3 col = mix(vC, vec3(1.0), ring * 0.9);
          float a = 1.0 - smoothstep(0.9, 1.0, r);
          gl_FragColor = vec4(mix(vec3(0.02), col, step(r, 0.86) + ring), a * (r > 0.86 ? 0.55 : 1.0));
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.points.name = 'car-markers';
  }
  set(i: number, pos: THREE.Vector3 | null, px: number): void {
    this.size[i] = pos ? px : 0;
    if (pos) {
      this.pos[i * 3] = pos.x;
      this.pos[i * 3 + 1] = 2.2;
      this.pos[i * 3 + 2] = pos.z;
    }
  }
  setPixelRatio(pr: number): void {
    ((this.points.material as THREE.ShaderMaterial).uniforms.uPR as { value: number }).value = pr;
  }
  commit(): void {
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/**
 * Safety-car light bar glow: alternating amber billboards over the roof plus a
 * pulsing amber pool of light on the asphalt, in phase with the model's lamps.
 * Readable from heli / TV distances where the roof lamps are a few pixels.
 */
export class ScBeacons {
  readonly group = new THREE.Group();
  private l: THREE.Sprite;
  private r: THREE.Sprite;
  private pool: THREE.Mesh;
  private poolMat: THREE.MeshBasicMaterial;
  constructor(roofY: number) {
    const map = softDotTexture();
    const mk = () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: new THREE.Color('#ffa21f').multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      s.scale.set(1.6, 1.6, 1);
      s.renderOrder = 10;
      this.group.add(s);
      return s;
    };
    this.l = mk();
    this.r = mk();
    this.l.position.set(0.42, roofY + 0.08, -0.15);
    this.r.position.set(-0.42, roofY + 0.08, -0.15);
    this.poolMat = new THREE.MeshBasicMaterial({ map: glowRingTexture(), color: '#ff9a1a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.0, toneMapped: false });
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(5.5, 32).rotateX(-Math.PI / 2), this.poolMat);
    this.pool.position.y = 0.05;
    this.pool.renderOrder = 5;
    this.group.add(this.pool);
    this.group.visible = false;
  }
  /** Attach to the active safety/medical car root (or hide with null). */
  update(target: THREE.Object3D | null, on: boolean, t: number, camDist: number): void {
    if (!target || !on) {
      this.group.visible = false;
      return;
    }
    if (this.group.parent !== target) target.add(this.group);
    this.group.visible = true;
    // Same phase as the road-car lamps (3.2 Hz alternate).
    const ph = Math.floor(t * 3.2) % 2;
    const grow = 1 + Math.min(4, camDist / 60);
    this.l.scale.setScalar((ph ? 1.7 : 0.35) * grow);
    this.r.scale.setScalar((ph ? 0.35 : 1.7) * grow);
    this.poolMat.opacity = 0.32 + (ph ? 0.1 : 0);
  }
  dispose(): void {
    this.group.removeFromParent();
    (this.l.material as THREE.Material).dispose();
    (this.r.material as THREE.Material).dispose();
    this.pool.geometry.dispose();
    this.poolMat.dispose();
  }
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);
