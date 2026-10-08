/**
 * Custom full-screen grade pass (runs on HDR linear colour, before tone mapping):
 * radial speed blur, chromatic aberration, anime speed lines, screen flash, hit vignette,
 * vignette, exposure / saturation / contrast grade.
 * OWNER: Visuals.
 */
export const GradeShader = {
  name: 'KartGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uCenter: { value: [0.5, 0.42] },
    uBlur: { value: 0 }, //       radial blur amount 0..1
    uCA: { value: 0 }, //         chromatic aberration amount 0..1
    uLines: { value: 0 }, //      anime speed lines 0..1
    uFlash: { value: 0 }, //      screen flash 0..1
    uFlashColor: { value: [1, 1, 1] },
    uHit: { value: 0 }, //        red damage pulse 0..1
    uVignette: { value: 0.28 },
    uExposure: { value: 1.0 },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.06 },
    uTint: { value: [1, 1, 1] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uBlur, uCA, uLines, uFlash, uHit, uVignette, uExposure, uSaturation, uContrast;
    uniform vec2 uCenter;
    uniform vec3 uFlashColor, uTint;
    varying vec2 vUv;

    float hash11(float p) {
      p = fract(p * 0.1031);
      p *= p + 33.33;
      p *= p + p;
      return fract(p);
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - uCenter;
      vec2 dA = vec2(d.x * uAspect, d.y);
      float dist = length(dA);

      vec3 col;
      if (uBlur > 0.001 || uCA > 0.001) {
        // radial blur toward the centre (stronger at the edges, clear around the kart)
        float k = uBlur * 0.06 * smoothstep(0.1, 0.65, dist);
        float ca = uCA * 0.006 * smoothstep(0.05, 0.7, dist);
        vec3 acc = vec3(0.0);
        const int N = 9;
        for (int i = 0; i < N; i++) {
          float f = float(i) / float(N - 1);
          vec2 p = uCenter + d * (1.0 - k * f);
          vec2 off = d * ca * (1.0 + f);
          acc.r += texture2D(tDiffuse, p + off).r;
          acc.g += texture2D(tDiffuse, p).g;
          acc.b += texture2D(tDiffuse, p - off).b;
        }
        col = acc / float(N);
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }

      // anime speed lines (white streaks radiating from the edges)
      if (uLines > 0.001) {
        float ang = atan(dA.y, dA.x);
        float seg = floor(ang * 26.0 + floor(uTime * 24.0) * 3.7);
        float h = hash11(seg);
        float width = 0.35 + 0.5 * hash11(seg + 17.0);
        float streak = smoothstep(width, 1.0, h) * smoothstep(0.34, 0.95, dist);
        streak *= step(0.55, hash11(seg * 1.7 + floor(uTime * 24.0)));
        col += vec3(1.0, 0.98, 0.92) * streak * uLines * 1.35;
      }

      // exposure + saturation + gentle contrast
      col *= uExposure * uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = pow(max(col / 0.18, vec3(0.0)), vec3(uContrast)) * 0.18;

      // vignette
      float v = smoothstep(0.42, 1.25, length(vec2(d.x * uAspect, d.y) * 1.05));
      col *= 1.0 - uVignette * v;

      // damage pulse + flash
      col = mix(col, col * vec3(1.0, 0.35, 0.3) + vec3(0.25, 0.0, 0.0) * v, uHit * (0.35 + 0.65 * v));
      float fl = clamp(uFlash, 0.0, 1.0);
      col = col * (1.0 + fl * 0.5) + uFlashColor * fl * fl * 1.1; // punchy but never a total white-out

      gl_FragColor = vec4(col, 1.0);
    }`,
};
