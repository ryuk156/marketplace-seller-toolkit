'use strict';

/**
 * Marketplace Seller Toolkit - Dashboard Logic
 *
 * Full comparison dashboard with sortable table, search, export, and settings.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  'Computers & Tablets', 'Cell Phones', 'TV & Home Theatre',
  'Cameras & Camcorders', 'Audio', 'Car Electronics',
  'Musical Instruments', 'Video Games', 'Movies & Music',
  'Appliances', 'Smart Home', 'Health & Fitness',
  'Toys & Drones', 'Office & Stationery', 'Furniture & Home', 'Baby & Kids'
];

// ─── State ───────────────────────────────────────────────────────────────────

let historyData = [];
let filteredData = [];
let currentSort = { field: null, direction: 'asc' };
let settings = {};

// ─── DOM References ──────────────────────────────────────────────────────────

const tableBody = document.getElementById('mst-table-body');
const emptyState = document.getElementById('mst-empty-state');
const searchInput = document.getElementById('mst-search');
const exportBtn = document.getElementById('mst-export-csv');
const clearBtn = document.getElementById('mst-clear-data');

// Stats
const statTotalProducts = document.getElementById('dash-total-products');
const statAvgSavings = document.getElementById('dash-avg-savings');
const statLowestElsewhere = document.getElementById('dash-lowest-elsewhere');
const statLastScan = document.getElementById('dash-last-scan');

// Settings
const dashCommissionSlider = document.getElementById('dash-default-commission');
const dashCommissionDisplay = document.getElementById('dash-commission-display');
const dashMonthlyFee = document.getElementById('dash-monthly-fee');
const dashShippingCost = document.getElementById('dash-shipping-cost');
const dashCategoryList = document.getElementById('dash-category-list');
const dashSaveBtn = document.getElementById('dash-save-settings');
const dashSaveStatus = document.getElementById('dash-save-status');

// ─── Initialize ──────────────────────────────────────────────────────────────

async function init() {
  loadHistory();
  loadSettings();
  setupEventListeners();
}

function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getComparisonHistory' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[MST Dashboard] Failed to load history:', chrome.runtime.lastError);
      return;
    }
    historyData = response?.history || [];
    filteredData = [...historyData];
    renderTable();
    updateStats();
  });
}

function loadSettings() {
  chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (chrome.runtime.lastError) return;
    settings = response || {};
    populateSettings(settings);
  });
}

// ─── Table Rendering ─────────────────────────────────────────────────────────

function renderTable() {
  tableBody.innerHTML = '';

  if (filteredData.length === 0) {
    emptyState.classList.add('mst-visible');
    document.getElementById('mst-data-table').style.display = 'none';
    return;
  }

  emptyState.classList.remove('mst-visible');
  document.getElementById('mst-data-table').style.display = 'table';

  for (const entry of filteredData) {
    const row = document.createElement('tr');

    const amazon = findResult(entry.results, 'Amazon.ca');
    const walmart = findResult(entry.results, 'Walmart.ca');
    const newegg = findResult(entry.results, 'Newegg.ca');
    const staples = findResult(entry.results, 'Staples.ca');

    // Find lowest price across all marketplaces
    const allPrices = [];
    if (entry.bbPrice) allPrices.push({ mp: 'Best Buy', price: entry.bbPrice });
    if (amazon.found && amazon.price) allPrices.push({ mp: 'Amazon', price: amazon.price });
    if (walmart.found && walmart.price) allPrices.push({ mp: 'Walmart', price: walmart.price });
    if (newegg.found && newegg.price) allPrices.push({ mp: 'Newegg', price: newegg.price });
    if (staples.found && staples.price) allPrices.push({ mp: 'Staples', price: staples.price });

    allPrices.sort((a, b) => a.price - b.price);
    const lowest = allPrices.length > 0 ? allPrices[0] : null;

    // Profit calculation
    const profitHtml = calculateProfitHtml(entry);

    row.innerHTML = `
      <td class="mst-product-name" title="${escapeHtml(entry.productName || '')}">${escapeHtml(entry.productName || 'Unknown')}</td>
      <td>${entry.sku || '--'}</td>
      <td>${entry.upc || '--'}</td>
      <td class="mst-price-cell">${formatPrice(entry.bbPrice)}</td>
      <td class="mst-price-cell">${formatPriceLink(amazon, 'amazon')}</td>
      <td class="mst-price-cell">${formatPriceLink(walmart, 'walmart')}</td>
      <td class="mst-price-cell">${formatPriceLink(newegg, 'newegg')}</td>
      <td class="mst-price-cell">${formatPriceLink(staples, 'staples')}</td>
      <td class="mst-price-cell ${lowest ? 'mst-lowest-cell' : ''}">${lowest ? `${formatPrice(lowest.price)}<br><small>${lowest.mp}</small>` : '--'}</td>
      <td class="mst-price-cell">${profitHtml}</td>
    `;

    tableBody.appendChild(row);
  }
}

function findResult(results, marketplace) {
  if (!results) return { found: false, price: null, url: null };
  return results.find(r => r.marketplace === marketplace) || { found: false, price: null, url: null };
}

function formatPrice(price) {
  if (price === null || price === undefined) return '<span class="mst-na-cell">N/A</span>';
  return `$${price.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPriceLink(result, mpClass) {
  if (!result.found || !result.price) return '<span class="mst-na-cell">N/A</span>';
  const priceStr = `$${result.price.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (result.url) {
    return `<a href="${escapeHtml(result.url)}" target="_blank" class="mst-mp-${mpClass}">${priceStr}</a>`;
  }
  return `<span class="mst-mp-${mpClass}">${priceStr}</span>`;
}

function calculateProfitHtml(entry) {
  if (!entry.bbPrice) return '<span class="mst-na-cell">N/A</span>';

  const commissionRate = settings.defaultCommission || 10;
  const commissionFee = entry.bbPrice * (commissionRate / 100);
  const shippingCost = settings.shippingCost || 0;

  // We don't have cost price in the history, so just show commission
  return `<span style="color:#888">-$${commissionFee.toFixed(2)} (${commissionRate}%)</span>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

function updateStats() {
  statTotalProducts.textContent = historyData.length;

  // Average potential savings (difference from BB to lowest)
  let totalSavings = 0;
  let savingsCount = 0;
  let lowerCount = 0;

  for (const entry of historyData) {
    if (!entry.bbPrice || !entry.results) continue;

    const otherPrices = entry.results
      .filter(r => r.found && r.price && r.marketplace !== 'Best Buy.ca')
      .map(r => r.price);

    if (otherPrices.length > 0) {
      const minOther = Math.min(...otherPrices);
      if (minOther < entry.bbPrice) {
        totalSavings += (entry.bbPrice - minOther);
        savingsCount++;
        lowerCount++;
      }
    }
  }

  const avgSavings = savingsCount > 0 ? totalSavings / savingsCount : 0;
  statAvgSavings.textContent = `$${avgSavings.toFixed(2)}`;
  statLowestElsewhere.textContent = lowerCount;

  // Last scan
  if (historyData.length > 0) {
    const latest = historyData.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
    const date = new Date(latest.timestamp);
    statLastScan.textContent = date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

function sortData(field) {
  // Toggle sort direction
  if (currentSort.field === field) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.field = field;
    currentSort.direction = 'asc';
  }

  // Update header classes
  document.querySelectorAll('.mst-table th').forEach(th => {
    th.classList.remove('mst-sort-asc', 'mst-sort-desc');
    if (th.getAttribute('data-sort') === field) {
      th.classList.add(currentSort.direction === 'asc' ? 'mst-sort-asc' : 'mst-sort-desc');
    }
  });

  filteredData.sort((a, b) => {
    let aVal = getSortValue(a, field);
    let bVal = getSortValue(b, field);

    // Handle nulls
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;

    let comparison;
    if (typeof aVal === 'string') {
      comparison = aVal.localeCompare(bVal);
    } else {
      comparison = aVal - bVal;
    }

    return currentSort.direction === 'asc' ? comparison : -comparison;
  });

  renderTable();
}

function getSortValue(entry, field) {
  switch (field) {
    case 'productName': return entry.productName || '';
    case 'sku': return entry.sku || '';
    case 'upc': return entry.upc || '';
    case 'bbPrice': return entry.bbPrice || null;
    case 'amazon': return getResultPrice(entry, 'Amazon.ca');
    case 'walmart': return getResultPrice(entry, 'Walmart.ca');
    case 'newegg': return getResultPrice(entry, 'Newegg.ca');
    case 'staples': return getResultPrice(entry, 'Staples.ca');
    case 'lowest': {
      const prices = (entry.results || [])
        .filter(r => r.found && r.price)
        .map(r => r.price);
      if (entry.bbPrice) prices.push(entry.bbPrice);
      return prices.length > 0 ? Math.min(...prices) : null;
    }
    case 'profit': {
      if (!entry.bbPrice) return null;
      const rate = settings.defaultCommission || 10;
      return entry.bbPrice - (entry.bbPrice * rate / 100) - (settings.shippingCost || 0);
    }
    default: return null;
  }
}

function getResultPrice(entry, marketplace) {
  if (!entry.results) return null;
  const result = entry.results.find(r => r.marketplace === marketplace);
  return result && result.found ? result.price : null;
}

// ─── Search / Filter ─────────────────────────────────────────────────────────

function filterData(query) {
  if (!query) {
    filteredData = [...historyData];
  } else {
    const lowerQuery = query.toLowerCase();
    filteredData = historyData.filter(entry => {
      const name = (entry.productName || '').toLowerCase();
      const sku = (entry.sku || '').toLowerCase();
      const upc = (entry.upc || '').toLowerCase();
      return name.includes(lowerQuery) || sku.includes(lowerQuery) || upc.includes(lowerQuery);
    });
  }
  renderTable();
}

// ─── Export CSV ──────────────────────────────────────────────────────────────

function handleExport() {
  chrome.runtime.sendMessage({ action: 'exportData' }, (response) => {
    if (chrome.runtime.lastError || !response?.csv) {
      alert('Failed to export data');
      return;
    }

    const blob = new Blob([response.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mst-price-comparison-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

// ─── Clear Data ──────────────────────────────────────────────────────────────

function handleClear() {
  if (!confirm('Are you sure you want to clear all comparison data? This cannot be undone.')) {
    return;
  }

  chrome.runtime.sendMessage({ action: 'clearComparisonHistory' }, () => {
    historyData = [];
    filteredData = [];
    renderTable();
    updateStats();
  });
}

// ─── Settings Panel ──────────────────────────────────────────────────────────

function populateSettings(s) {
  dashCommissionSlider.value = s.defaultCommission || 10;
  dashCommissionDisplay.textContent = `${s.defaultCommission || 10}%`;
  dashMonthlyFee.value = s.monthlyFee ?? 29.99;
  dashShippingCost.value = s.shippingCost ?? 0;

  // Build category list
  dashCategoryList.innerHTML = '';
  const cats = s.categoryCommissions || {};
  for (const category of CATEGORIES) {
    const rate = cats[category] ?? s.defaultCommission ?? 10;
    const row = document.createElement('div');
    row.className = 'mst-settings-cat-row';
    row.innerHTML = `
      <span class="mst-settings-cat-name">${category}</span>
      <input type="number" class="mst-settings-cat-input" data-category="${category}"
             value="${rate}" min="0" max="50" step="0.5" />
      <span class="mst-settings-cat-pct">%</span>
    `;
    dashCategoryList.appendChild(row);
  }
}

function saveSettingsFromDashboard() {
  const categoryCommissions = {};
  dashCategoryList.querySelectorAll('.mst-settings-cat-input').forEach(input => {
    const category = input.getAttribute('data-category');
    const value = parseFloat(input.value);
    if (category && !isNaN(value)) {
      categoryCommissions[category] = value;
    }
  });

  const newSettings = {
    defaultCommission: parseFloat(dashCommissionSlider.value) || 10,
    categoryCommissions,
    monthlyFee: parseFloat(dashMonthlyFee.value) || 0,
    shippingCost: parseFloat(dashShippingCost.value) || 0
  };

  chrome.runtime.sendMessage({ action: 'saveSettings', settings: newSettings }, (response) => {
    if (response?.success) {
      settings = { ...settings, ...newSettings };
      dashSaveStatus.textContent = 'Settings saved!';
      dashSaveStatus.classList.add('mst-visible');
      setTimeout(() => dashSaveStatus.classList.remove('mst-visible'), 2000);
      // Re-render table with new settings
      renderTable();
    }
  });
}

// ─── Navigation ──────────────────────────────────────────────────────────────

function switchView(viewName) {
  document.querySelectorAll('.mst-view').forEach(v => v.classList.remove('mst-active'));
  document.querySelectorAll('.mst-nav-item').forEach(n => n.classList.remove('mst-active'));

  const view = document.getElementById(`view-${viewName}`);
  if (view) view.classList.add('mst-active');

  const navItem = document.querySelector(`.mst-nav-item[data-view="${viewName}"]`);
  if (navItem) navItem.classList.add('mst-active');

  const pageTitle = document.getElementById('mst-page-title');
  if (viewName === 'comparisons') {
    pageTitle.textContent = 'Price Comparisons';
  } else if (viewName === 'settings') {
    pageTitle.textContent = 'Settings';
  }
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

function setupEventListeners() {
  // Search
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      filterData(searchInput.value.trim());
    }, 200);
  });

  // Export
  exportBtn.addEventListener('click', handleExport);

  // Clear
  clearBtn.addEventListener('click', handleClear);

  // Table header sort
  document.querySelectorAll('.mst-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      sortData(th.getAttribute('data-sort'));
    });
  });

  // Navigation
  document.querySelectorAll('.mst-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(item.getAttribute('data-view'));
    });
  });

  // Settings - commission slider
  dashCommissionSlider.addEventListener('input', () => {
    dashCommissionDisplay.textContent = `${dashCommissionSlider.value}%`;
  });

  // Settings - save
  dashSaveBtn.addEventListener('click', saveSettingsFromDashboard);
}

// Start
init();
