// Evaluated inside the page by `bhn deepsurge eval`. The review page is loaded in an iframe of the requested width, so its
// media queries see that width. Returns JSON { width, violations: [...] }; an empty list is a pass.
(function (frameId) {
  const f = document.getElementById(frameId);
  const w = f.contentWindow, d = f.contentDocument;
  const v = [];
  const W = w.innerWidth;
  const rect = (e) => e.getBoundingClientRect();
  const name = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").join(".") : "");
  if (d.documentElement.scrollWidth > W) v.push(`horizontal scroll: document ${d.documentElement.scrollWidth}px > viewport ${W}px`);
  for (const e of d.querySelectorAll("main *")) {
    const r = rect(e);
    if (r.width > 0 && (r.right > W + 0.5 || r.left < -0.5)) v.push(`${name(e)} spills out: left ${Math.round(r.left)} right ${Math.round(r.right)} of ${W}`);
  }
  for (const e of d.querySelectorAll(".tape div, .tape b, .tape span, .slip h2, .ev dd, .quote, .rel, .status")) {
    if (e.scrollWidth > e.clientWidth + 1) v.push(`${name(e)} text clipped: scrollWidth ${e.scrollWidth} > clientWidth ${e.clientWidth}`);
  }
  for (const cell of d.querySelectorAll(".tape div")) {
    // the label wraps with overflow-wrap:anywhere, so a narrow cell would break words mid-letter without ever "clipping"
    if (cell.clientWidth < 88) v.push(`tape cell only ${cell.clientWidth}px wide, labels break mid-word`);
  }
  for (const s of d.querySelectorAll(".slip")) {
    const stamp = s.querySelector(".stamp"), h2 = s.querySelector("h2");
    const sr = rect(stamp);
    const range = d.createRange();
    range.selectNodeContents(h2);
    for (const t of range.getClientRects()) {
      if (!(t.right <= sr.left || sr.right <= t.left || t.bottom <= sr.top || sr.bottom <= t.top)) { v.push(`stamp overlaps heading text in ${s.id}`); break; }
    }
    for (const b of s.querySelectorAll(".btn")) {
      const r = rect(b);
      if (r.height < 40 || r.width < 40) v.push(`tap target ${Math.round(r.width)}x${Math.round(r.height)} in ${s.id}`);
    }
    const header = s.querySelector("header");
    if (header.scrollWidth > header.clientWidth + 1) v.push(`slip header clipped in ${s.id}`);
  }
  if (d.querySelectorAll(".slip").length < 5) v.push(`only ${d.querySelectorAll(".slip").length} slips rendered, the check needs every verdict on screen`);
  return JSON.stringify({ width: W, slips: d.querySelectorAll(".slip").length, violations: v });
})
