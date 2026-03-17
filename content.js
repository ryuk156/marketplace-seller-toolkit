'use strict';

/**
 * Marketplace Seller Toolkit - Content Script
 *
 * Injected on Best Buy Canada pages to detect products,
 * show marketplace badges, enable price comparison, and
 * display profit calculator.
 */

// ─── State ───────────────────────────────────────────────────────────────────

const MST = {
  settings: null,
  processedCards: new WeakSet(),
  observer: null,
  enabled: true
};

// ─── Product Card Detection ──────────────────────────────────────────────────

/**
 * Find all product cards on the page using multiple selectors
 * for resilience against markup changes.
 */
function findProductCards() {
  const selectors = [
    'li.sku-item',
    '[data-testid="product-item"]',
    '[data-sku-id]',
    '.productLine',
    '.product-item',
    '.listing-product-item'
  ];

  const cards = new Set();
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach(el => cards.add(el));
  }
  return Array.from(cards);
}

/**
 * Extract product data from a card element.
 */
function extractProductData(card) {
  const data = {
    sku: null,
    productName: null,
    price: null,
    productUrl: null,
    category: null
  };

  // SKU extraction
  data.sku = card.getAttribute('data-sku-id')
    || card.getAttribute('data-sku')
    || card.querySelector('[data-sku-id]')?.getAttribute('data-sku-id')
    || null;

  // Product name
  const nameEl = card.querySelector(
    '[data-automation="productTitle"], .productName, .product-title, h3 a, h2 a, .prod-title a'
  );
  if (nameEl) {
    data.productName = nameEl.textContent.trim();
    if (nameEl.href) {
      data.productUrl = nameEl.href;
    }
  }

  // If no URL from name, try any product link
  if (!data.productUrl) {
    const link = card.querySelector('a[href*="/product/"], a[href*="/en-ca/product/"]');
    if (link) {
      data.productUrl = link.href;
    }
  }

  // SKU from URL fallback
  if (!data.sku && data.productUrl) {
    const skuMatch = data.productUrl.match(/\/(\d{7,8})(?:[?#]|$)/);
    if (skuMatch) {
      data.sku = skuMatch[1];
    }
  }

  // Price extraction
  const priceSelectors = [
    '[data-automation="product-price"] span',
    '.productPricingContainer .price',
    '.prod-price span',
    '.price_FHDfG',
    '.price'
  ];
  for (const sel of priceSelectors) {
    const el = card.querySelector(sel);
    if (el) {
      const priceText = el.textContent.replace(/[^0-9.,]/g, '');
      const parsed = parseFloat(priceText.replace(/,/g, ''));
      if (parsed > 0) {
        data.price = parsed;
        break;
      }
    }
  }

  return data;
}

// ─── Badge Creation ──────────────────────────────────────────────────────────

/**
 * Create the MST badge container for a product card.
 */
function createBadge(card, productData) {
  // Don't process cards we've already handled
  if (MST.processedCards.has(card)) return;
  MST.processedCards.add(card);

  const badge = document.createElement('div');
  badge.className = 'mst-badge';
  badge.setAttribute('data-sku', productData.sku || '');

  // Compare button
  const compareBtn = document.createElement('button');
  compareBtn.className = 'mst-compare-btn';
  compareBtn.innerHTML = '&#x1F50D; Compare Prices';
  compareBtn.title = 'Compare prices across marketplaces';
  compareBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleCompareClick(card, productData, badge);
  });

  badge.appendChild(compareBtn);

  // Profit calculator row
  const profitRow = createProfitRow(productData);
  badge.appendChild(profitRow);

  // Insert badge into the card
  const insertTarget = card.querySelector('.productPricingContainer, .prod-price, .price')
    || card.querySelector('[data-automation="product-price"]')
    || card;

  if (insertTarget === card) {
    card.appendChild(badge);
  } else {
    insertTarget.parentNode.insertBefore(badge, insertTarget.nextSibling);
  }

  // Update stats
  chrome.runtime.sendMessage({ action: 'updateDailyStats', type: 'scanned' });
}

// ─── Profit Calculator ──────────────────────────────────────────────────────

function createProfitRow(productData) {
  const row = document.createElement('div');
  row.className = 'mst-profit-row';

  if (!productData.price) {
    row.innerHTML = '<span class="mst-profit-na">Price not detected</span>';
    return row;
  }

  const settings = MST.settings || {};
  const commissionRate = getCommissionRate(productData.category, settings);
  const commissionFee = productData.price * (commissionRate / 100);

  // Check for stored cost price
  const sku = productData.sku;
  if (sku) {
    chrome.runtime.sendMessage({ action: 'getCostPrice', sku }, (response) => {
      if (chrome.runtime.lastError) return;
      const costPrice = response?.costPrice;

      if (costPrice !== null && costPrice !== undefined) {
        const shippingCost = settings.shippingCost || 0;
        const profit = productData.price - commissionFee - shippingCost - costPrice;
        const margin = (profit / productData.price) * 100;
        const isPositive = profit >= 0;

        row.innerHTML = `
          <span class="mst-profit-label">Profit:</span>
          <span class="mst-profit-value ${isPositive ? 'mst-profit-positive' : 'mst-profit-negative'}">
            $${profit.toFixed(2)} (${margin.toFixed(1)}% margin)
          </span>
          <button class="mst-cost-edit" title="Edit cost price">&#9998;</button>
        `;
      } else {
        row.innerHTML = `
          <span class="mst-profit-label">Commission: ${commissionRate}% ($${commissionFee.toFixed(2)})</span>
          <button class="mst-cost-set" title="Set cost price to calculate profit">Set cost</button>
        `;
      }

      // Attach cost price edit handler
      const editBtn = row.querySelector('.mst-cost-edit, .mst-cost-set');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showCostPriceEditor(row, productData, settings);
        });
      }
    });
  } else {
    row.innerHTML = `
      <span class="mst-profit-label">Commission: ${commissionRate}% ($${commissionFee.toFixed(2)})</span>
    `;
  }

  return row;
}

function getCommissionRate(category, settings) {
  if (!settings.categoryCommissions || !category) {
    return settings.defaultCommission || 10;
  }
  return settings.categoryCommissions[category] || settings.defaultCommission || 10;
}

/**
 * Show inline cost price editor.
 */
function showCostPriceEditor(row, productData, settings) {
  const existingEditor = row.querySelector('.mst-cost-editor');
  if (existingEditor) {
    existingEditor.remove();
    return;
  }

  const editor = document.createElement('div');
  editor.className = 'mst-cost-editor';
  editor.innerHTML = `
    <input type="number" class="mst-cost-input" placeholder="Cost price ($)" step="0.01" min="0" />
    <button class="mst-cost-save">Save</button>
    <button class="mst-cost-cancel">Cancel</button>
  `;

  row.appendChild(editor);

  const input = editor.querySelector('.mst-cost-input');
  input.focus();

  editor.querySelector('.mst-cost-save').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const costPrice = parseFloat(input.value);
    if (isNaN(costPrice) || costPrice < 0) return;

    chrome.runtime.sendMessage({
      action: 'saveCostPrice',
      sku: productData.sku,
      costPrice
    }, () => {
      editor.remove();
      // Recalculate profit display
      updateProfitRow(row, productData, costPrice, settings);
    });
  });

  editor.querySelector('.mst-cost-cancel').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    editor.remove();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      editor.querySelector('.mst-cost-save').click();
    } else if (e.key === 'Escape') {
      editor.remove();
    }
  });
}

function updateProfitRow(row, productData, costPrice, settings) {
  const commissionRate = getCommissionRate(productData.category, settings);
  const commissionFee = productData.price * (commissionRate / 100);
  const shippingCost = settings.shippingCost || 0;
  const profit = productData.price - commissionFee - shippingCost - costPrice;
  const margin = (profit / productData.price) * 100;
  const isPositive = profit >= 0;

  row.innerHTML = `
    <span class="mst-profit-label">Profit:</span>
    <span class="mst-profit-value ${isPositive ? 'mst-profit-positive' : 'mst-profit-negative'}">
      $${profit.toFixed(2)} (${margin.toFixed(1)}% margin)
    </span>
    <button class="mst-cost-edit" title="Edit cost price">&#9998;</button>
  `;

  const editBtn = row.querySelector('.mst-cost-edit');
  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCostPriceEditor(row, productData, settings);
    });
  }
}

// ─── Price Comparison ────────────────────────────────────────────────────────

function handleCompareClick(card, productData, badge) {
  // Check if comparison panel already exists
  const existingPanel = badge.querySelector('.mst-comparison-panel');
  if (existingPanel) {
    existingPanel.remove();
    return;
  }

  // Create loading panel
  const panel = document.createElement('div');
  panel.className = 'mst-comparison-panel';
  panel.innerHTML = `
    <div class="mst-panel-header">
      <span>&#x1F4CA; Price Comparison</span>
      <button class="mst-panel-close" title="Close">&times;</button>
    </div>
    <div class="mst-panel-body mst-loading">
      <div class="mst-skeleton-row"></div>
      <div class="mst-skeleton-row"></div>
      <div class="mst-skeleton-row"></div>
      <div class="mst-skeleton-row"></div>
      <div class="mst-skeleton-row"></div>
    </div>
  `;

  badge.appendChild(panel);

  panel.querySelector('.mst-panel-close').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    panel.remove();
  });

  // Send comparison request to background
  chrome.runtime.sendMessage({
    action: 'comparePrice',
    sku: productData.sku,
    upc: productData.sku, // Use SKU as UPC fallback for searches
    productName: productData.productName,
    productUrl: productData.productUrl,
    bbPrice: productData.price
  }, (response) => {
    if (chrome.runtime.lastError) {
      renderComparisonError(panel, chrome.runtime.lastError.message);
      return;
    }
    if (response?.error) {
      renderComparisonError(panel, response.error);
      return;
    }
    renderComparisonResults(panel, response.results, productData.price);
  });
}

function renderComparisonResults(panel, results, bbPrice) {
  const body = panel.querySelector('.mst-panel-body');
  if (!body) return;

  body.classList.remove('mst-loading');

  // Find lowest price among all results
  const allPrices = results
    .filter(r => r.found && r.price)
    .map(r => ({ marketplace: r.marketplace, price: r.price, url: r.url }));

  if (bbPrice) {
    allPrices.push({ marketplace: 'Best Buy.ca (current)', price: bbPrice, url: null });
  }

  allPrices.sort((a, b) => a.price - b.price);
  const lowestPrice = allPrices.length > 0 ? allPrices[0].price : null;
  const lowestMarketplace = allPrices.length > 0 ? allPrices[0].marketplace : null;

  const marketplaceColors = {
    'Amazon.ca': { dot: '#FF9900', label: 'Amazon.ca' },
    'Walmart.ca': { dot: '#0071DC', label: 'Walmart.ca' },
    'Newegg.ca': { dot: '#D14905', label: 'Newegg.ca' },
    'Staples.ca': { dot: '#CC0000', label: 'Staples.ca' },
    'Best Buy.ca': { dot: '#0046BE', label: 'Best Buy.ca' }
  };

  let html = '';

  for (const result of results) {
    const colors = marketplaceColors[result.marketplace] || { dot: '#888', label: result.marketplace };
    const isLowest = result.found && result.price === lowestPrice;
    const priceDiff = result.found && result.price && bbPrice
      ? result.price - bbPrice
      : null;

    html += `<div class="mst-mp-row ${isLowest ? 'mst-mp-lowest' : ''}" ${result.url ? `data-url="${result.url}"` : ''}>`;
    html += `<span class="mst-mp-dot" style="background:${colors.dot}"></span>`;
    html += `<span class="mst-mp-name">${colors.label}</span>`;

    if (result.found && result.price) {
      html += `<span class="mst-mp-price">$${result.price.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
      if (isLowest && allPrices.length > 1) {
        html += '<span class="mst-mp-badge-lowest">LOWEST</span>';
      }
      if (priceDiff !== null && priceDiff !== 0) {
        const sign = priceDiff > 0 ? '+' : '';
        const cls = priceDiff < 0 ? 'mst-diff-lower' : 'mst-diff-higher';
        html += `<span class="mst-mp-diff ${cls}">${sign}$${priceDiff.toFixed(2)}</span>`;
      }
      if (result.url) {
        html += '<span class="mst-mp-link" title="Open in new tab">&#8599;</span>';
      }
    } else {
      html += '<span class="mst-mp-not-found">Not Found</span>';
    }

    html += '</div>';
  }

  // Add current BB price row
  if (bbPrice) {
    const isLowestBB = bbPrice === lowestPrice;
    html += `<div class="mst-mp-row mst-mp-current ${isLowestBB ? 'mst-mp-lowest' : ''}">`;
    html += `<span class="mst-mp-dot" style="background:#0046BE"></span>`;
    html += `<span class="mst-mp-name">Best Buy (current)</span>`;
    html += `<span class="mst-mp-price">$${bbPrice.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
    if (isLowestBB) {
      html += '<span class="mst-mp-badge-lowest">LOWEST</span>';
    }
    html += '</div>';
  }

  // Summary footer
  if (lowestPrice && lowestMarketplace && bbPrice) {
    const diff = lowestPrice - bbPrice;
    const diffStr = diff < 0 ? `-$${Math.abs(diff).toFixed(2)}` : `+$${diff.toFixed(2)}`;
    html += `<div class="mst-mp-summary">Lowest: ${lowestMarketplace} (${diffStr})</div>`;
  }

  body.innerHTML = html;

  // Attach click handlers for marketplace rows with URLs
  body.querySelectorAll('.mst-mp-row[data-url]').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(row.getAttribute('data-url'), '_blank');
    });
  });
}

function renderComparisonError(panel, errorMessage) {
  const body = panel.querySelector('.mst-panel-body');
  if (!body) return;
  body.classList.remove('mst-loading');
  body.innerHTML = `
    <div class="mst-error">
      <span>Failed to fetch comparison data</span>
      <small>${errorMessage || 'Unknown error'}</small>
    </div>
  `;
}

// ─── Floating Compare All Button ─────────────────────────────────────────────

function createFloatingButton() {
  if (document.querySelector('.mst-floating-btn')) return;

  const cards = findProductCards();
  if (cards.length === 0) return;

  const btn = document.createElement('button');
  btn.className = 'mst-floating-btn';
  btn.innerHTML = '&#x1F4CA; Compare All';
  btn.title = 'Compare all products on this page across marketplaces';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    handleCompareAll();
  });
  document.body.appendChild(btn);
}

async function handleCompareAll() {
  const cards = findProductCards();
  const btn = document.querySelector('.mst-floating-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '&#x23F3; Comparing...';
  }

  for (const card of cards) {
    const badge = card.querySelector('.mst-badge');
    if (!badge) continue;

    const productData = extractProductData(card);
    if (!productData.sku && !productData.productName) continue;

    // Trigger comparison for each card
    const compareBtn = badge.querySelector('.mst-compare-btn');
    if (compareBtn) {
      compareBtn.click();
      // Wait between comparisons to avoid overwhelming the background script
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '&#x1F4CA; Compare All';
  }
}

// ─── Initialization ──────────────────────────────────────────────────────────

function processPage() {
  if (!MST.enabled) return;

  const cards = findProductCards();
  for (const card of cards) {
    if (MST.processedCards.has(card)) continue;
    const productData = extractProductData(card);
    if (productData.sku || productData.productName) {
      createBadge(card, productData);
    }
  }

  createFloatingButton();
}

/**
 * Initialize the content script.
 */
async function init() {
  // Load settings
  chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[MST] Could not load settings:', chrome.runtime.lastError.message);
      MST.settings = {};
      return;
    }
    MST.settings = response || {};
    MST.enabled = MST.settings.enabled !== false;

    if (!MST.enabled) {
      console.log('[MST] Extension is disabled');
      return;
    }

    // Process existing cards
    processPage();

    // Watch for dynamically loaded cards (infinite scroll, AJAX navigation)
    MST.observer = new MutationObserver((mutations) => {
      let hasNewNodes = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          hasNewNodes = true;
          break;
        }
      }
      if (hasNewNodes) {
        // Debounce processing
        clearTimeout(MST._processTimer);
        MST._processTimer = setTimeout(processPage, 300);
      }
    });

    MST.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

// Listen for settings changes from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'settingsUpdated') {
    MST.settings = message.settings;
    MST.enabled = message.settings.enabled !== false;
    if (!MST.enabled) {
      // Remove all badges
      document.querySelectorAll('.mst-badge, .mst-floating-btn').forEach(el => el.remove());
      MST.processedCards = new WeakSet();
      if (MST.observer) MST.observer.disconnect();
    } else {
      processPage();
    }
    sendResponse({ success: true });
  }
  return true;
});

// Start
init();
