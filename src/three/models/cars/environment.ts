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
