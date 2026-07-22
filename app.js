const STORAGE_KEY = "crystal_finance_v1";
const CLOUD_KEY = "crystal_finance_cloud_v1";
const AUTO_SYNC_DELAY = 1200;
const AUTO_PULL_INTERVAL = 60000;

const state = loadState();
let syncTimer = null;
let syncing = false;
let pendingSync = false;
const titles = {
  dashboard: "总览",
  products: "商品",
  purchases: "进货",
  sales: "销售",
  expenses: "开支",
  settings: "设置"
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthNow() {
  return new Date().toISOString().slice(0, 7);
}

function money(n) {
  return `¥${Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function num(n) {
  return Number(n || 0);
}

function loadState() {
  const empty = { products: [], purchases: [], sales: [], expenses: [], importedHftKeys: [], updatedAt: new Date().toISOString() };
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return empty;
  }
}

function saveState(options = {}) {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!options.skipAutoSync) scheduleAutoSync();
}

function cloudConfig() {
  try {
    return JSON.parse(localStorage.getItem(CLOUD_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCloudConfig(cfg) {
  localStorage.setItem(CLOUD_KEY, JSON.stringify(cfg));
}

function hasCloudConfig() {
  const cfg = cloudConfig();
  return Boolean(cfg.url && cfg.key && cfg.storeCode);
}

function setSyncStatus(text) {
  const el = $("#syncStatus");
  if (el) el.textContent = text;
}

function scheduleAutoSync() {
  if (!hasCloudConfig()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncCloud({ silent: true }).catch(() => setSyncStatus("自动同步失败，请检查网络或同步设置。"));
  }, AUTO_SYNC_DELAY);
}

function productById(id) {
  return state.products.find(p => p.id === id) || {};
}

function avgCost(productId) {
  const p = productById(productId);
  const openingQty = num(p.openingQty);
  const openingAmount = num(p.openingAmount);
  const purchases = state.purchases.filter(x => x.productId === productId);
  const qty = openingQty + purchases.reduce((s, x) => s + num(x.qty), 0);
  const amount = openingAmount + purchases.reduce((s, x) => s + num(x.qty) * num(x.unitCost) + num(x.extraCost), 0);
  if (qty <= 0) return num(p.cost);
  return amount / qty;
}

function stockFor(productId) {
  const p = productById(productId);
  const bought = state.purchases.filter(x => x.productId === productId).reduce((s, x) => s + num(x.qty), 0);
  const sold = state.sales.filter(x => x.productId === productId).reduce((s, x) => s + num(x.qty), 0);
  const stock = num(p.openingQty) + bought - sold;
  const cost = avgCost(productId);
  return { bought, sold, stock, cost, amount: stock * cost };
}

function monthRange(month) {
  const start = `${month}-01`;
  const d = new Date(start);
  d.setMonth(d.getMonth() + 1);
  const end = d.toISOString().slice(0, 10);
  return { start, end };
}

function inMonth(date, month) {
  if (!date) return false;
  const { start, end } = monthRange(month);
  return date >= start && date < end;
}

function monthSummary(month) {
  const sales = state.sales.filter(x => inMonth(x.date, month));
  const expenses = state.expenses.filter(x => inMonth(x.date, month));
  const revenue = sales.reduce((s, x) => s + num(x.qty) * num(x.unitPrice), 0);
  const cost = sales.reduce((s, x) => s + num(x.qty) * avgCost(x.productId), 0);
  const expense = expenses.reduce((s, x) => s + num(x.amount), 0);
  return { revenue, cost, expense, profit: revenue - cost - expense };
}

function setDefaults() {
  $$("input[type=date]").forEach(input => {
    if (!input.value) input.value = today();
  });
  if (!$("#monthFilter").value) $("#monthFilter").value = monthNow();
}

function fillSelects() {
  $$("select[name=productId]").forEach(sel => {
    const current = sel.value;
    sel.innerHTML = `<option value="">请选择商品</option>` + state.products
      .map(p => `<option value="${p.id}">${escapeHtml(p.code || "")} ${escapeHtml(p.name || "")}</option>`)
      .join("");
    sel.value = current;
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function listOrEmpty(container, html) {
  container.innerHTML = html || $("#emptyTpl").innerHTML;
}

function itemActions(type, id) {
  return `<div class="item-actions">
    <button class="mini-btn" data-edit="${type}" data-id="${id}" type="button">编辑</button>
    <button class="mini-btn" data-delete="${type}" data-id="${id}" type="button">删除</button>
  </div>`;
}

function renderDashboard() {
  const month = $("#monthFilter").value || monthNow();
  const s = monthSummary(month);
  $("#kpiRevenue").textContent = money(s.revenue);
  $("#kpiCost").textContent = money(s.cost);
  $("#kpiExpense").textContent = money(s.expense);
  $("#kpiProfit").textContent = money(s.profit);
  $("#kpiProfit").className = s.profit < 0 ? "negative" : "";

  const stocks = state.products.map(p => ({ ...p, ...stockFor(p.id) })).sort((a, b) => a.stock - b.stock);
  $("#stockCount").textContent = `${stocks.length} 个商品`;
  listOrEmpty($("#stockList"), stocks.slice(0, 12).map(p => `
    <article class="item">
      <div>
        <h3>${escapeHtml(p.name)} ${p.stock <= 0 ? "（需补货）" : ""}</h3>
        <p>编号：${escapeHtml(p.code || "-")}｜规格：${escapeHtml(p.spec || "-")}｜平均成本：${money(p.cost)}</p>
      </div>
      <div class="amount ${p.stock <= 0 ? "negative" : "positive"}">${p.stock} 件<br><small>${money(p.amount)}</small></div>
    </article>`).join(""));
}

function renderProducts() {
  listOrEmpty($("#productList"), state.products.map(p => {
    const st = stockFor(p.id);
    return `<article class="item">
      <div>
        <h3>${escapeHtml(p.name)}</h3>
        <p>编号：${escapeHtml(p.code || "-")}｜规格：${escapeHtml(p.spec || "-")}｜默认进货价：${money(p.cost)}</p>
      </div>
      <div class="amount">${st.stock} 件</div>
      ${itemActions("products", p.id)}
    </article>`;
  }).join(""));
}

function renderPurchases() {
  const rows = [...state.purchases].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  listOrEmpty($("#purchaseList"), rows.map(x => {
    const p = productById(x.productId);
    const total = num(x.qty) * num(x.unitCost) + num(x.extraCost);
    return `<article class="item">
      <div>
        <h3>${escapeHtml(p.name || "未命名商品")}</h3>
        <p>${x.date || "-"}｜供应商：${escapeHtml(x.supplier || "-")}｜数量：${num(x.qty)} 件｜单价：${money(x.unitCost)}</p>
      </div>
      <div class="amount">${money(total)}</div>
      ${itemActions("purchases", x.id)}
    </article>`;
  }).join(""));
}

function renderSales() {
  const rows = [...state.sales].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  listOrEmpty($("#saleList"), rows.map(x => {
    const p = productById(x.productId);
    const revenue = num(x.qty) * num(x.unitPrice);
    const profit = revenue - num(x.qty) * avgCost(x.productId);
    const title = x.revenueOnly ? "航富通销售收入" : (p.name || "未命名商品");
    const subText = x.revenueOnly ? "只计入销售额，不扣库存、不计算商品成本" : `毛利 ${money(profit)}`;
    return `<article class="item">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${x.date || "-"}｜订单：${escapeHtml(x.orderNo || "-")}｜数量：${num(x.qty)} 件｜渠道：${escapeHtml(x.channel || "-")}</p>
      </div>
      <div class="amount">${money(revenue)}<br><small class="${x.revenueOnly ? "" : (profit < 0 ? "negative" : "positive")}">${subText}</small></div>
      ${itemActions("sales", x.id)}
    </article>`;
  }).join(""));
}

function renderExpenses() {
  const rows = [...state.expenses].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  listOrEmpty($("#expenseList"), rows.map(x => `
    <article class="item">
      <div>
        <h3>${escapeHtml(x.title || x.category || "开支")}</h3>
        <p>${x.date || "-"}｜类别：${escapeHtml(x.category || "-")}｜付款：${escapeHtml(x.payment || "-")}</p>
      </div>
      <div class="amount negative">${money(x.amount)}</div>
      ${itemActions("expenses", x.id)}
    </article>`).join(""));
}

function renderAll() {
  fillSelects();
  renderDashboard();
  renderProducts();
  renderPurchases();
  renderSales();
  renderExpenses();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function upsert(type, data) {
  const rows = state[type];
  if (data.id) {
    const idx = rows.findIndex(x => x.id === data.id);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...data };
  } else {
    rows.push({ ...data, id: uid() });
  }
  saveState();
  renderAll();
}

function resetForm(form) {
  form.reset();
  form.elements.id.value = "";
  setDefaults();
}

function bindForms() {
  $("#productForm").addEventListener("submit", e => {
    e.preventDefault();
    const d = formData(e.currentTarget);
    upsert("products", { ...d, cost: num(d.cost), openingQty: num(d.openingQty), openingAmount: num(d.openingAmount) });
    resetForm(e.currentTarget);
  });
  $("#purchaseForm").addEventListener("submit", e => {
    e.preventDefault();
    const d = formData(e.currentTarget);
    upsert("purchases", { ...d, qty: num(d.qty), unitCost: num(d.unitCost), extraCost: num(d.extraCost) });
    resetForm(e.currentTarget);
  });
  $("#saleForm").addEventListener("submit", e => {
    e.preventDefault();
    const d = formData(e.currentTarget);
    upsert("sales", { ...d, qty: num(d.qty), unitPrice: num(d.unitPrice) });
    resetForm(e.currentTarget);
  });
  $("#expenseForm").addEventListener("submit", e => {
    e.preventDefault();
    const d = formData(e.currentTarget);
    upsert("expenses", { ...d, amount: num(d.amount) });
    resetForm(e.currentTarget);
  });
}

function bindNav() {
  $$(".tabbar button").forEach(btn => btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    $$(".tabbar button").forEach(b => b.classList.toggle("active", b === btn));
    $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${view}`));
    $("#pageTitle").textContent = titles[view] || "总览";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
}

function bindActions() {
  document.addEventListener("click", e => {
    const del = e.target.closest("[data-delete]");
    const edit = e.target.closest("[data-edit]");
    const clear = e.target.closest("[data-clear]");
    if (del) {
      if (!confirm("确定删除这条记录吗？")) return;
      const type = del.dataset.delete;
      state[type] = state[type].filter(x => x.id !== del.dataset.id);
      saveState();
      renderAll();
    }
    if (clear) {
      if (!confirm("确定清空这一类记录吗？这个操作不能撤销。")) return;
      state[clear.dataset.clear] = [];
      saveState();
      renderAll();
    }
    if (edit) {
      loadToForm(edit.dataset.edit, edit.dataset.id);
    }
  });
  $("#monthFilter").addEventListener("change", renderDashboard);
}

function loadToForm(type, id) {
  const map = {
    products: "#productForm",
    purchases: "#purchaseForm",
    sales: "#saleForm",
    expenses: "#expenseForm"
  };
  const form = $(map[type]);
  const row = state[type].find(x => x.id === id);
  if (!form || !row) return;
  Object.entries(row).forEach(([k, v]) => {
    if (form.elements[k]) form.elements[k].value = v;
  });
  const view = type === "products" ? "products" : type;
  $(`.tabbar button[data-view="${view}"]`)?.click();
}

function bindBackup() {
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `水晶店财务备份_${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#importFile").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    Object.assign(state, data);
    saveState();
    renderAll();
    alert("备份已导入。");
  });
}

function normalizeHeader(row) {
  const out = {};
  Object.entries(row).forEach(([k, v]) => {
    out[String(k).trim()] = v;
  });
  return out;
}

function excelDateToIso(value) {
  if (!value) return today();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const text = String(value).trim().replace(/\//g, "-");
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const d = new Date(text);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return today();
}

function splitHftProduct(text, barcode) {
  const raw = String(text || "").trim();
  if (raw.includes("/")) {
    const [left, ...rest] = raw.split("/");
    const code = left.trim() || String(barcode || "").replace(/\.0$/, "").trim() || "无码商品";
    const name = rest.join("/").trim() || "无码商品";
    return { code, name };
  }
  return {
    code: String(barcode || "").replace(/\.0$/, "").trim() || raw || "无码商品",
    name: raw || "无码商品"
  };
}

function findOrCreateProduct({ code, name, spec }) {
  const normalizedCode = String(code || "").trim();
  const normalizedName = String(name || "").trim() || "未命名商品";
  let product = state.products.find(p => p.code === normalizedCode && p.name === normalizedName);
  if (!product && normalizedCode && normalizedCode !== "无码商品") {
    product = state.products.find(p => p.code === normalizedCode);
  }
  if (!product) {
    product = {
      id: uid(),
      code: normalizedCode || "无码商品",
      name: normalizedName,
      spec: String(spec || "").trim(),
      cost: 0,
      openingQty: 0,
      openingAmount: 0
    };
    state.products.push(product);
  } else if (!product.spec && spec) {
    product.spec = String(spec || "").trim();
  }
  return product;
}

function getHftRows(workbook) {
  const sheetName = workbook.SheetNames.find(n => n.includes("销售订单明细")) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true }).map(normalizeHeader);
}

function rowValue(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== "") return row[name];
  }
  return "";
}

async function importHftFile(file) {
  if (!window.XLSX) throw new Error("Excel 解析组件未加载，请刷新页面后重试。");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const rows = getHftRows(workbook).filter(row => rowValue(row, ["订单编号", "商品", "实际销售额"]) !== "");
  if (!rows.length) throw new Error("没有识别到航富通销售订单明细，请确认导出的是“销售订单明细报表”。");

  const existingKeys = new Set(state.importedHftKeys || []);
  const dayTotals = new Map();
  let importedRows = 0;
  let skipped = 0;
  let revenue = 0;

  rows.forEach(row => {
    const orderNo = String(rowValue(row, ["订单编号", "订单号"])).trim();
    const date = excelDateToIso(rowValue(row, ["销售日期", "日期"]));
    const productText = rowValue(row, ["商品", "商品名称"]);
    const saleQty = num(rowValue(row, ["销售数量", "数量"]));
    const returnQty = num(rowValue(row, ["退货数量"]));
    const amount = num(rowValue(row, ["实际销售额", "商品实收(元)", "订单总额(元)"]));
    const sourceKey = `hft-row:${orderNo}:${date}:${String(productText).trim()}:${saleQty}:${returnQty}:${amount}`;
    if (existingKeys.has(sourceKey)) {
      skipped += 1;
      return;
    }
    existingKeys.add(sourceKey);
    dayTotals.set(date, (dayTotals.get(date) || 0) + amount);
    importedRows += 1;
    revenue += amount;
  });

  dayTotals.forEach((amount, date) => {
    const dailyKey = `hft-revenue:${date}`;
    const existing = state.sales.find(x => x.sourceKey === dailyKey);
    if (existing) {
      existing.unitPrice = num(existing.unitPrice) + amount;
      existing.note = `航富通销售额按日期汇总；本记录只计销售收入，不扣库存、不计算商品成本；最近导入:${new Date().toLocaleString("zh-CN")}`;
    } else {
      state.sales.push({
        id: uid(),
        date,
        productId: "",
        orderNo: `航富通-${date}`,
        qty: 1,
        unitPrice: amount,
        channel: "航富通",
        note: "航富通销售额按日期汇总；本记录只计销售收入，不扣库存、不计算商品成本。",
        source: "航富通销售额",
        sourceKey: dailyKey,
        revenueOnly: true
      });
    }
  });

  state.importedHftKeys = Array.from(existingKeys);
  saveState();
  renderAll();
  return { importedRows, dayCount: dayTotals.size, skipped, revenue };
}

function bindHftImport() {
  const input = $("#hftImportFile");
  if (!input) return;
  input.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    $("#hftImportStatus").textContent = "正在导入，请稍等...";
    try {
      const result = await importHftFile(file);
      $("#hftImportStatus").textContent = `导入完成：新增明细 ${result.importedRows} 行，按 ${result.dayCount} 天汇总为销售收入，跳过重复 ${result.skipped} 行，导入销售额 ${money(result.revenue)}。本次导入不扣库存、不计算商品成本。`;
    } catch (err) {
      $("#hftImportStatus").textContent = `导入失败：${err.message}`;
    } finally {
      input.value = "";
    }
  });
}

async function cloudRequest(method, url, key, body) {
  const res = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

async function syncCloud(options = {}) {
  if (syncing) {
    pendingSync = true;
    return;
  }
  const cfg = cloudConfig();
  if (!cfg.url || !cfg.key || !cfg.storeCode) {
    if (!options.silent) {
      setSyncStatus("还没有填写云同步设置。");
      $(`.tabbar button[data-view="settings"]`).click();
    }
    return;
  }
  syncing = true;
  if (!options.silent) setSyncStatus("正在同步...");
  try {
    const base = `${cfg.url.replace(/\/$/, "")}/rest/v1/crystal_finance_data`;
    const query = `${base}?store_code=eq.${encodeURIComponent(cfg.storeCode)}&select=*`;
    const remote = await cloudRequest("GET", query, cfg.key);
    const remoteRow = remote?.[0];
    if (remoteRow?.data && new Date(remoteRow.updated_at) > new Date(state.updatedAt || 0)) {
      Object.assign(state, remoteRow.data);
      saveState({ skipAutoSync: true });
    } else {
      saveState({ skipAutoSync: true });
    }
    await cloudRequest("POST", `${base}?on_conflict=store_code`, cfg.key, {
      store_code: cfg.storeCode,
      data: state,
      updated_at: state.updatedAt
    });
    renderAll();
    setSyncStatus(`同步完成：${new Date().toLocaleString("zh-CN")}`);
  } finally {
    syncing = false;
    if (pendingSync) {
      pendingSync = false;
      scheduleAutoSync();
    }
  }
}

function bindCloud() {
  const cfg = cloudConfig();
  $("#supabaseUrl").value = cfg.url || "";
  $("#supabaseKey").value = cfg.key || "";
  $("#storeCode").value = cfg.storeCode || "";
  $("#saveCloudBtn").addEventListener("click", () => {
    saveCloudConfig({
      url: $("#supabaseUrl").value.trim(),
      key: $("#supabaseKey").value.trim(),
      storeCode: $("#storeCode").value.trim()
    });
    setSyncStatus("同步设置已保存，正在做第一次同步...");
    syncCloud({ silent: true }).catch(err => {
      setSyncStatus("第一次同步失败，请检查 Supabase 表和 Key。");
      alert(`同步失败：${err.message.slice(0, 180)}`);
    });
  });
  $("#syncBtn").addEventListener("click", () => {
    syncCloud().catch(err => {
      setSyncStatus("同步失败，请检查 Supabase 表和 Key。");
      alert(`同步失败：${err.message.slice(0, 180)}`);
    });
  });
}

function bindAutoSync() {
  if (hasCloudConfig()) {
    setTimeout(() => syncCloud({ silent: true }).catch(() => setSyncStatus("自动同步失败，请检查网络或同步设置。")), 800);
  }
  window.addEventListener("focus", () => {
    if (hasCloudConfig()) syncCloud({ silent: true }).catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && hasCloudConfig()) syncCloud({ silent: true }).catch(() => {});
  });
  setInterval(() => {
    if (hasCloudConfig() && !document.hidden) syncCloud({ silent: true }).catch(() => {});
  }, AUTO_PULL_INTERVAL);
}

function seedIfEmpty() {
  if (state.products.length) return;
  state.products.push(
    { id: uid(), code: "SP001", name: "白水晶手串", spec: "8mm", cost: 35, openingQty: 0, openingAmount: 0 },
    { id: uid(), code: "SP002", name: "紫水晶吊坠", spec: "银扣", cost: 58, openingQty: 0, openingAmount: 0 },
    { id: uid(), code: "SP003", name: "黄水晶摆件", spec: "约300g", cost: 120, openingQty: 0, openingAmount: 0 }
  );
  saveState();
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

seedIfEmpty();
setDefaults();
bindForms();
bindNav();
bindActions();
bindBackup();
bindHftImport();
bindCloud();
bindAutoSync();
renderAll();
registerSW();
