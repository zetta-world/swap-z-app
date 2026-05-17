"use client";

/**
 * LiquidNexus — the cinematic 3D backdrop of the Swap dashboard.
 * A pulsing plasma core orbited by chain rings, with photon-particles
 * flowing along edges. Built with React Three Fiber + custom GLSL shaders.
 *
 * Renders behind the Swap Card. Falls back to gradient blobs on prefers-reduced-motion.
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { CHAINS } from "@/lib/chains";

// ─── Plasma core fragment shader ─────────────────────────────────────────
const plasmaVertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  uniform float uTime;
  uniform float uAmp;

  // Simplex noise (cnatoli)
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i); vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_); vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw); vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3))); p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  void main(){
    vNormal = normalize(normalMatrix * normal);
    float n = snoise(position * 1.8 + vec3(uTime * 0.4));
    vec3 displaced = position + normal * n * uAmp;
    vPos = displaced;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const plasmaFragment = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  void main(){
    float t = 0.5 + 0.5 * sin(uTime * 0.6 + vPos.x * 0.8 + vPos.y * 0.6);
    vec3 base = mix(uColorA, uColorB, t);
    base = mix(base, uColorC, 0.35 * (0.5 + 0.5 * sin(uTime * 0.4 + vPos.z * 1.2)));
    // Fresnel
    float fres = pow(1.0 - max(dot(normalize(vNormal), vec3(0.0,0.0,1.0)), 0.0), 2.0);
    base += fres * 0.8;
    gl_FragColor = vec4(base, 0.95);
  }
`;

function PlasmaCore() {
  const ref = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const uniforms = useMemo(
    () => ({
      uTime:   { value: 0 },
      uAmp:    { value: 0.18 },
      uColorA: { value: new THREE.Color("#00E8FF") },
      uColorB: { value: new THREE.Color("#9F5FFF") },
      uColorC: { value: new THREE.Color("#F5A623") },
    }),
    [],
  );

  useFrame((_, dt) => {
    if (ref.current)     ref.current.uniforms.uTime.value += dt;
    if (meshRef.current) {
      meshRef.current.rotation.y += dt * 0.08;
      meshRef.current.rotation.x += dt * 0.04;
    }
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1.1, 24]} />
      <shaderMaterial
        ref={ref}
        vertexShader={plasmaVertex}
        fragmentShader={plasmaFragment}
        uniforms={uniforms}
        transparent
      />
    </mesh>
  );
}

function CoreHalo() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const s = 1.6 + Math.sin(state.clock.elapsedTime * 0.8) * 0.06;
    ref.current.scale.set(s, s, s);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 40, 40]} />
      <meshBasicMaterial color="#00E8FF" transparent opacity={0.06} />
    </mesh>
  );
}

interface ChainRingProps {
  radius: number;
  tilt: number;
  speed: number;
  color: string;
  count: number;
  baseAngle: number;
}

function ChainRing({ radius, tilt, speed, color, count, baseAngle }: ChainRingProps) {
  const groupRef    = useRef<THREE.Group>(null);
  const ringRef     = useRef<THREE.LineSegments>(null);
  const particlesRef = useRef<THREE.Points>(null);

  // Pre-build ring line
  const ringPositions = useMemo(() => {
    const pts: number[] = [];
    const segs = 96;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
    return new Float32Array(pts);
  }, [radius]);

  // Pre-build particle positions
  const particles = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + baseAngle;
      arr[i * 3]     = Math.cos(a) * radius;
      arr[i * 3 + 1] = 0;
      arr[i * 3 + 2] = Math.sin(a) * radius;
    }
    return arr;
  }, [radius, count, baseAngle]);

  const phase = useRef(baseAngle);

  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += dt * speed;
    phase.current += dt * speed * 1.2;
    if (particlesRef.current) {
      const pos = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + phase.current;
        pos.setXYZ(i, Math.cos(a) * radius, Math.sin(phase.current * 0.5 + i) * 0.05, Math.sin(a) * radius);
      }
      pos.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} rotation={[tilt, 0, 0]}>
      <lineSegments ref={ringRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[ringPositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={0.35} />
      </lineSegments>

      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[particles, 3]}
          />
        </bufferGeometry>
        <pointsMaterial color={color} size={0.07} transparent opacity={0.9} sizeAttenuation />
      </points>
    </group>
  );
}

function NexusScene() {
  // Build chain rings: pick chains and assign each a radius/tilt/speed
  const rings = useMemo(
    () =>
      CHAINS.slice(0, 8).map((c, i) => ({
        id:        c.id,
        radius:    1.9 + i * 0.32,
        tilt:      (i % 2 === 0 ? 0.18 : -0.12) + (i * 0.04),
        speed:     0.06 + i * 0.012,
        color:     c.color,
        count:     2 + (i % 3),
        baseAngle: (i / 8) * Math.PI * 2,
      })),
    [],
  );

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 3, 3]} intensity={1.2} color="#00E8FF" />
      <pointLight position={[-3, -2, 2]} intensity={0.8} color="#9F5FFF" />

      <CoreHalo />
      <PlasmaCore />

      {rings.map((r, i) => (
        <ChainRing key={i} {...r} />
      ))}
    </>
  );
}

export default function LiquidNexus() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  if (reduced) {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full bg-grad-cyan opacity-15 blur-3xl" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none">
      <Canvas
        camera={{ position: [0, 1.2, 5.4], fov: 50 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      >
        <NexusScene />
      </Canvas>
    </div>
  );
}
