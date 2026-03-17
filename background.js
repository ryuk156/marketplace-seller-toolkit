'use strict';

/**
 * Marketplace Seller Toolkit - Background Service Worker
 *
 * Handles cross-origin fetches for marketplace price comparison,
 * settings management, and data persistence.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const FETCH_DELAY_MS = 500;
const CACHE_PREFIX = 'mst_compare_';

const DEFAULT_SETTINGS = {
  enabled: true,
  defaultCommission: 10,
  categoryCommissions: {
    'Computers & Tablets': 8,
    'Cell Phones': 8,
    'TV & Home Theatre': 8,
    'Cameras & Camcorders': 8,
    'Audio': 10,
    'Car Electronics': 10,
    'Musical Instruments': 10,
    'Video Games': 10,
    'Movies & Music': 15,
    'Appliances': 8,
    'Smart Home': 10,
    'Health & Fitness': 12,
    'Toys & Drones': 12,
    'Office & Stationery': 12,
    'Furniture & Home': 15,
    'Baby & Kids': 15
  },
  monthlyFee: 29.99,
  shippingCost: 0
};

// ─── Marketplace Search URLs ─────────────────────────────────────────────────

function buildSearchUrls(query) {
  const encoded = encodeURIComponent(query);
  return {
    amazon: `https://www.amazon.ca/s?k=${encoded}`,
    walmart: `https://www.walmart.ca/search?q=${encoded}`,
    newegg: `https://www.newegg.ca/p/pl?d=${encoded}`,
    staples: `https://www.staples.ca/search?query=${encoded}`,
    bestbuy: `https://www.bestbuy.ca/api/v2/json/search?query=${encoded}&lang=en-CA`
  };
}

// ─── HTML Parsers (regex-based for service worker) ───────────────────────────

/**
 * Parse Amazon.ca search results HTML for product info.
 * Tries multiple patterns since Amazon's markup changes frequently.
 */
function parseAmazonResults(html) {
  try {
    // Try to find the first search result with a price
    // Pattern 1: a-offscreen price span
    const offscreenPattern = /class="a-offscreen">\s*\$([\d,]+\.?\d*)\s*<\/span>/gi;
    const prices = [];
    let match;
    while ((match = offscreenPattern.exec(html)) !== null) {
      prices.push(parseFloat(match[1].replace(/,/g, '')));
    }

    // Pattern 2: a-price-whole and a-price-fraction
    if (prices.length === 0) {
      const wholePattern = /a-price-whole[^>]*>([\d,]+)/gi;
      const fractionPattern = /a-price-fraction[^>]*>(\d+)/gi;
      const wholeMatch = wholePattern.exec(html);
      const fractionMatch = fractionPattern.exec(html);
      if (wholeMatch) {
        const whole = wholeMatch[1].replace(/,/g, '');
        const fraction = fractionMatch ? fractionMatch[1] : '00';
        prices.push(parseFloat(`${whole}.${fraction}`));
      }
    }

    // Pattern 3: data-a-price attribute
    if (prices.length === 0) {
      const dataPricePattern = /data-a-price="([\d.]+)"/gi;
      while ((match = dataPricePattern.exec(html)) !== null) {
        prices.push(parseFloat(match[1]));
      }
    }

    // Extract product URL and title
    let productUrl = null;
    let productTitle = null;

    // Product link pattern
    const linkPattern = /class="a-link-normal[^"]*s-underline-text[^"]*"[^>]*href="(\/[^"]*\/dp\/[^"]+)"/i;
    const linkMatch = linkPattern.exec(html);
    if (linkMatch) {
      productUrl = `https://www.amazon.ca${linkMatch[1]}`;
    } else {
      // Fallback link pattern
      const fallbackLinkPattern = /href="(\/[^"]*\/dp\/[A-Z0-9]{10}[^"]*)"/i;
      const fallbackMatch = fallbackLinkPattern.exec(html);
      if (fallbackMatch) {
        productUrl = `https://www.amazon.ca${fallbackMatch[1]}`;
      }
    }

    // Title pattern
    const titlePattern = /class="a-size-[^"]*a-text-normal[^"]*"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i;
    const titleMatch = titlePattern.exec(html);
    if (titleMatch) {
      productTitle = titleMatch[1].trim();
    } else {
      const altTitlePattern = /class="a-text-normal"[^>]*>([^<]+)</i;
      const altTitleMatch = altTitlePattern.exec(html);
      if (altTitleMatch) {
        productTitle = altTitleMatch[1].trim();
      }
    }

    if (prices.length > 0) {
      return {
        marketplace: 'Amazon.ca',
        price: prices[0],
        url: productUrl || 'https://www.amazon.ca',
        title: productTitle || 'Amazon Product',
        found: true
      };
    }

    return { marketplace: 'Amazon.ca', price: null, url: null, title: null, found: false };
  } catch (e) {
    console.error('[MST] Amazon parse error:', e);
    return { marketplace: 'Amazon.ca', price: null, url: null, title: null, found: false };
  }
}

/**
 * Parse Walmart.ca search results HTML.
 */
function parseWalmartResults(html) {
  try {
    // Walmart uses various price patterns
    // Pattern 1: data-automation="current-price" or similar
    const pricePatterns = [
      /\$\s*([\d,]+\.?\d*)\s*<\/span>/gi,
      /"currentPrice":\s*([\d.]+)/gi,
      /data-automation="current-price"[^>]*>\s*\$?([\d,]+\.?\d*)/gi,
      /"price":\s*"?\$?([\d,]+\.?\d*)"?/gi
    ];

    let price = null;
    for (const pattern of pricePatterns) {
      const match = pattern.exec(html);
      if (match) {
        const parsed = parseFloat(match[1].replace(/,/g, ''));
        if (parsed > 0 && parsed < 100000) {
          price = parsed;
          break;
        }
      }
    }

    // Extract URL
    let productUrl = null;
    const urlPattern = /href="(\/ip\/[^"]+)"/i;
    const urlMatch = urlPattern.exec(html);
    if (urlMatch) {
      productUrl = `https://www.walmart.ca${urlMatch[1]}`;
    }

    // Extract title
    let productTitle = null;
    const titlePattern = /data-automation="product-title"[^>]*>([^<]+)</i;
    const titleMatch = titlePattern.exec(html);
    if (titleMatch) {
      productTitle = titleMatch[1].trim();
    }

    if (price) {
      return {
        marketplace: 'Walmart.ca',
        price,
        url: productUrl || 'https://www.walmart.ca',
        title: productTitle || 'Walmart Product',
        found: true
      };
    }

    return { marketplace: 'Walmart.ca', price: null, url: null, title: null, found: false };
  } catch (e) {
    console.error('[MST] Walmart parse error:', e);
    return { marketplace: 'Walmart.ca', price: null, url: null, title: null, found: false };
  }
}

/**
 * Parse Newegg.ca search results HTML.
 */
function parseNeweggResults(html) {
  try {
    // Newegg price patterns
    const pricePatterns = [
      /class="price-current"[^>]*>\s*\$?\s*<strong>([\d,]+)<\/strong><sup>\.([\d]+)<\/sup>/i,
      /class="price-current"[^>]*>[^$]*\$([\d,]+\.?\d*)/i,
      /"FinalPrice":\s*"?([\d.]+)"?/gi
    ];

    let price = null;
    for (const pattern of pricePatterns) {
      const match = pattern.exec(html);
      if (match) {
        if (match[2]) {
          price = parseFloat(`${match[1].replace(/,/g, '')}.${match[2]}`);
        } else {
          price = parseFloat(match[1].replace(/,/g, ''));
        }
        if (price > 0 && price < 100000) break;
        price = null;
      }
    }

    // Extract URL
    let productUrl = null;
    const urlPattern = /class="item-title"[^>]*href="([^"]+)"/i;
    const urlMatch = urlPattern.exec(html);
    if (urlMatch) {
      productUrl = urlMatch[1].startsWith('http') ? urlMatch[1] : `https://www.newegg.ca${urlMatch[1]}`;
    } else {
      const altUrlPattern = /href="(https:\/\/www\.newegg\.ca\/[^"]*\/p\/[^"]+)"/i;
      const altUrlMatch = altUrlPattern.exec(html);
      if (altUrlMatch) {
        productUrl = altUrlMatch[1];
      }
    }

    // Extract title
    let productTitle = null;
    const titlePattern = /class="item-title"[^>]*>([^<]+)</i;
    const titleMatch = titlePattern.exec(html);
    if (titleMatch) {
      productTitle = titleMatch[1].trim();
    }

    if (price) {
      return {
        marketplace: 'Newegg.ca',
        price,
        url: productUrl || 'https://www.newegg.ca',
        title: productTitle || 'Newegg Product',
        found: true
      };
    }

    return { marketplace: 'Newegg.ca', price: null, url: null, title: null, found: false };
  } catch (e) {
    console.error('[MST] Newegg parse error:', e);
    return { marketplace: 'Newegg.ca', price: null, url: null, title: null, found: false };
  }
}

/**
 * Parse Staples.ca search results HTML.
 */
function parseStaplesResults(html) {
  try {
    const pricePatterns = [
      /class="[^"]*price[^"]*"[^>]*>\s*\$\s*([\d,]+\.?\d*)/gi,
      /"price":\s*"?\$?([\d,]+\.?\d*)"?/gi,
      /\$([\d,]+\.\d{2})/g
    ];

    let price = null;
    for (const pattern of pricePatterns) {
      const match = pattern.exec(html);
      if (match) {
        const parsed = parseFloat(match[1].replace(/,/g, ''));
        if (parsed > 0 && parsed < 100000) {
          price = parsed;
          break;
        }
      }
    }

    // Extract URL
    let productUrl = null;
    const urlPattern = /href="(\/products\/[^"]+)"/i;
    const urlMatch = urlPattern.exec(html);
    if (urlMatch) {
      productUrl = `https://www.staples.ca${urlMatch[1]}`;
    }

    // Extract title
    let productTitle = null;
    const titlePattern = /class="[^"]*product-title[^"]*"[^>]*>([^<]+)</i;
    const titleMatch = titlePattern.exec(html);
    if (titleMatch) {
      productTitle = titleMatch[1].trim();
    }

    if (price) {
      return {
        marketplace: 'Staples.ca',
        price,
        url: productUrl || 'https://www.staples.ca',
        title: productTitle || 'Staples Product',
        found: true
      };
    }

    return { marketplace: 'Staples.ca', price: null, url: null, title: null, found: false };
  } catch (e) {
    console.error('[MST] Staples parse error:', e);
    return { marketplace: 'Staples.ca', price: null, url: null, title: null, found: false };
  }
}

/**
 * Parse Best Buy Canada JSON API response.
 */
function parseBestBuyResults(json, currentSku) {
  try {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const products = data.products || [];

    // Find the matching product (skip current SKU)
    for (const product of products) {
      if (product.sku === currentSku) continue;
      return {
        marketplace: 'Best Buy.ca',
        price: product.salePrice || product.regularPrice || null,
        url: product.productUrl ? `https://www.bestbuy.ca${product.productUrl}` : 'https://www.bestbuy.ca',
        title: product.name || 'Best Buy Product',
        found: true,
        seller: product.seller ? product.seller.name : 'Best Buy'
      };
    }

    // If only one product and it matches, return it as the reference
    if (products.length > 0) {
      const p = products[0];
      return {
        marketplace: 'Best Buy.ca',
        price: p.salePrice || p.regularPrice || null,
        url: p.productUrl ? `https://www.bestbuy.ca${p.productUrl}` : 'https://www.bestbuy.ca',
        title: p.name || 'Best Buy Product',
        found: true,
        seller: p.seller ? p.seller.name : 'Best Buy'
      };
    }

    return { marketplace: 'Best Buy.ca', price: null, url: null, title: null, found: false };
  } catch (e) {
    console.error('[MST] Best Buy parse error:', e);
    return { marketplace: 'Best Buy.ca', price: null, url: null, title: null, found: false };
  }
}

// ─── Fetch with Timeout ──────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-CA,en;q=0.9'
      }
    });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// ─── Delay Helper ────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Marketplace Comparison ──────────────────────────────────────────────────

/**
 * Search a single marketplace and return parsed results.
 */
async function searchMarketplace(marketplace, url, sku) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      console.warn(`[MST] ${marketplace} returned status ${response.status}`);
      return { marketplace, price: null, url: null, title: null, found: false };
    }

    if (marketplace === 'Best Buy.ca') {
      const json = await response.json();
      return parseBestBuyResults(json, sku);
    }

    const html = await response.text();

    switch (marketplace) {
      case 'Amazon.ca':
        return parseAmazonResults(html);
      case 'Walmart.ca':
        return parseWalmartResults(html);
      case 'Newegg.ca':
        return parseNeweggResults(html);
      case 'Staples.ca':
        return parseStaplesResults(html);
      default:
        return { marketplace, price: null, url: null, title: null, found: false };
    }
  } catch (e) {
    console.error(`[MST] Error fetching ${marketplace}:`, e.message);
    return { marketplace, price: null, url: null, title: null, found: false };
  }
}

/**
 * Compare prices across all marketplaces for a product.
 * Searches sequentially with delays to avoid rate limiting.
 */
async function comparePrice(data) {
  const { sku, upc, productName, bbPrice } = data;
  const searchQuery = upc || productName;
  const cacheKey = `${CACHE_PREFIX}${upc || sku}`;

  // Check cache first
  try {
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey]) {
      const { results, timestamp } = cached[cacheKey];
      if (Date.now() - timestamp < CACHE_TTL_MS) {
        console.log('[MST] Returning cached comparison results');
        return { results, fromCache: true };
      }
    }
  } catch (e) {
    console.warn('[MST] Cache read error:', e);
  }

  const urls = buildSearchUrls(searchQuery);
  const marketplaces = [
    { name: 'Amazon.ca', url: urls.amazon },
    { name: 'Walmart.ca', url: urls.walmart },
    { name: 'Newegg.ca', url: urls.newegg },
    { name: 'Staples.ca', url: urls.staples },
    { name: 'Best Buy.ca', url: urls.bestbuy }
  ];

  const results = [];

  // Fetch sequentially with delays
  for (let i = 0; i < marketplaces.length; i++) {
    const mp = marketplaces[i];
    const result = await searchMarketplace(mp.name, mp.url, sku);
    results.push(result);

    // Delay between requests (not after the last one)
    if (i < marketplaces.length - 1) {
      await delay(FETCH_DELAY_MS);
    }
  }

  // Cache the results
  try {
    await chrome.storage.local.set({
      [cacheKey]: { results, timestamp: Date.now() }
    });
  } catch (e) {
    console.warn('[MST] Cache write error:', e);
  }

  // Store in comparison history for the dashboard
  await storeComparisonHistory({
    sku,
    upc,
    productName,
    bbPrice,
    results,
    timestamp: Date.now()
  });

  // Update daily stats
  await updateDailyStats('comparisons');

  return { results, fromCache: false };
}

// ─── Comparison History ──────────────────────────────────────────────────────

async function storeComparisonHistory(entry) {
  try {
    const data = await chrome.storage.local.get('mst_comparison_history');
    const history = data.mst_comparison_history || [];

    // Update or add entry
    const existingIndex = history.findIndex(h => h.sku === entry.sku || h.upc === entry.upc);
    if (existingIndex >= 0) {
      history[existingIndex] = entry;
    } else {
      history.unshift(entry);
    }

    // Keep last 500 entries
    const trimmed = history.slice(0, 500);
    await chrome.storage.local.set({ mst_comparison_history: trimmed });
  } catch (e) {
    console.error('[MST] History store error:', e);
  }
}

// ─── Daily Stats ─────────────────────────────────────────────────────────────

async function updateDailyStats(type) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const data = await chrome.storage.local.get('mst_daily_stats');
    const stats = data.mst_daily_stats || {};

    if (stats.date !== today) {
      stats.date = today;
      stats.scanned = 0;
      stats.comparisons = 0;
    }

    if (type === 'scanned') {
      stats.scanned = (stats.scanned || 0) + 1;
    } else if (type === 'comparisons') {
      stats.comparisons = (stats.comparisons || 0) + 1;
    }

    await chrome.storage.local.set({ mst_daily_stats: stats });
  } catch (e) {
    console.error('[MST] Stats update error:', e);
  }
}

async function getDailyStats() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const data = await chrome.storage.local.get('mst_daily_stats');
    const stats = data.mst_daily_stats || {};

    if (stats.date !== today) {
      return { date: today, scanned: 0, comparisons: 0 };
    }
    return stats;
  } catch (e) {
    return { date: new Date().toISOString().slice(0, 10), scanned: 0, comparisons: 0 };
  }
}

// ─── Settings Management ─────────────────────────────────────────────────────

async function getSettings() {
  try {
    const data = await chrome.storage.sync.get('mst_settings');
    return { ...DEFAULT_SETTINGS, ...(data.mst_settings || {}) };
  } catch (e) {
    console.error('[MST] Settings read error:', e);
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(settings) {
  try {
    const current = await getSettings();
    const merged = { ...current, ...settings };
    await chrome.storage.sync.set({ mst_settings: merged });
    return { success: true };
  } catch (e) {
    console.error('[MST] Settings save error:', e);
    return { success: false, error: e.message };
  }
}

// ─── Cost Price Management ───────────────────────────────────────────────────

async function saveCostPrice(sku, costPrice) {
  try {
    const key = `mst_cost_${sku}`;
    await chrome.storage.local.set({ [key]: costPrice });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getCostPrice(sku) {
  try {
    const key = `mst_cost_${sku}`;
    const data = await chrome.storage.local.get(key);
    return { costPrice: data[key] || null };
  } catch (e) {
    return { costPrice: null };
  }
}

// ─── Export Data ─────────────────────────────────────────────────────────────

async function exportData() {
  try {
    const data = await chrome.storage.local.get('mst_comparison_history');
    const history = data.mst_comparison_history || [];

    const headers = ['Product Name', 'SKU', 'UPC', 'Best Buy Price', 'Amazon.ca', 'Walmart.ca', 'Newegg.ca', 'Staples.ca', 'Lowest Price', 'Lowest Marketplace', 'Date'];
    const rows = history.map(entry => {
      const amazonResult = entry.results.find(r => r.marketplace === 'Amazon.ca');
      const walmartResult = entry.results.find(r => r.marketplace === 'Walmart.ca');
      const neweggResult = entry.results.find(r => r.marketplace === 'Newegg.ca');
      const staplesResult = entry.results.find(r => r.marketplace === 'Staples.ca');

      const allPrices = entry.results.filter(r => r.found && r.price).map(r => ({ marketplace: r.marketplace, price: r.price }));
      if (entry.bbPrice) allPrices.push({ marketplace: 'Best Buy.ca', price: entry.bbPrice });
      allPrices.sort((a, b) => a.price - b.price);

      return [
        `"${(entry.productName || '').replace(/"/g, '""')}"`,
        entry.sku || '',
        entry.upc || '',
        entry.bbPrice || '',
        amazonResult && amazonResult.found ? amazonResult.price : 'N/A',
        walmartResult && walmartResult.found ? walmartResult.price : 'N/A',
        neweggResult && neweggResult.found ? neweggResult.price : 'N/A',
        staplesResult && staplesResult.found ? staplesResult.price : 'N/A',
        allPrices.length > 0 ? allPrices[0].price : 'N/A',
        allPrices.length > 0 ? allPrices[0].marketplace : 'N/A',
        new Date(entry.timestamp).toLocaleDateString()
      ].join(',');
    });

    return { csv: [headers.join(','), ...rows].join('\n') };
  } catch (e) {
    return { csv: '', error: e.message };
  }
}

// ─── Message Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  // All handlers are async, so we return true to keep the message port open
  (async () => {
    try {
      switch (action) {
        case 'comparePrice': {
          const result = await comparePrice(message);
          sendResponse(result);
          break;
        }
        case 'getSettings': {
          const settings = await getSettings();
          sendResponse(settings);
          break;
        }
        case 'saveSettings': {
          const result = await saveSettings(message.settings);
          sendResponse(result);
          break;
        }
        case 'saveCostPrice': {
          const result = await saveCostPrice(message.sku, message.costPrice);
          sendResponse(result);
          break;
        }
        case 'getCostPrice': {
          const result = await getCostPrice(message.sku);
          sendResponse(result);
          break;
        }
        case 'getDailyStats': {
          const stats = await getDailyStats();
          sendResponse(stats);
          break;
        }
        case 'updateDailyStats': {
          await updateDailyStats(message.type);
          sendResponse({ success: true });
          break;
        }
        case 'exportData': {
          const result = await exportData();
          sendResponse(result);
          break;
        }
        case 'getComparisonHistory': {
          const data = await chrome.storage.local.get('mst_comparison_history');
          sendResponse({ history: data.mst_comparison_history || [] });
          break;
        }
        case 'clearComparisonHistory': {
          await chrome.storage.local.remove('mst_comparison_history');
          sendResponse({ success: true });
          break;
        }
        case 'openDashboard': {
          chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
          sendResponse({ success: true });
          break;
        }
        default:
          sendResponse({ error: `Unknown action: ${action}` });
      }
    } catch (e) {
      console.error(`[MST] Error handling action '${action}':`, e);
      sendResponse({ error: e.message });
    }
  })();

  return true; // Keep message port open for async response
});

// ─── Install Handler ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Initialize default settings
    await saveSettings(DEFAULT_SETTINGS);
    console.log('[MST] Marketplace Seller Toolkit installed with default settings');
  }
});
