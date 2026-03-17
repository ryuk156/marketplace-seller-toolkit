# Marketplace Seller Toolkit

A Chrome extension for e-commerce sellers on Best Buy Canada that provides cross-marketplace price comparison and profit calculation — directly on product listing pages.

## Features

### Cross-Marketplace Price Comparison
- Compare prices across **Amazon.ca**, **Walmart.ca**, **Newegg.ca**, **Staples.ca**, and **Best Buy.ca**
- Click "Compare Prices" on any product card to see pricing side-by-side
- Lowest price highlighted in green with price difference shown
- Click any marketplace row to open the product in a new tab
- "Compare All" floating button for batch comparison on listing pages
- Results cached for 4 hours to minimize requests

### Profit Calculator
- Instant commission calculation based on Best Buy category rates
- Per-SKU cost price tracking — set your cost and see profit + margin instantly
- Configurable default commission rate (5-20% slider)
- 16 pre-configured Best Buy product categories with typical commission rates
- Monthly platform fee and shipping cost included in calculations
- Profit shown in green, losses in red — at a glance

### Settings Popup
- Enable/disable toggle
- Commission rate configuration (default + per-category)
- Monthly fee and shipping cost inputs
- Daily stats: products scanned and comparisons made
- Quick link to open full dashboard

### Full Dashboard
- Table of all recently compared products (up to 500)
- Columns: Product Name, SKU, UPC, BB Price, Amazon, Walmart, Newegg, Staples, Lowest Price
- Sortable by any column
- Search and filter by product name
- One-click CSV export for spreadsheet analysis
- Clear all data button

## File Structure
```
marketplace-seller-toolkit/
├── manifest.json       # Manifest V3 extension config
├── content.js          # Content script — product detection, badges, UI
├── background.js       # Service worker — marketplace fetching, caching, storage
├── styles.css          # Content script styles (mst- prefixed)
├── popup.html          # Settings popup
├── popup.js            # Popup logic
├── dashboard.html      # Full comparison dashboard
├── dashboard.js        # Dashboard logic
├── dashboard.css       # Dashboard styles
└── icons/              # Add your extension icons here
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select this folder
5. Visit any Best Buy Canada listing page — badges appear on product cards

## How It Works

### Price Comparison Flow
1. Content script detects product cards on Best Buy listing pages
2. Extracts SKU, product name, and price from each card
3. When you click "Compare Prices", it sends the product info to the background worker
4. Background worker searches each marketplace sequentially (500ms delay between each)
5. Parses HTML/JSON responses using regex patterns to extract prices
6. Returns results to content script, which renders the comparison panel
7. Results are cached for 4 hours per product

### Profit Calculation
```
Commission Fee = Selling Price × (Commission Rate / 100)
Profit = Selling Price − Commission Fee − Shipping Cost − Cost Price
Margin = (Profit / Selling Price) × 100
```

### Default Commission Rates
| Category | Rate |
|---|---|
| Computers & Tablets | 8% |
| Cell Phones | 8% |
| TV & Home Theatre | 8% |
| Cameras & Camcorders | 8% |
| Appliances | 8% |
| Audio | 10% |
| Car Electronics | 10% |
| Musical Instruments | 10% |
| Video Games | 10% |
| Smart Home | 10% |
| Health & Fitness | 12% |
| Toys & Drones | 12% |
| Office & Stationery | 12% |
| Movies & Music | 15% |
| Furniture & Home | 15% |
| Baby & Kids | 15% |

All rates are configurable in the popup settings.

## Technical Details

- **Manifest**: V3
- **Permissions**: `activeTab`, `storage`, `tabs`
- **Host Permissions**: bestbuy.ca, amazon.ca, walmart.ca, newegg.ca, staples.ca
- **Cross-Origin Fetches**: Handled by the background service worker
- **Caching**: 4-hour TTL in `chrome.storage.local`
- **Settings**: Synced via `chrome.storage.sync`
- **CSS Prefix**: All classes use `mst-` to avoid conflicts with host pages
- **Rate Limiting**: Sequential marketplace fetches with 500ms delays

## Marketplace Search Strategy

| Marketplace | Method | Search URL |
|---|---|---|
| Amazon.ca | HTML parsing | `amazon.ca/s?k={query}` |
| Walmart.ca | HTML parsing | `walmart.ca/search?q={query}` |
| Newegg.ca | HTML parsing | `newegg.ca/p/pl?d={query}` |
| Staples.ca | HTML parsing | `staples.ca/search?query={query}` |
| Best Buy.ca | JSON API | `bestbuy.ca/api/v2/json/search` |

## Important Notes

- Marketplace HTML parsers use multiple regex patterns for resilience, but may need updates if sites change their markup
- UPC search tends to give the most accurate cross-marketplace matches
- Best Buy's JSON API is the most reliable data source (structured data)
- Extension only activates on bestbuy.ca pages

## Privacy
- Only accesses pages you visit on the listed marketplaces
- All data stored locally in your browser
- No personal data collection or external transmission
- No tracking or analytics
