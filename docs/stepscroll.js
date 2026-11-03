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
    var els = [el];
    if (id === "contact") { var f = document.querySelector("main > footer"); if (f) els.push(f); }  // contact + footer = one unit
    return {id: id, el: el, els: els};
  });
  if (stops.some(function(s){ return !s.el; }) || !nav) return;

  var TOL = 4, THRESH = 30, PAD = 8, GAP_MS = 80;
  var motionQ = matchMedia("(prefers-reduced-motion: reduce)");
  function reduce(){ return motionQ.matches; }
  function now(){ return performance.now(); }
  try { history.scrollRestoration = "manual"; } catch (e) {}

  var st = document.createElement("style");
  st.textContent = "section:focus{outline:none}";
  document.head.appendChild(st);

  // ---- layout: each stop gets a resting interval [lo, hi] of scrollY, recomputed from live rects ----
  // short section (fits under the nav): lo = hi = centered position; tall: lo = top aligned, hi = bottom aligned
  function layout(){
    var vh = innerHeight, navH = nav.getBoundingClientRect().height, avail = vh - navH;
    var max = Math.max(0, doc.scrollHeight - vh);
    function clamp(y){ return Math.min(max, Math.max(0, y)); }
    return stops.map(function(s){
      var top = Infinity, bottom = -Infinity;
      s.els.forEach(function(el){
        var r = el.getBoundingClientRect();
        top = Math.min(top, r.top + scrollY); bottom = Math.max(bottom, r.bottom + scrollY);
      });
      var h = bottom - top, lo, hi;
      if (h <= avail) lo = hi = clamp(top - navH - (avail - h) / 2);
      else { lo = clamp(top - navH - PAD); hi = Math.max(lo, clamp(bottom - vh + PAD)); }
      return {lo: lo, hi: hi, tall: hi > lo, s: s};
    });
  }

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
  function goTo(y, i, instant){
    cancelTween();
    var max = Math.max(0, doc.scrollHeight - innerHeight);
    y = Math.min(max, Math.max(0, y));
    if (i >= 0) arrive(i);
    var from = scrollY, dist = Math.abs(y - from);
    function land(){ lastLand = {y: scrollY}; }
    if (dist < 1) { land(); return; }
    if (instant || reduce() || document.hidden) { jump(y); lastLand = {y: y}; return; }
    var dur = 500 + Math.min(100, dist / 10), t0 = 0;
    tweening = true;
    tweenDone = function(){ jump(y); lastLand = {y: y}; };
    raf = requestAnimationFrame(function tick(t){
      if (!tweening) return;
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      progUntil = now() + 120;
      scrollTo({top: from + (y - from) * e, left: 0, behavior: "instant"});
      if (p < 1) raf = requestAnimationFrame(tick);
      else { tweening = false; tweenDone = null; lastLand = {y: scrollY}; }
    });
  }
  document.addEventListener("visibilitychange", function(){ if (document.hidden) finishTween(); });

  function step(dec){ goTo(dec.target, dec.i, false); }

  // ---- gesture state shared by wheel ----
  var lastWheelT = 0, locked = false, lockDir = 0, minAbs = Infinity, acc = 0, accDir = 0, lastNativeAt = 0;
  function lock(d, abs){ locked = true; lockDir = d; minAbs = abs; acc = 0; }

  addEventListener("wheel", function(e){
    if (e.ctrlKey || e.defaultPrevented) return;
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
    if (accDir !== d || gap > 250) acc = 0;
    accDir = d; acc += abs;
    if (acc >= THRESH) { lock(d, abs); step(dec); }
  }, {passive: false});

  // ---- touch ----
  var touch = null;
  addEventListener("touchstart", function(e){
    if (e.touches.length !== 1) { touch = null; return; }
    cancelTween();
    touch = {y: e.touches[0].clientY, mode: "", dy: 0};
  }, {passive: true});
  addEventListener("touchmove", function(e){
    if (!touch || e.touches.length !== 1) { touch = null; return; }
    touch.dy = touch.y - e.touches[0].clientY;
    if (!touch.mode && Math.abs(touch.dy) > 6) {
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
    if (tg && tg.closest && tg.closest("input,select,textarea,button,[contenteditable]")) return;
    var k = e.key, d = 0, L;
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
    if (dec.native) { lastNativeAt = now(); return; }
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
    goTo(L[i].lo, i, instant);
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
    if (e.target === doc && e.clientX >= doc.clientWidth) { lastNativeAt = 0; cancelTween(); }   // scrollbar drag stays native
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
