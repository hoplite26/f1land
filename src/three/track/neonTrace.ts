import * as THREE from 'three';
import type { CircuitData } from '@/data/circuits/types';
import type { TrackGeometry } from '@/data/circuits/geometry';
import type { ModelQuality } from '@/three/models/types';
import { ZONE_COLORS } from './trackMesh';

const VERT = /* glsl */ `
  attribute float aSide;
  attribute vec2 aNormal;
  attribute float aSector;
  attribute float aS;
  uniform float uPxScale;
  uniform float uHalfPx;
  uniform float uMinHalf;
  varying float vSide;
  varying float vSector;
  varying float vS;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // Constant on-screen width: metres per pixel grow linearly with the distance to the camera.
    float hw = max(uMinHalf, uHalfPx * uPxScale * distance(cameraPosition, wp.xyz));
    wp.xz += aNormal * aSide * hw;
    vSide = aSide;
    vSector = aSector;
    vS = aS;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uColors[3];
  uniform float uSelected;
  uniform float uZones;
  uniform float uFade;
  uniform float uTime;
  varying float vSide;
  varying float vSector;
  varying float vS;
  void main() {
    float x = abs(vSide);
    float core = 1.0 - smoothstep(0.2, 0.32, x);
    float glow = pow(1.0 - x, 2.4) * 0.6;
    int i = int(floor(vSector + 0.5));
    vec3 c = i == 0 ? uColors[0] : (i == 1 ? uColors[1] : uColors[2]);
    c = mix(vec3(0.82, 0.93, 1.0), c, uZones);
    float sel = uSelected < -0.5 ? 1.0 : (abs(vSector - uSelected) < 0.5 ? 1.5 : 0.3);
    // Running light in the race direction.
    float run = smoothstep(0.86, 1.0, fract(vS / 260.0 - uTime * 0.18)) * 0.8;
    float a = clamp((core * (1.0 + run) + glow) * sel, 0.0, 1.0) * uFade;
    // Premultiplied "over": the core replaces the ground colour, so the neon reads on bright day grass too.
    gl_FragColor = vec4(mix(c, vec3(1.0), core * run * 0.5) * a, a);
  }`;

/**
 * Broadcast-style neon trace of the circuit for high cameras (overview,
 * zone framing): one ribbon whose width is resolved in the vertex shader to a
 * constant few pixels at any distance, coloured per sector (S1 cyan, S2 lime,
 * S3 violet) with the selected prediction zone emphasised. Fades out as the
 * camera descends to car level, where the road and zone curtains take over.
 * One draw call, unaffected by fog.
 */
export class NeonTrace {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: {
    uColors: { value: THREE.Color[] };
    uSelected: { value: number };
    uZones: { value: number };
    uFade: { value: number };
    uTime: { value: number };
    uPxScale: { value: number };
    uHalfPx: { value: number };
    uMinHalf: { value: number };
  };

  constructor(geom: TrackGeometry, circuit: CircuitData, quality: ModelQuality) {
    const L = geom.length;
    const step = quality === 'low' ? 9 : 6;
    const rows = Math.max(8, Math.ceil(L / step));
    const count = (rows + 1) * 2;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 2);
    const side = new Float32Array(count);
    const sector = new Float32Array(count);
    const arc = new Float32Array(count);
    const p: [number, number] = [0, 0];
    const inSector = (s: number, a: number, b: number) => (a <= b ? s >= a && s < b : s >= a || s < b);
    for (let r = 0; r <= rows; r++) {
      const s = ((r / rows) * L) % L;
      geom.pointAt(s, 0, p);
      const h = geom.headingAt(s);
      // Left normal of the heading in circuit space (x east, y north) → world (x, -z).
      const nx = -Math.sin(h);
      const nz = -Math.cos(h);
      const sec = Math.max(0, circuit.sectors.findIndex((x) => inSector(s, x.startS, x.endS)));
      for (let k = 0; k < 2; k++) {
        const v = r * 2 + k;
        pos[v * 3] = p[0];
        pos[v * 3 + 1] = 0.35;
        pos[v * 3 + 2] = -p[1];
        nrm[v * 2] = nx;
        nrm[v * 2 + 1] = nz;
        side[v] = k === 0 ? -1 : 1;
        sector[v] = sec;
        arc[v] = (r / rows) * L;
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rows; r++) {
      const a = r * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aNormal', new THREE.BufferAttribute(nrm, 2));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aSector', new THREE.BufferAttribute(sector, 1));
    g.setAttribute('aS', new THREE.BufferAttribute(arc, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 60;
    this.uniforms = {
      uColors: { value: ZONE_COLORS.map((c) => new THREE.Color(c)) },
      uSelected: { value: -1 },
      uZones: { value: 1 },
      uFade: { value: 0 },
      uTime: { value: 0 },
      uPxScale: { value: 0.001 },
      uHalfPx: { value: 5 },
      uMinHalf: { value: circuit.widthM * 0.5 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'neon-trace';
    this.mesh.renderOrder = 4;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  /** 0 at car level … 1 for high cameras. */
  get fade(): number {
    return this.uniforms.uFade.value;
  }

  /** Per frame: camera-height fade, pixel scale, selection and zone colouring. */
  update(camera: THREE.PerspectiveCamera, viewportPx: number, dt: number, selected: 1 | 2 | 3 | null, zones: boolean, reducedMotion: boolean): void {
    const u = this.uniforms;
    // Follows the camera height directly: camera moves are already smooth and cuts should cut.
    u.uFade.value = THREE.MathUtils.smoothstep(camera.position.y, 85, 260);
    this.mesh.visible = u.uFade.value > 0.005;
    if (!this.mesh.visible) return;
    if (!reducedMotion) u.uTime.value += dt;
    u.uPxScale.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, viewportPx);
    u.uSelected.value = selected ? selected - 1 : -1;
    u.uZones.value += ((zones || selected ? 1 : 0) - u.uZones.value) * Math.min(1, dt * 6);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
