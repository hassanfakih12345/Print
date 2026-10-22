// تطبيق طباعة فواتير على طابعات POS الحرارية (58/80 مم)
// كل البيانات بتنحفظ بالمتصفح (localStorage): الشركات، منتجات كل شركة، والفاتورة الحالية.

const STORAGE = {
  data: 'pos.v2',
  draft: 'pos.draft',
};

const defaultCompany = {
  name: '', phone: '', address: '', taxId: '', cashier: '',
  footer: 'شكراً لزيارتكم!',
  logo: '',
  paper: '80', fontSize: '12',
  currency: '$', taxRate: '0', rate: '', currency2: 'ل.ل',
  lastNumber: 0,
  products: [], // [{ name, price }]
};

const storageOk = checkStorage();
let data = loadData();
let invoice = load(STORAGE.draft, null) || newInvoice();

function checkStorage() {
  try {
    const k = 'pos.test';
    localStorage.setItem(k, '1');
    const ok = localStorage.getItem(k) === '1';
    localStorage.removeItem(k);
    return ok;
  } catch {
    return false;
  }
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('تعذر الحفظ', e);
    return false;
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// بيقرا البيانات، وبينقل بيانات النسخة القديمة (محل واحد) اذا موجودة
function loadData() {
  const saved = load(STORAGE.data, null);
  if (saved && saved.companies && Object.keys(saved.companies).length) {
    for (const id of Object.keys(saved.companies)) {
      saved.companies[id] = { ...defaultCompany, ...saved.companies[id] };
    }
    if (!saved.companies[saved.activeId]) saved.activeId = Object.keys(saved.companies)[0];
    return saved;
  }
  const oldStore = load('pos.store', {});
  const oldProducts = load('pos.products', {});
  const id = uid();
  return {
    activeId: id,
    companies: {
      [id]: {
        ...defaultCompany,
        ...oldStore,
        lastNumber: parseInt(load('pos.lastNumber', 0), 10) || 0,
        products: Object.entries(oldProducts).map(([name, price]) => ({ name, price })),
      },
    },
  };
}

function company() {
  return data.companies[data.activeId];
}

let statusTimer;
function persist() {
  const ok = save(STORAGE.data, data);
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = ok ? '✓ تم الحفظ' : '';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ''; }, 1500);
}

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function newInvoice() {
  const next = (parseInt(company().lastNumber, 10) || 0) + 1;
  return {
    number: String(next).padStart(5, '0'),
    date: nowLocal(),
    customer: '', customerPhone: '',
    payment: 'نقداً', paid: '',
    discount: '0', discountType: 'amount',
    notes: '',
    items: [{ name: '', qty: 1, price: '' }],
  };
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n) => num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Math.round(num(n)).toLocaleString('en-US');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// زر حذف بكبستين بدل confirm(): أول كبسة بتسأل "متأكد؟"، التانية بتنفذ
function armButton(btn, label, action) {
  if (btn.dataset.armed) {
    clearTimeout(Number(btn.dataset.armed));
    delete btn.dataset.armed;
    btn.classList.remove('armed');
    btn.textContent = btn.dataset.label;
    action();
    return;
  }
  btn.dataset.label = btn.textContent;
  btn.textContent = label;
  btn.classList.add('armed');
  btn.dataset.armed = String(setTimeout(() => {
    delete btn.dataset.armed;
    btn.classList.remove('armed');
    btn.textContent = btn.dataset.label;
  }, 3000));
}

function totals() {
  const subtotal = invoice.items.reduce((s, it) => s + num(it.qty) * num(it.price), 0);
  const discount = invoice.discountType === 'percent'
    ? subtotal * num(invoice.discount) / 100
    : num(invoice.discount);
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = afterDiscount * num(company().taxRate) / 100;
  const total = afterDiscount + tax;
  const paid = num(invoice.paid);
  const change = paid > 0 ? paid - total : 0;
  return { subtotal, discount, tax, total, paid, change };
}

// ===== الشركات =====

function renderCompanySelect() {
  const sel = document.getElementById('company-select');
  sel.innerHTML = Object.entries(data.companies)
    .map(([id, c]) => `<option value="${id}">${escapeHtml(c.name || 'شركة بلا اسم')}</option>`)
    .join('');
  sel.value = data.activeId;
}

function switchCompany(id) {
  data.activeId = id;
  persist();
  fillStoreFields();
  renderCompanySelect();
  renderCatalog();
  // رقم الفاتورة بيتبع عداد الشركة الجديدة
  invoice.number = newInvoice().number;
  saveDraft();
  fillInvoiceFields();
  render();
}

function addCompany() {
  const id = uid();
  const current = company();
  // الشركة الجديدة بتاخد إعدادات الطباعة من الحالية
  data.companies[id] = {
    ...defaultCompany,
    paper: current.paper, fontSize: current.fontSize,
    currency: current.currency, currency2: current.currency2, rate: current.rate,
    products: [],
  };
  switchCompany(id);
  const card = document.getElementById('store-card');
  card.open = true;
  card.querySelector('[data-store="name"]').focus();
}

function deleteCompany() {
  const ids = Object.keys(data.companies);
  if (ids.length === 1) {
    data.companies[data.activeId] = { ...defaultCompany, products: [] };
    switchCompany(data.activeId);
    return;
  }
  delete data.companies[data.activeId];
  switchCompany(Object.keys(data.companies)[0]);
}

// ===== الفورم =====

function fillStoreFields() {
  const c = company();
  document.querySelectorAll('[data-store]').forEach((el) => {
    el.value = c[el.dataset.store] ?? '';
  });
}

function bindFields() {
  document.querySelectorAll('[data-store]').forEach((el) => {
    const key = el.dataset.store;
    el.addEventListener('input', () => {
      company()[key] = el.value;
      persist();
      if (key === 'name') renderCompanySelect();
      render();
    });
  });
  fillStoreFields();

  document.querySelectorAll('[data-inv]').forEach((el) => {
    const key = el.dataset.inv;
    el.addEventListener('input', () => {
      invoice[key] = el.value;
      saveDraft();
      render();
    });
  });
  fillInvoiceFields();

  document.getElementById('company-select').addEventListener('change', (e) => switchCompany(e.target.value));
  document.getElementById('btn-company-add').addEventListener('click', addCompany);
  document.getElementById('btn-company-del').addEventListener('click', (e) =>
    armButton(e.currentTarget, 'متأكد؟ كبوس كمان', deleteCompany));

  document.getElementById('logo-input').addEventListener('change', onLogo);
  document.getElementById('logo-remove').addEventListener('click', () => {
    company().logo = '';
    persist();
    document.getElementById('logo-input').value = '';
    render();
  });

  document.getElementById('catalog-form').addEventListener('submit', onCatalogSubmit);
  document.getElementById('catalog-search').addEventListener('input', renderCatalog);
  document.getElementById('btn-export').addEventListener('click', exportBackup);
  document.getElementById('import-input').addEventListener('change', importBackup);

  // اذا ما في اسم شركة، افتح قسم معلومات الشركة
  if (!company().name) document.getElementById('store-card').open = true;
}

function fillInvoiceFields() {
  document.querySelectorAll('[data-inv]').forEach((el) => {
    el.value = invoice[el.dataset.inv] ?? '';
  });
}

function saveDraft() {
  save(STORAGE.draft, invoice);
}

// تصغير اللوغو قبل الحفظ حتى ما يكبر حجم التخزين
function onLogo(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxW = 400;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      company().logo = canvas.toDataURL('image/png');
      persist();
      render();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// ===== المنتجات المحفوظة =====

function findProduct(name) {
  const key = name.trim().toLowerCase();
  return company().products.find((p) => p.name.trim().toLowerCase() === key);
}

function upsertProduct(name, price) {
  name = name.trim();
  if (!name) return;
  const existing = findProduct(name);
  if (existing) existing.price = num(price);
  else company().products.push({ name, price: num(price) });
  company().products.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

function onCatalogSubmit(e) {
  e.preventDefault();
  const nameEl = document.getElementById('catalog-name');
  const priceEl = document.getElementById('catalog-price');
  upsertProduct(nameEl.value, priceEl.value);
  persist();
  nameEl.value = '';
  priceEl.value = '';
  nameEl.focus();
  renderCatalog();
}

function renderCatalog() {
  const products = company().products;
  const q = document.getElementById('catalog-search').value.trim().toLowerCase();
  const list = document.getElementById('catalog-list');
  const cur = escapeHtml(company().currency);
  list.innerHTML = '';
  products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !q || p.name.toLowerCase().includes(q))
    .forEach(({ p, i }) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <button type="button" class="pick"><span>${escapeHtml(p.name)}</span><span class="price">${fmt(p.price)} ${cur}</span></button>
        <button type="button" class="del" title="حذف">✕</button>`;
      li.querySelector('.pick').addEventListener('click', () => addToInvoice(p));
      li.querySelector('.del').addEventListener('click', (e) =>
        armButton(e.currentTarget, 'حذف؟', () => {
          products.splice(i, 1);
          persist();
          renderCatalog();
        }));
      list.appendChild(li);
    });

  document.getElementById('catalog-count').textContent = products.length ? `(${products.length})` : '';
  document.getElementById('products-list').innerHTML = products
    .map((p) => `<option value="${escapeHtml(p.name)}">`)
    .join('');
}

function addToInvoice(p) {
  const same = invoice.items.find((it) => it.name.trim() === p.name);
  if (same) {
    same.qty = num(same.qty) + 1;
  } else {
    const empty = invoice.items.find((it) => !it.name.trim() && !num(it.price));
    if (empty) Object.assign(empty, { name: p.name, qty: 1, price: p.price });
    else invoice.items.push({ name: p.name, qty: 1, price: p.price });
  }
  saveDraft();
  renderItems();
  render();
}

function rememberProducts() {
  invoice.items.forEach((it) => {
    if (it.name.trim() && num(it.price) > 0) upsertProduct(it.name, it.price);
  });
  persist();
  renderCatalog();
}

// ===== منتجات الفاتورة =====

function renderItems() {
  const body = document.getElementById('items-body');
  body.innerHTML = '';
  invoice.items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <input list="products-list" data-f="name" placeholder="اسم المنتج" aria-label="اسم المنتج">
      <input type="number" inputmode="decimal" min="0" step="any" data-f="qty" placeholder="الكمية" aria-label="الكمية">
      <input type="number" inputmode="decimal" min="0" step="any" data-f="price" placeholder="السعر" aria-label="السعر">
      <span class="line-total"></span>
      <button type="button" class="del" title="حذف">✕</button>`;
    row.querySelectorAll('[data-f]').forEach((el) => {
      const f = el.dataset.f;
      el.value = it[f] ?? '';
      el.addEventListener('input', () => {
        it[f] = el.value;
        // تعبئة السعر تلقائياً من المنتجات المحفوظة
        if (f === 'name') {
          const p = findProduct(el.value);
          if (p && !num(it.price)) {
            it.price = p.price;
            row.querySelector('[data-f="price"]').value = it.price;
          }
        }
        updateLineTotal(row, it);
        saveDraft();
        render();
      });
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && i === invoice.items.length - 1) {
          ev.preventDefault();
          addItem();
        }
      });
    });
    row.querySelector('.del').addEventListener('click', () => {
      invoice.items.splice(i, 1);
      if (!invoice.items.length) invoice.items.push({ name: '', qty: 1, price: '' });
      saveDraft();
      renderItems();
      render();
    });
    updateLineTotal(row, it);
    body.appendChild(row);
  });
}

function updateLineTotal(row, it) {
  row.querySelector('.line-total').textContent = fmt(num(it.qty) * num(it.price));
}

function addItem() {
  invoice.items.push({ name: '', qty: 1, price: '' });
  saveDraft();
  renderItems();
  const inputs = document.querySelectorAll('#items-body [data-f="name"]');
  inputs[inputs.length - 1].focus();
}

// ===== الفاتورة =====

function receiptHtml() {
  const store = company();
  const t = totals();
  const cur = escapeHtml(store.currency);
  const money = (n) => `${fmt(n)} ${cur}`;
  const date = invoice.date ? new Date(invoice.date) : new Date();
  const dateStr = date.toLocaleDateString('en-GB') + ' ' +
    date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const items = invoice.items.filter((it) => it.name.trim() || num(it.price));

  const rows = items.map((it) => `
    <tr>
      <td>${escapeHtml(it.name)}</td>
      <td class="num">${escapeHtml(it.qty)}</td>
      <td class="num">${fmt(it.price)}</td>
      <td class="num">${fmt(num(it.qty) * num(it.price))}</td>
    </tr>`).join('');

  const line = (label, value, cls = '') =>
    `<div class="row ${cls}"><span>${label}</span><span>${value}</span></div>`;

  const rate = num(store.rate);

  return `
    ${store.logo ? `<img class="logo" src="${store.logo}" alt="">` : ''}
    <div class="center">
      ${store.name ? `<div class="store-name">${escapeHtml(store.name)}</div>` : ''}
      ${store.address ? `<div>${escapeHtml(store.address)}</div>` : ''}
      ${store.phone ? `<div>هاتف: <bdi dir="ltr">${escapeHtml(store.phone)}</bdi></div>` : ''}
      ${store.taxId ? `<div>الرقم الضريبي: ${escapeHtml(store.taxId)}</div>` : ''}
    </div>
    <hr class="sep">
    ${line('فاتورة رقم:', escapeHtml(invoice.number))}
    ${line('التاريخ:', dateStr)}
    ${store.cashier ? line('الكاشير:', escapeHtml(store.cashier)) : ''}
    ${invoice.customer ? line('الزبون:', escapeHtml(invoice.customer)) : ''}
    ${invoice.customerPhone ? line('هاتف الزبون:', `<bdi dir="ltr">${escapeHtml(invoice.customerPhone)}</bdi>`) : ''}
    <hr class="sep">
    <table>
      <thead><tr><th>الصنف</th><th class="num">كمية</th><th class="num">سعر</th><th class="num">مجموع</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr class="sep">
    ${line('المجموع:', money(t.subtotal))}
    ${t.discount ? line('الخصم:', '- ' + money(t.discount)) : ''}
    ${t.tax ? line(`الضريبة (${escapeHtml(store.taxRate)}%):`, money(t.tax)) : ''}
    ${line('الإجمالي:', money(t.total), 'total')}
    ${rate ? line('', `<bdi>${fmtInt(t.total * rate)} ${escapeHtml(store.currency2)}</bdi>`, 'muted') : ''}
    <hr class="sep">
    ${line('طريقة الدفع:', escapeHtml(invoice.payment))}
    ${t.paid ? line('المدفوع:', money(t.paid)) : ''}
    ${t.paid ? line(t.change >= 0 ? 'الباقي:' : 'المتبقي عليه:', money(Math.abs(t.change))) : ''}
    ${invoice.notes ? `<hr class="sep"><div>${escapeHtml(invoice.notes)}</div>` : ''}
    ${store.footer ? `<hr class="sep"><div class="center">${escapeHtml(store.footer).replace(/\n/g, '<br>')}</div>` : ''}
  `;
}

function render() {
  const store = company();
  const html = receiptHtml();
  const width = `${store.paper}mm`;
  const fontSize = `${store.fontSize}px`;

  for (const id of ['receipt', 'print-area']) {
    const el = document.getElementById(id);
    el.innerHTML = html;
    el.style.setProperty('--w', width);
    el.style.fontSize = fontSize;
  }

  // حجم الصفحة حسب عرض الورق، والطول تلقائي (رول)
  document.getElementById('page-size').textContent =
    `@page { size: ${width} auto; margin: 0; }`;

  const thumb = document.getElementById('logo-thumb');
  if (store.logo) thumb.src = store.logo; else thumb.removeAttribute('src');
}

// ===== النسخة الاحتياطية =====

function exportBackup() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.companies || !Object.keys(parsed.companies).length) throw new Error('bad file');
      save(STORAGE.data, parsed);
      data = loadData();
      switchCompany(data.activeId);
      const el = document.getElementById('save-status');
      el.textContent = '✓ رجعت النسخة الاحتياطية';
    } catch {
      document.getElementById('save-status').textContent = '✕ الملف مش نسخة احتياطية صحيحة';
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

// ===== الأزرار =====

function printInvoice() {
  rememberProducts();
  const n = parseInt(invoice.number, 10);
  if (Number.isFinite(n) && n > (parseInt(company().lastNumber, 10) || 0)) {
    company().lastNumber = n;
    persist();
  }
  render();
  window.print();
}

function startNew() {
  invoice = newInvoice();
  saveDraft();
  fillInvoiceFields();
  renderItems();
  render();
}

document.getElementById('btn-print').addEventListener('click', printInvoice);
document.getElementById('btn-new').addEventListener('click', (e) =>
  armButton(e.currentTarget, 'متأكد؟ كبوس كمان', startNew));
document.getElementById('btn-add').addEventListener('click', addItem);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    printInvoice();
  }
});

document.getElementById('storage-warning').hidden = storageOk;
bindFields();
renderCompanySelect();
renderCatalog();
renderItems();
render();
