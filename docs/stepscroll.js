// Section-by-section scrolling (see office/SCROLL.md). One rule for every input:
// if the current section has room in that direction, scroll natively; at its edge, step to the next.
// Without JS (or if this file fails) the page scrolls normally.
(function(){
  "use strict";
  var doc = document.documentElement;
  var nav = document.querySelector("nav");
  var ids = ["hero", "about", "experience", "certs", "skills", "contact"];
  var stops = ids.map(function(id){
    var el = document.getElementById(id);
    return {id: id, el: el, els: [el]};
  });
  if (stops.some(function(s){ return !s.el; }) || !nav) return;

  var TOL = 4, THRESH = 30, WHEEL_THRESH = 15, GAP_MS = 80;   // THRESH = touch
  function reduce(){ return !!(window.motion && window.motion.reduced()); }   // single source of truth, read live
  if (window.motion) window.motion.onChange(function(r){ if (r) finishTween(); });
  function now(){ return performance.now(); }
  // pinch-zoomed: panning must stay fully native
  function zoomed(){ return !!(window.visualViewport && window.visualViewport.scale > 1.01); }
  try { history.scrollRestoration = "manual"; } catch (e) {}

  var st = document.createElement("style");
  st.textContent = "section:focus{outline:none}";
  document.head.appendChild(st);

  // ---- layout: each stop gets a resting interval [lo, hi] of scrollY, recomputed from live rects ----
  // Every section is one page tall (CSS centers its content), so landing is always top-aligned: lo = top - navH.
  // A section that fits (within 1px of the area under the nav) has lo = hi; a tall one scrolls from lo to hi = bottom - vh.
  // Positions are whole CSS pixels (nav height and page height are integers, so seams are too); see measureNav in index.html.
  function snap(y){ return Math.round(y); }
  function layout(){
    var vh = innerHeight, navH = nav.getBoundingClientRect().height, avail = vh - navH;
    var max = Math.max(0, doc.scrollHeight - vh);
    function clamp(y){ return Math.min(max, Math.max(0, y)); }
    return stops.map(function(s){
      var r = s.el.getBoundingClientRect(), top = r.top + scrollY, bottom = r.bottom + scrollY;
      var lo = clamp(snap(top - navH)), hi = lo;
      if (bottom - top > avail + 1) hi = Math.max(lo, clamp(snap(bottom - vh)));
      return {lo: lo, hi: hi, tall: hi > lo, s: s};
    });
  }

  // ---- whole-pixel heights: content-sized (tall) sections have fractional heights, which would make every later top fractional
  // (a sub-pixel row of the neighbour at the seam). Round such a section up to a whole pixel; sections of exactly one page are left alone.
  var fitRaf = 0;
  function fitHeights(){
    stops.forEach(function(s){
      var el = s.el;
      if (el.style.minHeight) el.style.minHeight = "";
      var h = el.getBoundingClientRect().height;
      if (Math.abs(h - Math.round(h)) > .01) el.style.minHeight = Math.ceil(h) + "px";
    });
  }
  function queueFit(){ cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fitHeights); }
  fitHeights();
  addEventListener("load", fitHeights);
  addEventListener("resize", queueFit);
  if (window.ResizeObserver) { var fro = new ResizeObserver(queueFit); stops.forEach(function(s){ fro.observe(s.el); }); }

  // THE shared decision for any input. d = +1 down, -1 up, y = scrollY.
  // returns {target, i} to step, {native:true, clamp} to scroll natively, or null at the page edges
  function decide(d, y, L){
    var j, i;
    for (j = 0; j < L.length; j++){
      if (d > 0 && y >= L[j].lo - TOL && y < L[j].hi - TOL) return {native: true, clamp: L[j].hi};
      if (d < 0 && y > L[j].lo + TOL && y <= L[j].hi + TOL) return {native: true, clamp: L[j].lo};
    }
    if (d > 0) {
      for (i = 0; i < L.length; i++) if (L[i].lo > y + TOL) return {target: L[i].lo, i: i};
    } else {
      for (i = L.length - 1; i >= 0; i--) if (L[i].hi < y - TOL) return {target: L[i].lo, i: i};
    }
    return null;
  }

  function nearest(y, L){
    var best = 0, bd = Infinity;
    L.forEach(function(it, i){
      var dd = y < it.lo ? it.lo - y : (y > it.hi ? y - it.hi : 0);
      if (dd < bd) { bd = dd; best = i; }
    });
    return best;
  }

  // ---- movement ----
  var tweening = false, raf = 0, progUntil = 0, lastLand = null, tweenDone = null;
  function jump(y){ progUntil = now() + 120; scrollTo({top: y, left: 0, behavior: "instant"}); }
  function cancelTween(){
    if (!tweening) return;
    cancelAnimationFrame(raf); tweening = false; tweenDone = null;
  }
  function finishTween(){
    if (!tweening) return;
    cancelAnimationFrame(raf); tweening = false;
    var f = tweenDone; tweenDone = null; if (f) f();
  }
  function arrive(i){
    if (i <= 0 || reduce() || !window.sectionReplay) return;
    stops[i].els.forEach(function(el){ try { window.sectionReplay(el); } catch (e) {} });
  }
  // re (optional): returns the freshly measured target; used when the tween ends so a layout that moved meanwhile is corrected
  function goTo(y, i, instant, dur, re){
    cancelTween();
    function fix(v){ var mx = Math.max(0, doc.scrollHeight - innerHeight); return Math.min(mx, Math.max(0, v)); }
    y = fix(y);
    if (i >= 0) arrive(i);
    var from = scrollY, dist = Math.abs(y - from);
    function end(){ var ny = re ? fix(re()) : y; if (Math.abs(ny - scrollY) > .01) jump(ny); lastLand = {y: scrollY}; }
    if (dist < .01) { end(); return; }
    if (instant || dist < 4 || reduce() || document.hidden) { jump(y); end(); return; }
    dur = dur || 500 + Math.min(100, dist / 10); var t0 = 0;
    tweening = true;
    tweenDone = end;
    raf = requestAnimationFrame(function tick(t){
      if (!tweening) return;
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      progUntil = now() + 120;
      scrollTo({top: from + (y - from) * e, left: 0, behavior: "instant"});
      if (p < 1) raf = requestAnimationFrame(tick);
      else { tweening = false; tweenDone = null; jump(y); end(); }
    });
  }
  document.addEventListener("visibilitychange", function(){ if (document.hidden) finishTween(); });

  function step(dec){ goTo(dec.target, dec.i, false, 0, function(){ return layout()[dec.i].lo; }); }

  // ---- gesture state shared by wheel ----
  var lastWheelT = 0, locked = false, lockDir = 0, minAbs = Infinity, acc = 0, accDir = 0, lastNativeAt = -1e9;
  function lock(d, abs){ locked = true; lockDir = d; minAbs = abs; acc = 0; }

  addEventListener("wheel", function(e){
    if (e.ctrlKey || e.defaultPrevented || zoomed()) return;
    var dx = e.deltaX, dy = e.deltaY;
    if (!dy || Math.abs(dx) > Math.abs(dy)) return;
    dy *= e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    var t = e.timeStamp || now(), gap = t - lastWheelT; lastWheelT = t;
    var abs = Math.abs(dy), d = dy > 0 ? 1 : -1;
    if (tweening) { e.preventDefault(); lock(d, abs); return; }   // swallow during the tween
    if (locked) {
      minAbs = Math.min(minAbs, abs);
      if (gap >= GAP_MS || d !== lockDir || abs > minAbs * 2 + 20) locked = false;   // a new gesture
    }
    var L = layout(), y = scrollY, dec = decide(d, y, L);
    if (!dec) { acc = 0; return; }                                   // page edge: native (pull-to-refresh etc.)
    if (dec.native) {
      acc = 0; lastNativeAt = now();
      if (d > 0 ? y + dy > dec.clamp : y + dy < dec.clamp) {         // would overshoot the section edge: stop at it
        e.preventDefault(); jump(dec.clamp); lock(d, abs);
      }
      return;
    }
    e.preventDefault();
    if (locked) return;
    if (accDir !== d || gap > 400) acc = 0;
    accDir = d; acc += abs;
    if (acc >= WHEEL_THRESH) { lock(d, abs); step(dec); }
  }, {passive: false});

  // ---- touch ----
  var touch = null;
  addEventListener("touchstart", function(e){
    if (e.touches.length !== 1 || zoomed()) { touch = null; return; }
    cancelTween();
    touch = {y: e.touches[0].clientY, mode: "", dy: 0};
  }, {passive: true});
  addEventListener("touchmove", function(e){
    if (!touch || e.touches.length !== 1 || zoomed()) { touch = null; return; }
    touch.dy = touch.y - e.touches[0].clientY;
    if (!touch.mode && touch.dy !== 0) {   // decide on the very first move, while it is still cancelable
      var d = touch.dy > 0 ? 1 : -1, dec = decide(d, scrollY, layout());
      touch.mode = dec && !dec.native ? "step" : "native";
    }
    if (touch.mode === "step" && e.cancelable) e.preventDefault();
  }, {passive: false});
  function touchEnd(e){
    var tc = touch; touch = null;
    if (!tc) return;
    lastNativeAt = now();
    if (tc.mode !== "step" || Math.abs(tc.dy) < THRESH) return;
    var d = tc.dy > 0 ? 1 : -1, dec = decide(d, scrollY, layout());
    if (dec && !dec.native) step(dec);
  }
  addEventListener("touchend", touchEnd, {passive: true});
  addEventListener("touchcancel", function(){ touch = null; }, {passive: true});

  // ---- keyboard ----
  addEventListener("keydown", function(e){
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    var tg = e.target;
    if (tg && tg.closest && tg.closest("input,select,textarea,[contenteditable]")) return;
    var k = e.key, d = 0, L;
    if ((k === " " || k === "Enter") && tg && tg.closest && tg.closest("button")) return;   // buttons keep Space/Enter; other keys still step
    if (k === "ArrowDown" || k === "PageDown" || (k === " " && !e.shiftKey)) d = 1;
    else if (k === "ArrowUp" || k === "PageUp" || (k === " " && e.shiftKey)) d = -1;
    else if (k === "Home" || k === "End") {
      e.preventDefault();
      goTo(k === "Home" ? 0 : doc.scrollHeight, k === "Home" ? 0 : stops.length - 1, false);
      return;
    } else return;
    if (e.shiftKey && k !== " ") return;
    if (tweening) { e.preventDefault(); return; }
    L = layout();
    var dec = decide(d, scrollY, L);
    if (!dec) return;
    if (dec.native) {
      // inside a tall section: our own clamped movement instead of native key scrolling (which can overshoot the edge)
      var amt = (k === "ArrowDown" || k === "ArrowUp") ? 80 : Math.round(.85 * (innerHeight - nav.getBoundingClientRect().height));
      var ny = d > 0 ? Math.min(scrollY + amt, dec.clamp) : Math.max(scrollY - amt, dec.clamp);
      e.preventDefault(); lastNativeAt = now();
      goTo(ny, -1, false, 140 + Math.abs(ny - scrollY) * .35);
      return;
    }
    e.preventDefault(); step(dec);
  });

  // ---- links, hash, history ----
  function stopIndexOf(el){
    for (var i = 0; i < stops.length; i++) if (stops[i].els.some(function(s){ return s === el || s.contains(el); })) return i;
    return -1;
  }
  function goHash(hash, instant){
    var id = decodeURIComponent((hash || "").replace(/^#/, ""));
    var i = id ? ids.indexOf(id) : 0;
    if (i < 0) return false;
    var L = layout();
    goTo(L[i].lo, i, instant, 0, function(){ return layout()[i].lo; });
    return true;
  }
  document.addEventListener("click", function(e){
    if (e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var h = a.getAttribute("href");
    if (h.length < 2) return;
    var id = decodeURIComponent(h.slice(1)), i = ids.indexOf(id);
    if (i < 0) return;
    e.preventDefault();
    if (location.hash !== h) history.pushState(null, "", h);
    var sec = stops[i].el;
    if (!sec.hasAttribute("tabindex")) sec.setAttribute("tabindex", "-1");
    sec.focus({preventScroll: true});
    goHash(h, false);
  });
  addEventListener("popstate", function(){ if (!goHash(location.hash, false)) goTo(0, 0, false); });
  function initial(){ if (location.hash && goHash(location.hash, true)) { /* landed instantly */ } }
  initial();
  addEventListener("load", initial);

  // ---- settle: native scrolling that overshot a tall section's edge comes back (or moves on) once input stops ----
  var idle = 0;
  addEventListener("mousedown", function(e){
    if (e.target === doc && e.clientX >= doc.clientWidth) { lastNativeAt = -1e9; cancelTween(); }   // scrollbar drag stays native
  });
  addEventListener("scroll", function(){
    if (tweening || now() < progUntil) return;
    clearTimeout(idle); idle = setTimeout(onIdle, 160);
  }, {passive: true});
  function onIdle(){
    if (tweening || touch) return;
    var L = layout(), y = scrollY, i = nearest(y, L);
    arrive(i);
    if (now() - lastNativeAt > 2500) return;                         // find-in-page, Tab focus, scrollbar: never snapped
    for (var j = 0; j < L.length; j++) if (y >= L[j].lo - TOL && y <= L[j].hi + TOL) return;
    var below = -1, above = -1;
    for (j = 0; j < L.length; j++) { if (L[j].hi < y) below = j; if (L[j].lo > y && above < 0) above = j; }
    var avail = innerHeight - nav.getBoundingClientRect().height;
    if (below >= 0 && above >= 0) {
      var past = y - L[below].hi, before = L[above].lo - y;
      if (L[below].tall && past <= avail * .3) goTo(L[below].hi, -1, false);
      else if (L[above].tall && before <= avail * .3 && past > before) goTo(L[above].lo, above, false);
      else goTo(past < before ? L[below].hi : L[above].lo, past < before ? below : above, false);
    }
  }

  // ---- resize: re-align only if resting on a stop; ignore height-only changes (phone URL bar) ----
  var lastW = innerWidth, lastH = innerHeight, rz = 0;
  addEventListener("resize", function(){
    clearTimeout(rz);
    rz = setTimeout(function(){
      var changed = innerWidth !== lastW || Math.abs(innerHeight - lastH) > 200;
      lastW = innerWidth; lastH = innerHeight;
      if (!changed || tweening || !lastLand || Math.abs(scrollY - lastLand.y) > 3) return;
      var L = layout(), i = nearest(scrollY, L);
      jump(L[i].lo); lastLand = {y: L[i].lo};
    }, 150);
  });
})();
