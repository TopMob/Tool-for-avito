document.addEventListener('DOMContentLoaded', async () => {
  const statusDot  = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const btnParse   = document.getElementById('btn-parse');
  const lastParse  = document.getElementById('last-parse');
  const lastInfo   = document.getElementById('last-info');
  const formatSel  = document.getElementById('default-format');

  // Clear any leftover legacy darkMode key from storage
  chrome.storage.local.remove(['darkMode']).catch(() => {});

  const stored = await chrome.storage.local.get(['defaultFormat', 'lastParse']);
  if (stored.defaultFormat) formatSel.value = stored.defaultFormat;

  if (stored.lastParse) {
    const lp = stored.lastParse;
    lastParse.style.display = 'block';

    // Safe DOM construction (No innerHTML / Zero UNSAFE_VAR_ASSIGNMENT)
    lastInfo.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = String(lp.count || 0);
    lastInfo.appendChild(strong);
    lastInfo.appendChild(document.createTextNode(' объявлений'));

    if (lp.query) {
      lastInfo.appendChild(document.createElement('br'));
      const queryLabel = document.createTextNode(`Запрос: ${lp.query}`);
      lastInfo.appendChild(queryLabel);
    }

    if (lp.parsedAt) {
      lastInfo.appendChild(document.createElement('br'));
      const timeStr = new Date(lp.parsedAt).toLocaleString('ru-RU');
      lastInfo.appendChild(document.createTextNode(timeStr));
    }
  }

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

  btnParse.addEventListener('click', async () => {
    btnParse.disabled = true;
    btnParse.textContent = 'Сбор данных…';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab');
      await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_PARSE' });

      btnParse.textContent = 'Готово';
      // Закрываем окно попапа через небольшую паузу,
      // чтобы сразу открыть боковую панель на странице
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

  formatSel.addEventListener('change', () => {
    chrome.storage.local.set({ defaultFormat: formatSel.value });
  });
});
