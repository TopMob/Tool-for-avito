document.addEventListener('DOMContentLoaded', async () => {
  const statusDot    = document.getElementById('status-dot');
  const statusText   = document.getElementById('status-text');
  const btnParse     = document.getElementById('btn-parse');
  const formatSel    = document.getElementById('default-format');
  const savedBlock   = document.getElementById('saved-session');
  const savedBadge   = document.getElementById('saved-badge');
  const savedQuery   = document.getElementById('saved-query');
  const savedDate    = document.getElementById('saved-date');
  const btnOpen      = document.getElementById('btn-open-session');
  const btnToggle    = document.getElementById('btn-toggle-list');
  const previewEl    = document.getElementById('lots-preview');
  const lotsList     = document.getElementById('lots-list');
  const toastEl      = document.getElementById('popup-toast');

  let currentSession = null;
  let toastTimer = null;
  let listRendered = false;

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.style.display = 'none';
    }, 2200);
  }

  // Clear legacy darkMode key
  chrome.storage.local.remove(['darkMode']).catch(() => {});

  // Load stored state
  const stored = await chrome.storage.local.get([
    'defaultFormat',
    'savedSession',
    'lastParse',
    'ap_export_fields',
  ]);

  if (stored.defaultFormat) {
    formatSel.value = stored.defaultFormat;
  }

  // Check saved session
  currentSession = stored.savedSession || stored.lastParse;
  if (currentSession && (currentSession.count > 0 || (currentSession.items && currentSession.items.length > 0))) {
    savedBlock.style.display = 'flex';

    const count = currentSession.count || (currentSession.items ? currentSession.items.length : 0);
    savedBadge.textContent = `${count} шт.`;

    savedQuery.textContent = currentSession.query ? `«${currentSession.query}»` : 'Поиск без названия';

    if (currentSession.parsedAt) {
      const d = new Date(currentSession.parsedAt);
      const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      const timeStr = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      savedDate.textContent = `${dateStr}, ${timeStr}`;
    } else {
      savedDate.textContent = '';
    }
  }

  // Render items preview list
  function renderLotsList() {
    if (!currentSession || !Array.isArray(currentSession.items) || currentSession.items.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'popup-lot-empty';
      emptyMsg.textContent = 'Список лотов не сохранён в сессии';
      lotsList.replaceChildren(emptyMsg);
      return;
    }

    const fragment = document.createDocumentFragment();
    currentSession.items.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'popup-lot-row';

      const num = document.createElement('span');
      num.className = 'popup-lot-num';
      num.textContent = `№${item.itemNum || (idx + 1)}`;

      const link = document.createElement('a');
      link.className = 'popup-lot-link';
      link.textContent = item.title || 'Без названия';
      link.title = item.title || '';
      if (item.url && /^https?:\/\//i.test(item.url)) {
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener';
      }

      const price = document.createElement('span');
      price.className = 'popup-lot-price';
      price.textContent = item.priceNum != null
        ? `${item.priceNum.toLocaleString('ru-RU')} ₽`
        : (item.price || '—');

      row.append(num, link, price);
      fragment.appendChild(row);
    });

    lotsList.replaceChildren(fragment);
    listRendered = true;
  }

  // Toggle list preview inside popup
  btnToggle.addEventListener('click', () => {
    const isHidden = previewEl.style.display === 'none';
    if (isHidden) {
      if (!listRendered) renderLotsList();
      previewEl.style.display = 'block';
      btnToggle.textContent = 'Скрыть ▴';
      btnToggle.classList.add('popup-sub-btn-active');
    } else {
      previewEl.style.display = 'none';
      btnToggle.textContent = 'Список ▾';
      btnToggle.classList.remove('popup-sub-btn-active');
    }
  });

  // Open / Show session
  btnOpen.addEventListener('click', async () => {
    if (!currentSession) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const isOnAvito = tab && tab.url && /avito\.ru/i.test(tab.url);

      if (isOnAvito && tab.id) {
        // Send message to load saved session directly into the side panel
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'LOAD_SAVED_SESSION',
            session: currentSession,
          });
          window.close();
          return;
        } catch {
          // Tab might not be ready, fallback to opening URL
        }
      }

      // If not on Avito, open the saved URL in a new tab
      if (currentSession.url && /^https?:\/\//i.test(currentSession.url)) {
        await chrome.tabs.create({ url: currentSession.url });
      } else {
        await chrome.tabs.create({ url: 'https://www.avito.ru' });
      }
      window.close();
    } catch {
      showToast('Не удалось открыть сессию');
    }
  });

  // Export buttons
  document.querySelectorAll('.popup-export-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!currentSession || !Array.isArray(currentSession.items) || currentSession.items.length === 0) {
        showToast('Лоты не найдены в сессии');
        return;
      }

      const format = btn.dataset.format;
      const fields = stored.ap_export_fields || (typeof AvitoParser !== 'undefined' ? AvitoParser.DEFAULT_FIELDS : {});
      let text = '';

      if (typeof AvitoParser !== 'undefined') {
        if (format === 'md') {
          text = AvitoParser.toMarkdown(currentSession.items, fields, currentSession.query);
        } else if (format === 'json') {
          text = AvitoParser.toJSON(currentSession.items, fields, currentSession.query);
        } else if (format === 'tsv') {
          text = AvitoParser.toTSV(currentSession.items, fields, currentSession.query);
        }
      }

      if (!text) {
        showToast('Ошибка при формировании экспорта');
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        const originalText = btn.textContent;
        btn.textContent = '✓ Готово';
        btn.classList.add('popup-export-copied');
        showToast(`✓ Скопировано ${currentSession.items.length} лотов (${format.toUpperCase()})`);

        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove('popup-export-copied');
        }, 1500);
      } catch {
        showToast('Не удалось скопировать в буфер');
      }
    });
  });

  // Check active tab status
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url && /avito\.ru/i.test(tab.url)) {
      statusDot.classList.add('active');
      statusText.textContent = 'На странице Авито';
      btnParse.disabled = false;
    } else {
      statusDot.classList.add('inactive');
      statusText.textContent = 'Открой страницу Авито';
      btnParse.disabled = true;
    }
  } catch {
    statusDot.classList.add('inactive');
    statusText.textContent = 'Не удалось проверить вкладку';
  }

  // Collect listings on active page
  btnParse.addEventListener('click', async () => {
    btnParse.disabled = true;
    btnParse.textContent = 'Сбор данных…';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab');
      await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_PARSE' });

      btnParse.textContent = 'Готово';
      setTimeout(() => {
        window.close();
      }, 250);
    } catch {
      btnParse.textContent = 'Обнови вкладку';
      setTimeout(() => {
        btnParse.textContent = 'Собрать объявления';
        btnParse.disabled = false;
      }, 2000);
    }
  });

  // Save default format
  formatSel.addEventListener('change', () => {
    chrome.storage.local.set({ defaultFormat: formatSel.value });
  });
});
