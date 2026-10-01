import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type GeoPreviewPlacement = {
  altitudeM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  scale: number;
};

export default function GeoModelPreview({
  modelUrl,
  placement,
}: {
  modelUrl: string | null;
  placement: GeoPreviewPlacement;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pivotRef = useRef<THREE.Group | null>(null);
  const sourceBaseYRef = useRef(0);
  const [status, setStatus] = useState("Loading published GLB…");
  const [bounds, setBounds] = useState("");

  useEffect(() => {
    const pivot = pivotRef.current;
    if (!pivot) return;
    const scale = Math.max(0.001, Number.isFinite(placement.scale) ? placement.scale : 1);
    pivot.position.set(0, placement.altitudeM, 0);
    pivot.scale.setScalar(scale);
    pivot.rotation.order = "YXZ";
    pivot.rotation.set(
      THREE.MathUtils.degToRad(placement.pitchDeg),
      THREE.MathUtils.degToRad(-placement.headingDeg),
      THREE.MathUtils.degToRad(placement.rollDeg),
    );
    const model = pivot.children[0];
    if (model) model.position.y = -sourceBaseYRef.current;
  }, [
    placement.altitudeM,
    placement.headingDeg,
    placement.pitchDeg,
    placement.rollDeg,
    placement.scale,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !modelUrl) {
      setStatus(modelUrl ? "Preview initialize ho raha hai…" : "Published GLB required");
      return;
    }

    let disposed = false;
    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 10000);
    camera.position.set(48, 34, 54);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x07101b, 1);
    renderer.domElement.dataset.rekixoGeoModelPreview = "1";
    host.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 8, 0);
    controls.minDistance = 8;
    controls.maxDistance = 1500;
    controls.maxPolarAngle = Math.PI * 0.49;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x526172, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(-60, 90, 50);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd7ff, 0.35);
    fill.position.set(70, 35, -60);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshStandardMaterial({
        color: 0x17212d,
        roughness: 0.96,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.015;
    scene.add(ground);

    const grid = new THREE.GridHelper(500, 100, 0x63768f, 0x2e3e52);
    grid.position.y = 0;
    scene.add(grid);

    const pivot = new THREE.Group();
    scene.add(pivot);
    pivotRef.current = pivot;

    const applyPlacement = () => {
      const scale = Math.max(0.001, Number.isFinite(placement.scale) ? placement.scale : 1);
      pivot.position.set(0, placement.altitudeM, 0);
      pivot.scale.setScalar(scale);
      pivot.rotation.order = "YXZ";
      pivot.rotation.set(
        THREE.MathUtils.degToRad(placement.pitchDeg),
        THREE.MathUtils.degToRad(-placement.headingDeg),
        THREE.MathUtils.degToRad(placement.rollDeg),
      );
      const model = pivot.children[0];
      if (model) model.position.y = -sourceBaseYRef.current;
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    setStatus("Published GLB load ho raha hai…");
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (disposed) return;
        const root = gltf.scene || gltf.scenes[0];
        if (!root) {
          setStatus("GLB scene missing");
          return;
        }
        const sourceBounds = new THREE.Box3().setFromObject(root);
        if (sourceBounds.isEmpty()) {
          setStatus("GLB bounds empty");
          return;
        }
        const size = sourceBounds.getSize(new THREE.Vector3());
        sourceBaseYRef.current = sourceBounds.min.y;
        root.position.y = -sourceBaseYRef.current;
        root.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) mesh.frustumCulled = false;
        });
        pivot.add(root);
        applyPlacement();

        const scaledHeight = Math.max(1, size.y * Math.max(0.001, placement.scale));
        controls.target.set(0, placement.altitudeM + scaledHeight * 0.45, 0);
        const span = Math.max(size.x, size.y, size.z) * Math.max(0.001, placement.scale);
        const distance = Math.max(24, span * 2.35);
        camera.position.set(distance * 0.72, distance * 0.52, distance);
        controls.update();
        setBounds(
          `${size.x.toFixed(1)}m × ${size.y.toFixed(1)}m × ${size.z.toFixed(1)}m`,
        );
        setStatus("Ground-locked preview ready");
      },
      undefined,
      (error) => {
        if (!disposed) {
          console.error("3D Geo Mapper GLB preview failed", error);
          setStatus("Published GLB preview load nahi hua");
        }
      },
    );

    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      controls.dispose();
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material]
            : [];
        for (const material of materials) {
          const record = material as unknown as Record<string, unknown>;
          for (const value of Object.values(record)) {
            if (
              value &&
              typeof value === "object" &&
              (value as { isTexture?: boolean }).isTexture
            )
              (value as THREE.Texture).dispose();
          }
          material.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      pivotRef.current = null;
      host.replaceChildren();
    };
  }, [modelUrl]);

  return (
    <section className="geo3d-preview-card">
      <div className="geo3d-preview-head">
        <div>
          <p className="eyebrow">MODEL PREVIEW</p>
          <h3>Ground contact preview</h3>
        </div>
        <div className="geo3d-preview-status">
          <strong>{status}</strong>
          {bounds ? <small>GLB bounds {bounds}</small> : null}
        </div>
      </div>
      <div ref={hostRef} className="geo3d-model-canvas" aria-label="3D Geo model preview" />
      <p className="geo3d-help">
        Drag = orbit · wheel = zoom. Grid Y=0 ground reference hai; Ground offset 0 par
        authored GLB ka lowest point grid par lock hota hai.
      </p>
    </section>
  );
}
