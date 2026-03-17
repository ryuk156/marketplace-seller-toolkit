'use strict';

/**
 * Marketplace Seller Toolkit - Popup Logic
 *
 * Manages settings UI, stats display, and dashboard navigation.
 */

// ─── Category Definitions ────────────────────────────────────────────────────

const CATEGORIES = [
  'Computers & Tablets',
  'Cell Phones',
  'TV & Home Theatre',
  'Cameras & Camcorders',
  'Audio',
  'Car Electronics',
  'Musical Instruments',
  'Video Games',
  'Movies & Music',
  'Appliances',
  'Smart Home',
  'Health & Fitness',
  'Toys & Drones',
  'Office & Stationery',
  'Furniture & Home',
  'Baby & Kids'
];

// ─── DOM Elements ────────────────────────────────────────────────────────────

const enabledToggle = document.getElementById('mst-enabled');
const defaultCommissionSlider = document.getElementById('mst-default-commission');
const commissionDisplay = document.getElementById('mst-commission-display');
const categoryList = document.getElementById('mst-category-list');
const monthlyFeeInput = document.getElementById('mst-monthly-fee');
const shippingCostInput = document.getElementById('mst-shipping-cost');
const statScanned = document.getElementById('mst-stat-scanned');
const statComparisons = document.getElementById('mst-stat-comparisons');
const openDashboardBtn = document.getElementById('mst-open-dashboard');
const saveStatus = document.getElementById('mst-save-status');

// ─── Settings State ──────────────────────────────────────────────────────────

let currentSettings = {};
let saveTimeout = null;

// ─── Initialize ──────────────────────────────────────────────────────────────

async function init() {
  // Load settings
  chrome.runtime.sendMessage({ action: 'getSettings' }, (settings) => {
    if (chrome.runtime.lastError) {
      console.error('[MST Popup] Failed to load settings:', chrome.runtime.lastError);
      return;
    }
    currentSettings = settings || {};
    populateUI(currentSettings);
  });

  // Load stats
  chrome.runtime.sendMessage({ action: 'getDailyStats' }, (stats) => {
    if (chrome.runtime.lastError) return;
    if (stats) {
      statScanned.textContent = stats.scanned || 0;
      statComparisons.textContent = stats.comparisons || 0;
    }
  });

  // Setup event listeners
  setupListeners();
}

function populateUI(settings) {
  // Enabled toggle
  enabledToggle.checked = settings.enabled !== false;

  // Default commission
  const commission = settings.defaultCommission || 10;
  defaultCommissionSlider.value = commission;
  commissionDisplay.textContent = `${commission}%`;

  // Monthly fee and shipping
  monthlyFeeInput.value = settings.monthlyFee ?? 29.99;
  shippingCostInput.value = settings.shippingCost ?? 0;

  // Category commissions
  buildCategoryList(settings.categoryCommissions || {});
}

function buildCategoryList(categoryCommissions) {
  categoryList.innerHTML = '';

  for (const category of CATEGORIES) {
    const rate = categoryCommissions[category] ?? currentSettings.defaultCommission ?? 10;

    const row = document.createElement('div');
    row.className = 'mst-category-row';
    row.innerHTML = `
      <span class="mst-category-name">${category}</span>
      <input type="number" class="mst-category-input" data-category="${category}"
             value="${rate}" min="0" max="50" step="0.5" />
      <span class="mst-category-pct">%</span>
    `;
    categoryList.appendChild(row);
  }

  // Category input change handlers
  categoryList.querySelectorAll('.mst-category-input').forEach(input => {
    input.addEventListener('change', () => {
      scheduleSettingsSave();
    });
  });
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

function setupListeners() {
  // Enable/disable toggle
  enabledToggle.addEventListener('change', () => {
    scheduleSettingsSave();
    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const settings = gatherSettings();
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'settingsUpdated',
          settings
        });
      }
    });
  });

  // Default commission slider
  defaultCommissionSlider.addEventListener('input', () => {
    commissionDisplay.textContent = `${defaultCommissionSlider.value}%`;
  });

  defaultCommissionSlider.addEventListener('change', () => {
    scheduleSettingsSave();
  });

  // Fee inputs
  monthlyFeeInput.addEventListener('change', () => scheduleSettingsSave());
  shippingCostInput.addEventListener('change', () => scheduleSettingsSave());

  // Section collapse/expand
  document.querySelectorAll('.mst-section-header').forEach(header => {
    header.addEventListener('click', () => {
      header.classList.toggle('mst-expanded');
      const sectionId = header.getAttribute('data-section');
      const body = document.getElementById(`${sectionId}-body`);
      if (body) {
        body.classList.toggle('mst-open');
      }
    });
  });

  // Open dashboard
  openDashboardBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openDashboard' });
  });
}

// ─── Save Settings ───────────────────────────────────────────────────────────

function gatherSettings() {
  const categoryCommissions = {};
  categoryList.querySelectorAll('.mst-category-input').forEach(input => {
    const category = input.getAttribute('data-category');
    const value = parseFloat(input.value);
    if (category && !isNaN(value)) {
      categoryCommissions[category] = value;
    }
  });

  return {
    enabled: enabledToggle.checked,
    defaultCommission: parseFloat(defaultCommissionSlider.value) || 10,
    categoryCommissions,
    monthlyFee: parseFloat(monthlyFeeInput.value) || 0,
    shippingCost: parseFloat(shippingCostInput.value) || 0
  };
}

function scheduleSettingsSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const settings = gatherSettings();
    chrome.runtime.sendMessage({
      action: 'saveSettings',
      settings
    }, (response) => {
      if (response?.success) {
        showSaveStatus();
      }
    });
  }, 300);
}

function showSaveStatus() {
  saveStatus.classList.add('mst-visible');
  setTimeout(() => {
    saveStatus.classList.remove('mst-visible');
  }, 1500);
}

// Start
init();
