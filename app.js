// تطبيق طباعة فواتير على طابعات POS الحرارية (58/80 مم)
// كل البيانات بتنحفظ بالمتصفح (localStorage).

const STORAGE = {
  store: 'pos.store',
  products: 'pos.products',
  lastNumber: 'pos.lastNumber',
  draft: 'pos.draft',
};

const defaultStore = {
  name: '', phone: '', address: '', taxId: '', cashier: '',
  footer: 'شكراً لزيارتكم!',
  logo: '',
  paper: '80', fontSize: '12',
  currency: '$', taxRate: '0', rate: '', currency2: 'ل.ل',
};

let store = { ...defaultStore, ...load(STORAGE.store, {}) };
let products = load(STORAGE.products, {}); // { name: price }
let invoice = load(STORAGE.draft, null) || newInvoice();

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
  } catch (e) {
    console.warn('تعذر الحفظ', e);
  }
}

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function newInvoice() {
  const next = (parseInt(load(STORAGE.lastNumber, 0), 10) || 0) + 1;
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

function totals() {
  const subtotal = invoice.items.reduce((s, it) => s + num(it.qty) * num(it.price), 0);
  const discount = invoice.discountType === 'percent'
    ? subtotal * num(invoice.discount) / 100
    : num(invoice.discount);
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = afterDiscount * num(store.taxRate) / 100;
  const total = afterDiscount + tax;
  const paid = num(invoice.paid);
  const change = paid > 0 ? paid - total : 0;
  return { subtotal, discount, tax, total, paid, change };
}

// ===== الفورم =====

function bindFields() {
  document.querySelectorAll('[data-store]').forEach((el) => {
    const key = el.dataset.store;
    el.value = store[key] ?? '';
    el.addEventListener('input', () => {
      store[key] = el.value;
      save(STORAGE.store, store);
      render();
    });
  });

  document.querySelectorAll('[data-inv]').forEach((el) => {
    const key = el.dataset.inv;
    el.addEventListener('input', () => {
      invoice[key] = el.value;
      saveDraft();
      render();
    });
  });
  fillInvoiceFields();

  document.getElementById('logo-input').addEventListener('change', onLogo);
  document.getElementById('logo-remove').addEventListener('click', () => {
    store.logo = '';
    save(STORAGE.store, store);
    document.getElementById('logo-input').value = '';
    render();
  });

  // اذا ما في اسم محل، افتح قسم معلومات المحل
  if (!store.name) document.getElementById('store-card').open = true;
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
      store.logo = canvas.toDataURL('image/png');
      save(STORAGE.store, store);
      render();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// ===== المنتجات =====

function renderItems() {
  const body = document.getElementById('items-body');
  body.innerHTML = '';
  invoice.items.forEach((it, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input list="products-list" data-f="name" placeholder="اسم المنتج"></td>
      <td><input type="number" min="0" step="any" data-f="qty"></td>
      <td><input type="number" min="0" step="any" data-f="price"></td>
      <td class="line-total"></td>
      <td><button class="del" title="حذف">✕</button></td>`;
    tr.querySelectorAll('[data-f]').forEach((el) => {
      const f = el.dataset.f;
      el.value = it[f] ?? '';
      el.addEventListener('input', () => {
        it[f] = el.value;
        // تعبئة السعر تلقائياً من المنتجات المحفوظة
        if (f === 'name' && products[el.value] !== undefined && !num(it.price)) {
          it.price = products[el.value];
          tr.querySelector('[data-f="price"]').value = it.price;
        }
        updateLineTotal(tr, it);
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
    tr.querySelector('.del').addEventListener('click', () => {
      invoice.items.splice(i, 1);
      if (!invoice.items.length) invoice.items.push({ name: '', qty: 1, price: '' });
      saveDraft();
      renderItems();
      render();
    });
    updateLineTotal(tr, it);
    body.appendChild(tr);
  });
}

function updateLineTotal(tr, it) {
  tr.querySelector('.line-total').textContent = fmt(num(it.qty) * num(it.price));
}

function addItem() {
  invoice.items.push({ name: '', qty: 1, price: '' });
  saveDraft();
  renderItems();
  const inputs = document.querySelectorAll('#items-body [data-f="name"]');
  inputs[inputs.length - 1].focus();
}

function renderProductList() {
  const list = document.getElementById('products-list');
  list.innerHTML = Object.keys(products)
    .sort()
    .map((n) => `<option value="${escapeHtml(n)}">`)
    .join('');
}

function rememberProducts() {
  invoice.items.forEach((it) => {
    const name = it.name.trim();
    if (name && num(it.price) > 0) products[name] = num(it.price);
  });
  save(STORAGE.products, products);
  renderProductList();
}

// ===== الفاتورة =====

function receiptHtml() {
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

// ===== الأزرار =====

function printInvoice() {
  const hasItems = invoice.items.some((it) => it.name.trim() && num(it.price) > 0);
  if (!hasItems && !confirm('ما في منتجات بالفاتورة. بدك تطبع هيك؟')) return;
  rememberProducts();
  const n = parseInt(invoice.number, 10);
  if (Number.isFinite(n) && n > (parseInt(load(STORAGE.lastNumber, 0), 10) || 0)) {
    save(STORAGE.lastNumber, n);
  }
  render();
  window.print();
}

function startNew() {
  if (!confirm('بدك تبلش فاتورة جديدة؟ الفاتورة الحالية رح تنمسح.')) return;
  invoice = newInvoice();
  saveDraft();
  fillInvoiceFields();
  renderItems();
  render();
}

document.getElementById('btn-print').addEventListener('click', printInvoice);
document.getElementById('btn-new').addEventListener('click', startNew);
document.getElementById('btn-add').addEventListener('click', addItem);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    printInvoice();
  }
});

bindFields();
renderProductList();
renderItems();
render();
