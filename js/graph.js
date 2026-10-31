// ============================================================
// Bản đồ Kiến thức Nhân loại — DAG theo dòng thời gian
// ============================================================

const CURRENT_YEAR = 2026;
// Trục thời gian được chia theo giai đoạn (piecewise) thay vì tuyến tính thuần túy:
// vì phần lớn node tập trung ở giai đoạn 1000-2026, giai đoạn này được cấp nhiều
// không gian ngang hơn hẳn so với tỉ lệ năm thực tế, để tránh chồng lấp.
// TIME_DOMAIN: các mốc năm phân giai đoạn. TIME_RANGE_FRACTIONS: tỉ lệ (0→1) không
// gian ngang cấp cho mỗi giai đoạn, cộng dồn.
const TIME_DOMAIN =          [-50000, -1000, 1000, 1800, 2026];
const TIME_RANGE_FRACTIONS = [0,       0.10,  0.30, 0.65, 1.0];
const STORAGE_KEY = "knowledge-map-additions-v1";
const LS_HIDDEN_CATS = "knowledge-map-hidden-categories-v1";

let state = {
  categories: [],
  categoryById: {},
  baseNodes: [],
  additions: [],
  nodes: [],        // baseNodes + additions, merged
  nodeById: {},
  childrenOf: {},   // id -> [ids of nodes whose origins include id]
  hiddenCategories: new Set(),
  selectedId: null,
  showDescendants: false,
  searchTerm: "",
  originSelection: [], // for the add-node modal
};

let svg, zoomLayer, width, height;
let axisTickSel = null; // d3 selection of fixed axis-tick <g> elements, repositioned on zoom
const AXIS_BAR_HEIGHT = 34;
const MARGIN = { top: 20, right: 40, bottom: 30 + AXIS_BAR_HEIGHT, left: 160 };
const TICK_YEARS = [-50000, -1000, 0, 500, 1000, 1300, 1500, 1650, 1800, 1850, 1900, 1930, 1960, 1990, 2026];

// ---------- utils ----------

function normalize(str) {
  return (str || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function slugify(str) {
  const base = normalize(str).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return "u-" + (base || "node") + "-" + Math.random().toString(36).slice(2, 7);
}

function makeTimeScale(width) {
  const innerLeft = MARGIN.left;
  const innerRight = width - MARGIN.right;
  const span = innerRight - innerLeft;
  const range = TIME_RANGE_FRACTIONS.map((f) => innerLeft + f * span);
  return d3.scaleLinear().domain(TIME_DOMAIN).range(range).clamp(true);
}

// Đẩy các node quá gần nhau (cùng lĩnh vực, gần nhau về thời gian) ra xa nhau
// theo chiều dọc, giữ trong biên của lane, để nhãn/chấm đỡ chồng lên nhau.
function resolveLaneCollisions(nodesInLane, laneTop, laneBottom) {
  const MIN_DX = 15; // chỉ xét các cặp đủ gần nhau theo trục x
  const MIN_DY = 15; // khoảng cách dọc tối thiểu mong muốn
  const arr = nodesInLane.slice().sort((a, b) => a.x - b.x);
  for (let iter = 0; iter < 5; iter++) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[j].x - arr[i].x > MIN_DX) break; // đã sắp xếp theo x, có thể dừng sớm
        const dy = arr[j].y - arr[i].y;
        if (Math.abs(dy) < MIN_DY) {
          const push = (MIN_DY - Math.abs(dy)) / 2 + 0.6;
          const dir = dy >= 0 ? 1 : -1;
          arr[j].y += push * dir;
          arr[i].y -= push * dir;
        }
      }
    }
    arr.forEach((n) => {
      n.y = Math.max(laneTop + 7, Math.min(laneBottom - 7, n.y));
    });
  }
}

function loadAdditions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn("Không đọc được localStorage:", e);
    return [];
  }
}

function saveAdditions() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.additions));
  } catch (e) {
    console.warn("Không lưu được localStorage:", e);
  }
}

function loadHiddenCats() {
  try {
    const raw = localStorage.getItem(LS_HIDDEN_CATS);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    return new Set();
  }
}

function saveHiddenCats() {
  try {
    localStorage.setItem(LS_HIDDEN_CATS, JSON.stringify([...state.hiddenCategories]));
  } catch (e) { /* noop */ }
}

function rebuildIndexes() {
  state.nodes = [...state.baseNodes, ...state.additions];
  state.nodeById = {};
  state.childrenOf = {};
  for (const n of state.nodes) {
    state.nodeById[n.id] = n;
    state.childrenOf[n.id] = state.childrenOf[n.id] || [];
  }
  for (const n of state.nodes) {
    for (const originId of (n.origins || [])) {
      if (!state.childrenOf[originId]) state.childrenOf[originId] = [];
      state.childrenOf[originId].push(n.id);
    }
  }
}

function getAncestors(id) {
  const visited = new Set();
  const edges = new Set(); // "parentId->childId"
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    const node = state.nodeById[cur];
    if (!node) continue;
    for (const originId of (node.origins || [])) {
      edges.add(originId + "->" + cur);
      if (!visited.has(originId)) {
        visited.add(originId);
        stack.push(originId);
      }
    }
  }
  return { nodes: visited, edges };
}

function getDescendants(id) {
  const visited = new Set();
  const edges = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    const kids = state.childrenOf[cur] || [];
    for (const childId of kids) {
      edges.add(cur + "->" + childId);
      if (!visited.has(childId)) {
        visited.add(childId);
        stack.push(childId);
      }
    }
  }
  return { nodes: visited, edges };
}

// ---------- layout ----------

function computeLayout() {
  width = document.getElementById("graph-container").clientWidth;
  height = document.getElementById("graph-container").clientHeight;

  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const xScale = makeTimeScale(width);

  const cats = state.categories;
  const laneH = innerH / cats.length;
  const laneIndex = {};
  cats.forEach((c, i) => (laneIndex[c.id] = i));

  const byLane = {};
  for (const n of state.nodes) {
    n.x = xScale(n.year);
    const lane = laneIndex[n.category] ?? 0;
    const laneCenter = MARGIN.top + lane * laneH + laneH / 2;
    // deterministic jitter within lane based on id hash, as a starting position
    // before collision resolution spreads out anything still too close together
    let hash = 0;
    for (let i = 0; i < n.id.length; i++) hash = (hash * 31 + n.id.charCodeAt(i)) >>> 0;
    const jitter = ((hash % 1000) / 1000 - 0.5) * (laneH * 0.5);
    n.y = laneCenter + jitter;
    (byLane[lane] = byLane[lane] || []).push(n);
  }

  cats.forEach((c, i) => {
    const laneTop = MARGIN.top + i * laneH;
    resolveLaneCollisions(byLane[i] || [], laneTop, laneTop + laneH);
  });

  return { xScale, laneIndex, laneH, innerW, innerH };
}

// ---------- rendering ----------

function render() {
  const layout = computeLayout();
  svg.selectAll("*").remove();

  const defsAndStatic = svg.append("g").attr("class", "static-layer");
  zoomLayer = svg.append("g").attr("class", "zoom-layer");

  // lane labels (kept outside zoom so they stay readable; redraw per category)
  const laneLabelLayer = defsAndStatic.append("g").attr("class", "lane-labels");
  state.categories.forEach((c, i) => {
    const y = MARGIN.top + i * layout.laneH + layout.laneH / 2;
    laneLabelLayer
      .append("text")
      .attr("class", "lane-label")
      .attr("x", 12)
      .attr("y", y)
      .attr("dy", "0.32em")
      .text(c.name);
    laneLabelLayer
      .append("circle")
      .attr("cx", 4)
      .attr("cy", y)
      .attr("r", 4)
      .attr("fill", c.color);
    // faint lane separator
    laneLabelLayer
      .append("line")
      .attr("x1", 0).attr("x2", width)
      .attr("y1", MARGIN.top + (i + 1) * layout.laneH)
      .attr("y2", MARGIN.top + (i + 1) * layout.laneH)
      .attr("stroke", "#1f252d")
      .attr("stroke-width", 1);
  });

  // Dữ liệu các mốc năm, tính sẵn vị trí x gốc (ứng với transform = identity).
  const axisTickData = TICK_YEARS.map((y) => ({ year: y, baseX: layout.xScale(y) }));

  // Gridline dọc theo mốc năm — đặt BÊN TRONG zoomLayer (thêm bên dưới, sau khi
  // zoomLayer đã append) để chúng tự động pan/zoom cùng node & cạnh, luôn khớp
  // chính xác vị trí thời gian dù kéo/zoom thế nào — đây là phần vá lỗi trục cũ
  // (trước đây gridline đứng yên, lệch khỏi node ngay khi kéo/zoom).

  // Thanh trục thời gian CỐ ĐỊNH ở đáy khung nhìn (không pan/zoom theo nội dung),
  // nhưng vị trí từng mốc năm được cập nhật lại mỗi lần zoom (xem hàm updateAxisPositions)
  // nên luôn khớp chính xác với vị trí node — chỉ cỡ chữ là không đổi để luôn dễ đọc.
  const axisBarY = height - AXIS_BAR_HEIGHT;
  const axisBar = defsAndStatic.append("g").attr("class", "axis-bar");
  axisBar.append("rect")
    .attr("x", 0).attr("y", axisBarY)
    .attr("width", width).attr("height", AXIS_BAR_HEIGHT)
    .attr("fill", "#141820");
  axisBar.append("line")
    .attr("x1", 0).attr("x2", width)
    .attr("y1", axisBarY).attr("y2", axisBarY)
    .attr("stroke", "#2b323c").attr("stroke-width", 1);

  axisTickSel = axisBar
    .selectAll("g.axis-tick")
    .data(axisTickData)
    .join("g")
    .attr("class", "axis-tick")
    .attr("transform", (d) => `translate(${d.baseX},0)`);

  axisTickSel.append("line")
    .attr("y1", axisBarY).attr("y2", axisBarY + 6)
    .attr("stroke", "#5a6472").attr("stroke-width", 1);
  axisTickSel.append("text")
    .attr("y", axisBarY + 20)
    .attr("text-anchor", "middle")
    .text((d) => (d.year < 0 ? Math.abs(d.year) + " TCN" : String(d.year)));

  // Gridline dọc bên trong zoomLayer → tự pan/zoom cùng node, luôn khớp đúng thời gian.
  zoomLayer
    .append("g")
    .attr("class", "gridlines")
    .selectAll("line")
    .data(axisTickData)
    .join("line")
    .attr("x1", (d) => d.baseX).attr("x2", (d) => d.baseX)
    .attr("y1", MARGIN.top).attr("y2", axisBarY)
    .attr("stroke", "#1a1f26").attr("stroke-width", 1);

  const visibleNodes = state.nodes.filter((n) => !state.hiddenCategories.has(n.category));
  const visibleIds = new Set(visibleNodes.map((n) => n.id));

  // highlight sets
  let ancestorSet = new Set(), descendantSet = new Set();
  let ancestorEdges = new Set(), descendantEdges = new Set();
  if (state.selectedId) {
    const anc = getAncestors(state.selectedId);
    ancestorSet = anc.nodes;
    ancestorEdges = anc.edges;
    if (state.showDescendants) {
      const desc = getDescendants(state.selectedId);
      descendantSet = desc.nodes;
      descendantEdges = desc.edges;
    }
  }

  const searchActive = state.searchTerm.trim().length > 0;
  const searchNorm = normalize(state.searchTerm);
  const matchIds = new Set();
  if (searchActive) {
    for (const n of visibleNodes) {
      if (normalize(n.name).includes(searchNorm)) matchIds.add(n.id);
    }
  }

  function nodeDimmed(n) {
    if (state.selectedId) {
      return !(n.id === state.selectedId || ancestorSet.has(n.id) || descendantSet.has(n.id));
    }
    if (searchActive) return !matchIds.has(n.id);
    return false;
  }

  // edges
  const edgeG = zoomLayer.append("g").attr("class", "edges");
  const edgeData = [];
  for (const n of visibleNodes) {
    for (const originId of (n.origins || [])) {
      if (!visibleIds.has(originId)) continue;
      edgeData.push({ source: state.nodeById[originId], target: n, key: originId + "->" + n.id });
    }
  }
  edgeG
    .selectAll("path")
    .data(edgeData, (d) => d.key)
    .join("path")
    .attr("class", (d) => {
      let cls = "edge-path";
      if (ancestorEdges.has(d.key)) cls += " highlight-ancestor";
      else if (descendantEdges.has(d.key)) cls += " highlight-descendant";
      return cls;
    })
    .classed("dim", (d) => state.selectedId
      ? !(ancestorEdges.has(d.key) || descendantEdges.has(d.key))
      : (searchActive && !(matchIds.has(d.source.id) && matchIds.has(d.target.id))))
    .attr("d", (d) => {
      const sx = d.source.x, sy = d.source.y, tx = d.target.x, ty = d.target.y;
      const mx = (sx + tx) / 2;
      return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
    });

  // nodes
  const nodeG = zoomLayer.append("g").attr("class", "nodes");
  const nodeSel = nodeG
    .selectAll("g.node")
    .data(visibleNodes, (d) => d.id)
    .join("g")
    .attr("class", "node")
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      event.stopPropagation();
      selectNode(d.id);
    });

  nodeSel
    .append("circle")
    .attr("class", (d) => {
      let cls = "node-circle";
      if (d.id === state.selectedId) cls += " highlight-selected";
      else if (ancestorSet.has(d.id)) cls += " highlight-ancestor";
      else if (descendantSet.has(d.id)) cls += " highlight-descendant";
      if (searchActive && matchIds.has(d.id)) cls += " search-match";
      return cls;
    })
    .classed("dim", (d) => nodeDimmed(d))
    .attr("r", (d) => (d.id === state.selectedId ? 7 : 5))
    .attr("fill", (d) => state.categoryById[d.category]?.color || "#888");

  nodeSel.append("title").text((d) => `${d.name} — ${d.period || d.year}`);

  // Label visibility strategy: with 70+ nodes, showing all labels at once is
  // unreadable. In "focus mode" (a node selected, or a search active) only the
  // relevant labels show at full opacity. In overview mode, labels are hidden
  // by default and revealed via CSS once the user zooms in past a threshold
  // (see #graph-svg.zoomed-in rule) — hovering a dot always shows its name via
  // the native tooltip above regardless of mode.
  const focusModeActive = !!state.selectedId || searchActive;
  nodeSel
    .append("text")
    .attr("class", (d) => {
      if (focusModeActive) return "node-label" + (nodeDimmed(d) ? " dim" : " focus-visible");
      return "node-label overview-label";
    })
    .attr("x", 9)
    .attr("y", 3)
    .text((d) => d.name);

  // background click clears selection
  svg.on("click", () => selectNode(null));

  // zoom/pan
  const zoom = d3.zoom()
    .scaleExtent([0.3, 10])
    .on("zoom", (event) => {
      zoomLayer.attr("transform", event.transform);
      svg.classed("zoomed-in", event.transform.k > 1.6);
      if (axisTickSel) {
        axisTickSel.attr("transform", (d) => `translate(${event.transform.applyX(d.baseX)},0)`);
      }
    });
  svg.call(zoom);

  renderLegend();
}

function selectNode(id) {
  state.selectedId = id;
  state.showDescendants = false;
  render();
  showDetail(id);
}

// ---------- detail panel ----------

function showDetail(id) {
  const panel = document.getElementById("detail-panel");
  if (!id) {
    panel.classList.add("hidden");
    return;
  }
  const n = state.nodeById[id];
  if (!n) { panel.classList.add("hidden"); return; }
  const cat = state.categoryById[n.category];
  const content = document.getElementById("detail-content");

  const originsHtml = (n.origins && n.origins.length)
    ? `<ul class="detail-link-list">${n.origins.map((oid) => {
        const o = state.nodeById[oid];
        return o ? `<li data-jump="${oid}">${o.name} <span style="color:#9aa4b2">(${o.year < 0 ? Math.abs(o.year) + " TCN" : o.year})</span></li>` : "";
      }).join("")}</ul>`
    : `<div class="detail-link-list empty-note">Không có nguồn gốc nào được ghi nhận — đây có thể là điểm khởi đầu độc lập.</div>`;

  const children = state.childrenOf[id] || [];
  const childrenHtml = children.length
    ? `<ul class="detail-link-list">${children.map((cid) => {
        const c = state.nodeById[cid];
        return c ? `<li data-jump="${cid}">${c.name} <span style="color:#9aa4b2">(${c.year < 0 ? Math.abs(c.year) + " TCN" : c.year})</span></li>` : "";
      }).join("")}</ul>`
    : `<div class="detail-link-list empty-note">Chưa có mục nào được ghi nhận là chịu ảnh hưởng trực tiếp.</div>`;

  content.innerHTML = `
    <h2>${n.name}</h2>
    <div class="detail-meta">${n.period || (n.year < 0 ? Math.abs(n.year) + " TCN" : n.year)}</div>
    <span class="detail-category-badge" style="background:${cat?.color || "#888"}22; color:${cat?.color || "#ccc"}; border:1px solid ${cat?.color || "#888"}">${cat?.name || n.category}</span>
    <div class="detail-desc">${n.description || ""}</div>
    <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#9aa4b2; cursor:pointer;">
      <input type="checkbox" id="chk-descendants" ${state.showDescendants ? "checked" : ""}/> Hiện cả những gì chịu ảnh hưởng từ đây
    </label>
    <div class="detail-section-title">Bắt nguồn từ</div>
    ${originsHtml}
    <div class="detail-section-title">Dẫn tới / Ảnh hưởng tới</div>
    ${childrenHtml}
  `;
  panel.classList.remove("hidden");

  content.querySelectorAll("[data-jump]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      selectNode(el.getAttribute("data-jump"));
    });
  });

  const chk = document.getElementById("chk-descendants");
  chk.addEventListener("change", () => {
    state.showDescendants = chk.checked;
    render();
    showDetail(id);
  });
}

document.getElementById("btn-close-panel").addEventListener("click", () => selectNode(null));

// ---------- legend ----------

function renderLegend() {
  const legend = document.getElementById("legend");
  legend.innerHTML = "";
  state.categories.forEach((c) => {
    const item = document.createElement("div");
    item.className = "legend-item" + (state.hiddenCategories.has(c.id) ? " off" : "");
    item.innerHTML = `<span class="legend-swatch" style="background:${c.color}"></span>${c.name}`;
    item.addEventListener("click", () => {
      if (state.hiddenCategories.has(c.id)) state.hiddenCategories.delete(c.id);
      else state.hiddenCategories.add(c.id);
      saveHiddenCats();
      render();
    });
    legend.appendChild(item);
  });
}

// ---------- search ----------

document.getElementById("search-box").addEventListener("input", (e) => {
  state.searchTerm = e.target.value;
  if (state.searchTerm.trim()) state.selectedId = null;
  render();
});

// ---------- add-node modal ----------

const modalOverlay = document.getElementById("modal-overlay");

document.getElementById("btn-add-node").addEventListener("click", () => {
  state.originSelection = [];
  document.getElementById("input-name").value = "";
  document.getElementById("input-year").value = "";
  document.getElementById("input-desc").value = "";
  document.getElementById("input-origin-search").value = "";
  document.getElementById("origin-results").innerHTML = "";
  renderOriginChips();
  const sel = document.getElementById("input-category");
  sel.innerHTML = state.categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  modalOverlay.classList.remove("hidden");
});

document.getElementById("btn-cancel-add").addEventListener("click", () => modalOverlay.classList.add("hidden"));
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) modalOverlay.classList.add("hidden"); });

document.getElementById("input-origin-search").addEventListener("input", (e) => {
  const term = normalize(e.target.value);
  const results = document.getElementById("origin-results");
  results.innerHTML = "";
  if (!term) return;
  const matches = state.nodes
    .filter((n) => normalize(n.name).includes(term) && !state.originSelection.includes(n.id))
    .slice(0, 8);
  matches.forEach((n) => {
    const div = document.createElement("div");
    div.className = "origin-result-item";
    div.textContent = `${n.name} (${n.year < 0 ? Math.abs(n.year) + " TCN" : n.year})`;
    div.addEventListener("click", () => {
      state.originSelection.push(n.id);
      renderOriginChips();
      e.target.value = "";
      results.innerHTML = "";
    });
    results.appendChild(div);
  });
});

function renderOriginChips() {
  const box = document.getElementById("origin-selected");
  box.innerHTML = "";
  state.originSelection.forEach((id) => {
    const n = state.nodeById[id];
    if (!n) return;
    const chip = document.createElement("span");
    chip.className = "origin-chip";
    chip.innerHTML = `${n.name} <button aria-label="xóa">&times;</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      state.originSelection = state.originSelection.filter((x) => x !== id);
      renderOriginChips();
    });
    box.appendChild(chip);
  });
}

document.getElementById("btn-save-add").addEventListener("click", () => {
  const name = document.getElementById("input-name").value.trim();
  const category = document.getElementById("input-category").value;
  const yearStr = document.getElementById("input-year").value.trim();
  const description = document.getElementById("input-desc").value.trim();
  if (!name || !yearStr) {
    alert("Vui lòng điền tên sự kiện và năm.");
    return;
  }
  const year = parseInt(yearStr, 10);
  if (Number.isNaN(year)) {
    alert("Năm phải là một số.");
    return;
  }
  const newNode = {
    id: slugify(name),
    name,
    category,
    year,
    period: year < 0 ? `${Math.abs(year)} TCN` : `${year} CN`,
    description,
    origins: [...state.originSelection],
  };
  state.additions.push(newNode);
  saveAdditions();
  rebuildIndexes();
  modalOverlay.classList.add("hidden");
  render();
});

// ---------- export modal ----------

const exportOverlay = document.getElementById("modal-export-overlay");

document.getElementById("btn-export").addEventListener("click", () => {
  const payload = {
    meta: { ...state.meta, lastUpdated: new Date().toISOString().slice(0, 10) },
    categories: state.categories,
    nodes: state.nodes,
  };
  document.getElementById("export-textarea").value = JSON.stringify(payload, null, 2);
  exportOverlay.classList.remove("hidden");
});

document.getElementById("btn-close-export").addEventListener("click", () => exportOverlay.classList.add("hidden"));
exportOverlay.addEventListener("click", (e) => { if (e.target === exportOverlay) exportOverlay.classList.add("hidden"); });

document.getElementById("btn-copy-export").addEventListener("click", async () => {
  const text = document.getElementById("export-textarea").value;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById("btn-copy-export");
    const old = btn.textContent;
    btn.textContent = "Đã sao chép!";
    setTimeout(() => (btn.textContent = old), 1500);
  } catch (e) {
    alert("Không thể tự sao chép — vui lòng bôi đen và Ctrl+C.");
  }
});

document.getElementById("btn-download-export").addEventListener("click", () => {
  const text = document.getElementById("export-textarea").value;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "knowledge-map.json";
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- reset ----------

document.getElementById("btn-reset").addEventListener("click", () => {
  if (!state.additions.length) {
    alert("Chưa có sự kiện tự thêm nào để xóa.");
    return;
  }
  if (confirm(`Xóa ${state.additions.length} sự kiện bạn đã thêm (chỉ lưu trong trình duyệt này)?`)) {
    state.additions = [];
    saveAdditions();
    rebuildIndexes();
    selectNode(null);
    render();
  }
});

// ---------- resize ----------

// ResizeObserver (not just window "resize") catches every size change of the
// graph container — including a reflow caused by web fonts finishing their
// load shortly after first paint, which a plain window-resize listener misses.
// Without this, the bottom axis bar could be positioned using a container
// height measured just before that reflow, landing a few px outside the
// visible SVG.
let resizeRenderQueued = false;
function scheduleResizeRender() {
  if (resizeRenderQueued) return;
  resizeRenderQueued = true;
  requestAnimationFrame(() => {
    resizeRenderQueued = false;
    render();
  });
}
new ResizeObserver(scheduleResizeRender).observe(document.getElementById("graph-container"));
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(scheduleResizeRender);
}

// ---------- init ----------

async function init() {
  svg = d3.select("#graph-svg");
  const res = await fetch("data/knowledge-map.json");
  const data = await res.json();
  state.meta = data.meta;
  state.categories = data.categories;
  state.categoryById = {};
  data.categories.forEach((c) => (state.categoryById[c.id] = c));
  state.baseNodes = data.nodes;
  state.additions = loadAdditions();
  state.hiddenCategories = loadHiddenCats();
  rebuildIndexes();
  render();
}

init();
