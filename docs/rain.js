// Matrix rain after the CodePen "Matrix Effect" by Ganesh Prasad: https://codepen.io/gnsp/pen/vYBQZJm (MIT).
// Pen values kept literally: #0001 fade, #0f0, 15pt monospace, 20px columns, floor(w/20)+1 columns, 20px step,
// String.fromCharCode(32 + Math.random()*95) (printable ASCII only: 0-31 drew tofu boxes), the same reset rule, 50ms tick, every column starting at y=0, black background.
// Departures: fixed full-viewport canvas, DPR-aware (cap 2, drawing in CSS px), resize-safe (picture kept, columns added or
// trimmed, height-only changes ignored), timer stopped while the tab is hidden, tick follows window.motion (calm = 140ms).
(function(){
  var c = document.getElementById("rain");
  var g = c && c.getContext("2d");
  if (!g) return;
  var M = window.motion;
  var STEP = 20, K = 2500, FULL = 50, CALM = 140;
  // Reset rule. The pen resets a column when y > 100 + random*10000, drawn fresh every tick, so a column can reset anywhere and
  // survival to depth y falls off like exp(-y^2 / 400000). That is fine on the pen's 500x200 canvas, but on a tall screen only ~5%
  // of the columns reach the bottom (measured bottom/top coverage 0.2 at 1920x1080 with the literal rule). Same form, different anchor:
  // reset only past the bottom edge, y > H + random*K, so every row gets the same number of passes. K = how long a column stays
  // off-screen, which is what breaks up the first wall's sync (K >= 1000 desyncs, 250-500 leaves visible bands; 2500 chosen).
  var W = 0, H = 0, dpr = 1, cols = 0, ypos = [], ready = false, timer = 0;
  function calm(){ return !!(M && M.reduced()); }

  function size(){
    var w = innerWidth, h = innerHeight, d = Math.min(window.devicePixelRatio || 1, 2);
    if (ready && w === W && h <= H && d === dpr) return;          // height-only shrink (phone URL bar): nothing to do
    var nh = ready ? Math.max(h, H) : h, tmp = null;
    if (ready) { tmp = document.createElement("canvas"); tmp.width = c.width; tmp.height = c.height; tmp.getContext("2d").drawImage(c, 0, 0); }
    var oldW = W, oldH = H;
    c.width = Math.round(w * d); c.height = Math.round(nh * d);
    c.style.height = nh + "px";
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = "#000"; g.fillRect(0, 0, w, nh);
    if (tmp) g.drawImage(tmp, 0, 0, oldW, oldH);                   // keep the picture
    W = w; H = nh; dpr = d;
    var n = Math.floor(w / STEP) + 1;
    if (n < ypos.length) ypos.length = n;
    while (ypos.length < n) ypos.push(0);
    cols = n; ready = true;
  }

  function matrix(){
    g.fillStyle = "#0001";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#0f0";
    g.font = "15pt monospace";
    for (var i = 0; i < cols; i++){
      var y = ypos[i];
      g.fillText(String.fromCharCode(32 + Math.random() * 95), i * STEP, y);
      if (y > H + Math.random() * K) ypos[i] = 0; else ypos[i] = y + STEP;
    }
  }

  function start(){
    clearInterval(timer);
    if (document.hidden) return;
    timer = setInterval(matrix, calm() ? CALM : FULL);
  }
  size();
  // calm mode: at 140ms the first wall would cover only a fraction of the screen during the short opening,
  // so run about 54 ticks now, before first paint, and the screen already shows full rain
  if (calm()) for (var k = 0; k < 54; k++) matrix();
  addEventListener("resize", size);
  document.addEventListener("visibilitychange", start);
  if (M) M.onChange(start);
  start();
  window.rain = {tick: matrix};
})();
