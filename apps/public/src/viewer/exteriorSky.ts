import * as THREE from "three";

/** Procedural outdoor sky; no network textures, additional lights or per-frame allocations. */
export function createExteriorSky(reducedMotion: boolean) {
  const uniforms = {
    elapsed: { value: 0 },
    night: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `varying vec3 skyDirection;
      uniform float elapsed;
      uniform float night;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);
      }
      float cloudNoise(vec2 p) {
        return noise(p)*0.55 + noise(p*2.03)*0.28 + noise(p*4.09)*0.12 + noise(p*8.17)*0.05;
      }
      void main() {
        vec3 d = normalize(skyDirection);
        float h = pow(clamp((d.y+0.12)*2.0,0.0,1.0),0.65);
        vec3 day = mix(vec3(0.52,0.70,0.87),vec3(0.06,0.27,0.58),h);
        vec3 dusk = mix(vec3(0.012,0.020,0.045),vec3(0.002,0.006,0.018),h);
        vec3 color = mix(day,dusk,night);
        vec2 uv = d.xz / max(d.y+0.45,0.15)*3.0;
        float clouds = smoothstep(0.48,0.70,cloudNoise(uv+vec2(elapsed*0.005,elapsed*0.002)));
        clouds *= smoothstep(-0.05,0.15,d.y) * (1.0-smoothstep(0.8,1.0,d.y));
        color = mix(color,mix(vec3(1.0,0.97,0.92),vec3(0.025,0.035,0.06),night),clouds*0.85);
        float sun = pow(max(dot(d,normalize(vec3(-0.6,0.38,0.5))),0.0),240.0);
        color += vec3(1.0,0.70,0.35)*sun*(1.0-night)*0.5;
        gl_FragColor = vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const root = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material);
  root.name = "Exterior sky and drifting clouds";
  root.frustumCulled = false;
  root.renderOrder = -100;
  return {
    root,
    update(delta: number, camera: THREE.Camera) {
      root.position.copy(camera.position);
      if (!reducedMotion) uniforms.elapsed.value += delta;
    },
    setNight(night: boolean) { uniforms.night.value = night ? 1 : 0; },
    dispose() { root.geometry.dispose(); material.dispose(); },
  };
}
