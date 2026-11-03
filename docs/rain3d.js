// Optional 3D glyph rain (Three.js, instanced). Loaded lazily after first paint by index.html.
// If anything is missing or goes wrong, the 2D canvas rain in index.html simply keeps running
// (or resumes) via window.rain2d.setSuspended(false). Only one rain runs at a time.
// Debug: ?rain=2d forces the 2D rain; ?rain=3d also allows software WebGL renderers.

var CHARS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789<>/{}=".split("");

function mode(){
  var m = /[?&]rain=(\w+)/.exec(location.search);
  return m ? m[1] : "";
}

// Cheap probe before downloading the library: real, hardware WebGL available?
function webglOk(allowSoftware){
  try {
    var t = document.createElement("canvas");
    var gl = t.getContext("webgl2", {failIfMajorPerformanceCaveat: !allowSoftware}) ||
             t.getContext("webgl", {failIfMajorPerformanceCaveat: !allowSoftware});
    if (!gl) return false;
    var ok = true;
    var info = gl.getExtension("WEBGL_debug_renderer_info");
    if (info && !allowSoftware) {
      var name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
      if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) ok = false;
    }
    var lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    return ok;
  } catch (e) { return false; }
}

export function start(){
  var m = mode();
  if (m === "2d") return;
  var canvas = document.getElementById("rain3d");
  if (!canvas || !webglOk(m === "3d")) return;
  import("./vendor/three.module.min.js").then(function(THREE){ run(THREE, canvas); }).catch(function(){});
}

function run(THREE, canvas){
  var rain2d = window.rain2d;
  var reduce = window.motion.reduced();
  var phone = Math.min(screen.width, screen.height) < 600 || matchMedia("(pointer: coarse)").matches;
  var finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  var FOV = 60, TAN = Math.tan(FOV * Math.PI / 360);
  // Dense fine rain: glyphs keep a roughly constant apparent size (14-24 CSS px quads, about 10-17 px of glyph)
  // at every depth; depth only changes brightness, size inside that range and (via the column) fall speed.
  // Desktop: up to 8000 instances (one draw call, motion in the vertex shader); phone keeps ~800.
  var CAP = phone ? 800 : 8000, MAXLEN = phone ? 18 : 60;
  var COLS = Math.max(phone ? 30 : 60, Math.min(Math.round(innerWidth / (phone ? 9 : 10)), Math.floor(CAP / (phone ? 14 : 40))));
  var LEN = Math.max(12, Math.min(MAXLEN, Math.floor(CAP / COLS)));
  var live = false, dead = false, raf = 0;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({canvas: canvas, alpha: true, antialias: false,
      failIfMajorPerformanceCaveat: mode() !== "3d"});
  } catch (e) { return; }
  var dpr = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.debug.onShaderError = function(){ fallback(); };

  // glyph atlas: 8x8 cells sized to the render size (about 1 texel per device pixel), mipmapped, white on transparent
  var cell = dpr > 1.25 ? 64 : 32, atlas = document.createElement("canvas");
  atlas.width = atlas.height = cell * 8;
  var a = atlas.getContext("2d");
  a.fillStyle = "#fff"; a.font = "bold " + Math.round(cell * .72) + "px monospace"; a.textAlign = "center"; a.textBaseline = "middle";
  CHARS.forEach(function(ch, i){ a.fillText(ch, (i % 8) * cell + cell / 2, Math.floor(i / 8) * cell + cell / 2); });
  var tex = new THREE.CanvasTexture(atlas);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  // one instance = one glyph; instances are ordered column by column. Column x slots are stratified (even coverage
  // across the width) and shuffled, so dropping the last columns under load thins the rain evenly.
  var n = COLS * LEN;
  var aCol = new Float32Array(n * 4), aIdx = new Float32Array(n * 2);
  var slots = []; for (var q = 0; q < COLS; q++) slots.push(q);
  for (q = COLS - 1; q > 0; q--) { var j = (Math.random() * (q + 1)) | 0, tmp = slots[q]; slots[q] = slots[j]; slots[j] = tmp; }
  for (var c = 0; c < COLS; c++){
    var x = ((slots[c] + Math.random()) / COLS) * 2 - 1, d0 = 8 + Math.random() * 52;
    var speed = 110 + Math.random() * 150, phase = Math.random();      // px/s
    for (var k = 0; k < LEN; k++){
      var i = c * LEN + k;
      aCol.set([x, d0, speed, phase], i * 4);
      aIdx.set([k, Math.random()], i * 2);
    }
  }
  var geo = new THREE.InstancedBufferGeometry();
  geo.copy(new THREE.PlaneGeometry(1, 1));
  geo.setAttribute("aCol", new THREE.InstancedBufferAttribute(aCol, 4));
  geo.setAttribute("aIdx", new THREE.InstancedBufferAttribute(aIdx, 2));
  geo.instanceCount = n;

  var mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: {value: 0}, uAspect: {value: 1}, uViewH: {value: 800}, uTan: {value: TAN}, uLen: {value: LEN},
      uDive: {value: 0}, uG: {value: phone ? new THREE.Vector2(19, 12) : new THREE.Vector2(24, 14)}, uAtlas: {value: tex}
    },
    vertexShader: [
      "attribute vec4 aCol; attribute vec2 aIdx;",
      "uniform float uTime,uAspect,uViewH,uTan,uLen,uDive; uniform vec2 uG;",
      "varying vec2 vUv; varying vec4 vColor;",
      "float hash(float s){return fract(sin(s*91.345)*47453.5453);}",
      "void main(){",
      "  float k=aIdx.x, r=aIdx.y;",
      // depth wraps (scroll dive moves columns through the depth range, never past the camera), so coverage stays constant
      "  float dd=8.0+mod(aCol.y-8.0+uDive,52.0);",
      "  float t=(dd-8.0)/52.0;",
      "  float s=2.0*uTan*dd/uViewH;",                 // world units per CSS pixel at this depth
      "  float g=mix(uG.x,uG.y,t);",                   // glyph quad size in CSS px
      "  float sp=g*0.85;",
      "  float H=uViewH, W=uViewH*uAspect;",
      "  float padY=80.0, padX=40.0+1.4/s;",
      "  float R=H+2.0*padY+uLen*uG.x*0.85;",          // fall period, independent of depth
      "  float p=mod(aCol.w*R+uTime*aCol.z,R);",
      "  float Y=H*0.5+padY-p+k*sp;",
      "  float X=aCol.x*(W*0.5+padX);",
      "  vec3 wp=vec3(X*s,Y*s,-dd);",
      "  vec4 mv=viewMatrix*vec4(wp,1.0);",
      "  mv.xy+=position.xy*g*s;",
      "  gl_Position=projectionMatrix*mv;",
      "  float gi=mod(floor(r*64.0)+floor(uTime*(1.5+r*3.0)+r*9.0)*7.0,64.0);",
      "  vec2 cellp=vec2(mod(gi,8.0),7.0-floor(gi/8.0));",
      "  vUv=(cellp+uv)/8.0;",
      "  float fade=1.0-k/uLen;",
      "  float df=smoothstep(8.0,12.0,dd)*(1.0-smoothstep(54.0,60.0,dd));",
      "  float spark=step(0.965,hash(r+floor(uTime*2.0)));",
      "  float depthB=mix(1.0,0.4,t);",
      "  vec3 col=mix(vec3(0.22,1.0,0.08)*(0.3+0.7*fade),vec3(0.85,1.0,0.9),max(step(k,0.5),spark*0.7));",
      "  float al=(k<0.5?1.0:pow(fade,1.1)*0.85)*depthB*df;",
      "  vColor=vec4(col,al);",
      "}"
    ].join("\n"),
    fragmentShader: [
      "uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vColor;",
      "void main(){ float t=smoothstep(0.2,0.7,texture2D(uAtlas,vUv).a); gl_FragColor=vec4(vColor.rgb,vColor.a*t); }"
    ].join("\n")
  });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  var scene = new THREE.Scene(); scene.add(mesh);
  var camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

  function size(){
    var w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    mat.uniforms.uAspect.value = camera.aspect; mat.uniforms.uViewH.value = h;
  }
  var sizeQueued = false;
  addEventListener("resize", function(){
    if (sizeQueued) return; sizeQueued = true;
    requestAnimationFrame(function(){ sizeQueued = false; if (!dead) size(); });
  });
  size();

  // input: pointer parallax (fine pointers only) and scroll dive; neither runs under reduced motion (window.motion, live)
  var px = 0, py = 0, tx = 0, ty = 0, sp = 0, ts = 0;
  if (finePointer) addEventListener("pointermove", function(e){
    if (e.pointerType && e.pointerType !== "mouse") return;
    tx = e.clientX / innerWidth * 2 - 1; ty = e.clientY / innerHeight * 2 - 1;
  }, {passive: true});
  function scrollProgress(){
    var max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  }

  window.motion.onChange(function(r){ reduce = r; });

  // performance guard: first cut instances, then give up and hand back to the 2D rain
  var cut = false, bad = 0, acc = 0, frames = 0, warm = 0;
  function perf(dt){
    if (dt > 0.25) return;                       // raw (unclamped) gap: tab switch or stall, not a sustained rate
    warm += dt; if (warm < 1.5) return;
    acc += dt; frames++;
    if (acc < 2) return;
    var fps = frames / acc; acc = 0; frames = 0;
    if (fps >= 24) { bad = 0; return; }
    if (++bad < 2) return;
    bad = 0; warm = 0;
    if (!cut) { cut = true; geo.instanceCount = Math.floor(COLS * 0.5) * LEN; }
    else fallback();
  }

  var tm = 0, last = 0;
  function frame(now){
    if (dead) return;
    raf = requestAnimationFrame(frame);
    var raw = (now - last) / 1000, dt = Math.min(raw, 0.25); last = now;
    var scale = reduce ? 0.25 : 1;
    tm += dt * scale;
    var dl = reduce ? 0.35 : 1;
    if (!reduce) { ts = scrollProgress(); } else { tx = ty = 0; ts = 0; }
    var e = Math.min(1, dt * 3);
    px += (tx - px) * e; py += (ty - py) * e; sp += (ts - sp) * e;
    camera.position.set(Math.sin(tm * 0.11) * 0.5 * dl + px * 0.8, Math.cos(tm * 0.083) * 0.3 * dl - py * 0.35, 0);
    camera.rotation.set(Math.sin(tm * 0.07) * 0.03 * dl - py * 0.02, -px * 0.03 + Math.cos(tm * 0.05) * 0.02 * dl, 0);
    mat.uniforms.uDive.value = sp * 36;
    mat.uniforms.uTime.value = tm;
    try { renderer.render(scene, camera); } catch (e) { fallback(); return; }
    if (dead) return;               // shader compile error during that render
    if (!live) goLive();
    perf(raw);
  }

  // first good frame: swap rains (2D stops completely, 3D fades in)
  function goLive(){
    live = true;
    document.documentElement.classList.add("rain3d");   // stronger rain + lighter panels while 3D is live
    if (rain2d) rain2d.setSuspended(true);
    canvas.hidden = false;
    if (canvas.animate) canvas.animate([{filter: "opacity(0)"}, {filter: "opacity(1)"}], {duration: 900, easing: "ease-out"});
  }

  function fallback(){
    if (dead) return;
    dead = true; cancelAnimationFrame(raf);
    try { geo.dispose(); mat.dispose(); tex.dispose(); renderer.dispose(); } catch (e) {}
    canvas.hidden = true;
    document.documentElement.classList.remove("rain3d");
    if (rain2d) rain2d.setSuspended(false);
  }

  function begin(){ cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(frame); }
  document.addEventListener("visibilitychange", function(){
    if (dead) return;
    if (document.hidden) cancelAnimationFrame(raf); else begin();
  });
  canvas.addEventListener("webglcontextlost", function(e){ e.preventDefault(); fallback(); });
  if (!document.hidden) begin();
}
