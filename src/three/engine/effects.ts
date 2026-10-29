import * as THREE from 'three';
import { glowRingTexture, softDotTexture } from '@/three/track/textures';

/** Glowing ground ring under the followed / rival car. */
export class SelectionRing {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private t = 0;
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
    const pulse = reduced ? 1 : 1 + Math.sin(this.t * 4) * 0.07;
    this.mesh.scale.setScalar(pulse);
    this.mat.opacity = reduced ? 0.9 : 0.75 + Math.sin(this.t * 4) * 0.2;
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
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ float a = vA * vA * 0.85; gl_FragColor = vec4(uColor * a, a); }',
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
      const w = 0.32 * (1 - i / this.n) + 0.05;
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
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.size[i] = size;
  }
  burst(center: THREE.Vector3, color: THREE.Color, count: number, speed: number, life = 1.2, size = 1.6): void {
    for (let k = 0; k < count; k++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.5 + Math.random() * 0.5);
      this.emit(center, new THREE.Vector3(Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp, Math.sin(ph) * Math.sin(th) * sp), color, life * (0.7 + Math.random() * 0.5), size);
    }
  }
  update(dt: number): void {
    const g = this.gravity;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
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
    const target = THREE.MathUtils.smoothstep(d, 45, 140) * 0.55;
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
