// Временную ссылку запрашиваем при нажатии, а не сохраняем в сборке.
export function yandexRequestUrl(folderUrl, fileName) {
  const folder = new URL(folderUrl);
  if (folder.protocol !== 'https:' || !['disk.yandex.ru', 'disk.yandex.com'].includes(folder.hostname)) {
    throw new Error('Неверная публичная папка Яндекс.Диска');
  }
  if (!fileName || /[/\\\x00-\x1f]/.test(fileName)) throw new Error('Неверное имя файла');
  const url = new URL('https://cloud-api.yandex.net/v1/disk/public/resources/download');
  url.searchParams.set('public_key', folder.href);
  url.searchParams.set('path', `/${fileName}`);
  return url;
}

export async function getYandexDownload(folderUrl, fileName, fetcher = fetch) {
  const response = await fetcher(yandexRequestUrl(folderUrl, fileName), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = new Error(`Яндекс.Диск: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  const href = new URL(data.href);
  // Не разрешаем API отправить посетителя на произвольный сайт.
  if (href.protocol !== 'https:' || href.username || href.password || href.port ||
      !['yandex.ru', 'yandex.net', 'yandex.com'].some((domain) => href.hostname.endsWith(`.${domain}`))) {
    throw new Error('Яндекс.Диск вернул неверный адрес скачивания');
  }
  return href.href;
}

// Не передаём адрес сайта серверу скачивания. API и переход к файлу —
// отдельные запросы: referrerPolicy у fetch не действует на window.location.
export function navigateToDownload(url, doc = document) {
  const link = doc.createElement('a');
  link.href = url;
  link.referrerPolicy = 'no-referrer';
  link.rel = 'noreferrer';
  doc.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}

export function initYandexDownloads(scope = document, getLink = getYandexDownload, navigate = navigateToDownload) {
  const en = scope.documentElement?.lang === 'en';
  scope.querySelectorAll('[data-yandex-download]').forEach((button) => {
    const status = scope.getElementById(button.getAttribute('aria-describedby'));
    const label = button.querySelector('[data-download-label]');
    const original = label.textContent;
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      label.textContent = en ? 'Getting a link…' : 'Получаем ссылку…';
      status.textContent = en ? 'Preparing a download from Yandex Disk…' : 'Подготавливаем скачивание с Яндекс.Диска…';
      try {
        const href = await getLink(button.dataset.folderUrl, button.dataset.fileName);
        navigate(href);
        status.textContent = en ? 'The link was sent to your browser. If the download did not start, try again or open the folder below.' : 'Ссылка передана браузеру. Если скачивание не началось, попробуй ещё раз или открой папку ниже.';
      } catch (error) {
        const reason = error?.status === 429
          ? (en ? 'Yandex Disk is temporarily limiting download requests.' : 'Яндекс.Диск временно ограничил выдачу ссылок из-за большого числа запросов.')
          : error?.status === 404
            ? (en ? 'Yandex Disk could not find the selected file.' : 'Яндекс.Диск не нашёл выбранный файл.')
            : (en ? 'Could not get a download link.' : 'Не удалось получить ссылку для скачивания.');
        status.textContent = en ? `${reason} Use Open files on Yandex Disk below and choose ${button.dataset.fileName}.` : `${reason} Нажми «Открыть файлы на Яндекс.Диске» ниже и выбери ${button.dataset.fileName}.`;
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        label.textContent = original;
      }
    });
  });
}
