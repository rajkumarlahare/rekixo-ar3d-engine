import * as THREE from "three";

export interface ExteriorSolarState {
  /** Direction from the site toward the apparent sun, in world space. */
  direction: THREE.Vector3;
  /** Smoothly eased daylight amount, 0 at night and 1 in full daylight. */
  daylight: number;
  /** Warm dawn/dusk tint amount. */
  goldenHour: number;
  /** Simulated local solar time, in hours. */
  timeOfDay: number;
}

const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1);
const smoothRange = (start: number, end: number, value: number) => {
  const amount = clamp01((value - start) / Math.max(end - start, 0.0001));
  return amount * amount * (3 - 2 * amount);
};

/** Art-directed east-to-west sun arc for a consistent cinematic customer preview. */
function updateSolarState(hours: number, state: ExteriorSolarState) {
  const progress = (hours - 6) / 12;
  const azimuth = THREE.MathUtils.lerp(-1.18, 1.18, clamp01(progress));
  const elevation = Math.sin(progress * Math.PI) * 0.82;
  const horizontal = Math.cos(elevation);
  state.direction
    .set(
      Math.sin(azimuth) * horizontal,
      Math.sin(elevation),
      Math.cos(azimuth) * horizontal,
    )
    .normalize();
  state.timeOfDay = hours;
  state.daylight =
    smoothRange(5.55, 7.35, hours) *
    (1 - smoothRange(17.15, 19.05, hours));
  state.goldenHour = Math.max(
    1 - smoothRange(6.15, 9.25, hours),
    smoothRange(15.6, 18.35, hours),
  );
}

/**
 * Procedural outdoor sky with a short sunrise reveal, layered moving clouds,
 * horizon haze, and a sun disc aligned to the viewer's directional light.
 * The solar arc is art-directed until project releases carry real coordinates.
 */
export function createExteriorSky(reducedMotion: boolean, driftClouds = true) {
  const uniforms = {
    elapsed: { value: 0 },
    night: { value: 0 },
    sunDirection: { value: new THREE.Vector3(0, 0.7, 1).normalize() },
    daylight: { value: 1 },
    goldenHour: { value: 0 },
  };
  const solarState: ExteriorSolarState = {
    direction: new THREE.Vector3(),
    daylight: 1,
    goldenHour: 0,
    timeOfDay: 9,
  };
  let sunriseElapsed = reducedMotion ? 45 : 0;
  let solarTime = reducedMotion ? 9 : 5.5;
  const updateSolar = (hours: number) => {
    solarTime = normalizedHour(hours);
    updateSolarState(solarTime, solarState);
    uniforms.sunDirection.value.copy(solarState.direction);
    uniforms.daylight.value = solarState.daylight;
    uniforms.goldenHour.value = solarState.goldenHour;
  };
  updateSolar(solarTime);

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
      uniform vec3 sunDirection;
      uniform float daylight;
      uniform float goldenHour;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(
          mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),
          mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),
          f.y
        );
      }
      float cloudNoise(vec2 p) {
        return noise(p)*0.55 + noise(p*2.03)*0.28 +
          noise(p*4.09)*0.12 + noise(p*8.17)*0.05;
      }
      void main() {
        vec3 d = normalize(skyDirection);
        vec3 sunDir = normalize(sunDirection);
        float horizon = smoothstep(-0.16, 0.48, d.y);
        vec3 dawnHorizon = vec3(0.96, 0.43, 0.24);
        vec3 dayHorizon = vec3(0.70, 0.82, 0.91);
        vec3 zenith = vec3(0.08, 0.31, 0.63);
        vec3 horizonColor = mix(dawnHorizon, dayHorizon, daylight);
        vec3 daySky = mix(horizonColor, zenith, pow(horizon, 0.72));
        daySky = mix(
          daySky,
          vec3(0.98, 0.53, 0.31),
          goldenHour * (1.0 - horizon) * 0.36
        );
        vec3 nightSky = mix(
          vec3(0.014, 0.025, 0.055),
          vec3(0.003, 0.008, 0.025),
          horizon
        );
        vec3 color = mix(daySky, nightSky, night);

        // Low haze blooms around the sun at dawn, but falls away in daytime.
        float sunAlignment = max(dot(d, sunDir), 0.0);
        float horizonGlow = exp(-abs(d.y - max(sunDir.y, -0.02)) * 8.5);
        color += vec3(1.0, 0.40, 0.17) * horizonGlow *
          goldenHour * (1.0 - night) * 0.25;
        color += vec3(1.0, 0.71, 0.43) *
          pow(sunAlignment, 24.0) * (0.12 + 0.2 * goldenHour) * (1.0 - night);
        float sunDisc = pow(sunAlignment, 850.0) *
          smoothstep(-0.08, 0.10, sunDir.y) * (1.0 - night);
        color += mix(vec3(1.0, 0.56, 0.28), vec3(1.0, 0.94, 0.79), daylight) * sunDisc;

        vec2 uv = d.xz / max(d.y + 0.45, 0.15) * 3.0;
        vec2 lowFlow = vec2(elapsed * 0.0045, elapsed * 0.0014);
        vec2 highFlow = vec2(-elapsed * 0.0018, elapsed * 0.0006);
        float lowCloud = smoothstep(0.47, 0.69, cloudNoise(uv + lowFlow));
        float highCloud = smoothstep(
          0.53, 0.73, cloudNoise(uv * vec2(0.43, 0.8) + highFlow)
        );
        float cloudMask = max(lowCloud * 0.86, highCloud * 0.24);
        cloudMask *= smoothstep(-0.08, 0.13, d.y) *
          (1.0 - smoothstep(0.78, 0.98, d.y));
        float cloudLight = 0.72 + 0.28 * smoothstep(-0.2, 0.65, sunAlignment);
        vec3 dayCloud = mix(
          vec3(0.96, 0.62, 0.43),
          vec3(1.0, 0.985, 0.96),
          daylight
        ) * cloudLight;
        vec3 nightCloud = vec3(0.035, 0.047, 0.075);
        color = mix(color, mix(dayCloud, nightCloud, night), cloudMask * 0.86);

        gl_FragColor = vec4(color, 1.0);
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
    solarState,
    update(delta: number, camera: THREE.Camera) {
      root.position.copy(camera.position);
      if (!reducedMotion && sunriseElapsed < 45) {
        sunriseElapsed = Math.min(45, sunriseElapsed + delta);
        // Slow enough to read as sunrise, short enough for a customer-facing reveal.
        updateSolar(5.5 + (3.5 * sunriseElapsed) / 45);
      }
      if (!reducedMotion && driftClouds) uniforms.elapsed.value += delta;
    },
    setNight(night: boolean) {
      uniforms.night.value = night ? 1 : 0;
    },
    dispose() {
      root.geometry.dispose();
      material.dispose();
    },
  };
}
