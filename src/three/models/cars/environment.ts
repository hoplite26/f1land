/**
 * Night-race image-based lighting for the car paint/clearcoat: a dark dome
 * with floodlight panels and a warm horizon glow, prefiltered with PMREM.
 * Assign the result to `scene.environment`; the caller owns `dispose()`.
 */
import * as THREE from 'three';

export function createRaceEnvironment(renderer: THREE.WebGLRenderer, opts: { floodlights?: number } = {}): THREE.Texture {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 sky = mix(vec3(0.05, 0.07, 0.12), vec3(0.008, 0.01, 0.02), smoothstep(0.0, 0.6, h));
          vec3 glow = vec3(0.55, 0.32, 0.16) * exp(-abs(h) * 14.0) * 0.6;
          vec3 ground = vec3(0.025);
          gl_FragColor = vec4(h < 0.0 ? ground + glow * 0.4 : sky + glow, 1.0);
        }`,
    }),
  );
  env.add(dome);
  const n = opts.floodlights ?? 8;
  const panelGeo = new THREE.PlaneGeometry(9, 3);
  const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.9).multiplyScalar(9), side: THREE.DoubleSide });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const p = new THREE.Mesh(panelGeo, panelMat);
    p.position.set(Math.cos(a) * 40, 16 + (i % 2) * 5, Math.sin(a) * 40);
    p.lookAt(0, 0, 0);
    env.add(p);
  }
  // Soft overhead strip (gantry / grandstand roof lights).
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(60, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.8, 1).multiplyScalar(2.5) }));
  strip.position.set(0, 30, 0);
  strip.rotation.x = Math.PI / 2;
  env.add(strip);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.02);
  pmrem.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  panelGeo.dispose();
  panelMat.dispose();
  strip.geometry.dispose();
  (strip.material as THREE.Material).dispose();
  return rt.texture;
}

/**
 * Car-paint IBL matched to the session's time of day: a sky gradient with a
 * horizon glow, broad overhead softboxes (floodlights at night, sky/sun by
 * day) and a mid-grey ground bounce. Livery colours read as their team in
 * every lighting condition instead of reflecting a near-black night sky.
 * Assign to the car materials' `envMap`; the caller owns `dispose()` of the
 * returned render target.
 */
export function createCarEnvironment(renderer: THREE.WebGLRenderer, tod: 'day' | 'dusk' | 'night'): THREE.WebGLRenderTarget {
  const env = new THREE.Scene();
  const pal = {
    day: { zen: [0.32, 0.52, 0.85], hor: [0.85, 0.9, 0.95], glow: [1.0, 0.95, 0.85], ground: [0.22, 0.21, 0.2], box: 2.6 },
    dusk: { zen: [0.16, 0.18, 0.34], hor: [0.95, 0.55, 0.38], glow: [1.0, 0.55, 0.3], ground: [0.12, 0.1, 0.1], box: 3.2 },
    night: { zen: [0.02, 0.03, 0.06], hor: [0.12, 0.13, 0.2], glow: [0.6, 0.42, 0.28], ground: [0.06, 0.06, 0.07], box: 5.5 },
  }[tod];
  const v3 = (a: number[]) => `vec3(${a.map((x) => x.toFixed(3)).join(',')})`;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          vec3 d = normalize(vP);
          float h = d.y;
          vec3 sky = mix(${v3(pal.hor)}, ${v3(pal.zen)}, smoothstep(0.0, 0.7, h));
          vec3 glow = ${v3(pal.glow)} * exp(-abs(h) * 10.0) * 0.5;
          vec3 ground = ${v3(pal.ground)} * (0.7 + 0.3 * smoothstep(-0.6, 0.0, h));
          gl_FragColor = vec4(h < 0.0 ? ground + glow * 0.3 : sky + glow, 1.0);
        }`,
    }),
  );
  env.add(dome);
  const owned: Array<{ dispose(): void }> = [dome.geometry, dome.material as THREE.Material];
  // Softboxes: a ring of floodlight panels plus two long overhead strips (paint highlights along the body).
  const panelGeo = new THREE.PlaneGeometry(10, 3.5);
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.88).multiplyScalar(pal.box), side: THREE.DoubleSide });
  const cool = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.82, 0.9, 1).multiplyScalar(pal.box * 0.8), side: THREE.DoubleSide });
  owned.push(panelGeo, warm, cool);
  const n = tod === 'day' ? 4 : 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.35;
    const p = new THREE.Mesh(panelGeo, i % 2 ? cool : warm);
    p.position.set(Math.cos(a) * 38, 12 + (i % 3) * 5, Math.sin(a) * 38);
    p.lookAt(0, 0, 0);
    env.add(p);
  }
  const stripGeo = new THREE.PlaneGeometry(70, 4);
  owned.push(stripGeo);
  for (const x of [-9, 9]) {
    const strip = new THREE.Mesh(stripGeo, x < 0 ? warm : cool);
    strip.position.set(x, 32, 0);
    strip.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    env.add(strip);
  }
  if (tod === 'day') {
    const sun = new THREE.Mesh(new THREE.CircleGeometry(4, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.9).multiplyScalar(14) }));
    sun.position.set(20, 38, 14);
    sun.lookAt(0, 0, 0);
    env.add(sun);
    owned.push(sun.geometry, sun.material as THREE.Material);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.025, 0.1, 100);
  pmrem.dispose();
  owned.forEach((o) => o.dispose());
  return rt;
}
