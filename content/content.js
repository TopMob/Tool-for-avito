(() => {
  if (window.__avitoParserInjected) return;
  window.__avitoParserInjected = true;

  const SHADOW_HOST_ID = 'avito-parser-root';

  let shadowRoot = null;
  let panelEl = null;
  let fabEl = null;
  let lastResult = null;
  let displayItems = [];
  let selectedIndices = new Set();
  let currentSort = 'default';
  let searchQuery = '';
  let filterDelivery = 'all';
  let filterInclude = '';
  let filterExclude = '';
  let hideReserved = true;
  let pagesLoaded = 1;
  let loadingPages = false;
  let isLoadingAll = false;
  let abortLoadingAll = false;

  let lastParsedUrl = '';   // URL страницы на момент последнего парсинга
  let urlWatchTimer = null; // таймер поллинга URL
  let filtersCollapsed = false;

  let activeFields = {
    aiPrompt: true,
    title: true,
    price: true,
    delivery: false,
    description: true,
    location: false,
    date: false,
    seller: false,
    url: false,
    image: false,
  };

  const ICON_PARSE = `<svg class="ap-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const ICON_LOADING = `<svg class="ap-fab-icon ap-spin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;

  function setSvgIcon(element, svgString) {
    if (!element) return;
    try {
      const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
      const svg = doc.documentElement;
      if (svg && svg.tagName.toLowerCase() === 'svg') {
        element.replaceChildren(svg);
        return;
      }
    } catch {}
    element.textContent = '';
  }

  function init() {
    if (document.getElementById(SHADOW_HOST_ID)) return;

    const host = document.createElement('div');
    host.id = SHADOW_HOST_ID;
    host.style.cssText = 'all:initial; position:fixed; z-index:2147483647;';
    document.body.appendChild(host);

    // Ensure any previously set theme attributes on documentElement are cleaned up
    document.documentElement.removeAttribute('data-avito-theme');
    document.documentElement.removeAttribute('data-avito-custom-theme');
    document.documentElement.removeAttribute('data-avito-preset-theme');

    shadowRoot = host.attachShadow({ mode: 'closed' });

    injectStyles();
    createFAB();
    createPanel();
    loadStoredFields();
  }

  async function injectStyles() {
    try {
      const url = chrome.runtime.getURL('content/content.css');
      const res = await fetch(url);
      const css = await res.text();
      const style = document.createElement('style');
      style.textContent = css;
      shadowRoot.appendChild(style);
    } catch {
      const style = document.createElement('style');
      style.textContent = ':host { font-family: system-ui, sans-serif; }';
      shadowRoot.appendChild(style);
    }
  }

  function createFAB() {
    fabEl = document.createElement('button');
    fabEl.className = 'ap-fab';
    setSvgIcon(fabEl, ICON_PARSE);
    fabEl.title = 'Открыть панель Tool for Avito';
    fabEl.addEventListener('click', handleFabClick);
    shadowRoot.appendChild(fabEl);
  }

  function handleFabClick() {
    if (panelEl.classList.contains('ap-open')) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function createPanel() {
    panelEl = document.createElement('div');
    panelEl.className = 'ap-panel';
    panelEl.innerHTML = `
      <div class="ap-header">
        <div class="ap-header-top">
          <h2>Tool for Avito</h2>
          <div class="ap-header-actions">
            <button class="ap-header-btn" id="ap-header-parse" title="Собрать объявления с текущей страницы">🔄 Собрать</button>
            <button class="ap-header-btn" id="ap-toggle-filters" title="Скрыть/показать фильтры и поля">Фильтры ▾</button>
            <button class="ap-close" title="Закрыть (Esc)">✕</button>
          </div>
        </div>
        <div class="ap-stats" id="ap-stats"></div>
      </div>
      <div class="ap-reparse-banner" id="ap-reparse-banner" style="display:none">
        <span class="ap-reparse-text">🔄 Поиск изменился</span>
        <button class="ap-reparse-btn" id="ap-reparse-btn">Пересобрать</button>
      </div>
      <div class="ap-search-bar" id="ap-search-bar" style="display:none">
        <div class="ap-search-input-wrap">
          <svg class="ap-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="ap-search-input" id="ap-search-input" placeholder="Поиск по номеру (№2) или тексту..." autocomplete="off">
          <button class="ap-search-clear" id="ap-search-clear" style="display:none" title="Очистить поиск">✕</button>
        </div>
        <span class="ap-search-count" id="ap-search-count"></span>
      </div>
      <div class="ap-filters-bar" id="ap-filters-bar" style="display:none">
        <div class="ap-filters-top-row">
          <span class="ap-filter-label">Доставка:</span>
          <div class="ap-pills" id="ap-delivery-pills">
            <button class="ap-pill ap-pill-active" data-delivery="all">Все</button>
            <button class="ap-pill" data-delivery="with" title="Только с Авито Доставкой">🚚 Есть</button>
            <button class="ap-pill" data-delivery="without" title="Только без доставки">Нет</button>
          </div>
          <label class="ap-filter-check" title="Не показывать товары со статусом 'Товар зарезервирован'">
            <input type="checkbox" id="ap-filter-hide-reserved" checked> Без резерва
          </label>
          <button class="ap-filter-reset-btn" id="ap-filter-reset" style="display:none" title="Сбросить фильтры">✕ Сброс</button>
        </div>
        <div class="ap-filters-kw-row">
          <div class="ap-kw-wrap" title="Показывать только если содержит эти слова (через запятую)">
            <span class="ap-kw-badge ap-kw-plus">+</span>
            <input type="text" class="ap-kw-input" id="ap-filter-include" placeholder="Обязательно содержит..." autocomplete="off">
          </div>
          <div class="ap-kw-wrap" title="Исключить объявления с этими словами (минус-слова, через запятую)">
            <span class="ap-kw-badge ap-kw-minus">−</span>
            <input type="text" class="ap-kw-input" id="ap-filter-exclude" placeholder="Минус-слова (запчасти, сломан...)" autocomplete="off">
          </div>
        </div>
      </div>
      <div class="ap-toolbar" id="ap-toolbar" style="display:none">
        <div class="ap-toolbar-group">
          <span class="ap-toolbar-label">Сортировка</span>
          <select class="ap-select" id="ap-sort">
            <option value="default">По умолчанию</option>
            <option value="price-asc">Цена: дешевле</option>
            <option value="price-desc">Цена: дороже</option>
          </select>
        </div>
        <div class="ap-toolbar-sep"></div>
        <div class="ap-toolbar-group">
          <span class="ap-selection-info" id="ap-selection-info">Выбрано: 0</span>
          <button class="ap-toolbar-btn" id="ap-select-all">Выбрать все</button>
          <button class="ap-toolbar-btn" id="ap-deselect-all" style="display:none">Снять все</button>
        </div>
        <div class="ap-toolbar-sep"></div>
        <div class="ap-toolbar-group">
          <span class="ap-page-info" id="ap-page-info">Стр. 1</span>
          <button class="ap-page-btn" id="ap-load-more" title="Загрузить следующую страницу">+ След. стр.</button>
          <button class="ap-page-btn" id="ap-load-all" title="Загружать страницы последовательно с защитной паузой">+ Все стр.</button>
        </div>
      </div>
      <div class="ap-fields-bar" id="ap-fields-bar" style="display:none">
        <div class="ap-fields-header">
          <span class="ap-fields-title">Копировать поля:</span>
          <button class="ap-preset-btn" id="ap-preset-ai" title="Только название, цена и описание">⚡ Пресет для ИИ</button>
        </div>
        <div class="ap-fields-chips" id="ap-fields-chips">
          <label class="ap-chip ap-chip-active" data-chip="aiPrompt"><input type="checkbox" data-field="aiPrompt" checked> Инструкция для ИИ</label>
          <label class="ap-chip" data-chip="title"><input type="checkbox" data-field="title" checked> Название</label>
          <label class="ap-chip" data-chip="price"><input type="checkbox" data-field="price" checked> Цена</label>
          <label class="ap-chip" data-chip="delivery"><input type="checkbox" data-field="delivery"> 🚚 Доставка</label>
          <label class="ap-chip" data-chip="description"><input type="checkbox" data-field="description" checked> Описание</label>
          <label class="ap-chip" data-chip="location"><input type="checkbox" data-field="location"> Локация</label>
          <label class="ap-chip" data-chip="url"><input type="checkbox" data-field="url"> Ссылка</label>
          <label class="ap-chip" data-chip="image"><input type="checkbox" data-field="image"> Фото</label>
        </div>
      </div>
      <div class="ap-export-row" id="ap-export-row" style="display:none">
        <button class="ap-btn ap-primary" data-format="md">Markdown</button>
        <button class="ap-btn" data-format="json">JSON</button>
        <button class="ap-btn" data-format="tsv">TSV</button>
      </div>
      <div class="ap-cards" id="ap-cards"></div>
      <button class="ap-scroll-top" id="ap-scroll-top" title="Прокрутить вверх" style="display:none">↑</button>
    `;
    shadowRoot.appendChild(panelEl);

    panelEl.querySelector('.ap-close').addEventListener('click', closePanel);

    const headerParseBtn = panelEl.querySelector('#ap-header-parse');
    if (headerParseBtn) {
      headerParseBtn.addEventListener('click', handleParse);
    }

    const toggleFiltersBtn = panelEl.querySelector('#ap-toggle-filters');
    if (toggleFiltersBtn) {
      toggleFiltersBtn.addEventListener('click', () => {
        filtersCollapsed = !filtersCollapsed;
        const fb = panelEl.querySelector('#ap-filters-bar');
        const fieldsB = panelEl.querySelector('#ap-fields-bar');
        if (fb) fb.style.display = filtersCollapsed ? 'none' : 'flex';
        if (fieldsB) fieldsB.style.display = filtersCollapsed ? 'none' : 'flex';
        toggleFiltersBtn.textContent = filtersCollapsed ? 'Фильтры ▸' : 'Фильтры ▾';
        toggleFiltersBtn.classList.toggle('ap-collapsed', filtersCollapsed);
      });
    }
    panelEl.querySelector('#ap-export-row').addEventListener('click', handleExport);
    panelEl.querySelector('#ap-sort').addEventListener('change', handleSort);
    panelEl.querySelector('#ap-load-more').addEventListener('click', handleLoadMore);
    panelEl.querySelector('#ap-load-all').addEventListener('click', handleLoadAll);
    panelEl.querySelector('#ap-select-all').addEventListener('click', selectAll);
    panelEl.querySelector('#ap-deselect-all').addEventListener('click', deselectAll);
    panelEl.querySelector('#ap-preset-ai').addEventListener('click', applyAiPreset);
    panelEl.querySelector('#ap-fields-chips').addEventListener('change', handleFieldChange);

    panelEl.querySelector('#ap-delivery-pills').addEventListener('click', handleDeliveryFilterClick);
    panelEl.querySelector('#ap-filter-include').addEventListener('input', handleFilterIncludeInput);
    panelEl.querySelector('#ap-filter-exclude').addEventListener('input', handleFilterExcludeInput);
    panelEl.querySelector('#ap-filter-hide-reserved').addEventListener('change', handleHideReservedChange);
    panelEl.querySelector('#ap-filter-reset').addEventListener('click', handleFiltersReset);

    panelEl.querySelector('#ap-reparse-btn').addEventListener('click', () => {
      hideParseBanner();
      handleParse();
    });

    // Scroll-to-top button
    const cardsScrollEl = panelEl.querySelector('#ap-cards');
    const scrollTopBtn = panelEl.querySelector('#ap-scroll-top');
    if (cardsScrollEl && scrollTopBtn) {
      cardsScrollEl.addEventListener('scroll', () => {
        scrollTopBtn.style.display = cardsScrollEl.scrollTop > 300 ? 'flex' : 'none';
      });
      scrollTopBtn.addEventListener('click', () => {
        cardsScrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Hotkey: Escape closes panel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelEl.classList.contains('ap-open')) {
        // Only close if no input is focused inside the panel
        const focused = shadowRoot.activeElement;
        if (!focused || (!focused.matches('input, select, textarea'))) {
          closePanel();
        }
      }
    });

    renderInitialEmptyState();

    const searchInput = panelEl.querySelector('#ap-search-input');
    const searchClear = panelEl.querySelector('#ap-search-clear');
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        handleSearchClear();
      }
    });
    searchClear.addEventListener('click', handleSearchClear);
  }

  // Field selection logic
  function handleFieldChange(e) {
    const input = e.target.closest('input[type="checkbox"]');
    if (!input) return;
    const field = input.dataset.field;
    if (!field) return;

    activeFields[field] = input.checked;
    const chip = input.closest('.ap-chip');
    if (chip) chip.classList.toggle('ap-chip-active', input.checked);

    saveStoredFields();
  }

  function applyAiPreset() {
    activeFields = {
      aiPrompt: true,
      title: true,
      price: true,
      delivery: false,
      description: true,
      location: false,
      date: false,
      seller: false,
      url: false,
      image: false,
    };
    syncFieldsUI();
    saveStoredFields();

    const btn = panelEl.querySelector('#ap-preset-ai');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Включено';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }
  }

  function syncFieldsUI() {
    const chipsContainer = panelEl.querySelector('#ap-fields-chips');
    if (!chipsContainer) return;

    chipsContainer.querySelectorAll('input[type="checkbox"]').forEach(input => {
      const field = input.dataset.field;
      if (field in activeFields) {
        input.checked = !!activeFields[field];
        const chip = input.closest('.ap-chip');
        if (chip) chip.classList.toggle('ap-chip-active', input.checked);
      }
    });
  }

  function loadStoredFields() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['ap_export_fields'], (res) => {
        if (res && res.ap_export_fields) {
          activeFields = { ...activeFields, ...res.ap_export_fields };
          syncFieldsUI();
        }
      });
    }
  }

  function saveStoredFields() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ ap_export_fields: activeFields });
    }
  }

  // Search & Filter handlers
  function handleSearchInput(e) {
    searchQuery = e.target.value.trim().toLowerCase();
    const clearBtn = panelEl.querySelector('#ap-search-clear');
    if (clearBtn) clearBtn.style.display = searchQuery ? 'flex' : 'none';

    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleSearchClear() {
    const input = panelEl.querySelector('#ap-search-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    searchQuery = '';
    const clearBtn = panelEl.querySelector('#ap-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';

    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleDeliveryFilterClick(e) {
    const btn = e.target.closest('.ap-pill');
    if (!btn) return;
    const val = btn.dataset.delivery;
    if (!val) return;

    filterDelivery = val;
    panelEl.querySelectorAll('#ap-delivery-pills .ap-pill').forEach(b => {
      b.classList.toggle('ap-pill-active', b.dataset.delivery === val);
    });

    updateFilterResetVisibility();
    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleFilterIncludeInput(e) {
    filterInclude = e.target.value.trim().toLowerCase();
    updateFilterResetVisibility();
    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleFilterExcludeInput(e) {
    filterExclude = e.target.value.trim().toLowerCase();
    updateFilterResetVisibility();
    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleHideReservedChange(e) {
    hideReserved = e.target.checked;
    updateFilterResetVisibility();
    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleFiltersReset() {
    filterDelivery = 'all';
    filterInclude = '';
    filterExclude = '';
    hideReserved = true;

    const incInput = panelEl.querySelector('#ap-filter-include');
    if (incInput) incInput.value = '';
    const excInput = panelEl.querySelector('#ap-filter-exclude');
    if (excInput) excInput.value = '';
    const resCheck = panelEl.querySelector('#ap-filter-hide-reserved');
    if (resCheck) resCheck.checked = true;

    panelEl.querySelectorAll('#ap-delivery-pills .ap-pill').forEach(b => {
      b.classList.toggle('ap-pill-active', b.dataset.delivery === 'all');
    });

    updateFilterResetVisibility();
    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function updateFilterResetVisibility() {
    const resetBtn = panelEl.querySelector('#ap-filter-reset');
    if (!resetBtn) return;
    const hasActive = filterDelivery !== 'all' || !hideReserved || !!filterInclude || !!filterExclude;
    resetBtn.style.display = hasActive ? 'inline-flex' : 'none';
  }

  function getFilteredItems() {
    if (!displayItems || displayItems.length === 0) return [];

    const incTerms = filterInclude
      .split(/[,;]+/)
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    const excTerms = filterExclude
      .split(/[,;]+/)
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    const hasFilters = !!searchQuery || filterDelivery !== 'all' || hideReserved || incTerms.length > 0 || excTerms.length > 0;
    if (!hasFilters) return displayItems;

    // Explicit prefix required for jumping to lot number: №11, #11, лот 11, lot 11
    const numMatch = searchQuery ? searchQuery.match(/^(?:№|#|номер\s*|no\s*|лот\s*|lot\s+)(\d+)$/i) : null;
    const targetNum = numMatch ? parseInt(numMatch[1], 10) : null;

    return displayItems.filter(item => {
      // Direct jump by lot number ignores other filters so user can always find the lot
      if (targetNum !== null) {
        return item.itemNum === targetNum;
      }

      // 1. Reserved filter
      if (hideReserved && item.isReserved) return false;

      // 2. Delivery
      if (filterDelivery === 'with' && !item.hasDelivery) return false;
      if (filterDelivery === 'without' && item.hasDelivery) return false;

      const hay = [
        `№${item.itemNum}`,
        `лот ${item.itemNum}`,
        `лот${item.itemNum}`,
        `#${item.itemNum}`,
        item.title,
        String(item.priceNum != null ? item.priceNum : ''),
        item.price,
        item.oldPrice || '',
        item.discount || '',
        item.description,
        item.location,
        item.seller,
        item.sellerRating || '',
        item.deliveryText || ''
      ].join(' ').toLowerCase();

      // 3. Search query
      if (searchQuery && !hay.includes(searchQuery)) return false;

      // 4. Must include terms (ALL terms must be present)
      if (incTerms.length > 0) {
        for (const term of incTerms) {
          if (!hay.includes(term)) return false;
        }
      }

      // 5. Must exclude terms (NONE of the terms can be present)
      if (excTerms.length > 0) {
        for (const term of excTerms) {
          if (hay.includes(term)) return false;
        }
      }

      return true;
    });
  }

  function updateSearchCount() {
    const countEl = panelEl.querySelector('#ap-search-count');
    if (!countEl) return;
    const hasFilters = !!searchQuery || filterDelivery !== 'all' || !!filterInclude || !!filterExclude;
    if (hasFilters) {
      const filtered = getFilteredItems();
      countEl.textContent = `${filtered.length} из ${displayItems.length}`;
    } else {
      countEl.textContent = '';
    }
  }

  // FAB badge: show item count on the floating button
  function updateFabBadge(count) {
    if (!fabEl) return;
    // Remove old badge
    const old = fabEl.querySelector('.ap-fab-badge');
    if (old) old.remove();
    if (!count) return;
    const badge = document.createElement('span');
    badge.className = 'ap-fab-badge';
    badge.textContent = count > 999 ? '999+' : String(count);
    fabEl.appendChild(badge);
  }

  // URL-change watcher
  function getSearchKey() {
    // Сравниваем путь + параметры, но без номера страницы (p=)
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('p');
      return u.pathname + '?' + u.searchParams.toString();
    } catch {
      return window.location.href;
    }
  }

  function showParseBanner() {
    const banner = panelEl && panelEl.querySelector('#ap-reparse-banner');
    if (banner) banner.style.display = 'flex';
    // Подсветить FAB, чтобы пользователь заметил изменение
    if (fabEl) fabEl.classList.add('ap-fab-changed');
  }

  function hideParseBanner() {
    const banner = panelEl && panelEl.querySelector('#ap-reparse-banner');
    if (banner) banner.style.display = 'none';
    if (fabEl) fabEl.classList.remove('ap-fab-changed');
  }

  function startUrlWatch() {
    // Поллинг — надёжнее MutationObserver для SPA-переходов Авито
    if (urlWatchTimer) return;
    urlWatchTimer = setInterval(() => {
      if (!lastParsedUrl) return; // ещё не было парсинга
      const current = getSearchKey();
      if (current !== lastParsedUrl) {
        showParseBanner();
      } else {
        hideParseBanner();
      }
    }, 1000);
  }

  function renderSkeleton(container) {
    if (!container) return;
    const list = document.createElement('div');
    list.className = 'ap-skeleton-list';

    for (let i = 0; i < 5; i++) {
      const card = document.createElement('div');
      card.className = 'ap-skeleton-card';

      const controls = document.createElement('div');
      controls.className = 'ap-skeleton-controls';
      const c1 = document.createElement('div'); c1.className = 'ap-skel ap-skel-check';
      const c2 = document.createElement('div'); c2.className = 'ap-skel ap-skel-num';
      controls.append(c1, c2);

      const thumb = document.createElement('div');
      thumb.className = 'ap-skeleton-thumb ap-skel';

      const body = document.createElement('div');
      body.className = 'ap-skeleton-body';
      ['title', 'price', 'desc', 'desc ap-skel-desc-short', 'meta'].forEach(cls => {
        const d = document.createElement('div');
        d.className = `ap-skel ap-skel-${cls}`;
        body.appendChild(d);
      });

      card.append(controls, thumb, body);
      list.appendChild(card);
    }

    container.replaceChildren(list);
  }

  function getInitialPage() {
    try {
      const p = new URL(window.location.href).searchParams.get('p');
      const num = parseInt(p, 10);
      return (!isNaN(num) && num > 0) ? num : 1;
    } catch {
      return 1;
    }
  }

  // Parse
  function handleParse() {
    fabEl.classList.add('ap-loading');
    setSvgIcon(fabEl, ICON_LOADING);

    const cardsEl = panelEl.querySelector('#ap-cards');
    renderSkeleton(cardsEl);
    openPanel();

    setTimeout(() => {
      try {
        lastResult = AvitoParser.parse();
        lastParsedUrl = getSearchKey(); // запоминаем ключ поиска
        hideParseBanner();
        startUrlWatch(); // запускаем слежение (если ещё не запущено)
        pagesLoaded = getInitialPage();
        loadingPages = false;
        isLoadingAll = false;
        abortLoadingAll = false;
        currentSort = 'default';
        searchQuery = '';
        filterDelivery = 'all';
        filterInclude = '';
        filterExclude = '';
        selectedIndices = new Set();

        lastResult.items.forEach((item, idx) => {
          item.itemNum = idx + 1;
        });
        displayItems = [...lastResult.items];

        const searchInput = panelEl.querySelector('#ap-search-input');
        if (searchInput) searchInput.value = '';
        const searchClear = panelEl.querySelector('#ap-search-clear');
        if (searchClear) searchClear.style.display = 'none';

        const incInput = panelEl.querySelector('#ap-filter-include');
        if (incInput) incInput.value = '';
        const excInput = panelEl.querySelector('#ap-filter-exclude');
        if (excInput) excInput.value = '';

        panelEl.querySelectorAll('#ap-delivery-pills .ap-pill').forEach(b => {
          b.classList.toggle('ap-pill-active', b.dataset.delivery === 'all');
        });
        updateFilterResetVisibility();

        renderResults();

        const sortEl = panelEl.querySelector('#ap-sort');
        if (sortEl) sortEl.value = 'default';

        // Показать счётчик на FAB
        updateFabBadge(lastResult.items.length);

        saveSessionToStorage();
      } catch (err) {
        renderError(err);
      }

      fabEl.classList.remove('ap-loading');
      setSvgIcon(fabEl, ICON_PARSE);
    }, 150);
  }

  // Sort
  function handleSort(e) {
    currentSort = e.target.value;
    applySortAndRender();
  }

  function applySortAndRender() {
    if (!lastResult || lastResult.items.length === 0) return;

    displayItems = [...lastResult.items];

    if (currentSort === 'price-asc' || currentSort === 'price-desc') {
      const dir = currentSort === 'price-asc' ? 1 : -1;
      displayItems.sort((a, b) => {
        const pa = parsePrice(a.price);
        const pb = parsePrice(b.price);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return (pa - pb) * dir;
      });
    }

    renderCards(getFilteredItems());
    updateSelectionInfo();
    updateSearchCount();
  }

  function parsePrice(str) {
    if (!str) return null;
    const cleaned = str.replace(/[^\d.,]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  // Selection
  function toggleSelection(itemNum) {
    if (selectedIndices.has(itemNum)) {
      selectedIndices.delete(itemNum);
    } else {
      selectedIndices.add(itemNum);
    }
    updateCardSelectedState(itemNum);
    updateSelectionInfo();
  }

  function selectAll() {
    const visible = getFilteredItems();
    selectedIndices.clear();
    visible.forEach((item) => selectedIndices.add(item.itemNum));
    displayItems.forEach((item) => updateCardSelectedState(item.itemNum));
    updateSelectionInfo();
  }

  function deselectAll() {
    selectedIndices.clear();
    displayItems.forEach((item) => updateCardSelectedState(item.itemNum));
    updateSelectionInfo();
  }

  function updateCardSelectedState(itemNum) {
    const card = panelEl.querySelector(`[data-card-num="${itemNum}"]`);
    if (!card) return;
    const checkbox = card.querySelector('.ap-card-check');
    if (selectedIndices.has(itemNum)) {
      card.classList.add('ap-card-selected');
      if (checkbox) checkbox.checked = true;
    } else {
      card.classList.remove('ap-card-selected');
      if (checkbox) checkbox.checked = false;
    }
  }

  function updateSelectionInfo() {
    const info = panelEl.querySelector('#ap-selection-info');
    const selectAllBtn = panelEl.querySelector('#ap-select-all');
    const deselectAllBtn = panelEl.querySelector('#ap-deselect-all');

    const visible = getFilteredItems();
    const visibleTotal = visible.length;
    const selectedVisibleCount = visible.filter((item) => selectedIndices.has(item.itemNum)).length;

    if (info) {
      info.textContent = 'Выбрано: ';
      if (selectedVisibleCount > 0) {
        const strong = document.createElement('strong');
        strong.textContent = String(selectedVisibleCount);
        info.appendChild(strong);
        info.appendChild(document.createTextNode(` из ${visibleTotal}`));
      } else {
        info.appendChild(document.createTextNode(`0 из ${visibleTotal}`));
      }
    }

    if (selectAllBtn && deselectAllBtn) {
      if (selectedVisibleCount > 0) {
        selectAllBtn.style.display = 'none';
        deselectAllBtn.style.display = '';
      } else {
        selectAllBtn.style.display = '';
        deselectAllBtn.style.display = 'none';
      }
    }
  }

  // Pagination
  async function handleLoadMore() {
    if (loadingPages) return;

    const nextPage = pagesLoaded + 1;
    const nextUrl = buildPageUrl(nextPage);
    if (!nextUrl) return;

    const btn = panelEl.querySelector('#ap-load-more');
    const btnAll = panelEl.querySelector('#ap-load-all');
    btn.classList.add('ap-loading-pages');
    btn.textContent = 'Загрузка...';
    if (btnAll) btnAll.disabled = true;
    loadingPages = true;

    try {
      const html = await fetchPage(nextUrl);

      if (html.includes('firewall') || html.includes('captcha') || html.includes('Доступ ограничен')) {
        btn.textContent = 'Проверка / Капча';
        showToast('Авито запросил проверку');
        loadingPages = false;
        return;
      }

      const newItems = parseHTMLForItems(html);
      const existingIds = new Set((lastResult?.items || []).map(it => it.id).filter(Boolean));
      const uniqueNewItems = newItems.filter(it => !it.id || !existingIds.has(it.id));

      if (uniqueNewItems.length === 0) {
        btn.textContent = 'Страниц больше нет';
        btn.disabled = true;
        if (btnAll) {
          btnAll.textContent = 'Все загружены';
          btnAll.disabled = true;
        }
        loadingPages = false;
        return;
      }

      uniqueNewItems.forEach((item, idx) => {
        item.itemNum = lastResult.items.length + idx + 1;
      });
      lastResult.items.push(...uniqueNewItems);
      pagesLoaded = nextPage;

      applySortAndRender();
      updatePageInfo();
      updateStats();
      saveSessionToStorage();

      btn.textContent = '+ След. стр.';
    } catch {
      btn.textContent = 'Ошибка';
      setTimeout(() => { btn.textContent = '+ След. стр.'; }, 2000);
    } finally {
      btn.classList.remove('ap-loading-pages');
      if (btnAll && btn.textContent !== 'Страниц больше нет') {
        btnAll.disabled = false;
      }
      loadingPages = false;
    }
  }

  async function handleLoadAll() {
    const btnLoadAll = panelEl.querySelector('#ap-load-all');
    const btnLoadMore = panelEl.querySelector('#ap-load-more');
    if (!btnLoadAll) return;

    // Повторный клик во время загрузки останавливает процесс
    if (isLoadingAll) {
      abortLoadingAll = true;
      btnLoadAll.textContent = 'Остановка...';
      return;
    }

    if (loadingPages) return;

    loadingPages = true;
    isLoadingAll = true;
    abortLoadingAll = false;

    btnLoadAll.classList.add('ap-btn-stop');
    if (btnLoadMore) btnLoadMore.disabled = true;

    const MAX_PAGES = 50;

    try {
      while (!abortLoadingAll) {
        const nextPage = pagesLoaded + 1;
        if (nextPage > MAX_PAGES) {
          btnLoadAll.textContent = `Лимит (${MAX_PAGES} стр.)`;
          await new Promise(r => setTimeout(r, 1500));
          break;
        }

        const nextUrl = buildPageUrl(nextPage);
        if (!nextUrl) break;

        btnLoadAll.textContent = `⏹ Стоп (${nextPage}...)`;

        let html;
        try {
          html = await fetchPage(nextUrl);
        } catch {
          btnLoadAll.textContent = 'Ошибка сети';
          await new Promise(r => setTimeout(r, 1500));
          break;
        }

        if (html.includes('firewall') || html.includes('captcha') || html.includes('Доступ ограничен')) {
          btnLoadAll.textContent = 'Проверка / Капча';
          showToast('Авито запросил проверку');
          break;
        }

        if (abortLoadingAll) break;

        const newItems = parseHTMLForItems(html);
        const existingIds = new Set((lastResult?.items || []).map(it => it.id).filter(Boolean));
        const uniqueNewItems = newItems.filter(it => !it.id || !existingIds.has(it.id));

        if (uniqueNewItems.length === 0) {
          btnLoadAll.textContent = 'Все загружены';
          btnLoadAll.disabled = true;
          if (btnLoadMore) {
            btnLoadMore.textContent = 'Страниц больше нет';
            btnLoadMore.disabled = true;
          }
          await new Promise(r => setTimeout(r, 1500));
          break;
        }

        uniqueNewItems.forEach((item, idx) => {
          item.itemNum = lastResult.items.length + idx + 1;
        });
        lastResult.items.push(...uniqueNewItems);
        pagesLoaded = nextPage;

        applySortAndRender();
        updatePageInfo();
        updateStats();

        if (abortLoadingAll) break;

        // Защитная пауза с джиттером между страницами
        await new Promise(r => setTimeout(r, 1200 + Math.random() * 600));
      }
    } finally {
      loadingPages = false;
      isLoadingAll = false;
      abortLoadingAll = false;

      saveSessionToStorage();

      btnLoadAll.classList.remove('ap-btn-stop');
      if (!btnLoadAll.disabled) {
        btnLoadAll.textContent = '+ Все стр.';
      }
      if (btnLoadMore && btnLoadMore.textContent !== 'Страниц больше нет') {
        btnLoadMore.disabled = false;
      }
    }
  }

  function buildPageUrl(page) {
    const url = new URL(window.location.href);
    url.searchParams.set('p', String(page));
    return url.toString();
  }

  async function fetchPage(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  function parseHTMLForItems(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const scriptEl = doc.querySelector('script#__NEXT_DATA__');
    if (scriptEl) {
      try {
        const payload = JSON.parse(scriptEl.textContent);
        const items = findItemsInPayload(payload);
        if (items && items.length > 0) {
          return items.map(raw => normalizeItem(raw));
        }
      } catch { /* DOM fallback */ }
    }

    // 1. Search catalog cards
    const cards = doc.querySelectorAll('[data-marker="item"], [class*="iva-item-root"]');
    if (cards.length > 0) {
      return Array.from(cards).map(card => parseDOMCardFromDoc(card));
    }

    // 2. Feed / Recommendations cards
    const itemLinks = Array.from(doc.querySelectorAll('a[href*="_"]')).filter(a => {
      const href = a.getAttribute('href') || '';
      return /_(\d+)(?:\?|$|\/)/.test(href) && !href.includes('/user/') && !href.includes('/brands/');
    });

    if (itemLinks.length > 0) {
      const containers = new Set();
      const feedCards = [];
      for (const a of itemLinks) {
        const container = a.closest('div[class*="module"], div[class*="card"], div[class*="item"], div[class*="styles-module"]') || a.parentElement;
        if (container && !containers.has(container)) {
          containers.add(container);
          feedCards.push(container);
        }
      }
      if (feedCards.length > 0) {
        return feedCards.map(card => parseDOMCardFromDoc(card));
      }
    }

    const altCards = doc.querySelectorAll('[itemtype*="Product"]');
    return Array.from(altCards).map(card => parseDOMCardFromDoc(card));
  }

  function parseDOMCardFromDoc(card) {
    if (typeof AvitoParser !== 'undefined' && AvitoParser.parseDOMCard) {
      return AvitoParser.parseDOMCard(card);
    }

    const titleEl = card.querySelector('[data-marker="item-title"], [itemprop="name"], a[title]');
    const title = titleEl ? (AvitoParser.cleanText ? AvitoParser.cleanText(titleEl.textContent) : titleEl.textContent.trim()) : '';
    const price = AvitoParser.extractDOMPrice ? AvitoParser.extractDOMPrice(card) : '';
    const priceNum = AvitoParser.extractNumericPrice ? AvitoParser.extractNumericPrice(price) : null;
    const hasDelivery = AvitoParser.extractDOMDelivery ? AvitoParser.extractDOMDelivery(card) : false;
    const isReserved = AvitoParser.extractDOMReserved ? AvitoParser.extractDOMReserved(card) : false;
    const description = AvitoParser.extractDOMDescription ? AvitoParser.extractDOMDescription(card, title, price) : '';
    const linkEl = card.querySelector('a[data-marker="item-title"], a[href*="/"]');
    const dateEl = card.querySelector('[data-marker="item-date"], [class*="date"], time');
    const locEl = card.querySelector('[data-marker="item-address"], [class*="geo"], [class*="location"]');
    const imgEl = card.querySelector('img[src*="http"], img[data-marker*="image"]');
    const href = linkEl ? linkEl.getAttribute('href') : '';

    return {
      title,
      price: price || 'Цена не указана',
      priceNum,
      hasDelivery,
      isReserved,
      description,
      location: locEl ? (AvitoParser.cleanText ? AvitoParser.cleanText(locEl.textContent) : locEl.textContent.trim()) : '',
      url: AvitoParser.cleanUrl ? AvitoParser.cleanUrl(href) : (href.startsWith('http') ? href : `https://www.avito.ru${href}`),
      date: dateEl ? (AvitoParser.cleanText ? AvitoParser.cleanText(dateEl.textContent) : dateEl.textContent.trim()) : '',
      seller: AvitoParser.extractDOMSeller ? AvitoParser.extractDOMSeller(card) : '',
      image: imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '',
    };
  }

  function findItemsInPayload(obj) {
    const paths = [
      ['props', 'pageProps', 'data', 'catalog', 'items'],
      ['props', 'pageProps', 'initialState', 'catalog', 'list', 'items'],
      ['props', 'pageProps', 'serverData', 'catalog', 'items'],
    ];
    for (const path of paths) {
      let cursor = obj;
      for (const key of path) {
        if (cursor && typeof cursor === 'object' && key in cursor) {
          cursor = cursor[key];
        } else {
          cursor = null;
          break;
        }
      }
      if (Array.isArray(cursor) && cursor.length > 0) return cursor;
    }
    return null;
  }

  function normalizeItem(raw) {
    if (typeof AvitoParser !== 'undefined' && AvitoParser.normalizeNextDataItem) {
      return AvitoParser.normalizeNextDataItem(raw);
    }

    const getField = (keys) => {
      for (const k of keys) {
        if (raw[k] != null) return String(raw[k]).trim();
      }
      return '';
    };

    let price = '';
    if (raw.price != null) {
      price = typeof raw.price === 'object'
        ? (raw.price.text || raw.price.value || raw.price.formatted || '')
        : String(raw.price);
    }
    price = AvitoParser.cleanPrice ? AvitoParser.cleanPrice(price) : price;
    const priceNum = AvitoParser.extractNumericPrice ? AvitoParser.extractNumericPrice(raw.price || price) : null;
    const hasDelivery = AvitoParser.extractNextDataDelivery ? AvitoParser.extractNextDataDelivery(raw) : false;
    const isReserved = AvitoParser.extractNextDataReserved ? AvitoParser.extractNextDataReserved(raw) : false;

    let rawUrl = raw.url || raw.urlPath || raw.itemUrl || '';
    if (rawUrl && !rawUrl.startsWith('http')) rawUrl = `https://www.avito.ru${rawUrl}`;
    if (!rawUrl && raw.id) rawUrl = `https://www.avito.ru/items/${raw.id}`;
    const url = AvitoParser.cleanUrl ? AvitoParser.cleanUrl(rawUrl) : rawUrl;

    let image = '';
    if (raw.images && Array.isArray(raw.images) && raw.images.length > 0) {
      const img = raw.images[0];
      image = typeof img === 'string' ? img : (img.url || img.src || img['640x480'] || '');
    } else if (raw.image) {
      image = typeof raw.image === 'string' ? raw.image : (raw.image.url || raw.image.src || '');
    }

    let location = '';
    for (const k of ['location', 'geo', 'address']) {
      if (raw[k]) {
        location = typeof raw[k] === 'string' ? raw[k] : (raw[k].name || raw[k].formattedAddress || '');
        if (location) break;
      }
    }

    let seller = '';
    if (raw.seller) seller = typeof raw.seller === 'object' ? (raw.seller.name || '') : String(raw.seller);
    if (AvitoParser.cleanSeller) seller = AvitoParser.cleanSeller(seller);

    const description = AvitoParser.extractDescription ? AvitoParser.extractDescription(raw) : '';

    return {
      title: AvitoParser.cleanTitle ? AvitoParser.cleanTitle(getField(['title', 'name'])) : getField(['title', 'name']),
      price,
      priceNum,
      hasDelivery,
      isReserved,
      description,
      location,
      url,
      date: getField(['time', 'date', 'sortTimeStamp', 'publishDate']),
      seller,
      image,
    };
  }

  function updatePageInfo() {
    const info = panelEl.querySelector('#ap-page-info');
    if (info) info.textContent = pagesLoaded > 1 ? `Стр. 1–${pagesLoaded}` : 'Стр. 1';
  }

  function updateStats(currentItems) {
    const statsEl = panelEl.querySelector('#ap-stats');
    if (!statsEl || !lastResult) return;

    const list = currentItems || displayItems || lastResult.items;
    const prices = list
      .map(i => i.priceNum)
      .filter(p => typeof p === 'number' && !isNaN(p) && p > 0);

    const statsFragment = document.createDocumentFragment();

    // 1. Count
    const total = lastResult.items.length;
    const isFiltered = list.length !== total;
    const countStat = document.createElement('span');
    countStat.className = 'ap-stat';
    countStat.appendChild(document.createTextNode('Найдено: '));
    const strongCount = document.createElement('strong');
    strongCount.textContent = String(isFiltered ? list.length : total);
    countStat.appendChild(strongCount);
    if (isFiltered) {
      const sub = document.createElement('span');
      sub.className = 'ap-stat-sub';
      sub.textContent = ` из ${total}`;
      countStat.appendChild(sub);
    }
    statsFragment.appendChild(countStat);

    // 2. Query
    const query = (lastResult && lastResult.savedQuery) || AvitoParser.getSearchQuery() || '—';
    const queryStat = document.createElement('span');
    queryStat.className = 'ap-stat';
    queryStat.title = query;
    queryStat.appendChild(document.createTextNode('Запрос: '));
    const strongQuery = document.createElement('strong');
    strongQuery.textContent = query;
    queryStat.appendChild(strongQuery);
    statsFragment.appendChild(queryStat);

    // 3. Pages
    const pageStat = document.createElement('span');
    pageStat.className = 'ap-stat';
    pageStat.appendChild(document.createTextNode('Стр: '));
    const strongPage = document.createElement('strong');
    strongPage.textContent = String(pagesLoaded);
    pageStat.appendChild(strongPage);
    statsFragment.appendChild(pageStat);

    // 4. Prices
    if (prices.length > 0) {
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      const fmt = (n) => n.toLocaleString('ru-RU') + ' ₽';

      const createPriceStat = (label, value, title) => {
        const s = document.createElement('span');
        s.className = 'ap-stat ap-stat-price';
        s.title = title;
        s.appendChild(document.createTextNode(`${label}: `));
        const st = document.createElement('strong');
        st.textContent = fmt(value);
        s.appendChild(st);
        return s;
      };

      statsFragment.appendChild(createPriceStat('Мин', minPrice, 'Минимальная цена'));
      statsFragment.appendChild(createPriceStat('Ср', avgPrice, 'Средняя цена'));
      statsFragment.appendChild(createPriceStat('Макс', maxPrice, 'Максимальная цена'));
    }

    statsEl.replaceChildren(statsFragment);
  }

  // Render
  function renderResults() {
    const statsEl = panelEl.querySelector('#ap-stats');
    const searchBar = panelEl.querySelector('#ap-search-bar');
    const filtersBar = panelEl.querySelector('#ap-filters-bar');
    const toolbar = panelEl.querySelector('#ap-toolbar');
    const fieldsBar = panelEl.querySelector('#ap-fields-bar');
    const exportRow = panelEl.querySelector('#ap-export-row');

    if (!lastResult || lastResult.items.length === 0) {
      const toggleFiltersBtn = panelEl.querySelector('#ap-toggle-filters');
      if (toggleFiltersBtn) toggleFiltersBtn.style.display = 'none';
      if (statsEl) statsEl.textContent = '';
      if (searchBar) searchBar.style.display = 'none';
      if (filtersBar) filtersBar.style.display = 'none';
      if (toolbar) toolbar.style.display = 'none';
      if (fieldsBar) fieldsBar.style.display = 'none';
      if (exportRow) exportRow.style.display = 'none';

      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'ap-empty';
      const h3 = document.createElement('h3');
      h3.textContent = 'Объявления не найдены';
      const p = document.createElement('p');
      p.appendChild(document.createTextNode('Проверь, что ты на странице поиска Авито'));
      p.appendChild(document.createElement('br'));
      p.appendChild(document.createTextNode('с результатами, и попробуй ещё раз'));
      emptyDiv.append(h3, p);

      const cardsContainer = panelEl.querySelector('#ap-cards');
      if (cardsContainer) cardsContainer.replaceChildren(emptyDiv);
      return;
    }

    const toggleFiltersBtn = panelEl.querySelector('#ap-toggle-filters');
    if (toggleFiltersBtn) toggleFiltersBtn.style.display = '';

    updateStats();

    const btnLoadMore = panelEl.querySelector('#ap-load-more');
    if (btnLoadMore) {
      btnLoadMore.textContent = '+ След. стр.';
      btnLoadMore.disabled = false;
      btnLoadMore.classList.remove('ap-loading-pages');
    }
    const btnLoadAll = panelEl.querySelector('#ap-load-all');
    if (btnLoadAll) {
      btnLoadAll.textContent = '+ Все стр.';
      btnLoadAll.disabled = false;
      btnLoadAll.classList.remove('ap-btn-stop');
    }

    if (searchBar) searchBar.style.display = 'flex';
    if (filtersBar) filtersBar.style.display = filtersCollapsed ? 'none' : 'flex';
    if (toolbar) toolbar.style.display = 'flex';
    if (fieldsBar) fieldsBar.style.display = filtersCollapsed ? 'none' : 'flex';
    if (exportRow) exportRow.style.display = 'flex';
    syncFieldsUI();
    updatePageInfo();
    renderCards(getFilteredItems());
    updateSelectionInfo();
    updateSearchCount();
  }

  function createCardElement(item, renderIdx, minPrice, isSelected) {
    const card = document.createElement('div');
    card.className = `ap-card ${isSelected ? 'ap-card-selected' : ''}`;
    card.dataset.cardNum = String(item.itemNum);
    card.style.setProperty('--ap-card-delay', `${Math.min(renderIdx, 20) * 25}ms`);

    // 1. Controls
    const controls = document.createElement('div');
    controls.className = 'ap-card-controls';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ap-card-check';
    checkbox.checked = isSelected;
    checkbox.setAttribute('tabindex', '0');
    checkbox.setAttribute('aria-label', `Выбрать объявление ${item.itemNum}`);
    checkbox.addEventListener('change', () => {
      toggleSelection(item.itemNum);
    });

    const cardNum = document.createElement('span');
    cardNum.className = 'ap-card-num';
    cardNum.textContent = `№${item.itemNum}`;

    controls.append(checkbox, cardNum);
    card.appendChild(controls);

    // 2. Thumb
    const hasImage = item.image && /^https?:\/\//i.test(item.image);
    if (hasImage) {
      const thumb = document.createElement('div');
      thumb.className = 'ap-card-thumb';
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
      card.appendChild(thumb);
    }

    // 3. Body
    const body = document.createElement('div');
    body.className = 'ap-card-body';

    // Title row
    const titleRow = document.createElement('div');
    titleRow.className = 'ap-card-title-row';

    const titleEl = document.createElement('div');
    titleEl.className = 'ap-card-title';

    const safeUrl = (item.url && /^https?:\/\//i.test(item.url)) ? item.url : null;
    if (safeUrl) {
      const link = document.createElement('a');
      link.href = safeUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = item.title || 'Без названия';
      titleEl.appendChild(link);
    } else {
      titleEl.textContent = item.title || 'Без названия';
    }
    titleRow.appendChild(titleEl);

    if (safeUrl) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'ap-card-copy-url';
      copyBtn.title = 'Скопировать ссылку';
      copyBtn.setAttribute('aria-label', 'Скопировать ссылку');
      setSvgIcon(copyBtn, `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`);
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(safeUrl);
          showToast('✓ Ссылка скопирована');
        } catch {
          showToast('Не удалось скопировать');
        }
      });
      titleRow.appendChild(copyBtn);
    }
    body.appendChild(titleRow);

    // Price row
    const priceRow = document.createElement('div');
    priceRow.className = 'ap-card-price-row';

    const priceSpan = document.createElement('span');
    priceSpan.className = 'ap-card-price';
    priceSpan.textContent = item.price || 'Цена не указана';
    priceRow.appendChild(priceSpan);

    if (item.oldPrice) {
      const oldPriceSpan = document.createElement('span');
      oldPriceSpan.className = 'ap-card-old-price';
      oldPriceSpan.title = 'Старая цена';
      oldPriceSpan.textContent = item.oldPrice;
      priceRow.appendChild(oldPriceSpan);
    }

    if (item.discount) {
      const discountSpan = document.createElement('span');
      discountSpan.className = 'ap-card-discount';
      discountSpan.title = 'Скидка';
      discountSpan.textContent = item.discount;
      priceRow.appendChild(discountSpan);
    }
    body.appendChild(priceRow);

    // Description
    if (item.description && typeof item.description === 'string' && item.description.trim()) {
      const descEl = document.createElement('div');
      descEl.className = 'ap-card-desc';
      descEl.textContent = item.description.trim();
      body.appendChild(descEl);
    }

    // Meta badges
    const metaContainer = document.createElement('div');
    metaContainer.className = 'ap-card-meta';
    const metaNodes = [];

    const isBestPrice = minPrice !== null && item.priceNum === minPrice;
    if (isBestPrice) {
      const b = document.createElement('span');
      b.className = 'ap-badge-best-price';
      b.title = 'Самая выгодная цена в текущей подборке';
      b.textContent = '★ Лучшая цена';
      metaNodes.push(b);
    }

    if (item.isReserved) {
      const b = document.createElement('span');
      b.className = 'ap-badge-reserved';
      b.title = 'Товар зарезервирован';
      b.textContent = 'Зарезервирован';
      metaNodes.push(b);
    }

    if (item.hasDelivery) {
      const b = document.createElement('span');
      b.className = 'ap-badge-delivery';
      b.title = item.deliveryText || 'Доступна Авито Доставка';
      b.textContent = `🚚 ${item.deliveryText || 'Доставка'}`;
      metaNodes.push(b);
    }

    if (item.isPromoted) {
      const b = document.createElement('span');
      b.className = 'ap-badge-promoted';
      b.title = 'Продвигаемое объявление';
      b.textContent = 'Продвинуто ⬆';
      metaNodes.push(b);
    }

    if (item.location) {
      const s = document.createElement('span');
      s.className = 'ap-card-meta-item';
      s.textContent = item.location;
      metaNodes.push(s);
    }

    if (item.date) {
      const s = document.createElement('span');
      s.className = 'ap-card-meta-item';
      s.textContent = item.date;
      metaNodes.push(s);
    }

    if (item.seller) {
      const s = document.createElement('span');
      s.className = 'ap-card-meta-item';
      s.textContent = item.seller;
      if (item.sellerRating) {
        const rating = document.createElement('span');
        rating.className = 'ap-card-rating';
        rating.title = item.sellerReviews || 'Рейтинг';
        rating.textContent = ` ★ ${item.sellerRating}`;
        s.appendChild(rating);
      }
      metaNodes.push(s);
    }

    metaNodes.forEach((node, idx) => {
      if (idx > 0) {
        metaContainer.appendChild(document.createTextNode(' · '));
      }
      metaContainer.appendChild(node);
    });

    if (metaNodes.length > 0) {
      body.appendChild(metaContainer);
    }

    card.appendChild(body);

    // Click on card row toggles checkbox (excluding links & buttons)
    card.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('.ap-card-check') || e.target.closest('.ap-card-copy-url')) return;
      toggleSelection(item.itemNum);
    });

    return card;
  }

  function renderCards(items) {
    const cardsEl = panelEl.querySelector('#ap-cards');
    if (!cardsEl) return;

    updateStats(items);

    if (items.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'ap-empty';
      const h3 = document.createElement('h3');
      h3.textContent = 'Ничего не найдено';
      const p = document.createElement('p');
      p.appendChild(document.createTextNode('По заданным фильтрам и поиску объявлений нет.'));
      p.appendChild(document.createElement('br'));
      p.appendChild(document.createTextNode('Попробуй изменить фильтры или сбросить их.'));
      emptyDiv.append(h3, p);
      cardsEl.replaceChildren(emptyDiv);
      return;
    }

    const validPrices = items
      .map(i => i.priceNum)
      .filter(p => typeof p === 'number' && !isNaN(p) && p > 0);
    const minPrice = validPrices.length > 1 ? Math.min(...validPrices) : null;

    const fragment = document.createDocumentFragment();
    items.forEach((item, renderIdx) => {
      const isSelected = selectedIndices.has(item.itemNum);
      const card = createCardElement(item, renderIdx, minPrice, isSelected);
      fragment.appendChild(card);
    });

    cardsEl.replaceChildren(fragment);
  }

  function renderError(err) {
    const searchBar = panelEl.querySelector('#ap-search-bar');
    const filtersBar = panelEl.querySelector('#ap-filters-bar');
    const toolbar = panelEl.querySelector('#ap-toolbar');
    const fieldsBar = panelEl.querySelector('#ap-fields-bar');
    const exportRow = panelEl.querySelector('#ap-export-row');
    if (searchBar) searchBar.style.display = 'none';
    if (filtersBar) filtersBar.style.display = 'none';
    if (toolbar) toolbar.style.display = 'none';
    if (fieldsBar) fieldsBar.style.display = 'none';
    if (exportRow) exportRow.style.display = 'none';

    const cardsEl = panelEl.querySelector('#ap-cards');
    if (!cardsEl) return;
    const errWrap = document.createElement('div');
    errWrap.className = 'ap-error-state';
    const h3 = document.createElement('h3');
    h3.textContent = 'Не удалось распарсить';
    const p = document.createElement('p');
    p.appendChild(document.createTextNode((err && err.message) ? err.message : 'Ошибка при сборе данных'));
    p.appendChild(document.createElement('br'));
    p.appendChild(document.createTextNode('Попробуй обновить страницу'));
    errWrap.append(h3, p);
    cardsEl.replaceChildren(errWrap);
  }

  // Export — selected items, or all filtered items if none selected
  function handleExport(e) {
    const btn = e.target.closest('.ap-btn');
    if (!btn || !displayItems || displayItems.length === 0) return;

    const visible = getFilteredItems();
    if (visible.length === 0) return;

    const selectedVisible = visible.filter((item) => selectedIndices.has(item.itemNum));
    const itemsToExport = selectedVisible.length > 0 ? selectedVisible : visible;

    const format = btn.dataset.format;
    const exportQuery = (lastResult && lastResult.savedQuery) || AvitoParser.getSearchQuery();
    let text = '';

    switch (format) {
      case 'md': text = AvitoParser.toMarkdown(itemsToExport, activeFields, exportQuery); break;
      case 'json': text = AvitoParser.toJSON(itemsToExport, activeFields, exportQuery); break;
      case 'tsv':
      case 'csv':
        text = AvitoParser.toTSV ? AvitoParser.toTSV(itemsToExport, activeFields, exportQuery) : AvitoParser.toCSV(itemsToExport, activeFields, exportQuery);
        break;
      default: return;
    }

    copyToClipboard(text, btn, itemsToExport.length);
  }

  async function copyToClipboard(text, btn, count) {
    try {
      await navigator.clipboard.writeText(text);
      showCopiedFeedback(btn, count);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showCopiedFeedback(btn, count);
    }
  }

  function showCopiedFeedback(btn, count) {
    const original = btn.textContent;
    btn.classList.add('ap-copied');
    btn.textContent = count > 0 ? `Скопировано (${count})` : 'Скопировано';

    setTimeout(() => {
      btn.classList.remove('ap-copied');
      btn.textContent = original;
    }, 1500);

    showToast(count > 0 ? `✓ Скопировано ${count} объявл.` : '✓ Скопировано');
  }

  function showToast(message) {
    if (!panelEl) return;
    const old = panelEl.querySelector('.ap-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.className = 'ap-toast';
    toast.textContent = message;
    panelEl.appendChild(toast);

    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2200);
  }

  function openPanel() {
    panelEl.classList.add('ap-open');
    if (fabEl) fabEl.title = 'Закрыть панель (Esc)';
    if (!lastResult || !lastResult.items || lastResult.items.length === 0) {
      renderInitialEmptyState();
    }
  }

  function closePanel() {
    panelEl.classList.remove('ap-open');
    if (fabEl) fabEl.title = 'Открыть панель Tool for Avito';
  }

  function renderInitialEmptyState() {
    if (lastResult && lastResult.items && lastResult.items.length > 0) return;
    const cardsEl = panelEl && panelEl.querySelector('#ap-cards');
    if (!cardsEl) return;

    chrome.storage.local.get(['savedSession', 'lastParse'], (res) => {
      if (lastResult && lastResult.items && lastResult.items.length > 0) return;

      const session = res && (res.savedSession || res.lastParse);

      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'ap-empty';

      const badge = document.createElement('div');
      badge.className = 'ap-empty-badge';
      badge.textContent = 'Готово к работе';

      const h3 = document.createElement('h3');
      h3.textContent = 'Сбор объявлений';

      const p = document.createElement('p');
      p.textContent = 'Собери данные с текущей страницы или загрузи сохранённые лоты';

      const actions = document.createElement('div');
      actions.className = 'ap-empty-actions';

      const parseBtn = document.createElement('button');
      parseBtn.className = 'ap-btn ap-primary ap-empty-btn';
      parseBtn.id = 'ap-empty-parse-now';
      parseBtn.textContent = '⚡ Собрать текущую страницу';
      parseBtn.addEventListener('click', handleParse);
      actions.appendChild(parseBtn);

      if (session && Array.isArray(session.items) && session.items.length > 0) {
        const loadBtn = document.createElement('button');
        loadBtn.className = 'ap-btn ap-empty-btn ap-empty-load-session';
        loadBtn.id = 'ap-empty-load-saved';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'ap-empty-btn-title';
        titleSpan.textContent = '📂 Загрузить сохранённую сессию';

        const descSpan = document.createElement('span');
        descSpan.className = 'ap-empty-session-desc';

        const d = session.parsedAt ? new Date(session.parsedAt) : null;
        const dateFormatted = d ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
        const count = session.items.length;
        const q = session.query || 'Поиск';
        descSpan.textContent = `«${q}» · ${count} лотов ${dateFormatted ? '(' + dateFormatted + ')' : ''}`;

        loadBtn.append(titleSpan, descSpan);
        loadBtn.addEventListener('click', () => {
          loadSavedSession(session);
        });
        actions.appendChild(loadBtn);
      }

      emptyDiv.append(badge, h3, p, actions);
      cardsEl.replaceChildren(emptyDiv);
    });
  }

  function loadSavedSession(session) {
    if (!session || !Array.isArray(session.items) || session.items.length === 0) return;

    lastResult = {
      items: session.items.map((it, idx) => ({
        ...it,
        itemNum: it.itemNum != null ? it.itemNum : (idx + 1),
      })),
      source: 'Сохранено',
      savedQuery: session.query || '',
    };

    lastParsedUrl = session.url || '';
    pagesLoaded = 1;
    loadingPages = false;
    isLoadingAll = false;
    abortLoadingAll = false;
    currentSort = 'default';
    searchQuery = '';
    filterDelivery = 'all';
    filterInclude = '';
    filterExclude = '';
    selectedIndices = new Set();
    displayItems = [...lastResult.items];

    const searchInput = panelEl.querySelector('#ap-search-input');
    if (searchInput) searchInput.value = '';
    const searchClear = panelEl.querySelector('#ap-search-clear');
    if (searchClear) searchClear.style.display = 'none';

    const incInput = panelEl.querySelector('#ap-filter-include');
    if (incInput) incInput.value = '';
    const excInput = panelEl.querySelector('#ap-filter-exclude');
    if (excInput) excInput.value = '';

    panelEl.querySelectorAll('#ap-delivery-pills .ap-pill').forEach(b => {
      b.classList.toggle('ap-pill-active', b.dataset.delivery === 'all');
    });
    updateFilterResetVisibility();

    renderResults();

    const sortEl = panelEl.querySelector('#ap-sort');
    if (sortEl) sortEl.value = 'default';

    updateFabBadge(lastResult.items.length);
    openPanel();
    showToast(`✓ Загружено ${lastResult.items.length} сохранённых лотов`);
  }

  function saveSessionToStorage() {
    if (!lastResult || !Array.isArray(lastResult.items) || lastResult.items.length === 0) return;
    const maxItems = 300;
    const itemsToSave = lastResult.items.slice(0, maxItems).map((item, idx) => ({
      itemNum: item.itemNum != null ? item.itemNum : (idx + 1),
      id: item.id || null,
      title: item.title || '',
      price: item.price || '',
      priceNum: item.priceNum != null ? item.priceNum : null,
      oldPrice: item.oldPrice || '',
      discount: item.discount || '',
      hasDelivery: !!item.hasDelivery,
      deliveryText: item.deliveryText || '',
      isReserved: !!item.isReserved,
      isPromoted: !!item.isPromoted,
      description: item.description || '',
      location: item.location || '',
      date: item.date || '',
      seller: item.seller || '',
      sellerRating: item.sellerRating || '',
      sellerReviews: item.sellerReviews || '',
      url: item.url || '',
      image: item.image || '',
    }));

    const sessionData = {
      query: (lastResult && lastResult.savedQuery) || AvitoParser.getSearchQuery() || 'Поиск Авито',
      count: lastResult.items.length,
      url: window.location.href,
      parsedAt: new Date().toISOString(),
      items: itemsToSave,
    };

    chrome.storage.local.set({
      savedSession: sessionData,
      lastParse: sessionData,
    }).catch(() => {});

    chrome.runtime.sendMessage({
      type: 'PARSE_RESULT',
      data: sessionData,
    }).catch(() => {});
  }

  // Messages from popup / service worker
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'TRIGGER_PARSE') {
      handleParse();
      sendResponse({ ok: true });
    }
    if (msg.type === 'LOAD_SAVED_SESSION') {
      if (msg.session) {
        loadSavedSession(msg.session);
      } else {
        chrome.storage.local.get(['savedSession', 'lastParse'], (res) => {
          const s = res && (res.savedSession || res.lastParse);
          if (s) loadSavedSession(s);
        });
      }
      sendResponse({ ok: true });
    }
    if (msg.type === 'GET_LAST_RESULT') {
      sendResponse({
        ok: true,
        data: lastResult
          ? {
              count: lastResult.items.length,
              source: lastResult.source,
              query: (lastResult && lastResult.savedQuery) || AvitoParser.getSearchQuery(),
            }
          : null,
      });
    }
    return true;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
