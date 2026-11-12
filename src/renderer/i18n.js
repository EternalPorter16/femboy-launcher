// Английский интерфейс. Лаунчер написан по-русски, а этот слой на лету переводит весь показанный текст:
// кнопки, подсказки, уведомления, сообщения бэкенда. Точные строки — из словаря, строки с подстановками — по шаблонам
(function () {
  let lang = 'ru';
  try {
    lang = localStorage.getItem('lang') || 'ru';
  } catch {}

  // Точные строки (сравниваем без пробелов по краям)
  const D = {
    'укутайся потеплее ♡': 'Wrap up warm ♡',
    'за окном снег, а здесь уютно ❄️': 'Snow outside, cozy in here ❄️',
    'горячий чай и новая стройка? ☕': 'Hot tea and a new build? ☕',
    // меню и заголовки
    'Сборки': 'Instances', 'Моды': 'Mods', 'Аккаунты': 'Accounts', 'Консоль': 'Console', 'Настройки': 'Settings',
    'Привет ~': 'Hi ~', 'Выбери сборку и нажми «Играть» ♡': 'Pick an instance and hit “Play” ♡',
    'Импорт': 'Import', 'Модпаки': 'Modpacks', 'Новая сборка': 'New instance', 'Найти сборку…': 'Find an instance…',
    'Недавние': 'Recent', 'По названию': 'By name', 'Больше всего играли': 'Most played', 'По версии игры': 'By game version',
    'Все': 'All', 'Без группы': 'No group', 'Играть': 'Play', 'Закрыть игру': 'Close game', 'Загрузка…': 'Loading…',
    'Нет сборки': 'No instance', 'создай первую ♡': 'create your first ♡', 'ещё не запускалась': 'never played',
    '⬆ обновление': '⬆ update', 'Ставь моды и модпаки прямо из лаунчера': 'Install mods and modpacks right from the launcher',
    'Сборка': 'Instance', 'Установленные': 'Installed', 'Ресурспаки': 'Resource packs', 'Шейдеры': 'Shaders',
    'Все категории': 'All categories', 'По умолчанию': 'Default', 'Популярные': 'Popular', 'Недавно обновлённые': 'Recently updated', 'Новые': 'Newest',
    'Обновления': 'Updates', 'Оптимизация': 'Optimize', 'Показать ещё': 'Show more',
    'Фильтр по названию…': 'Filter by name…', 'Поиск или Project ID с curseforge.com…': 'Search or a Project ID from curseforge.com…',
    'Поиск модов… например, sodium': 'Search mods… e.g. sodium', 'Поиск модпаков… например, Fabulously Optimized': 'Search modpacks… e.g. Fabulously Optimized',
    'Поиск ресурспаков… например, Faithful': 'Search resource packs… e.g. Faithful', 'Поиск шейдеров… например, Complementary': 'Search shaders… e.g. Complementary',
    'Поиск… например, sodium': 'Search… e.g. sodium', 'Поставить': 'Install', 'Установить': 'Install', 'Установлен ✓': 'Installed ✓', 'Ставлю…': 'Installing…',
    'Устанавливаю…': 'Installing…', 'Удалить': 'Remove', 'Включён': 'Enabled', 'Найти': 'Find', 'Открыть страницу': 'Open page',
    'Лицензия через Microsoft или просто ник для оффлайна': 'Microsoft license or just a nickname for offline play',
    'Для лицензии и онлайн-серверов. Откроется окно входа.': 'For a licensed account and online servers. A sign-in window will open.',
    'Войти через Microsoft': 'Sign in with Microsoft', 'Оффлайн': 'Offline', 'Придумай ник — играй в одиночке и на оффлайн-серверах.': 'Pick a nickname — play singleplayer and on offline servers.',
    'Ник, напр. Boykisser_': 'Nickname, e.g. Boykisser_', 'Добавить': 'Add', '3–16 символов: A–Z, 0–9, _': '3–16 characters: A–Z, 0–9, _',
    'Мои аккаунты': 'My accounts', 'Выбрать': 'Select', 'выбран ♡': 'selected ♡', 'Скин': 'Skin', 'стандартный': 'default', 'лицензия': 'license',
    'Microsoft ✓': 'Microsoft ✓', 'Нет аккаунта': 'No account', 'добавить ♡': 'add one ♡', 'Пока пусто… добавь аккаунт выше ♡': 'Nothing here yet… add an account above ♡',
    '🎨 Редактор': '🎨 Editor', 'Загрузить PNG': 'Upload PNG', 'Сбросить': 'Reset', 'Без плаща': 'No cape',
    'Логи загрузки и игры': 'Download and game logs', 'отладка': 'debug', 'Копировать': 'Copy', 'Очистить': 'Clear',
    'Поиск по консоли…': 'Search the console…', 'только ошибки': 'errors only',
    '📜 Лог игры': '📜 Game log', '📂 Папка логов': '📂 Logs folder',
    '🔧 Починить файлы игры': '🔧 Repair game files',
    'Заново проверит клиент игры, библиотеки и ресурсы по хэшам и скачает то, что повреждено. Миры, моды и настройки не трогает':
      'Re-checks the game client, libraries and assets by hash and re-downloads whatever is damaged. Worlds, mods and settings are left alone',
    'проверяю файлы игры по хэшам, это может занять минуту 🔧': 'checking the game files by hash, this can take a minute 🔧',
    'Файлы игры проверены 🔧': 'Game files checked 🔧',
    'Часть файлов пришлось скачать заново — они отмечены жёлтым ♡': 'Some files had to be downloaded again — they are marked yellow ♡',
    'Всё в порядке: чинить ничего не пришлось ♡': 'All good: nothing needed fixing ♡',
    'Перезапустить и обновить ♡': 'Restart and update ♡', 'Скачать': 'Download',
    'Копия мира перед открытием для друзей': 'World copy before opening it to friends',
    'Когда ты открываешь мир для друзей по сети, лаунчер сохраняет его копию (во вкладке «Миры» она подписана «автокопия»). Если в гостях что-то сломают, мир можно вернуть таким, каким он был до них.':
      'When you open a world to friends over the network, the launcher saves a copy of it (it is labelled “auto copy” in the “Worlds” tab). If something gets broken while they visit, you can bring the world back as it was before them.',
    'Время в игре 📊': 'Time in game 📊', 'Считаю…': 'Counting…',
    'Пока нет данных: статистика начнётся со следующей игры ♡': 'No data yet: the statistics start with your next game ♡',
    'за неделю · всего': 'this week · total', '· самая долгая игра': '· longest session',
    'Сборки за 30 дней': 'Instances over 30 days', 'Удалённая сборка': 'Deleted instance',
    'Мир открыт по сети 🔌': 'The world is open on the network 🔌', 'Понятно ♡': 'Got it ♡',
    'Адрес e4mc сейчас недоступен, но друг в той же сети или VPN (Radmin VPN, Hamachi…) может зайти напрямую — в «Сетевая игра → Прямое подключение»:':
      'The e4mc address isn’t available right now, but a friend on the same network or VPN (Radmin VPN, Hamachi…) can join directly — in “Multiplayer → Direct Connection”:',
    'Не заходит по адресу e4mc? Друг в той же сети или VPN (Radmin VPN, Hamachi…) может зайти напрямую — в «Сетевая игра → Прямое подключение»:':
      'The e4mc address doesn’t work? A friend on the same network or VPN (Radmin VPN, Hamachi…) can join directly — in “Multiplayer → Direct Connection”:',
    'Адрес действует, пока мир открыт. Если друг не заходит, проверь, что вы в одной сети или в одной VPN-комнате, и разреши Java в брандмауэре Windows. Белый список, если он включён, действует и здесь.':
      'The address works while the world is open. If your friend can’t join, check that you are on the same network or in the same VPN room, and allow Java in the Windows firewall. The whitelist, if it’s on, applies here too.',
    'Передавать игре прокси лаунчера': 'Pass the launcher’s proxy to the game',
    'Java сама системный прокси не видит. Если интернет есть только через прокси или VPN, лаунчер передаёт его игре, чтобы моды вроде e4mc могли выйти в сеть. Выключи, если из-за этого что-то в игре не работает: тогда игра пойдёт в сеть напрямую.':
      'Java doesn’t see the system proxy itself. If the internet is only reachable through a proxy or VPN, the launcher passes it to the game so mods like e4mc can get online. Turn it off if something in the game stops working because of it: the game will then go online directly.',
    'Прокси лаунчера для игры отключён в настройках': 'The launcher’s proxy for the game is turned off in the settings',
    'Старые логи игры': 'Old game logs',
    'Старые логи игры остались от тех версий лаунчера, где Java запускалась из общей папки: теперь у каждой сборки свои, эти больше нигде не нужны (заново они не скачиваются).':
      'The old game logs are left over from launcher versions that started Java from the shared folder: each instance now has its own, and these are not needed anywhere (they are not downloaded again).',
    '📌 закреплён': '📌 pinned',
    'Закреплён: «Обновить моды» его пропускает. Нажми, чтобы открепить': 'Pinned: “Update mods” skips it. Click to unpin',
    'Закрепить эту версию: «Обновить моды» её пропустит': 'Pin this version: “Update mods” will skip it',
    'Ресурсы игры': 'Game assets', 'Готово': 'Done',
    'Клиент игры': 'Game client', 'скачан заново: файла не было или он был повреждён': 'downloaded again: the file was missing or damaged',
    'в порядке': 'fine', 'Профиль версии': 'Version profile', 'был оборван при записи — скачан заново': 'was cut off while being written — downloaded again',
    'профиль в порядке': 'profile is fine', 'профиль был оборван или отсутствовал — скачан заново': 'the profile was cut off or missing — downloaded again',
    'версия загрузчика выберется при первом запуске — проверять пока нечего': 'the loader version is picked at the first launch — nothing to check yet',
    'файлы ставит установщик при запуске — здесь не проверяются': 'its files are installed by the installer at launch — not checked here',
    'Миры, моды и настройки сборки не тронуты. Если игра всё равно вылетает — попробуй «Найти виновника» во вкладке «Ещё» или «Отчёт для поддержки» в Настройках.':
      'Worlds, mods and instance settings are untouched. If the game still crashes, try “Find the culprit” in the “More” tab or the “Support report” in Settings.',
    'Сначала закрой игру (или дождись, пока она запустится): пока она идёт, общие файлы игры заменить нельзя': 'Close the game first (or wait until it has started): the shared game files can’t be replaced while it runs',
    'Откроет latest.log последнего запуска в программе для текстов': 'Opens the latest.log of the last launch in a text editor',
    'Папка logs этой сборки: latest.log и логи прошлых запусков': 'This instance’s logs folder: latest.log and the logs of earlier launches',
    'Лога этой сборки ещё нет: он появится после запуска игры': 'This instance has no log yet: it appears after the game is launched',
    'Папки логов этой сборки ещё нет: она появится после запуска игры': 'This instance has no logs folder yet: it appears after the game is launched',
    'Неизвестно, что открыть': 'Don’t know what to open',
    'Всё сохраняется сразу ✧': 'Everything saves instantly ✧', 'Оформление': 'Appearance', 'Тема': 'Theme', 'Светлая': 'Light', 'Тёмная': 'Dark',
    '☀ Светлая': '☀ Light', '☾ Тёмная': '☾ Dark', '🌸 Сакура': '🌸 Sakura', '🌌 Полночь': '🌌 Midnight', '⚙ Авто': '⚙ Auto',
    'Акцент': 'Accent', 'Анимации': 'Animations', 'Включены': 'On', 'Как в Windows': 'Like Windows', 'Выключены': 'Off',
    'Прятать лаунчер, пока идёт игра': 'Hide the launcher while playing', 'Звуки интерфейса': 'Interface sounds',
    'Память': 'Memory', 'Java': 'Java', 'Путь к java (пусто = скачать автоматически)': 'Path to java (empty = download automatically)', 'авто ♡': 'auto ♡',
    'Доп. аргументы JVM': 'Extra JVM arguments', 'CurseForge': 'CurseForge', 'Личный API-ключ (без него CurseForge не пускает лаунчеры)': 'Personal API key (CurseForge doesn’t let launchers in without it)',
    'Получить бесплатно:': 'Get one for free:', '→ API keys. Modrinth работает без ключа.': '→ API keys. Modrinth works without a key.',
    'Фон и котик': 'Background & kitty', 'Выбрать картинку': 'Choose image', 'Убрать': 'Remove', 'Аксессуар котика': 'Kitty accessory',
    'Без': 'None', 'Бантик': 'Bow', 'Наушники': 'Headphones', 'Шапочка': 'Beanie',
    'Сезонное оформление (наряды, снег, фразы)': 'Seasonal decorations (outfits, snow, phrases)', 'Свои фразы котика — по одной в строке': 'Your own kitty phrases — one per line',
    'Загрузки': 'Downloads', 'Откуда качать файлы игры, Forge и Fabric': 'Where to download game files, Forge and Fabric from',
    'Авто': 'Auto', 'Только официальные': 'Official only', 'Сначала зеркало': 'Mirror first',
    'Место на диске': 'Disk space', 'Посчитать': 'Calculate', 'Очистить неиспользуемое': 'Clean up unused', 'Нечего чистить ♡': 'Nothing to clean ♡',
    'Посмотри, сколько занимают Java, версии и ресурсы игры, и убери то, что не нужно ни одной сборке.': 'See how much space Java, game versions and assets take, and remove what no instance needs.',
    'Java': 'Java', 'Версии игры и загрузчики': 'Game versions and loaders', 'Библиотеки': 'Libraries', 'Ресурсы игры (звуки, языки)': 'Game assets (sounds, languages)',
    'Установщики и временные файлы': 'Installers and temp files', 'всё нужно': 'all in use',
    'Обновления': 'Updates', 'Версия лаунчера:': 'Launcher version:', 'Проверить обновления': 'Check for updates', 'Файлы': 'Files', 'Открыть папку лаунчера': 'Open launcher folder',
    'Проверять и скачивать обновления лаунчера в фоне': 'Check for and download launcher updates in the background',
    'Если выключено, проверяй обновления вручную. Уже отправленный запрос отменить задним числом нельзя.': 'When disabled, check for updates manually. Requests already sent cannot be undone.',
    'Приватность и сетевые функции': 'Privacy and network features',
    'Фоновые проверки выключены. Можно проверить обновления вручную.': 'Background checks are off. You can check for updates manually.',
    'Показывать игру в Discord': 'Show my game in Discord', 'Не показывать адрес сервера': 'Hide the server address',
    'Друзья увидят сборку, версию и время в игре. Нужна программа Discord на компьютере (не браузер).': 'Friends will see the instance, version and play time. Needs the Discord app on this PC (not the browser).',
    'Активность Discord появится в следующей версии лаунчера ♡': 'Discord activity is coming in the next launcher version ♡',
    'Что нового ✨': 'What’s new ✨',
    'Язык': 'Language', 'Язык / Language': 'Language / Язык', 'Русский': 'Русский',
    'ты сегодня очень милый 😳\nпойдём строить домик?': 'you look very cute today 😳\nlet’s build a little house?',
    '«Авто»: сначала официальные серверы, а если они тормозят или недоступны — зеркало BMCLAPI. Файлы с зеркала проверяются по хэшам, но само зеркало — сторонний сервис.':
      '“Auto”: official servers first, and if they’re slow or down — the BMCLAPI mirror. Mirror files are checked by hash, but the mirror itself is a third-party service.',
    // сборка: создание и подробности
    'Новая сборка 🎀': 'New instance 🎀', 'Изменить сборку 🎀': 'Edit instance 🎀', 'Название': 'Name', 'Моя милая сборка': 'My cute instance',
    'Группа (необязательно) — сборки с одной группой показываются вместе': 'Group (optional) — instances with the same group are shown together', 'например, С друзьями': 'e.g. With friends',
    'Версия Minecraft': 'Minecraft version', 'снапшоты': 'snapshots', 'Загружаю версии…': 'Loading versions…', 'Загрузчик модов': 'Mod loader', 'Ванилла': 'Vanilla',
    'Иконка': 'Icon', 'Дополнительно: память, окно, Java': 'Advanced: memory, window, Java', 'Память для этой сборки, МБ (пусто — из настроек)': 'Memory for this instance, MB (empty — from settings)',
    'Размер окна игры (пусто — как обычно)': 'Game window size (empty — default)', 'ширина': 'width', 'высота': 'height', 'во весь экран': 'fullscreen',
    'Своя Java для этой сборки (пусто — общая)': 'Custom Java for this instance (empty — shared)', 'Доп. аргументы JVM для этой сборки': 'Extra JVM arguments for this instance',
    'Отмена': 'Cancel', 'Сохранить': 'Save', 'Создать ♡': 'Create ♡', 'Удалить сборку? 🥺': 'Delete instance? 🥺', 'Оставить': 'Keep', 'Удалить навсегда': 'Delete forever',
    'Миры': 'Worlds', 'Скриншоты': 'Screenshots', 'Серверы': 'Servers', 'Ещё': 'More', 'Закрыть': 'Close', 'Резервная копия': 'Backup', 'Открыть папку миров': 'Open worlds folder',
    'Миров пока нет — создай первый в игре ♡': 'No worlds yet — create one in the game ♡', 'Скриншотов нет — в игре нажми F2 ♡': 'No screenshots — press F2 in the game ♡',
    'Серверов пока нет — добавь адрес ниже ♡': 'No servers yet — add an address below ♡', 'Зайти': 'Join', 'адрес, например play.example.ru': 'address, e.g. play.example.org',
    'С оффлайн-аккаунтом можно зайти только на серверы без проверки лицензии (online-mode=false).': 'With an offline account you can only join servers without license checks (online-mode=false).',
    'Экспорт в .mrpack': 'Export to .mrpack', 'Сделать копию': 'Duplicate', 'Обновить моды': 'Update mods', 'Проверить обновление': 'Check for update',
    'Экспорт: моды с Modrinth попадут в файл ссылками (он будет лёгким), остальные — внутрь. Миры в экспорт не входят. Файл можно отправить другу — он импортирует его кнопкой «Импорт».':
      'Export: Modrinth mods are stored as links (the file stays small), the rest go inside. Worlds are not included. Send the file to a friend — they import it with “Import”.',
    'При обновлении миры, скриншоты, твои моды и настройки игры (options.txt, серверы) остаются; файлы модпака заменяются новыми.':
      'Updating keeps your worlds, screenshots, your own mods and game settings (options.txt, servers); the modpack’s files are replaced with new ones.',
    'Миры, скриншоты, серверы, экспорт': 'Worlds, screenshots, servers, export', 'Открыть папку (моды, миры)': 'Open folder (mods, worlds)', 'Изменить': 'Edit',
    'Импорт сборки 📦': 'Import instance 📦', 'Выбрать файл .mrpack / .zip': 'Choose a .mrpack / .zip file', 'Папка сборки Prism / MultiMC': 'Prism / MultiMC instance folder',
    'Модпак из файла (.mrpack с Modrinth или zip с CurseForge) или сборка из Prism Launcher / MultiMC.': 'A modpack file (.mrpack from Modrinth or zip from CurseForge) or an instance from Prism Launcher / MultiMC.',
    'Обновления модов ✨': 'Mod updates ✨', 'Позже': 'Later', 'Обновить': 'Update',
    // вылеты и проверка сборки
    'Игра вылетела 🥺': 'The game crashed 🥺', 'Открыть отчёт': 'Open report', 'Открыть настройки': 'Open settings', 'Поставить Fabric API': 'Install Fabric API',
    'Подожди, в сборке проблемы 🥺': 'Wait, this instance has problems 🥺', 'Не запускать': 'Don’t launch', 'Запустить всё равно': 'Launch anyway', 'Запустить': 'Launch',
    'Поставить недостающее': 'Install missing', 'Выключить лишний': 'Disable the extra copy', 'вместе игра не запустится': 'the game won’t start with both', 'возможны глюки': 'may glitch',
    'Игре не хватило памяти.': 'The game ran out of memory.', 'Java не смогла выделить столько памяти.': 'Java couldn’t allocate that much memory.',
    'Неподходящая версия Java.': 'Wrong Java version.', 'Модам нужен Fabric API, а его нет или он не той версии.': 'Mods need Fabric API, but it’s missing or the wrong version.',
    'Набор модов несовместим (Fabric/Quilt).': 'The mod set is incompatible (Fabric/Quilt).', 'Каким-то модам не хватает других модов (Forge/NeoForge).': 'Some mods are missing other mods (Forge/NeoForge).',
    'Один и тот же мод установлен дважды.': 'The same mod is installed twice.', 'Проблема с видеокартой или её драйвером.': 'A graphics card or driver problem.',
    'Java аварийно упала (ошибка драйвера или нативной библиотеки).': 'Java crashed (a driver or native library error).', 'Мод несовместим с этой версией игры или загрузчика.': 'A mod is incompatible with this game or loader version.',
    'Игра аварийно упала в нативном коде (ошибка доступа к памяти).': 'The game crashed in native code (memory access violation).',
    'Обнови драйвер видеокарты.': 'Update your graphics driver.', 'Подробности — в отчёте о вылете.': 'Details are in the crash report.', 'Подробности — во вкладке «Консоль».': 'Details are in the “Console” tab.',
    'Если недавно ставил моды, попробуй выключить последние добавленные.': 'If you added mods recently, try disabling the latest ones.',
    'Увеличь память для этой сборки (✏️ на карточке) или в Настройках — для модпаков обычно нужно 4–8 ГБ.': 'Give this instance more memory (✏️ on its card) or in Settings — modpacks usually need 4–8 GB.',
    'Уменьши память в настройках — указано больше, чем есть свободной ОЗУ.': 'Lower the memory in settings — it’s set higher than your free RAM.',
    'Очисти поле «Путь к java» в Настройках — лаунчер сам скачает правильную Java для этой версии игры.': 'Clear the “Path to java” field in Settings — the launcher will download the right Java itself.',
    'Обновить драйвер видеокарты с сайта NVIDIA/AMD/Intel. На ноутбуке проверь, что игра запускается на дискретной видеокарте.': 'Update your graphics driver from NVIDIA/AMD/Intel. On a laptop, make sure the game runs on the discrete GPU.',
    'Обнови драйвер видеокарты с сайта NVIDIA/AMD/Intel. На ноутбуке проверь, что игра запускается на дискретной видеокарте.': 'Update your graphics driver from NVIDIA/AMD/Intel. On a laptop, make sure the game runs on the discrete GPU.',
    'Чаще всего виноват драйвер видеокарты или мод с нативным кодом. Обнови драйвер, попробуй без шейдеров.': 'Usually it’s the graphics driver or a mod with native code. Update the driver, try without shaders.',
    'Проверь, что все моды подходят под версию сборки, и обнови их.': 'Make sure all mods match the instance version, and update them.',
    'Мод несовместим с этой версией игры или с другим модом. Попробуй обновить моды или выключить последний добавленный.': 'A mod is incompatible with this game version or another mod. Try updating mods or disabling the last one you added.',
    'Открой «Моды» → «Установленные» и удали лишнюю копию.': 'Open “Mods” → “Installed” and remove the extra copy.',
    'Обычно помогает обновить моды (вкладка «Моды» → «Проверить обновления») или убрать мод из списка выше.': 'Updating mods (“Mods” → “Updates”) or removing a mod from the list above usually helps.',
    'Выключи оверлеи, которые встраиваются в игры: Discord, MSI Afterburner / RivaTuner, OBS, GeForce Experience.': 'Turn off in-game overlays: Discord, MSI Afterburner / RivaTuner, OBS, GeForce Experience.',
    'Если ставил свою Java в настройках — очисти поле, лаунчер скачает подходящую сам.': 'If you set your own Java in settings — clear the field, the launcher will download a suitable one.',
    // моды
    'Модов пока нет… поищем на Modrinth? :3': 'No mods yet… shall we look on Modrinth? :3', 'Ресурспаков пока нет… поищем на Modrinth? :3': 'No resource packs yet… shall we look on Modrinth? :3',
    'Шейдеров пока нет… поищем на Modrinth? :3': 'No shaders yet… shall we look on Modrinth? :3', 'Ничего не нашлось': 'Nothing found', 'Ничего не нашлось 🥺': 'Nothing found 🥺',
    'Не получилось загрузить 🥺': 'Couldn’t load 🥺', 'Сначала создай сборку — всё ставится в неё ♡': 'Create an instance first — everything goes into it ♡',
    'Модпак установится как новая сборка. Forge и NeoForge доустановятся при первом запуске (1–3 минуты).': 'A modpack installs as a new instance. Forge and NeoForge finish installing on first launch (1–3 minutes).',
    'Вместе с шейдером лаунчер сам поставит Iris (или Oculus для Forge) — если их ещё нет.': 'With a shader the launcher also installs Iris (or Oculus for Forge) if missing.',
    'Это ванильная сборка — моды не загрузятся, пока не выберешь загрузчик (Fabric, Quilt, Forge или NeoForge) в настройках сборки.': 'This is a vanilla instance — mods won’t load until you pick a loader (Fabric, Quilt, Forge or NeoForge) in its settings.',
    'Все моды свежие ♡': 'All mods are up to date ♡', 'Всё уже стоит ♡': 'Everything’s already installed ♡', 'Fabric включён ♡': 'Fabric enabled ♡',
    'Сними галочки с тех, что обновлять не нужно.': 'Uncheck the ones you don’t want to update.',
    // скины
    'Скин виден тебе в игре. На серверах его увидят только там, где стоит SkinsRestorer.': 'You see the skin in game. Others on a server see it only if it runs SkinsRestorer.',
    'Сейчас стандартный скин. Нарисуй свой, загрузи PNG или возьми скин по нику ♡': 'Default skin for now. Draw your own, upload a PNG or grab one by nickname ♡',
    'Скин и плащ лицензии меняются прямо здесь — их увидят все игроки.': 'Change your licensed skin and cape right here — everyone will see them.',
    'Пресет…': 'Preset…', 'Скин по нику…': 'Skin by nickname…', 'Взять': 'Get', 'Сохранить PNG на компьютер': 'Save PNG to computer',
    'Карандаш (B)': 'Pencil (B)', 'Ластик (E, правая кнопка мыши)': 'Eraser (E, right mouse button)', 'Заливка грани (G)': 'Fill face (G)', 'Пипетка (I)': 'Picker (I)',
    'Оба слоя': 'Both layers', 'Основной': 'Base', 'Второй': 'Overlay', 'Рисовать на обоих слоях': 'Draw on both layers', 'Только основной слой': 'Base layer only',
    'Только второй слой (шапка, куртка…)': 'Overlay layer only (hat, jacket…)', 'Отменить (Ctrl+Z)': 'Undo (Ctrl+Z)', 'Повторить (Ctrl+Y)': 'Redo (Ctrl+Y)', 'сетка': 'grid',
    'Наведи на текстуру — подскажу, что за часть тела ♡': 'Hover over the texture — I’ll tell you which body part it is ♡', 'Эта область игрой не используется': 'This area isn’t used by the game',
    'Slim (тонкие руки)': 'Slim (thin arms)', 'Сохранить скин ♡': 'Save skin ♡', 'Фембой': 'Femboy', 'Бойкиссер': 'Boykisser', 'Чистый лист': 'Blank',
    'Голова': 'Head', 'Шапка': 'Hat', 'Тело': 'Body', 'Куртка': 'Jacket', 'Правая рука': 'Right arm', 'Правый рукав': 'Right sleeve', 'Левая рука': 'Left arm', 'Левый рукав': 'Left sleeve',
    'Правая нога': 'Right leg', 'Правая штанина': 'Right pant', 'Левая нога': 'Left leg', 'Левая штанина': 'Left pant',
    // мастер, перетаскивание, разное
    'Шаг 1 из 2': 'Step 1 of 2', 'Шаг 2 из 2': 'Step 2 of 2', 'Привет! Давай знакомиться ♡': 'Hi! Let’s get to know each other ♡', 'Придумай ник для игры': 'Pick a nickname',
    'например, PinkCat_': 'e.g. PinkCat_', '— или —': '— or —', 'Войти через Microsoft (лицензия)': 'Sign in with Microsoft (license)', 'Пропустить': 'Skip', 'Дальше': 'Next',
    'Первая сборка 🎀': 'First instance 🎀', 'Какую сборку хочешь?': 'What kind of instance?', 'Обычный Minecraft': 'Plain Minecraft', 'С модами (Fabric)': 'With mods (Fabric)',
    'Сразу поставить моды для FPS (Sodium и др.)': 'Install FPS mods right away (Sodium etc.)', 'Готово ♡': 'Done ♡',
    'Отпусти — я всё разложу ♡': 'Drop it — I’ll sort everything out ♡', 'Моды .jar, ресурспаки и шейдеры .zip, модпаки .mrpack, скины .png': 'Mods .jar, resource packs and shaders .zip, modpacks .mrpack, skins .png',
    'Погладить': 'Pet me', 'Свернуть': 'Minimize', 'Развернуть': 'Maximize', 'Светлая / тёмная тема': 'Light / dark theme',
    'Готовлюсь…': 'Getting ready…', 'Проверяю аккаунт…': 'Checking account…', 'Ищу подходящую Java…': 'Finding the right Java…', 'Проверяю файлы игры…': 'Checking game files…',
    'Проверяю библиотеки и ресурсы…': 'Checking libraries and assets…', 'Подключаю скин…': 'Attaching skin…', 'Запускаю игру…': 'Starting the game…', 'Получаю список модов…': 'Fetching the mod list…',
    'Распаковываю настройки модпака…': 'Unpacking modpack settings…', 'Ищу подходящую версию модпака…': 'Finding a suitable modpack version…', 'Копирую файлы сборки…': 'Copying instance files…',
    'Добавляю настройки…': 'Adding settings…', 'Сохраняю архив…': 'Saving archive…', 'Собираю список модов, ресурспаков и шейдеров…': 'Collecting mods, resource packs and shaders…',
    'Проверяю…': 'Checking…', 'Обновляю…': 'Updating…', 'Копирую…': 'Copying…', 'Готово ✓': 'Done ✓', 'Не вышло 🥺': 'Didn’t work 🥺', 'Жду вход в окне…': 'Waiting for sign-in…',
    'Игра запущена, приятной игры ✧': 'Game started, have fun ✧', 'Лог скопирован ✧': 'Log copied ✧', 'Сохранено ✧': 'Saved ✧', 'Сборка удалена': 'Instance deleted', 'Мир удалён': 'World deleted',
    'Ключ CurseForge сохранён ✧': 'CurseForge key saved ✧', 'Стандартный скин возвращён': 'Default skin restored', 'Плащ обновлён ♡': 'Cape updated ♡',
    'Скин сохранён ♡ Он появится при следующем запуске игры': 'Skin saved ♡ It shows up next time you start the game', 'Скин лицензии обновлён — его увидят все ♡': 'Licensed skin updated — everyone will see it ♡',
    'Сборка в порядке ♡ Запускаю': 'Instance looks fine ♡ Launching', 'Мод выключен — его можно включить обратно во вкладке «Моды»': 'Mod disabled — you can turn it back on in “Mods”',
    'Это последняя версия модпака ♡': 'This is the latest modpack version ♡', 'Обновлять нечего ♡': 'Nothing to update ♡', 'Последняя версия ✓ Проверить ещё': 'Latest version ✓ Check again',
    'Выйти без сохранения?': 'Leave without saving?', 'Выбери версию': 'Pick a version', 'Сначала создай сборку ♡': 'Create an instance first ♡',
    'Добавь аккаунт, чтобы играть ♡': 'Add an account to play ♡', 'Добавь аккаунт, чтобы поставить скин ♡': 'Add an account to set a skin ♡', 'Сначала закрой игру': 'Close the game first',
    'Ник: 3–16 символов, латиница, цифры и _': 'Nickname: 3–16 characters, Latin letters, digits and _', 'Только A–Z, 0–9 и _, от 3 до 16 символов': 'Only A–Z, 0–9 and _, 3 to 16 characters',
    'Адрес вида play.example.ru или 1.2.3.4:25565': 'Address like play.example.org or 1.2.3.4:25565', 'Нет связи с серверами Mojang': 'Can’t reach Mojang servers',
    'Оптимизация ставит моды — включи в сборке Fabric или другой загрузчик': 'Optimization installs mods — enable Fabric or another loader in the instance',
    'Запущено из исходников — обновления проверяются только в установленной версии.': 'Running from source — updates are only checked in the installed version.',
    'Лаунчер сам проверяет обновления при запуске и каждые 2 часа.': 'The launcher checks for updates on start and every 2 hours.', 'Проверяю': 'Checking', 'У тебя последняя версия ♡': 'You have the latest version ♡',
    'Обновления работают только в установленной версии': 'Updates only work in the installed version', 'Обновление ещё не скачано': 'The update hasn’t downloaded yet',
    'Сначала закрой игру — обновление поставится после этого': 'Close the game first — the update will install after that',
    'Сначала закрой игру — сейчас эти файлы могут использоваться': 'Close the game first — these files may be in use',
    'Окно входа закрыто': 'Sign-in window closed', 'На этом аккаунте нет купленного Minecraft Java Edition': 'This account doesn’t own Minecraft Java Edition',
    'Проблема с Xbox-профилем (нужен Xbox-аккаунт / возрастные ограничения)': 'Xbox profile problem (an Xbox account is needed / age restrictions)',
    'Для CurseForge нужен API-ключ — добавь его в Настройках': 'CurseForge needs an API key — add it in Settings', 'Это не PNG-картинка': 'This isn’t a PNG image',
    'Ожидалась PNG-картинка': 'A PNG image was expected', 'Файл скина слишком большой': 'The skin file is too big', 'Картинка больше 25 МБ — выбери поменьше': 'The image is over 25 MB — choose a smaller one',
    'Сборка не найдена': 'Instance not found', 'Аккаунт не найден': 'Account not found', 'Мир не найден': 'World not found', 'Эта сборка уже запущена': 'This instance is already running',
    'Сначала добавь аккаунт ♡': 'Add an account first ♡', 'Игра не запустилась — подробности во вкладке «Консоль»': 'The game didn’t start — see the “Console” tab',
    'Сборка сделана не из модпака с Modrinth/CurseForge': 'This instance wasn’t made from a Modrinth/CurseForge modpack',
    'Не понимаю этот файл: нужен .mrpack, zip модпака CurseForge или экспорт Prism/MultiMC': 'Can’t read this file: need a .mrpack, a CurseForge modpack zip or a Prism/MultiMC export',
    'Это не модпак Modrinth (нет modrinth.index.json)': 'Not a Modrinth modpack (no modrinth.index.json)', 'Это не модпак CurseForge (нет manifest.json)': 'Not a CurseForge modpack (no manifest.json)',
    'В модпаке не указана версия Minecraft': 'The modpack doesn’t specify a Minecraft version', 'Скин лицензии меняется на minecraft.net': 'A licensed skin is changed on minecraft.net',
    'Модпак Modrinth': 'Modrinth modpack', 'Модпаки (.mrpack, .zip)': 'Modpacks (.mrpack, .zip)', 'Экспорт сборки': 'Export instance', 'Импорт сборки': 'Import instance', 'Картинка для фона': 'Background image', 'Картинки': 'Images',
    'Розовый': 'Pink', 'Лавандовый': 'Lavender', 'Голубой': 'Sky', 'Мятный': 'Mint', 'Свой цвет': 'Custom color', 'Сортировка': 'Sorting', 'Категория': 'Category',
    'Открыть папку': 'Open folder', 'Проверить обновления модов': 'Check mod updates', 'Поставить моды для FPS: Sodium, Lithium, FerriteCore…': 'Install FPS mods: Sodium, Lithium, FerriteCore…',
    'Импорт .mrpack, zip CurseForge или сборки Prism': 'Import a .mrpack, CurseForge zip or Prism instance',
    // котик
    'ты ведь любишь майнкрафт, да? 😳': 'you love minecraft, don’t you? 😳', 'поставь мне модов :3': 'install me some mods :3', 'я слежу за твоими сборками 👀': 'i’m watching your instances 👀',
    'мяу~ ♡': 'meow~ ♡', 'не забудь Fabric API!': 'don’t forget Fabric API!', 'ещё одну катку? ♡': 'one more round? ♡', 'гладь ещё 😳': 'pet me more 😳', 'sodium — это база': 'sodium is the basics',
    'шейдеры? шейдеры! ✨': 'shaders? shaders! ✨', 'кошелёк или жизнь? 🎃': 'trick or treat? 🎃', 'я страшный ведьмак 😳🧙': 'i’m a spooky warlock 😳🧙', 'бу! испугался? :3': 'boo! scared? :3',
    'с наступающим! 🎄': 'happy new year! 🎄', 'хочу мандаринку 🍊': 'i want a tangerine 🍊', 'загадал желание… про тебя 😳': 'made a wish… about you 😳',
    'ты мне нравишься 😳💖': 'i like you 😳💖', 'держи сердечко ♡': 'here’s a heart ♡', 'будешь моим валентинкой? :3': 'will you be my valentine? :3',
    'уже ночь… иди спать 😳': 'it’s night… go to sleep 😳', 'ну ещё одну катку и спать, да? 🌙': 'one more round and then bed, ok? 🌙', 'зеваю… *мяу* 💤': 'yawn… *meow* 💤',
    'доброе утро ☀️': 'good morning ☀️', 'утречко! кофе и майнкрафт? ☕': 'morning! coffee and minecraft? ☕', 'привет! поиграем? :3': 'hi! shall we play? :3',
    'хороший денёк для стройки ⛏️': 'nice day for building ⛏️', 'добрый вечер ✨': 'good evening ✨', 'вечерняя катка? 😳': 'evening round? 😳',
    'поздно уже… но я с тобой ♡': 'it’s late… but i’m with you ♡', 'ночной майнкрафт — самый уютный 🌙': 'night minecraft is the coziest 🌙', 'zzz… 💤': 'zzz… 💤',
    'запускаю… 😳': 'launching… 😳', 'удачи в игре ♡': 'have fun ♡', 'ой… загляни в консоль 🥺': 'oops… check the console 🥺', 'ой… игра упала 🥺': 'oops… the game crashed 🥺',
    'ой… что-то пошло не так 🥺': 'oops… something went wrong 🥺', 'ещё модик! :3': 'one more mod! :3', 'вкусно 😳': 'tasty 😳', 'ставь ещё ♡': 'install more ♡',
    'качаю модпак, подожди чуть-чуть ♡': 'downloading the modpack, wait a bit ♡', 'модпак готов! играем? 😳': 'the modpack is ready! play? 😳', 'новая сборка! поставим моды? :3': 'new instance! add some mods? :3',
    'какой милый скин 😳': 'what a cute skin 😳', 'мне идёт? 😳': 'does it suit me? 😳', 'запомнил ♡': 'remembered ♡', 'стало просторнее ✨': 'more room now ✨', 'ускоряю игру ⚡': 'speeding the game up ⚡',
    'ищу обновления модов 👀': 'looking for mod updates 👀', 'раскладываю файлы ♡': 'sorting the files ♡', 'распаковываю сборку ♡': 'unpacking the instance ♡',
    'обновляю модпак, миры не трогаю ♡': 'updating the modpack, not touching worlds ♡', 'всё готово! жми «Играть» ♡': 'all set! hit “Play” ♡',
    'сейчас вернусь уже обновлённым ♡': 'be right back, updated ♡', 'я обновился! ну почти… перезапусти меня ♡': 'i updated! well, almost… restart me ♡',
    'Не получилось 🥺': 'Didn’t work 🥺', 'Нет сборок': 'No instances', 'Редактор скина 🎨': 'Skin editor 🎨', 'Вход в Microsoft ♡': 'Microsoft sign-in ♡',
    'Можно открывать только файлы лаунчера': 'Only launcher files can be opened', 'Сначала проверь обновления': 'Check for updates first',
    'Некорректный id сборки': 'Invalid instance id', 'Некорректное имя мира': 'Invalid world name', 'Некорректное имя файла': 'Invalid file name',
    'в архиве нет java': 'no java in the archive', 'Не удалось открыть картинку': 'Couldn’t open the image', 'Это не Microsoft-аккаунт': 'This isn’t a Microsoft account',
    'Ник: 3–16 символов, только латиница, цифры и _': 'Nickname: 3–16 characters, Latin letters, digits and _ only', 'Ник: 2–16 символов, латиница, цифры и _': 'Nickname: 2–16 characters, Latin letters, digits and _',
    'у игрока стандартный скин': 'this player has the default skin', 'Этот Forge слишком старый (поддерживается 1.12.2 и новее)': 'This Forge is too old (1.12.2 and newer are supported)',
    'В сборке Prism не указана версия Minecraft': 'The Prism instance doesn’t specify a Minecraft version', 'нет ответа': 'no response', 'непонятный ответ': 'unexpected response', 'нет связи': 'no connection',
    'Mojang просит подождать — слишком много смен скина подряд, попробуй через минуту': 'Mojang asks to wait — too many skin changes in a row, try again in a minute',
    'скачивается сама, когда понадобится': 'downloads itself when needed', 'это папка, но не сборка Prism/MultiMC': 'this is a folder, but not a Prism/MultiMC instance',
    'сначала создай сборку — файл некуда положить': 'create an instance first — there’s nowhere to put the file', 'это не мод Fabric, Quilt, Forge или NeoForge': 'this isn’t a Fabric, Quilt, Forge or NeoForge mod',
    'не понял, что это за архив — не ресурспак, не шейдер и не модпак': 'couldn’t tell what this archive is — not a resource pack, shader or modpack',
    'CurseForge пускает лаунчеры только с личным API-ключом. Добавь его в': 'CurseForge only lets launchers in with a personal API key. Add it in', 'Настройках': 'Settings',
    '— это бесплатно. А Modrinth работает сразу ♡': '— it’s free. Modrinth works right away ♡',
    'Сначала создай сборку ♡ Моды ставятся в неё': 'Create an instance first ♡ Mods go into it',
  };
  // Подсказка про поиск CurseForge длинная и собирается из кусков — переводим её по частям
  Object.assign(D, {
    'Твой ключ CurseForge рабочий, но поиск CurseForge открывает только одобренным лаунчерам. Установка при этом работает: открой мод или модпак на curseforge.com, скопируй':
      'Your CurseForge key works, but CurseForge only opens search to approved launchers. Installing still works: open a mod or modpack on curseforge.com, copy the',
    '(он справа на странице) и вставь его в поле поиска ♡': '(it’s on the right of the page) and paste it into the search box ♡',
    'Вставь Project ID, например': 'Paste a Project ID, e.g.', '— это JEI': '— that’s JEI',
  });
  const D2 = {
    'Открыть лаунчер': 'Open launcher', 'Закрыть все игры': 'Close all games', 'Выйти из лаунчера': 'Quit launcher',
    // перенос из других лаунчеров
    'Из других лаунчеров: TLauncher, Prism, CurseForge…': 'From other launchers: TLauncher, Prism, CurseForge…',
    'Перенос из других лаунчеров 🧳': 'Move from other launchers 🧳',
    'Ищу TLauncher, Minecraft, Prism, CurseForge, Modrinth и другие…': 'Looking for TLauncher, Minecraft, Prism, CurseForge, Modrinth and others…',
    'Других лаунчеров не нашла 🥺': 'No other launchers found 🥺',
    'Ищу TLauncher и официальный Minecraft, Prism, PolyMC, CurseForge, Modrinth App, ATLauncher и GDLauncher.': 'I look for TLauncher and the official Minecraft launcher, Prism, PolyMC, CurseForge, Modrinth App, ATLauncher and GDLauncher.',
    'Отметь, что забрать. Старые лаунчеры при этом не меняются — всё копируется к нам. Большие миры и сборки можно не копировать, а использовать':
      'Tick what to bring over. Your old launchers stay untouched — everything is copied here. Big worlds and instances can be used',
    'на месте': 'in place',
    ': место не тратится, но данные остаются общими со старым лаунчером.': ' instead: no extra disk space, but the data stays shared with the old launcher.',
    'Миры, паки и настройки отсюда попадут в новую сборку. Версия игры:': 'Worlds, packs and settings from here go into a new instance. Game version:',
    'Версию не получилось узнать точно — проверь': 'Couldn’t tell the version for sure — please check',
    'Не копировать, а использовать папку старого лаунчера': 'Don’t copy, use the old launcher’s folder',
    'Серверы и настройки игры': 'Servers and game settings', 'Перенести ♡': 'Move ♡', 'Ничего не выбрано': 'Nothing selected',
    'переношу твои миры ♡': 'moving your worlds ♡', 'всё переехало! теперь всё в одном месте ♡': 'everything moved! now it’s all in one place ♡',
    'Освободить место 🧹': 'Free up space 🧹', 'Освобождать нечего ♡': 'Nothing to free up ♡', 'освобождать нечего': 'nothing to free up',
    'Здесь появятся старые копии того, что ты перенесёшь из других лаунчеров.': 'Old copies of what you move from other launchers will show up here.',
    'Это старые копии того, что уже перенесено в Femboy Launcher. Отмеченное уйдёт в': 'These are old copies of what’s already in Femboy Launcher. Ticked items go to the',
    'Корзину': 'Recycle Bin',
    '— передумаешь, восстановишь оттуда. Программу лаунчера удаляет его собственная программа удаления — ты увидишь её окно.':
      '— change your mind and restore them from there. A launcher itself is removed by its own uninstaller — you’ll see its window.',
    'менялось в старом лаунчере после переноса — не трогаю': 'changed in the old launcher after moving — leaving it',
    'используется на месте — не трогаю': 'used in place — leaving it', 'нашей копии больше нет — не трогаю': 'our copy is gone — leaving it',
    'у нас ещё не запускалось — сначала проверь, что всё работает': 'not played here yet — check that it works first', 'уже перенесено': 'already moved',
    'Убрать отмеченное в Корзину': 'Move ticked to Recycle Bin', 'Открыть «Приложения» Windows': 'Open Windows “Apps”', 'Отметь, что убрать': 'Tick what to remove',
    'Перенос удался ♡': 'The move worked ♡', 'Сборка из старого лаунчера работает и у нас': 'The instance from your old launcher works here too',
    'Старые копии всё ещё лежат в папках прежних лаунчеров и занимают место. Посмотреть, что можно убрать? Ничего не удалится без твоего подтверждения.':
      'Old copies are still in your previous launchers’ folders, taking up space. See what can be removed? Nothing is deleted without your OK.',
    'Не сейчас': 'Not now', 'Посмотреть': 'Show me', 'Назад': 'Back',
    'Другие лаунчеры': 'Other launchers', 'Перенести…': 'Move…', 'Освободить место': 'Free up space',
    'Перенеси миры, сборки и паки из TLauncher, Prism, CurseForge и других, а потом, если захочешь, освободи место от старых копий.':
      'Bring worlds, instances and packs over from TLauncher, Prism, CurseForge and others, then free up space from the old copies if you like.',
    'Нашла твои старые лаунчеры ♡': 'Found your old launchers ♡',
    'Могу перенести сюда сборки, миры и паки — будет всё в одном месте. Старые лаунчеры при этом не меняются.': 'I can bring instances, worlds and packs here — all in one place. Your old launchers stay untouched.',
    'Нет, сделать новую сборку': 'No, make a new instance', 'Выбрать, что перенести': 'Choose what to move', 'паки и настройки': 'packs and settings',
    'Выбери версию игры для сборки из .minecraft': 'Choose a game version for the .minecraft instance',
    'Не нашла программу удаления — удали её в «Параметры → Приложения»': 'Couldn’t find the uninstaller — remove it in “Settings → Apps”',
    // достижения и наряды
    'Достижения котика': 'Kitty achievements', 'Некоторые дарят котику новый наряд ♡': 'Some give the kitty a new outfit ♡',
    'Первая катка': 'First match', 'Час в кубах': 'An hour in blocks', 'Залипательно': 'Hooked', 'Королевский стаж': 'Royal veteran', 'Модпакер': 'Modpacker',
    'Коллекционер': 'Collector', 'Мододел': 'Modder', 'Ночная смена': 'Night shift', 'Вместе веселее': 'Better together', 'Запасливый': 'Prepared', 'Переезд': 'Moving day',
    'Делись с друзьями': 'Sharing is caring', 'Запусти игру': 'Launch the game', 'Наиграй 1 час': 'Play for 1 hour', 'Наиграй 10 часов': 'Play for 10 hours', 'Наиграй 50 часов': 'Play for 50 hours',
    'Поставь модпак с Modrinth или CurseForge': 'Install a modpack from Modrinth or CurseForge', 'Собери 5 сборок': 'Have 5 instances',
    'Поставь 50 модов (во всех сборках вместе)': 'Install 50 mods (across all instances)', 'Запусти игру между полуночью и пятью утра': 'Launch the game between midnight and 5 am',
    'Открой мир другу кнопкой «Играть с другом»': 'Open a world to a friend with “Play with a friend”', 'Сохрани копию мира': 'Back up a world',
    'Перенеси что-нибудь из другого лаунчера': 'Move something over from another launcher', 'Поделись сборкой': 'Share an instance',
    'Сердечные очки': 'Heart glasses', 'Корона': 'Crown', 'Цветочный венок': 'Flower crown', 'Шарфик': 'Scarf', 'Очки': 'Glasses', 'Венок': 'Flower crown',
    'у меня новый наряд! примеришь в настройках? 😳': 'I got a new outfit! try it on in settings? 😳', 'ура, достижение! ✨': 'yay, an achievement! ✨',
    // копии миров
    'Копии миров': 'World backups', 'Сохранять копию мира после игры': 'Back up worlds after playing', 'Каждый раз': 'Every time', 'Раз в день': 'Once a day', 'Не нужно': 'Never',
    'Сколько автокопий каждого мира хранить': 'Auto backups to keep per world',
    'Копии лежат в папке сборки, восстановить их можно в окне сборки на вкладке «Миры». Твои ручные копии лаунчер не удаляет.':
      'Backups live in the instance folder; restore them on the “Worlds” tab of the instance. Your manual backups are never deleted.',
    'Восстановить': 'Restore', 'Открыть папку копий': 'Open backups folder', 'Некорректное имя копии': 'Invalid backup name', 'Копия не найдена': 'Backup not found',
    // синхронизация
    'Синхронизация': 'Sync', 'Выбрать папку облака…': 'Choose cloud folder…', 'Синхронизировать': 'Sync now', 'Выключить': 'Turn off', 'ещё не было': 'never',
    'Выбери папку облака (Яндекс.Диск, OneDrive, Google Drive) — и сборки с мирами будут одинаковыми на всех твоих компьютерах. Аккаунты туда не попадают.':
      'Pick a cloud folder (Yandex.Disk, OneDrive, Google Drive) and your instances and worlds will be the same on all your computers. Accounts are never put there.',
    'Синхронизация выключена — копия в облаке осталась': 'Sync turned off — the cloud copy stays', 'Сначала выбери папку облака': 'Choose a cloud folder first',
    'Не удалось прочитать все файлы синхронизации. Данные не удалены; проверь доступ к папкам.': 'Could not read all files for sync. No data was deleted; check access to the folders.',
    'Облако ещё обновляется: другой компьютер не закончил отдачу этой сборки. Ничего не изменено; подожди, пока программа облака закончит, и повтори. Если не проходит, запусти синхронизацию на том компьютере.':
      'The cloud is still updating: another computer has not finished uploading this instance. Nothing was changed; wait for the cloud app to finish and try again. If it does not clear up, run sync on that computer.',
    'Облако ещё обновляется: файлы в облаке не совпадают с его описанием (программа облака не докачала их или другой компьютер не закончил). Ничего не изменено; подожди, пока программа облака закончит, и повтори.':
      'The cloud is still updating: the files in the cloud do not match its description (the cloud app has not finished downloading them, or another computer has not finished). Nothing was changed; wait for the cloud app to finish and try again.',
    'Список синхронизации на этом компьютере повреждён. Ничего не удалено и не перезаписано: расхождения сохранены как конфликты.': 'The sync list on this computer is damaged. Nothing was deleted or overwritten: differences were kept as conflicts.',
    'Облако не приходило в согласованное состояние больше 30 минут, поэтому его файлы приняты как есть.': 'The cloud did not reach a consistent state for over 30 minutes, so its files were accepted as they are.',
    'сборка удалена на другом компьютере, здесь она осталась и больше не синхронизируется.': 'the instance was deleted on another computer; it stays here and is no longer synced.',
    'Синхронизация завершилась с предупреждениями ♡': 'Sync finished with warnings ♡', 'Синхронизация не удалась': 'Sync failed', 'Игру не запускаю, чтобы версии сборки не разошлись': 'Not launching the game so instance versions do not drift apart',
    'Если запустить без синхронизации, на этом компьютере сборка может оказаться старее, чем на другом. При следующей синхронизации лаунчер сохранит обе версии рядом, ничего не потеряется.':
      'If you launch without syncing, this computer may have an older version of the instance than the other one. On the next sync the launcher will keep both versions side by side; nothing will be lost.',
    'Не запускать': 'Do not launch', 'Запустить без синхронизации': 'Launch without syncing', 'Синхронизация пропущена по твоему выбору': 'Sync skipped by your choice',
    'Синхронизация завершилась с ошибками. Проверь сообщения ниже.': 'Sync finished with errors. Check the messages below.',
    // «Восстановить облако с этого компьютера» (publishLocal)
    'Восстановить облако с этого компьютера…': 'Restore the cloud from this computer…', 'Восстановить облако с этого компьютера?': 'Restore the cloud from this computer?',
    'Выход, если облако застряло на «Облако ещё обновляется»': 'A way out when the cloud is stuck on “The cloud is still updating”',
    'Восстановить облако': 'Restore the cloud',
    'Изменения, которые другой компьютер уже отдал в облако, а здесь их нет, будут заменены и на нём; они останутся в прежней облачной копии в «Корзине». Изменения, которые он ещё не отдал, не пропадут: при его следующей синхронизации они уйдут в облако, а если одно и то же изменили оба компьютера, обе версии сохранятся рядом.':
      'Changes the other computer has already uploaded but this one does not have will be replaced on it too; they stay in the previous cloud copy in “Корзина”. Changes it has not uploaded yet will not be lost: on its next sync they go to the cloud, and if both computers changed the same thing, both versions are kept side by side.',
    // «Перевести облако на новый формат» (sync.migrate)
    'Перевести облако на новый формат…': 'Move the cloud to the new format…', 'Перевести облако на новый формат?': 'Move the cloud to the new format?',
    'Нужно один раз после обновления лаунчера': 'Needed once after updating the launcher', 'Перевести': 'Move', 'Перевожу облако на новый формат…': 'Moving the cloud to the new format…',
    'Лаунчер скопирует сборки из прежней папки облака в новую («v2» в папке «Femboy Launcher Sync») и сверит их с этим компьютером. Прежняя копия останется нетронутой, в облаке понадобится ещё столько же места.':
      'The launcher will copy the instances from the previous cloud folder to a new one (“v2” inside “Femboy Launcher Sync”) and reconcile them with this computer. The previous copy stays untouched; the cloud will need the same amount of space again.',
    'Лаунчеры 0.10.2 и раньше на других компьютерах перестанут синхронизировать эти сборки — обнови лаунчер там. Их несинхронизированные изменения не пропадут: после обновления они уйдут в облако, а если одно и то же изменили оба компьютера, обе версии сохранятся рядом.':
      'Launchers 0.10.2 and older on other computers will stop syncing these instances — update the launcher there. Their unsynced changes will not be lost: after the update they go to the cloud, and if both computers changed the same thing, both versions are kept side by side.',
    'Перед переводом закрой лаунчер на других компьютерах и дождись, пока программа облака закончит синхронизацию.': 'Before moving, close the launcher on other computers and wait until the cloud app finishes syncing.',
    'Облако ещё в старом формате (лаунчер 0.10.2 и раньше), синхронизация приостановлена. Ничего не изменено; нажми «Перевести облако на новый формат…» в настройках синхронизации.':
      'The cloud is still in the old format (launcher 0.10.2 and older), sync is paused. Nothing was changed; click “Move the cloud to the new format…” in the sync settings.',
    'Прежняя копия сборки в облаке менялась во время перевода (на другом компьютере ещё работает старый лаунчер или программа облака не докачала файлы). Перевод не закончен, ничего не потеряно; закрой лаунчер на других компьютерах, подожди, пока программа облака закончит, и повтори.':
      'The previous cloud copy of the instance changed while it was being moved (an old launcher is still running on another computer, or the cloud app has not finished downloading). The move is not finished and nothing was lost; close the launcher on other computers, wait for the cloud app to finish and try again.',
    'Сборка удалена на другом компьютере: перевести её нельзя': 'The instance was deleted on another computer: it cannot be moved',
    'Сборка в корзине: сначала верни её, потом восстанавливай облако': 'The instance is in the trash: restore it first, then restore the cloud',
    'Сборка удалена на другом компьютере: восстановить для неё облако нельзя': 'The instance was deleted on another computer: the cloud cannot be restored for it',
    'Сначала дождись восстановления облака': 'Wait until the cloud is restored first',
    'Облачная копия сборки сейчас занята другой программой (например, программой облака). Ничего не изменено; подожди немного и повтори.':
      'The cloud copy of the instance is in use by another program (for example, the cloud app). Nothing was changed; wait a little and try again.',
    'Облако не восстановлено: синхронизация этой сборки сейчас невозможна': 'The cloud was not restored: this instance cannot be synced right now',
    'Сначала заверши или восстанови обновление модпака': 'Complete or recover the modpack update first',
    'Обновление этой сборки ещё выполняется': 'This instance is still being updated',
    'Не удалось прочитать журнал обновления сборки': 'Could not read the instance update journal',
    'Некорректный журнал обновления сборки': 'Invalid instance update journal',
    'Некорректные метаданные обновления сборки': 'Invalid instance update metadata',
    'Файл обновления занят папкой или ссылкой': 'An update file is occupied by a directory or link',
    'Файл обновления занят другим модом': 'An update file is occupied by another mod',
    'Файл authlib-injector повреждён': 'The authlib-injector file is corrupted',
    'Запись восстановления повреждена. Резервные файлы сохранены; не удаляй папку обновления': 'The recovery record is damaged. Backup files are preserved; do not delete the update folder',
    'Прерванное обновление': 'Interrupted update',
    'Обновление ещё выполняется': 'The update is still running',
    'Можно проверить резервные файлы и завершить восстановление': 'You can check the backup files and complete recovery',
    'Проверить и восстановить': 'Check and recover',
    'Показать резервные файлы': 'Show backup files',
    'Не удалось проверить восстановление обновления': 'Could not check update recovery',
    'Восстановление обновления завершено': 'Update recovery completed',
    'Папка восстановления не найдена': 'Recovery folder not found',
    'Перед установкой модов': 'Before installing mods',
    'Обновление ещё не применено': 'The update has not been applied yet',
    'Сборка уже занята запуском или обновлением': 'This instance is already launching or updating',
    'Сначала дождись обновления модпака': 'Wait for the modpack update to finish first',
    'Сначала закрой игру и дождись завершения задач сборки': 'Close the game and wait for the instance tasks to finish first',
    'Копия с таким именем уже существует': 'A backup with this name already exists',
    'Некорректное имя файла Modrinth': 'Invalid Modrinth filename',
    'Некорректное имя файла мода': 'Invalid mod filename',
    'Файл обновления мода повреждён': 'The mod update file is corrupted',
    'слишком большой ответ': 'response is too large',
    'Не удалось запустить Java': 'Could not start Java',
    'Очистка остановлена: сначала восстанови настройки повреждённой сборки': 'Cleanup stopped: restore the damaged instance settings first',
    'Очистка остановлена: сначала заверши или восстанови обновление модпака': 'Cleanup stopped: complete or recover the modpack update first',
    'Очистка остановлена: не удалось прочитать настройки установленной версии игры': 'Cleanup stopped: could not read the installed game version settings',
    'Очистка остановлена: не удалось прочитать список ресурсов игры': 'Cleanup stopped: could not read the game asset index',
    'Сначала дождись завершения игр и фоновых задач': 'Wait for games and background tasks to finish first',
    'В модпаке слишком много файлов': 'The modpack contains too many files',
    'Архив содержит некорректный размер файла': 'The archive contains an invalid file size',
    'Файл в модпаке превышает допустимый размер': 'A modpack file exceeds the size limit',
    'Модпак превышает допустимый размер после распаковки': 'The unpacked modpack exceeds the size limit',
    'Архив содержит зашифрованный или неподдерживаемый файл': 'The archive contains an encrypted or unsupported file',
    'Описание модпака слишком большое': 'The modpack manifest is too large',
    'Архив модпака слишком большой или недоступен': 'The modpack archive is too large or unavailable',
    'Некорректный или слишком большой список файлов модпака': 'The modpack file list is invalid or too large',
    'Папка облака не найдена — проверь, что программа облака установлена': 'Cloud folder not found — check that the cloud app is installed',
    'Это папка самого лаунчера — выбери папку облака': 'That’s the launcher’s own folder — choose a cloud folder',
    'Синхронизирую сборки…': 'Syncing instances…', 'Синхронизирую с облаком…': 'Syncing with the cloud…',
    // железо
    'Под твой компьютер': 'Tuned to your PC', 'Смотрю на железо…': 'Checking your hardware…', 'Поставить рекомендуемую память': 'Use recommended memory',
    'Не получилось узнать железо.': 'Couldn’t read the hardware.', 'Видеокарта': 'Graphics card', 'Процессор': 'CPU', 'Компьютер': 'Computer', 'не определилась': 'unknown',
    'скромный — бережём FPS': 'modest — saving FPS', 'средний — хватит на лёгкие шейдеры': 'mid-range — fine for light shaders', 'мощный — тянет красивые шейдеры ✨': 'powerful — handles pretty shaders ✨',
    'Для этого компьютера шейдеры будут тормозить — лучше поставь «Оптимизацию»': 'Shaders would lag on this PC — use “Optimization” instead',
    // поделиться и игра с другом
    '💌 Поделиться': '💌 Share', '💞 Играть с другом': '💞 Play with a friend', '✨ Шейдеры под мой ПК': '✨ Shaders for my PC',
    'Экспорт: моды с Modrinth попадут в файл ссылками (он будет лёгким), остальные — внутрь. Миры в экспорт не входят. «Поделиться» сразу копирует файл — вставь его в чат Discord или Telegram, а друг просто перетащит его в лаунчер.':
      'Export: Modrinth mods go in as links (the file stays small), others go inside. Worlds aren’t included. “Share” copies the file right away — paste it into Discord or Telegram, and your friend just drags it into the launcher.',
    'упаковываю сборку для друга 💌': 'packing the instance for your friend 💌', 'подбираю шейдеры под твой компьютер ✨': 'picking shaders for your PC ✨',
    'Файл сборки скопирован — вставь его в чат Discord или Telegram (Ctrl+V) ♡': 'Instance file copied — paste it into Discord or Telegram (Ctrl+V) ♡',
    'Файл сборки готов — перетащи его в чат ♡': 'Instance file is ready — drag it into the chat ♡',
    'Играть с другом 💞': 'Play with a friend 💞', 'Без настройки роутера и своего сервера': 'No router setup, no server of your own',
    'Нажми «Подготовить» — поставлю в сборку бесплатный мод': 'Press “Prepare” — I’ll add the free mod', 'Запусти игру, зайди в мир, нажми': 'Start the game, open a world, press',
    'Esc → «Открыть для сети» → «Начать»': 'Esc → “Open to LAN” → “Start”', 'Я поймаю адрес вида': 'I’ll catch an address like', 'и сразу скопирую его — отправь другу.': 'and copy it right away — send it to your friend.',
    'У друга должны быть такие же моды: отправь ему адрес и «Код сборки» (кнопка ниже). В лаунчере он нажмёт «Войти к другу», вставит сообщение, и я сверю его моды с твоими и поставлю недостающее. Без лаунчера: «Сетевая игра → Прямое подключение» и адрес.':
      'Your friend needs the same mods: send them the address and the “Pack code” (the button below). In the launcher they press “Join a friend”, paste the message, and I compare their mods with yours and install what’s missing. Without the launcher: “Multiplayer → Direct Connection” and the address.',
    'Подготовить': 'Prepare', 'Играть ♡': 'Play ♡', 'Ставлю…': 'Installing…', 'Готово ✓': 'Done ✓', 'e4mc стоит — можно звать друга ♡': 'e4mc is installed — go call your friend ♡',
    'Ставлю e4mc — мод для игры с другом…': 'Installing e4mc — the mod for playing with a friend…',
    'e4mc не достучался до своего сервера — мир для друга не открыт. Что мешает, покажет кнопка «Проверить» в окне «Играть с другом»':
      'e4mc couldn’t reach its server — the world isn’t open for your friend. The “Check” button in the “Play with a friend” window will show what’s in the way',
    'мир открыт для друга! адрес уже скопирован 💞': 'the world is open for your friend! address copied 💞', 'Мир открыт для друга 💞': 'World open for your friend 💞',
    'Отправь другу этот адрес — он вставит его в «Сетевая игра → Прямое подключение»:': 'Send this address to your friend — they paste it into “Multiplayer → Direct Connection”:',
    'Скопировать': 'Copy', 'Скопировано ✧': 'Copied ✧', 'Ура ♡': 'Yay ♡',
    'Друг играет без лицензии (офлайн-аккаунт)': 'My friend has no license (offline account)', 'Поставлю ещё мод': 'I’ll also add the',
    '. В игре в окне «Открыть для сети» выключи': ' mod. In the game’s “Open to LAN” screen turn off', 'Online Mode': 'Online Mode',
    '— тогда проверки лицензии не будет. Важно: так зайти сможет любой, кто знает адрес, под любым ником — отправляй адрес только другу. Скин офлайн-друга вы, скорее всего, увидите стандартным.':
      '— then there’s no license check. Important: anyone who knows the address can join under any nickname — send it only to your friend. You’ll most likely see your offline friend with a default skin.',
    'Ставлю LAN World Plug-n-Play — белый список и вход без лицензии…': 'Installing LAN World Plug-n-Play — whitelist and joining without a license…',
    'Ник друга — пущу в мир только его (белый список)': 'Friend’s nickname — only they get in (whitelist)', 'В игре в окне «Открыть для сети» выключи': 'In the game’s “Open to LAN” screen turn off',
    '— тогда проверки лицензии не будет. Без лицензии игра узнаёт друга только по нику: кто знает и адрес, и ник, сможет зайти вместо него — отправляй адрес только другу, лично. Скин офлайн-друга вы, скорее всего, увидите стандартным.':
      '— then there’s no license check. Without a license the game recognizes your friend only by nickname: anyone who knows both the address and the nickname can join as them — send the address only to your friend, privately. You’ll most likely see your offline friend with a default skin.',
    'С ником поставлю ещё мод': 'With a nickname I’ll also add the', '— он включает в мире команды белого списка. Когда мир откроется, я покажу их готовыми.': 'mod — it enables whitelist commands in the world. When the world opens, I’ll show them ready to copy.',
    'Чтобы зашёл только': 'So that only', ', введи в чат игры (T) по очереди:': 'can join, type these into the game chat (T) one by one:',
    'Если команды не срабатывают — при «Открыть для сети» включи «Разрешить читы».': 'If the commands don’t work, turn on “Allow Cheats” when opening to LAN.',
    'Совет: укажи ник друга в «Играть с другом» — тогда в мир пустит только его.': 'Tip: enter your friend’s nickname in “Play with a friend” — then only they can join.',
    'Друг без лицензии: игра проверяет только ник. Не показывай адрес на стримах и скриншотах. Если зашёл кто-то чужой —': 'Friend without a license: the game checks only the nickname. Don’t show the address on streams or screenshots. If a stranger gets in —',
    'и': 'and', ', а лучше выйди из мира: адрес перестанет работать.': ', or better, leave the world: the address stops working.',
    'Курсор': 'Cursor', '🐾 Лапка': '🐾 Paw', '🐱 Котик': '🐱 Kitty', 'Обычный': 'Regular', 'теперь я у тебя в руке ♡': 'now I’m in your hand ♡',
    // список друзей в окне «Играть с другом»
    'Друзья': 'Friends', 'галочка — пустить в этот мир': 'tick — let them into this world', 'ник друга, например PinkCat_': 'friend’s nickname, e.g. PinkCat_',
    'без лицензии': 'no license', 'с лицензией': 'licensed', 'Нажми, чтобы поменять: с лицензией или без': 'Click to switch: licensed or not',
    'Убрать из списка друзей': 'Remove from the friends list', 'Список пока пуст: впиши ник друга ниже ♡': 'The list is empty for now: type a friend’s nickname below ♡',
    'Такого друга нет в списке': 'There is no such friend in the list',
    'В игре в окне «Открыть для сети» поставь': 'In the game’s “Open to LAN” screen set',
    ': проверки лицензии не будет, а у друзей с лицензией сохранятся их вещи и скины. Без проверки игра узнаёт всех только по нику: кто знает адрес и чей-то ник, сможет зайти вместо него — отправляй адрес только своим, лично. Скин офлайн-друга вы, скорее всего, увидите стандартным.':
      ': no license check, and licensed friends keep their items and skins. Without the check the game knows everyone only by nickname: anyone with the address and someone’s nickname can join as them — send the address only to your people, privately. You’ll most likely see offline friends with a default skin.',
    'Чтобы зашли только': 'So that only',
    'Совет: укажи ники друзей в «Играть с другом» — тогда в мир пустит только их.': 'Tip: enter your friends’ nicknames in “Play with a friend” — then only they can join.',
    'Кто-то без лицензии: в окне «Открыть для сети» выбери Online Mode → Disable + UUID Fixer. Игра проверяет только ники — не показывай адрес на стримах и скриншотах. Если зашёл кто-то чужой —':
      'Someone has no license: in “Open to LAN” pick Online Mode → Disable + UUID Fixer. The game checks only nicknames — don’t show the address on streams or screenshots. If a stranger gets in —',
    'Адрес работает, пока ты в этом мире. У друга должна быть такая же сборка.': 'The address works while you’re in this world. Your friend needs the same instance.',
    // 0.8.2: белый список друзей без лицензии пишет сам лаунчер
    'Записываю белый список…': 'Writing the whitelist…',
    'Белый список записан:': 'Whitelist saved:',
    'Сейчас в мире:': 'In the world now:',
    'Пока никто не зашёл': 'Nobody has joined yet',
    '. Ник друга без лицензии должен совпадать с ником у него в игре буква в букву, с заглавными.': '. A friend’s nickname without a license must match the one in their game letter for letter, capitals included.',
    'Он работает, пока в окне «Открыть для сети» включён переключатель «Белый список» (Whitelist): выключишь его — зайдёт любой, у кого есть адрес. Если друга не пускает с надписью «нет в белом списке», проверь ник и этот переключатель.':
      'It works while the “Whitelist” switch is on in the “Open to LAN” screen: turn it off and anyone with the address can join. If your friend gets “not whitelisted”, check the nickname and that switch.',
    'Если друга не пускает с надписью «нет в белом списке», выключи переключатель «Белый список» (Whitelist) в окне «Открыть для сети».':
      'If your friend gets “not whitelisted”, turn off the “Whitelist” switch in the “Open to LAN” screen.',
    'Ник друга без лицензии пиши точь-в-точь, как у него в игре: заглавные и строчные буквы считаются.': 'Type an offline friend’s nickname exactly as it is in their game: capital and small letters matter.',
    'Отмеченных друзей я запишу в белый список сама — когда игру запустят отсюда («Играть ♡») или нажмут «Подготовить»; для этого поставлю ещё мод':
      'I’ll write the checked friends to the whitelist myself — when the game is started from here (“Play ♡”) or when you press “Prepare”; for that I’ll also install the mod',
    'Игра уже запущена: список подхватится, когда откроешь мир; если мир уже открыт — введи в её чате /whitelist reload':
      'The game is already running: the list is picked up when you open a world; if the world is already open, type /whitelist reload in its chat',
    '/kick Ник': '/kick Nick', '/ban Ник': '/ban Nick',
    // белый список живёт один мир
    'Список живёт один мир: когда мир закроется, лаунчер его очистит, а друзья останутся в этом списке.': 'The list lives for one world: when the world closes, the launcher clears it, but your friends stay in this list.',
    'Белый список пуст: друзей из списка лаунчер записывает, когда игру запускают из окна «Играть с другом» («Играть ♡») или нажимают «Подготовить». Сейчас нажми там «Подготовить» и введи в чате игры (T):':
      'The whitelist is empty: the launcher writes the friends from the list when the game is started from the “Play with a friend” window (“Play ♡”) or when you press “Prepare”. Right now press “Prepare” there and type in the game chat (T):',
    'Адрес и белый список работают, пока ты в этом мире: когда закроешь его, список очистится. У друга должна быть такая же сборка.':
      'The address and the whitelist work while you’re in this world: when you close it, the list is cleared. Your friend needs the same instance.',
    // корзина сборок
    'Убрать сборку в корзину? 🥺': 'Move the instance to the trash? 🥺', 'В корзину': 'To the trash', 'Корзина': 'Trash', 'Корзина 🗑️': 'Trash 🗑️',
    'Удалённые сборки: пока лаунчер открыт, их можно вернуть': 'Deleted instances: you can bring them back while the launcher is open',
    'уедет в корзину вместе со всеми мирами, модами и скриншотами. Пока лаунчер открыт, её можно вернуть кнопкой «Корзина» на главной. Когда ты закроешь лаунчер, она удалится навсегда.':
      'goes to the trash with all its worlds, mods and screenshots. While the launcher is open you can bring it back with the “Trash” button on the main page. When you close the launcher, it is deleted forever.',
    'Сборка в корзине — вернуть её можно кнопкой «Корзина» ♡': 'The instance is in the trash — bring it back with the “Trash” button ♡',
    'Удалённые сборки, пока лаунчер открыт': 'Deleted instances, while the launcher is open',
    'Сборка лежит здесь целиком — с мирами, модами и скриншотами. Когда ты закроешь лаунчер, корзина очистится, а сборки удалятся навсегда.':
      'An instance lies here whole — with its worlds, mods and screenshots. When you close the launcher, the trash is emptied and the instances are deleted forever.',
    'Очистить корзину': 'Empty the trash', 'Точно очистить?': 'Really empty it?', 'Точно удалить?': 'Really delete?', 'Стереть сборку насовсем': 'Erase the instance for good',
    'В корзине пусто ♡': 'The trash is empty ♡', 'Сборка удалена навсегда': 'Instance deleted forever', 'Корзина очищена': 'Trash emptied',
    'вернула сборку из корзины ♡': 'brought the instance back from the trash ♡',
    'Копировать ник': 'Copy nickname', 'Скопировать ник, чтобы отправить его другу': 'Copy the nickname to send it to a friend',
    'Скопировать мой ник': 'Copy my nickname', 'Сначала добавь аккаунт ♡': 'Add an account first ♡',
    'Играть с другом': 'Play with a friend', 'Очищать белый список после закрытия мира': 'Clear the whitelist after the world closes',
    'Друзья, которых ты пускал в мир, не остаются в списке: в следующий мир их нужно добавить заново. Список очищается и когда закрывается игра.':
      'Friends you let into a world don’t stay on the list: you need to add them again for the next world. The list is also cleared when the game closes.',
    // проверка перед игрой с другом: куски фраз (значения в <code> подставляются между ними)
    'Проверить': 'Check', 'Проверка игры с другом 🩺': 'Play-with-a-friend check 🩺',
    'Заранее проверю, получится ли открыть мир для друга: интернет, моды, UDP, белый список': 'I’ll check in advance whether the world will open for your friend: internet, mods, UDP, whitelist',
    'Мод e4mc': 'The e4mc mod', 'Мод LAN World Plug-n-Play': 'The LAN World Plug-n-Play mod', 'Как игра выходит в интернет': 'How the game goes online',
    'Сервер адресов e4mc': 'e4mc address server', 'Связь с ретранслятором (UDP)': 'Connection to the relay (UDP)', 'Белый список': 'Whitelist',
    'Причина': 'Reason', 'не ответил за 8 секунд': 'no answer in 8 seconds', 'ответа нет за 3 секунды': 'no answer in 3 seconds',
    'прокси не пустил дальше': 'the proxy didn’t let it through', 'ответ сервера не разобрать': 'the server’s answer can’t be understood',
    'Стоит и включён.': 'Installed and enabled.', 'Стоит, но выключен: включи его в списке модов сборки.': 'Installed but disabled: enable it in the instance’s mod list.',
    'Не стоит: нажми «Назад», а потом «Подготовить» — мод поставится сам.': 'Not installed: press “Back”, then “Prepare” — the mod installs itself.',
    'Стоит и включён: белый список и друзья без лицензии заработают.': 'Installed and enabled: the whitelist and friends without a license will work.',
    'Стоит, но выключен: без него не работают белый список и вход без лицензии. Включи его в списке модов сборки.':
      'Installed but disabled: without it the whitelist and joining without a license don’t work. Enable it in the instance’s mod list.',
    'Не стоит, а нужен для белого списка и друзей без лицензии: нажми «Назад», а потом «Подготовить».':
      'Not installed, but it’s needed for the whitelist and friends without a license: press “Back”, then “Prepare”.',
    'Игра ходит в интернет напрямую: прокси не настроен.': 'The game goes online directly: no proxy is set up.',
    'Игра пойдёт через HTTP-прокси': 'The game will go through the HTTP proxy', '— лаунчер сам передаёт его игре.': '— the launcher passes it to the game itself.',
    'HTTP-прокси': 'The HTTP proxy', 'не отвечает, и игра пойдёт напрямую. Если сеть открывается только через VPN — включи его.': 'isn’t answering, so the game will go online directly. If the network opens only through a VPN — turn it on.',
    'В Windows настроен прокси типа': 'Windows is set up with a proxy of type', '— Java такие не понимает, и игра пойдёт напрямую.': '— Java doesn’t understand those, so the game will go online directly.',
    'Ответил за': 'Answered in', 'через прокси — игра получит адрес для друга.': 'through the proxy — the game will get the address for your friend.',
    'напрямую — игра получит адрес для друга.': 'directly — the game will get the address for your friend.',
    'Сервер адресов выключен в настройках e4mc — мод идёт сразу к ретранслятору': 'The address server is turned off in the e4mc settings — the mod goes straight to the relay',
    'Ответил, но с неожиданным адресом ретранслятора — мод может не открыть мир.': 'It answered, but with an unexpected relay address — the mod may fail to open the world.',
    'Через прокси не достучаться, а напрямую получается — игре лучше идти напрямую: выключи прокси в Windows и в настройках лаунчера или почини его.':
      'It can’t be reached through the proxy but works directly — the game is better off going directly: turn the proxy off in Windows and in the launcher settings, or fix it.',
    'Не достучаться ни через прокси, ни напрямую — игра не получит адрес для друга. Проверь интернет, VPN и прокси.':
      'It can’t be reached through the proxy or directly — the game won’t get an address for your friend. Check your internet, VPN and proxy.',
    'Напрямую не достучаться — игра не получит адрес для друга. Включи VPN или впиши рабочий HTTP-прокси в настройках лаунчера.':
      'It can’t be reached directly — the game won’t get an address for your friend. Turn on a VPN or enter a working HTTP proxy in the launcher settings.',
    'Ретранслятор': 'Relay', 'ответил за': 'answered in', '— мир сможет с ним соединиться.': '— the world will be able to connect to it.', 'UDP до ретранслятора': 'UDP to the relay',
    'не доходит — мир для друга не откроется. Так бывает, когда сеть или провайдер режут UDP: попробуй другую сеть или VPN, который пропускает UDP (HTTP-прокси для этого не годится).':
      'doesn’t get through — the world won’t open for your friend. That happens when the network or provider blocks UDP: try another network or a VPN that lets UDP through (an HTTP proxy won’t do for this).',
    'В мире': 'In the world', 'В мирах': 'In the worlds',
    'включён белый список, а ников друзей нет — кроме тебя никто не зайдёт. Впиши ники в «Играть с другом» или выключи переключатель «Белый список» в окне «Открыть для сети».':
      'the whitelist is on, but there are no friends’ nicknames — nobody but you can join. Enter nicknames in “Play with a friend” or turn off the “Whitelist” switch in the “Open to LAN” screen.',
    'белый список включён: зайдут только ники из whitelist.json. Друзей без лицензии лаунчер впишет сам, остальным введи в чате игры':
      'the whitelist is on: only nicknames from whitelist.json can join. The launcher adds friends without a license itself; for the others type in the game chat',
    '/whitelist add Ник': '/whitelist add Nick', '— команды покажу, когда мир откроется.': '— I’ll show the commands when the world opens.',
    'Лаунчер впишет друзей в белый список сам, когда игру запустят из окна «Играть с другом» («Играть ♡») или нажмут «Подготовить»:':
      'The launcher will add your friends to the whitelist itself when the game is started from the “Play with a friend” window (“Play ♡”) or when you press “Prepare”:',
    'Файл whitelist.json повреждён — белый список не заработает. Удали его или нажми «Назад» и «Подготовить» (для друзей без лицензии): файл перепишется, а старый останется рядом (.broken).':
      'The whitelist.json file is damaged — the whitelist won’t work. Delete it, or press “Back” and “Prepare” (for friends without a license): the file will be rewritten and the old one stays next to it (.broken).',
    'Не получилось проверить —': 'Couldn’t check —', 'Не получилось разобрать ответ проверки.': 'Couldn’t make sense of the check’s answer.',
    'Всё готово: можно открывать мир для друга ♡': 'All set: you can open the world for your friend ♡', 'Должно получиться, но есть замечания — они ниже.': 'It should work, but there are remarks — see below.',
    'Сейчас не получится: исправь красные пункты ниже.': 'It won’t work right now: fix the red items below.',
  };

  Object.assign(D, D2);

  // новый дизайн: главная с карточкой сборки, полка и три карточки под ней
  Object.assign(D, {
    'Мои сборки': 'My instances', 'играет': 'playing', 'Проверяю…': 'Checking…', 'Всё готово': 'All good', 'Открыть проверку сборки': 'Open the instance check',
    'без модов': 'no mods', 'Память для игры': 'Memory for the game',
    'Создай первую сборку ♡': 'Create your first instance ♡', 'Выбери версию Minecraft и загрузчик модов — остальное лаунчер поставит сам.': 'Pick a Minecraft version and a mod loader — the launcher sets up the rest.',
    'Все награды собраны': 'All rewards collected', 'котик тобой гордится ♡': 'the kitty is proud of you ♡',
    'Копия мира сохранена': 'World backup saved', 'Вернуть': 'Restore', 'Миров пока нет': 'No worlds yet', 'создай мир в игре': 'create a world in the game',
    'Копий мира пока нет': 'No world backups yet', 'автокопии выключены': 'auto backups are off', 'сохраню после игры': 'I’ll save one after you play',
    'Облако на связи': 'Cloud is connected', 'ещё не синхронизировалось': 'not synced yet', 'Облако не подключено': 'Cloud isn’t connected', 'сборки и миры на всех твоих ПК': 'instances and worlds on all your PCs', 'Подключить': 'Connect',
    'Добавить аккаунт': 'Add an account',
    // настройки по разделам
    'Котик и награды': 'Kitty and rewards', 'Игра и Java': 'Game and Java', 'Миры и облако': 'Worlds and cloud', 'Место и переезд': 'Space and moving', 'О лаунчере': 'About the launcher',
    'Тема': 'Theme', 'выбери настроение лаунчера': 'pick the launcher’s mood', 'Светлая': 'Light', 'Сакура': 'Sakura', 'Тёмная': 'Dark', 'Полночь': 'Midnight', 'Как в системе': 'Like the system',
    'Лапка': 'Paw', 'Котик': 'Kitty', 'цвет — как у акцента': 'same color as the accent', 'Фон': 'Background', 'Язык и звуки': 'Language and sounds',
    'Наряды котика': 'Kitty outfits', 'Праздники и фразы': 'Holidays and phrases', 'Запуск и загрузки': 'Launch and downloads',
  });

  // 0.7.1: спящий и экономный режимы, быстрая игра
  Object.assign(D, {
    'Из других лаунчеров: Legacy Launcher, TLauncher, Prism…': 'From other launchers: Legacy Launcher, TLauncher, Prism…',
    'Ищу Legacy Launcher, TLauncher, Minecraft, Prism, CurseForge, Modrinth и другие лаунчеры по всему компьютеру…': 'Looking for Legacy Launcher, TLauncher, Minecraft, Prism, CurseForge, Modrinth and other launchers all over the computer…',
    'Ищу Legacy Launcher (TL Legacy), TLauncher и официальный Minecraft, Prism, PolyMC, CurseForge, Modrinth App, ATLauncher и GDLauncher, а ещё любые папки Minecraft на рабочем столе, в «Загрузках» и на других дисках.':
      'I look for Legacy Launcher (TL Legacy), TLauncher and the official Minecraft launcher, Prism, PolyMC, CurseForge, Modrinth App, ATLauncher and GDLauncher, plus any Minecraft folders on the desktop, in Downloads and on other drives.',
    'Перенеси миры, сборки и паки из Legacy Launcher (TL Legacy), TLauncher, Prism, CurseForge и других: я найду их сама, даже если лаунчер лежит в «Загрузках» или на другом диске. Потом, если захочешь, освободи место от старых копий.':
      'Bring worlds, instances and packs over from Legacy Launcher (TL Legacy), TLauncher, Prism, CurseForge and others: I find them myself, even if a launcher sits in Downloads or on another drive. Then, if you like, free up space from the old copies.',
    'Предлагать перенос, когда найду другой лаунчер': 'Offer to move things when I find another launcher', 'Перенести': 'Move',
    'не удалось проверить': 'couldn’t check', 'Не получилось связаться с Modrinth, поэтому часть модов проверить не вышло. Проверь интернет и открой окно ещё раз.': 'Couldn’t reach Modrinth, so some mods couldn’t be checked. Check your internet and open this window again.', 'Нет связи с Modrinth — проверь интернет и попробуй ещё раз': 'Can’t reach Modrinth — check your internet and try again',
    'Могу перенести сюда сборки и миры. Старые лаунчеры при этом не меняются.': 'I can move instances and worlds over. The old launchers stay untouched.',
    'Движение': 'Motion', 'Включено': 'On', 'Выключено': 'Off', 'Экономный режим': 'Eco mode', 'На батарее': 'On battery', 'Всегда': 'Always', 'Выключен': 'Off',
    'сейчас экономит: ты на батарее': 'saving power: you’re on battery', 'экономный режим включён': 'eco mode is on',
    'Что поправить, чтобы игра шла быстрее': 'What to adjust to make the game faster', 'Как ускорить игру ⚡': 'Speed up the game ⚡', 'Смотрю на сборку и на компьютер…': 'Looking at the instance and the computer…',
    'Всё в порядке — больше нечего советовать ♡': 'All good — nothing more to suggest ♡',
    'Если игра долго грузится, добавь папку лаунчера в исключения антивируса: он проверяет каждый файл при запуске. Это настройка самой Windows, за тебя я её не трогаю.':
      'If the game takes long to load, add the launcher folder to your antivirus exclusions: it scans every file at launch. That’s a Windows setting, I don’t change it for you.',
    'Игра может идти на слабой видеокарте': 'The game may be running on a weak graphics card', 'Включить мощную': 'Use the powerful one', 'Модам мало памяти': 'Not enough memory for the mods',
    'Памяти отдано слишком много': 'Too much memory is given', 'В сборке нет модов для скорости': 'The instance has no speed mods', 'Открыть оптимизацию': 'Open Optimization',
    'Слишком большая дальность прорисовки': 'Render distance is too high', 'Экономная графика': 'Economy graphics', 'Сбалансированная графика': 'Balanced graphics',
    'Включены шейдеры': 'Shaders are on', 'Выключить шейдеры': 'Turn shaders off', 'Тяжёлые ресурспаки': 'Heavy resource packs', 'Открыть ресурспаки': 'Open resource packs',
    'Ноутбук работает от батареи': 'The laptop is on battery', 'Компьютер скромный, а шейдеры сильно режут кадры. Если игра тормозит — выключи их.': 'The computer is modest and shaders cut FPS a lot. If the game lags, turn them off.',
    'От батареи Windows урезает мощность, и игра идёт хуже. Подключи зарядку.': 'On battery Windows limits the power and the game runs worse. Plug in the charger.',
    'Настройки графики подобрала ♡': 'Graphics settings picked ♡', 'Настройки графики вернула как были': 'Graphics settings put back as they were', 'Шейдеры выключены — включить их можно в настройках игры': 'Shaders are off — you can turn them on in the game settings',
    'Графика игры': 'Game graphics', 'Экономная': 'Economy', 'Сбалансированная': 'Balanced', 'Красивая': 'Fancy', 'Вернуть как было': 'Put back as it was',
    'Подкручиваю дальность прорисовки, частицы, кадры в секунду и ещё несколько настроек в options.txt сборки. Клавиши, язык и звук не трогаю. Игра при этом должна быть закрыта.':
      'I tweak render distance, particles, FPS and a few more settings in the instance’s options.txt. Keys, language and sound stay as they are. The game has to be closed.',
    'Настроек игры ещё нет: запусти сборку один раз и закрой её — тогда здесь появятся кнопки.': 'There are no game settings yet: launch the instance once and close it — then the buttons will work.',
    'Сначала закрой игру: она перезаписывает настройки, когда выходит': 'Close the game first: it overwrites the settings when it exits',
    'Настроек игры ещё нет — запусти сборку один раз, закрой её и возвращайся ♡': 'There are no game settings yet — launch the instance once, close it and come back ♡',
    'Нечего возвращать — настройки этой сборки лаунчер не менял': 'Nothing to put back — the launcher hasn’t changed this instance’s settings', 'Не знаю такого набора настроек': 'Unknown settings set',
    'Оптимизация ⚡': 'Optimization ⚡', 'Смотрю, что вышло под эту версию…': 'Checking what’s available for this version…', 'Закрыть': 'Close', 'Поставить': 'Install', 'Нечего ставить': 'Nothing to install',
    'Основа': 'Essentials', 'рекомендую': 'recommended', 'Дополнительно': 'Extras', 'по желанию': 'optional', 'уже стоит': 'installed', 'работает только с Sodium': 'works with Sodium only',
    'Всё скачивается с Modrinth вместе с нужными библиотеками. Убрать можно во вкладке «Моды».': 'Everything is downloaded from Modrinth together with the libraries it needs. You can remove it in the “Mods” tab.',
    'Главный ускоритель: заменяет отрисовку игры. Кадров заметно больше, подвисаний меньше.': 'The main booster: replaces the game’s rendering. Noticeably more FPS and fewer stutters.',
    'Ускоряет мобов, блоки и тики — меньше лагов в мире.': 'Speeds up mobs, blocks and ticks — less lag in the world.',
    'Экономит оперативную память — заметно, когда модов много.': 'Saves RAM — you notice it when there are lots of mods.',
    'Не рисует тех, кого не видно за стеной: больше кадров на фермах и в деревнях.': 'Doesn’t draw what’s hidden behind a wall: more FPS on farms and in villages.',
    'Ускоряет отрисовку меню, текста и сундуков.': 'Speeds up drawing menus, text and chests.',
    'Быстрее загрузка игры, меньше памяти, исправляет частые баги.': 'Faster game loading, less memory, fixes common bugs.',
    'Когда окно игры не в фокусе, сбавляет кадры и нагрузку: тише вентиляторы, дольше батарея.': 'When the game window isn’t focused it lowers FPS and load: quieter fans, longer battery life.',
    'Прячет ещё больше невидимого — прибавка кадров в закрытых местах.': 'Hides even more of what you can’t see — extra FPS in enclosed places.',
    'Дополнение к Sodium: облака, частицы, анимации и другие настройки графики.': 'A Sodium add-on: clouds, particles, animations and other graphics options.',
    'Красивое меню видеонастроек для Sodium.': 'A nicer video settings menu for Sodium.',
    'Отзывчивее мышь и окно: ввод обрабатывается отдельным потоком.': 'More responsive mouse and window: input is handled in a separate thread.',
    'Быстрее обновляется свет — меньше подвисаний при стройке и загрузке мира.': 'Lighting updates faster — fewer stutters when building and loading the world.',
    'Выход в меню сразу, а мир сохраняется в фоне.': 'Returns to the menu right away while the world saves in the background.',
    'Видеокарта для игры': 'Graphics card for the game', 'Запускать игру на мощной видеокарте': 'Run the game on the powerful graphics card',
    'Когда в компьютере две видеокарты, Windows часто запускает Minecraft на слабой встроенной, и кадров мало. Эта настройка записывает в «Параметры графики» Windows «высокая производительность» для Java, которую запускает лаунчер. Выключишь — всё вернётся как было.':
      'When a computer has two graphics cards, Windows often runs Minecraft on the weak built-in one and the FPS is low. This setting writes “high performance” for the launcher’s Java into Windows “Graphics settings”. Turn it off and everything goes back as it was.',
    'Запускать игру на мощной видеокарте?': 'Run the game on the powerful graphics card?', 'Спрашиваю один раз — потом это можно поменять в настройках': 'I only ask once — you can change it later in the settings',
    'Не надо': 'No thanks', 'Включить мощную': 'Use the powerful one',
    'Игра будет запускаться на мощной видеокарте ♡': 'The game will run on the powerful graphics card ♡', 'Видеокарту для Java вернула как было': 'Put the graphics card choice for Java back as it was',
    'Экономный режим убирает лепестки, светлячков и звёзды и вечные анимации — ноутбук дольше живёт от батареи. Когда лаунчер просто открыт и ты ничего не делаешь, он и так засыпает; мышка его будит.':
      'Eco mode removes petals, fireflies, stars and endless animations, so a laptop lasts longer on battery. When the launcher is just open and you aren’t doing anything, it falls asleep anyway; the mouse wakes it up.',
  });

  // 0.8.0: надёжность — связь, прокси, запуск без интернета, отмена, защита настроек
  Object.assign(D, {
    'Отменить': 'Cancel', 'Отменяю…': 'Cancelling…', 'Отменено': 'Cancelled', 'Отменила ♡': 'Cancelled ♡', 'Запуск отменён': 'Launch cancelled', 'хорошо, не запускаю ♡': 'okay, not launching ♡',
    'Свой прокси для загрузок (пусто — как настроен Windows)': 'Your own proxy for downloads (empty — as Windows is set up)',
    'http://127.0.0.1:10809 или socks5://127.0.0.1:1080': 'http://127.0.0.1:10809 or socks5://127.0.0.1:1080',
    'Обычно вписывать ничего не нужно: лаунчер ходит в сеть так же, как браузер, то есть через прокси или VPN из настроек Windows. Свой адрес нужен, только если интернет есть лишь через конкретный прокси.':
      'You normally don’t need to type anything: the launcher goes online like a browser does, that is through the proxy or VPN from the Windows settings. A custom address is only for when the internet works through one specific proxy.',
    'Прокси впиши так: http://адрес:порт или socks5://адрес:порт': 'Write the proxy like this: http://address:port or socks5://address:port',
    'Прокси сохранён — проверь связь кнопкой ниже ✧': 'Proxy saved — check the connection with the button below ✧', 'Прокси убран — лаунчер ходит в сеть как Windows ✧': 'Proxy removed — the launcher goes online like Windows does ✧',
    'Проверить связь': 'Check connection', 'Проверка связи 📡': 'Connection check 📡', 'Стучусь к серверам лаунчера…': 'Knocking on the launcher’s servers…', 'Проверить ещё раз': 'Check again',
    'в обход прокси': 'bypassing the proxy', 'Прокси не сработал, зато напрямую дошло': 'The proxy didn’t work, but it got through directly',
    'Лаунчер ходит в сеть напрямую (без прокси).': 'The launcher goes online directly (no proxy).',
    'не ответил за 10 секунд': 'no answer in 10 seconds', 'адрес не находится (DNS)': 'address not found (DNS)', 'прокси не отвечает': 'the proxy doesn’t answer', 'сертификат не прошёл проверку': 'certificate check failed',
    'соединение отклонено': 'connection refused', 'соединение сброшено': 'connection reset', 'сервер ответил ошибкой': 'the server returned an error', 'не достучаться': 'can’t reach it',
    'Всё доступно ♡': 'Everything is reachable ♡',
    'Главное работает. Часть остальных сервисов не отвечает — они нужны только для отдельных возможностей, например для входа через Microsoft или для CurseForge.':
      'The essentials work. Some other services don’t answer — they are only needed for particular features, like Microsoft sign-in or CurseForge.',
    'Серверы Mojang не отвечают, но зеркало BMCLAPI доступно: файлы игры лаунчер скачает с него сам (режим загрузки «Авто» или «Сначала зеркало»).':
      'Mojang’s servers don’t answer, but the BMCLAPI mirror is reachable: the launcher downloads the game files from it by itself (download mode “Auto” or “Mirror first”).',
    'Не достучаться до серверов, без которых не скачать игру или моды. Проверь интернет, VPN и прокси.': 'Can’t reach the servers the game and mods are downloaded from. Check your internet, VPN and proxy.',
    'Связи нет совсем. Проверь интернет, VPN и прокси — и нажми «Проверить ещё раз».': 'There is no connection at all. Check your internet, VPN and proxy — then press “Check again”.',
    'Mojang — версии и файлы игры': 'Mojang — game versions and files', 'Mojang — ресурсы игры': 'Mojang — game assets', 'Modrinth — моды и сборки': 'Modrinth — mods and modpacks', 'Fabric — загрузчик модов': 'Fabric — mod loader',
    'CurseForge — моды и сборки': 'CurseForge — mods and modpacks', 'Вход через Microsoft': 'Microsoft sign-in', 'Профиль и скин Minecraft': 'Minecraft profile and skin', 'Зеркало BMCLAPI': 'BMCLAPI mirror', 'Обновления лаунчера': 'Launcher updates',
    'Нет связи с Microsoft — проверь интернет или прокси (Настройки → «Проверить связь»)': 'Can’t reach Microsoft — check your internet or proxy (Settings → “Check connection”)',
    'Нет связи с Microsoft — запускаю без входа в аккаунт. Одиночная игра работает, на серверы зайти не получится': 'Can’t reach Microsoft — launching without signing in. Singleplayer works, joining servers won’t',
    'Нет связи с Microsoft: запускаю без входа в аккаунт': 'Can’t reach Microsoft: launching without signing in',
    'Файл настроек оказался повреждён — вернула его прошлую копию. Посмотри, всё ли на месте ♡': 'The settings file was damaged — I put its previous copy back. Have a look that everything is in place ♡',
    'Файл настроек оказался повреждён, и копии не нашлось: настройки и аккаунты начаты заново. Испорченный файл лежит рядом (launcher.json.damaged-…)':
      'The settings file was damaged and there was no copy: settings and accounts start from scratch. The damaged file is next to it (launcher.json.damaged-…)',
  });

  // 0.8.0: точки восстановления
  Object.assign(D, {
    'Точки восстановления 🕘': 'Restore points 🕘', '🕘 Точки восстановления': '🕘 Restore points', 'Сохранить точку сейчас': 'Save a point now', 'Смотрю…': 'Looking…',
    'Перед обновлением модов и модпака, «Оптимизацией» и установкой недостающих модов я сама сохраняю точку. Возврат меняет моды, папку config и версию загрузчика; миры, скриншоты и настройки игры не трогаются. Нынешнее состояние я перед этим тоже сохраню, так что и возврат можно отменить.':
      'Before mod and modpack updates, Optimization and installing missing mods I save a point myself. Restoring changes the mods, the config folder and the loader version; worlds, screenshots and game settings are left alone. I save the current state first too, so a restore can be undone as well.',
    'Точек пока нет. Они появятся сами перед обновлением модов, а ещё можно сохранить точку сейчас.': 'No points yet. They appear by themselves before mod updates, and you can save one now.',
    'Точно вернуть?': 'Really restore?', 'Возвращаю…': 'Restoring…', 'Удалить точку': 'Delete the point', 'моды те же': 'same mods', 'Точка сохранена ♡': 'Point saved ♡', 'вернула как было ♡': 'put it back as it was ♡',
    'Перед обновлением модов': 'Before updating mods', 'Перед обновлением модпака': 'Before updating the modpack', 'Перед оптимизацией': 'Before optimization', 'Перед установкой недостающих модов': 'Before installing missing mods',
    'Перед откатом': 'Before a restore', 'Точка вручную': 'Saved by hand', 'Сохранила точку восстановления — вернуть можно в «Ещё»': 'Saved a restore point — you can go back in “More”',
    'Точка восстановления не найдена': 'Restore point not found', 'Некорректная точка восстановления': 'Invalid restore point', 'Сначала закрой игру: она держит моды открытыми': 'Close the game first: it keeps the mods open',
  });

  // 0.8.0: Ely.by
  Object.assign(D, {
    'Лицензия через Microsoft, Ely.by или просто ник для оффлайна': 'A license via Microsoft, Ely.by or just a nickname for offline', 'Скины и серверы Ely.by. Нужен аккаунт на ely.by.': 'Ely.by skins and servers. You need an ely.by account.',
    'Войти через Ely.by': 'Sign in with Ely.by', 'Вход через Ely.by 🦊': 'Sign in with Ely.by 🦊', 'Скины и серверы Ely.by': 'Ely.by skins and servers', 'Логин или почта': 'Login or email', 'Пароль': 'Password',
    'Код из приложения двухфакторной защиты': 'Code from the two-factor authentication app', 'Вхожу…': 'Signing in…', 'Войти': 'Sign in',
    'Пароль уходит только на сервер ely.by и нигде не сохраняется: лаунчер оставляет себе токен входа, зашифрованный средствами Windows. Аккаунт можно создать на': 'The password goes only to the ely.by server and is never stored: the launcher keeps just a sign-in token, encrypted by Windows. You can create an account at',
    'Сменить на ely.by': 'Change it on ely.by', 'Обновить скин': 'Update skin', 'Скин обновила ♡': 'Skin updated ♡',
    'Скин и плащ Ely.by меняются на сайте ely.by. В игре новый скин появится сам, а здесь его можно подтянуть кнопкой «Обновить скин».': 'Your Ely.by skin and cape are changed on ely.by. In the game a new skin shows up by itself, and here you can pull it with the “Update skin” button.',
    'Впиши логин (ник или почту) и пароль Ely.by': 'Enter your Ely.by login (nickname or email) and password', 'У аккаунта включена двухфакторная защита — введи код из приложения': 'The account has two-factor authentication — enter the code from the app',
    'Неверный логин или пароль': 'Wrong login or password', 'Неверный логин, пароль или код из приложения': 'Wrong login, password or code from the app', 'Аккаунт Ely.by заблокирован': 'The Ely.by account is suspended',
    'Слишком много попыток входа: подожди минуту и попробуй ещё раз': 'Too many sign-in attempts: wait a minute and try again', 'На этом аккаунте Ely.by нет профиля игрока': 'This Ely.by account has no player profile',
    'Нет связи с Ely.by — проверь интернет или прокси (Настройки → «Проверить связь»)': 'Can’t reach Ely.by — check your internet or proxy (Settings → “Check connection”)',
    'Сессия Ely.by устарела — удали аккаунт и войди заново': 'The Ely.by session has expired — remove the account and sign in again', 'Не получилось прочитать сохранённый вход Ely.by — войди заново': 'Couldn’t read the saved Ely.by sign-in — sign in again',
    'Это не аккаунт Ely.by': 'This isn’t an Ely.by account', 'Нет связи с Ely.by — запускаю без входа в аккаунт. Одиночная игра работает, на серверы зайти не получится': 'Can’t reach Ely.by — launching without signing in. Singleplayer works, joining servers won’t',
    'Нет связи с Ely.by: запускаю без входа в аккаунт': 'Can’t reach Ely.by: launching without signing in', 'Ely.by ✓': 'Ely.by ✓', 'Подключаю Ely.by…': 'Connecting Ely.by…', 'Ely.by подключён ♡': 'Ely.by connected ♡',
  });

  // 0.8.0: выбор Java
  Object.assign(D, {
    'Найти Java': 'Find Java', 'Выбрать файл…': 'Choose a file…', 'Ищу…': 'Searching…', 'Выбери из найденных…': 'Choose from the ones found…',
    'Java на компьютере не нашлось (лаунчер скачает нужную сам)': 'No Java found on this computer (the launcher downloads the right one itself)',
    'Не получилось узнать версию этой Java — похоже, это не Java': 'Couldn’t find out this Java’s version — it doesn’t look like Java',
    'Java по этому пути не найдена — выбери другую или оставь поле пустым': 'No Java at this path — choose another or leave the field empty',
  });

  // 0.8.0: происхождение модов
  Object.assign(D, {
    'неизвестный источник': 'unknown source',
    'Этого файла нет на Modrinth: так бывает с модами с других сайтов и самодельными. Если не знаешь, откуда он взялся, лучше убрать: чужие jar-файлы могут быть вредоносными':
      'This file isn’t on Modrinth: that happens with mods from other sites and homemade ones. If you don’t know where it came from, better remove it: unknown jar files can be malicious',
  });

  // 0.8.0: отчёт для поддержки и лог на mclo.gs
  Object.assign(D, {
    'Отчёт для поддержки': 'Support report', 'Собрать отчёт': 'Build a report', 'Поделиться': 'Share', 'Поделиться логом': 'Share the log',
    'Если что-то не работает и ты просишь помощи: одна кнопка собирает ZIP с версиями, железом, Java, проверкой связи, логами и списком модов выбранной сборки. Паролей и токенов в нём нет, имя пользователя Windows и адреса серверов убраны. Файл остаётся у тебя: сам решай, кому его показать.':
      'If something doesn’t work and you’re asking for help: one button builds a ZIP with versions, hardware, Java, the connection check, logs and the mod list of the selected instance. There are no passwords or tokens in it, and the Windows user name and server addresses are removed. The file stays with you: you decide who to show it to.',
    'Поделиться логом? 📤': 'Share the log? 📤', 'лог из консоли лаунчера': 'the launcher console log', 'лог игры (latest.log и отчёт о вылете, если он есть)': 'the game log (latest.log and the crash report, if there is one)',
    'Лог уйдёт на сайт': 'The log goes to the website', 'и будет доступен всем, у кого есть ссылка; хранится он там ограниченное время. Перед отправкой я убираю токены, имя пользователя из путей, почту и адреса серверов с портом, но если в логе есть что-то личное, лучше не отправлять.':
      'and will be available to anyone who has the link; it is stored there for a limited time. Before sending I remove tokens, the user name from paths, email and server addresses with a port, but if the log holds anything personal, better not to send it.',
    'Не отправлять': 'Don’t send', 'Отправить': 'Send', 'Отправляю…': 'Sending…', 'Ссылка уже в буфере обмена': 'The link is already in the clipboard', 'Просто вставь её в чат:': 'Just paste it into a chat:',
    'Собираю отчёт для поддержки…': 'Building the support report…', 'Отправляю лог на mclo.gs…': 'Sending the log to mclo.gs…', 'собираю отчёт… 📋': 'building the report… 📋',
    'У этой сборки ещё нет логов игры — запусти её хотя бы раз': 'This instance has no game logs yet — launch it at least once', 'Лог пустой — отправлять нечего': 'The log is empty — nothing to send',
  });

  // 0.8.0: быстрый поиск, масштаб, portable
  Object.assign(D, {
    'Быстрый поиск (Ctrl+K)': 'Quick search (Ctrl+K)', 'Быстрый поиск': 'Quick search', 'Что открыть или сделать? Сборка, страница, действие, мод…': 'What to open or do? An instance, page, action, mod…',
    'выбрать': 'select', 'выполнить': 'run', 'закрыть': 'close', 'Ничего не нашлось': 'Nothing found',
    'действие': 'action', 'страница': 'page', 'настройки': 'settings', 'сборка': 'instance', 'мод': 'mod', 'поиск': 'search',
    'Играть': 'Play', 'Оптимизация сборки': 'Optimize the instance', 'Точки восстановления': 'Restore points', 'Настройки сборки': 'Instance settings', 'Открыть папку сборки': 'Open the instance folder',
    'Обновить моды': 'Update mods', 'Новая сборка': 'New instance', 'Импорт сборки': 'Import an instance', 'Проверить связь': 'Check connection', 'Собрать отчёт для поддержки': 'Build a support report',
    'Поделиться логом на mclo.gs': 'Share the log on mclo.gs', 'Войти через Microsoft': 'Sign in with Microsoft', 'Добавить оффлайн-аккаунт': 'Add an offline account', 'Найти Java': 'Find Java',
    'Проверить обновления лаунчера': 'Check for launcher updates', 'Открыть папку лаунчера': 'Open the launcher folder', 'Язык: English': 'Language: English', 'Язык: Русский': 'Language: Russian',
    'Масштаб': 'Scale', 'Ctrl + «+», «−», «0»': 'Ctrl + “+”, “−”, “0”', 'Делает всё в лаунчере крупнее или мельче; окно подстраивается. На большом мониторе удобно 125–150%.': 'Makes everything in the launcher bigger or smaller; the window adjusts. On a big monitor 125–150% is comfortable.',
    'Portable: сборки, миры, Java и настройки лежат рядом с программой, в папке data. Папку целиком можно унести на другой компьютер.': 'Portable: instances, worlds, Java and settings live next to the program, in the data folder. You can carry the whole folder to another computer.',
    'Это portable-версия, но данные остались в профиле Windows: там уже были твои сборки. Чтобы хранить их рядом с программой, закрой лаунчер, создай рядом с exe папку data и перенеси в неё содержимое папки лаунчера.':
      'This is the portable version, but the data stayed in the Windows profile: your instances were already there. To keep them next to the program, close the launcher, create a data folder next to the exe and move the launcher folder’s contents into it.',
  });

  // 0.8.0: один запуск, ярлыки, лог лаунчера, «Играть в этот мир», индикатор связи
  Object.assign(D, {
    'Сборка из ярлыка не найдена — возможно, её удалили': 'The instance from the shortcut wasn’t found — it may have been deleted', 'Эта сборка уже запущена ♡': 'This instance is already running ♡',
    'Эта сборка уже запущена: зайди в мир прямо в игре ♡': 'This instance is already running: join the world right in the game ♡', 'Запустить игру и сразу зайти в этот мир': 'Start the game and jump straight into this world',
    '🖥️ Ярлык на рабочий стол': '🖥️ Desktop shortcut', 'Клик по ярлыку сразу запускает эту сборку': 'Clicking the shortcut launches this instance right away', 'Ярлык создан на рабочем столе ♡': 'Shortcut created on the desktop ♡',
    'Ярлык сборки на рабочий стол': 'Instance shortcut on the desktop', 'Не получилось создать ярлык на рабочем столе': 'Couldn’t create the shortcut on the desktop', 'Некорректный id сборки': 'Invalid instance id',
    'захожу в мир… 😳': 'joining the world… 😳', 'Быстрый вход в мир работает с Minecraft 1.20 и новее': 'Quick join into a world works with Minecraft 1.20 and newer', 'Некорректное имя мира': 'Invalid world name', 'Мир не найден': 'World not found',
    'Открыть лог лаунчера': 'Open the launcher log', 'Ход запуска, ошибки и события лаунчера': 'Launch progress, errors and launcher events', 'Лог лаунчера не ведётся: нет доступа к папке данных': 'The launcher log isn’t kept: no access to the data folder',
    'Что-то пошло не так в фоне — подробности в логе лаунчера': 'Something went wrong in the background — details are in the launcher log',
    'Окно лаунчера неожиданно закрылось и открыто заново — подробности в логе': 'The launcher window closed unexpectedly and was reopened — details are in the log',
    'Связь в порядке': 'The connection is fine', 'Связь ещё не проверялась. Нажми, чтобы проверить': 'The connection hasn’t been checked yet. Click to check',
  });

  // 0.8.0: перенос сборки на новую версию Minecraft
  Object.assign(D, {
    'Перенос на новую версию 🚀': 'Move to a new version 🚀', 'Новая версия Minecraft': 'New Minecraft version', 'Выбери версию — я посмотрю, что для неё вышло.': 'Pick a version — I’ll check what’s out for it.',
    'Смотрю, что вышло под': 'Checking what’s out for', 'Это самая свежая версия Minecraft ♡': 'This is already the newest Minecraft version ♡',
    'Создать копию': 'Create a copy', 'Создать копию на': 'Create a copy for', 'Загрузчик:': 'Loader:', '(подберётся сам)': '(picked automatically)',
    'Модов в сборке нет — в копию перейдут настройки, ресурспаки, шейдеры и миры.': 'There are no mods in this instance — settings, resource packs, shaders and worlds will move to the copy.',
    'Нет под': 'Not available for', 'в копию не попадут: у мода пока нет файла для этой версии': 'won’t go into the copy: the mod has no file for this version yet',
    'Неизвестный источник': 'Unknown source', 'перенесу выключенными — включи в «Моды», если нужно': 'I’ll move them switched off — turn them on in “Mods” if needed',
    'Обновятся': 'Will be updated', 'скачаю версию под новую игру': 'I’ll download the version for the new game', 'Подойдут как есть': 'Fit as they are', 'файл остаётся тем же': 'the file stays the same',
    'Добавлю библиотеки': 'Libraries I’ll add', 'они нужны новым версиям модов': 'the new mod versions need them', 'под эту версию нет': 'not available for this version',
    'подходит по описанию мода': 'fits by the mod’s own description', 'файл под новую игру': 'a file for the new game', 'выключен': 'switched off', 'автор запретил скачивание в лаунчерах': 'the author disallowed downloads in launchers',
    'Скопировать миры': 'Copy the worlds',
    'Это копия: старая сборка останется как есть. Миры в копии откроются новой версией игры и обновятся — в старой сборке они не меняются. Настройки, ресурспаки и шейдеры переедут как есть.':
      'This is a copy: the old instance stays as it is. Worlds in the copy will be opened by the new game version and upgraded — in the old instance they don’t change. Settings, resource packs and shaders move over as they are.',
    'Копия готова 🚀': 'The copy is ready 🚀', 'Отчёт о переносе 🚀': 'Move report 🚀', '📋 Отчёт о переносе': '📋 Move report', 'Отчёта о переносе нет': 'There’s no move report',
    'Что при переносе обновилось и чего не нашлось': 'What was updated and what wasn’t found when moving', 'обновлено': 'updated', 'без изменений': 'unchanged', 'требуют внимания': 'need attention',
    'в копию не попали; в старой сборке всё осталось': 'didn’t make it into the copy; everything is still in the old instance',
    'Не скачались': 'Failed to download', 'попробуй перенос ещё раз': 'try the move again', 'Перенесены выключенными': 'Moved switched off',
    'неизвестный источник — включи в «Моды», если нужно': 'unknown source — turn them on in “Mods” if needed', 'Добавлены библиотеки:': 'Libraries added:',
    'У некоторых модов есть замечания: перед первым запуском лаунчер покажет, что поправить.': 'Some mods have issues: before the first launch the launcher will show what to fix.',
    'Проверка сборки: замечаний нет ✓': 'Instance check: no issues ✓',
    'Перенос отменён: ничего не создано ♡': 'Move cancelled: nothing was created ♡', 'Сначала закрой игру: в мирах идёт запись ♡': 'Close the game first: it’s writing to the worlds ♡',
    'Сначала закрой игру: в мирах идёт запись, и копия получилась бы неполной': 'Close the game first: it’s writing to the worlds, and the copy would be incomplete',
    'переношу сборку на новую версию, старая останется как есть ♡': 'moving the instance to the new version, the old one stays as it is ♡',
    '🚀 На новую версию': '🚀 To a new version', 'Копия сборки на другой версии Minecraft: лаунчер подберёт версии модов': 'A copy of the instance on another Minecraft version: the launcher picks the mod versions',
    'Перенести сборку на новую версию Minecraft': 'Move the instance to a new Minecraft version',
    'Создаю копию сборки…': 'Creating the copy…', 'Проверяю сборку…': 'Checking the instance…', 'Сборка уже на этой версии': 'The instance is already on this version', 'Выбери версию Minecraft': 'Pick a Minecraft version',
  });

  // 0.8.0: поиск мода-виновника
  Object.assign(D, {
    'Найти мод-виновника 🔎': 'Find the culprit mod 🔎', 'проба': 'test', 'из': 'of',
    'Игра без модов': 'The game without mods', 'Сначала проверю, что проблема вообще из-за модов.': 'First I’ll check that the problem is caused by mods at all.',
    'Часть модов': 'Some of the mods', 'Сужаю круг: если проблемы нет, виновник среди выключенных, если есть — среди включённых.': 'Narrowing it down: if there’s no problem, the culprit is among the switched-off mods; if there is, among the enabled ones.',
    'Только подозреваемый': 'Only the suspect', 'Проверяю найденного: правда ли он виноват один.': 'Checking the one I found: whether it’s really to blame on its own.',
    'Сочетания модов': 'Mod combinations', 'Один мод не виноват — ищу сочетание.': 'No single mod is to blame — looking for a combination.',
    'Если игра вылетает или ведёт себя странно, я найду мод, из-за которого это происходит: буду включать часть модов и запускать игру, а ты будешь говорить, повторилась ли проблема. Каждая проба сужает круг вдвое, так что хватит нескольких запусков.':
      'If the game crashes or acts weird, I’ll find the mod that causes it: I’ll enable some of the mods and start the game, and you tell me whether the problem came back. Each test halves the suspects, so a few launches are enough.',
    'Включено модов:': 'Mods enabled:', 'Для поиска нужно хотя бы два включённых мода.': 'The search needs at least two enabled mods.',
    'Все твои моды я потом верну как были (или выключу найденный — как решишь). Перед началом сохраню точку восстановления.': 'I’ll put all your mods back as they were afterwards (or switch off the one I find — your choice). I’ll save a restore point first.',
    'Начать поиск': 'Start the search', 'ищу виновника: включаю моды по частям 🔎': 'looking for the culprit: enabling mods in parts 🔎',
    'Проблема повторилась': 'The problem came back', 'Всё в порядке': 'All fine', 'Включены': 'Enabled', 'вместе с нужными им библиотеками': 'together with the libraries they need',
    'Запусти игру, воспроизведи проблему (или дождись вылета) и закрой игру. Потом я спрошу, повторилась ли она.': 'Start the game, reproduce the problem (or wait for the crash) and close the game. Then I’ll ask whether it came back.',
    'Вернуть всё как было': 'Put everything back as it was', 'Игра запущена…': 'Game is running…', 'Запустить игру': 'Start the game',
    'Игра уже запущена: закрой её, и я задам вопрос ♡': 'The game is already running: close it and I’ll ask a question ♡',
    'Проблема повторилась? 🤔': 'Did the problem come back? 🤔', 'Игра вылетела:': 'The game crashed:', 'Игра закрыта без вылета.': 'The game was closed without a crash.',
    'Нет, всё в порядке': 'No, all fine', 'Да, повторилась': 'Yes, it came back', 'Моды вернула как были ♡': 'Put the mods back as they were ♡',
    'Вернуть все моды как были и закончить поиск?': 'Put all mods back as they were and end the search?',
    'Один мод не виноват 🤔': 'No single mod is to blame 🤔', 'Дело не в модах 🤔': 'It’s not the mods 🤔',
    'Проблема появляется только когда включены все моды сразу. Так бывает, когда не хватает памяти или сборка слишком тяжёлая: выдели игре больше памяти или убери самые тяжёлые моды.':
      'The problem only appears when all the mods are enabled at once. That happens when memory runs short or the instance is too heavy: give the game more memory or remove the heaviest mods.',
    'Проблема повторилась и без модов, значит, виноваты не они. Загляни в «Консоль» и проверь Java, память и драйвер видеокарты.': 'The problem came back even without mods, so they aren’t to blame. Look at the “Console” and check Java, memory and the graphics driver.',
    'Все моды я вернула как были.': 'I put all the mods back as they were.', 'Нашла сочетание 🎯': 'Found a combination 🎯', 'Нашла виновника 🎯': 'Found the culprit 🎯',
    'Проблема появляется только когда эти моды включены вместе. Обычно хватает выключить один из них:': 'The problem appears only when these mods are enabled together. Usually switching off one of them is enough:',
    'Проблема повторяется, когда включён:': 'The problem comes back when this one is enabled:', 'Вместе с ним включаются нужные ему моды:': 'Mods it needs are enabled together with it:',
    'Если проблема останется и без него, поищи ещё раз: возможно, дело в одном из них.': 'If the problem stays even without it, search again: it may be one of them.',
    'Выключить и закончить': 'Switch off and finish', 'Идёт поиск виновника: часть модов выключена ♡': 'The culprit search is in progress: some mods are switched off ♡',
    '🔎 Найти виновника': '🔎 Find the culprit', '🔎 Продолжить поиск виновника': '🔎 Continue the culprit search',
    'Лаунчер по очереди включит части модов и найдёт тот, из-за которого вылет': 'The launcher will enable parts of the mods in turn and find the one causing the crash',
    'Поможет найти мод, из-за которого игра вылетает или глючит': 'Helps find the mod that makes the game crash or glitch', 'Найти мод, из-за которого вылет': 'Find the mod that causes the crash',
    'В ванильной сборке нет модов': 'There are no mods in a vanilla instance', 'Поиск уже идёт: продолжи его или верни моды как были': 'A search is already in progress: continue it or put the mods back',
    'Для поиска нужно хотя бы два включённых мода': 'The search needs at least two enabled mods', 'Поиск не начат': 'The search hasn’t started', 'Поиск уже закончен': 'The search is already finished',
    'Перед поиском виновника': 'Before the culprit search',
  });

  // 0.8.0: выбор версии загрузчика
  Object.assign(D, {
    'Версия загрузчика': 'Loader version', 'пре-релизы': 'pre-releases', 'Загружаю…': 'Loading…',
    'После первого запуска лаунчер запоминает версию загрузчика, чтобы его новый выход не сломал моды. Хочешь обновить её или вернуть старую — выбери здесь.':
      'After the first launch the launcher remembers the loader version so that a new release of it doesn’t break your mods. To update it or go back to an older one, choose here.',
    'Последняя стабильная (поставлю при запуске)': 'Latest stable (I’ll install it on launch)',
    'С выбранной версией эти моды могут не запуститься:': 'These mods may not start with the selected version:', 'требует загрузчик': 'needs loader',
    'Некорректная версия игры': 'Invalid game version',
  });

  // «Последний удачный запуск»: закреплённая точка и блок «что изменилось» в окне вылета
  Object.assign(D, {
    'Последний удачный запуск': 'Last successful launch', 'С последнего удачного запуска': 'Since the last successful launch',
    'Моды, загрузчик и версия игры те же, что при последнем удачном запуске': 'The mods, the loader and the game version are the same as at the last successful launch',
    'Добавлено:': 'Added:', 'Включено:': 'Switched on:', 'Изменено:': 'Changed:', 'Убрано:': 'Removed:', 'Выключено:': 'Switched off:',
    'Загрузчик:': 'Loader:', 'Версия загрузчика:': 'Loader version:', 'Модпак:': 'Modpack:', 'без модпака': 'no modpack', 'авто (последняя)': 'auto (latest)',
    '🕘 Откатить на последний удачный запуск': '🕘 Roll back to the last successful launch',
    'Вернёт моды, папку config и версию загрузчика такими, какими они были при последнем удачном запуске. Нынешнее состояние я сохраню, так что откат можно отменить':
      'Puts the mods, the config folder and the loader version back as they were at the last successful launch. I’ll save the current state first, so the rollback can be undone',
    'Закреплена: обновляется сама после каждой нормальной игры и в лимит точек не входит': 'Pinned: it updates itself after every normal game and doesn’t count towards the limit of points',
    '«Последний удачный запуск» закреплена сверху: я обновляю её сама после каждой нормальной игры (дольше трёх минут, без вылета и без правок модов во время игры) и в лимит точек не считаю. Если игра вылетит, окно вылета покажет, что изменилось с этой точки, и предложит вернуться к ней.':
      '“Last successful launch” is pinned to the top: I update it myself after every normal game (longer than three minutes, no crash and no mod changes during the game) and don’t count it towards the limit of points. If the game crashes, the crash window shows what has changed since this point and offers to go back to it.',
  });

  // «Войти к другу»: код сборки, сверка модов, установка точных версий
  Object.assign(D, {
    'Войти к другу 🚪': 'Join a friend 🚪', 'Адрес мира и моды друга — одним сообщением': 'The world address and your friend’s mods — in one message',
    'Сообщение друга': 'Your friend’s message', 'Вставь сюда всё, что прислал друг: адрес мира и код сборки': 'Paste everything your friend sent: the world address and the pack code',
    'Адрес мира': 'World address', 'xxx.e4mc.link или адрес:порт': 'xxx.e4mc.link or address:port',
    'Сверить моды': 'Check the mods', 'Сверяю…': 'Checking…', 'Поставить как у друга': 'Install like your friend’s', 'Создать сборку и поставить моды': 'Create the instance and install the mods',
    'Зайти ▶': 'Join ▶', 'Зайти всё равно ▶': 'Join anyway ▶',
    'Друг копирует код кнопкой «Код сборки» в окне «Играть с другом». Если кода нет, достаточно адреса: я просто зайду на него.': 'Your friend copies the code with the “Pack code” button in the “Play with a friend” window. Without a code the address is enough: I’ll just join it.',
    'Кода сборки в сообщении нет: зайду на адрес без сверки модов.': 'There’s no pack code in the message: I’ll join the address without checking the mods.',
    'Сборка друга:': 'Friend’s pack:', '· модов у друга:': '· mods the friend has:',
    'Версия игры или загрузчик не совпадают.': 'The game version or the loader doesn’t match.', 'У друга:': 'Friend:', 'у тебя:': 'you:',
    'Моды друга под другую версию не подходят: выбери сборку с такой же версией или создай новую «как у друга».': 'The friend’s mods don’t fit another version: pick an instance with the same version or create a new one “like your friend’s”.',
    'Версия загрузчика у друга другая:': 'The friend’s loader version is different:', 'Обычно это не мешает.': 'That usually doesn’t matter.',
    'Совпало': 'Matching', 'Поставлю': 'To install', 'Заменю': 'To replace', 'Включу': 'To switch on', 'Нужны файлы от друга': 'Files needed from your friend', 'Лишних у тебя': 'Extra on your side',
    'Моды те же, что у друга ♡': 'The mods are the same as your friend’s ♡',
    'Заменю на версию друга': 'Will be replaced by your friend’s version', 'Включу (сейчас выключены)': 'Will be switched on (currently off)', 'Есть у тебя, но нет у друга': 'You have them, your friend doesn’t',
    'не с Modrinth — попроси файл у друга': 'not from Modrinth — ask your friend for the file',
    'у тебя файл с таким именем, но другой — попроси у друга его файл': 'you have a file with this name, but a different one — ask your friend for theirs',
    'версию удалили с Modrinth — поставить нечего': 'the version was removed from Modrinth — nothing to install',
    'не с Modrinth': 'not from Modrinth', 'Не получилось поставить:': 'Couldn’t install:',
    'Эта сборка уже запущена: закрой игру и нажми «Зайти» снова': 'This instance is already running: close the game and press “Join” again',
    'Адрес и код сборки скопированы — отправь их другу ♡': 'The address and pack code are copied — send them to your friend ♡',
    'Код сборки скопирован — отправь его другу вместе с адресом ♡': 'The pack code is copied — send it to your friend together with the address ♡',
    '📋 Код сборки': '📋 Pack code', '📋 Адрес и код сборки': '📋 Address and pack code', 'Собираю…': 'Building…',
    'Короткий текст со списком твоих модов: друг вставит его в «Войти к другу», и лаунчер поставит ему такие же. В код попадают только версия игры, загрузчик и id модов на Modrinth: ни путей, ни названия сборки, ни аккаунтов':
      'A short text with the list of your mods: your friend pastes it into “Join a friend” and the launcher installs the same ones. The code holds only the game version, the loader and the Modrinth mod ids: no paths, no instance name, no accounts',
    'Скопирует адрес и код сборки одним сообщением: друг вставит его в «Войти к другу», и лаунчер сверит его моды с твоими': 'Copies the address and the pack code as one message: your friend pastes it into “Join a friend” and the launcher compares their mods with yours',
    '🚪 Войти к другу': '🚪 Join a friend', 'Вставить сообщение друга: адрес мира и код сборки. Лаунчер сверит моды, поставит недостающее и зайдёт': 'Paste your friend’s message: the world address and the pack code. The launcher compares the mods, installs what’s missing and joins',
    'Войти к другу (адрес и код сборки)': 'Join a friend (address and pack code)', 'Скопировать код сборки для друга': 'Copy the pack code for a friend',
    // сообщения главного процесса
    'Это не код сборки: он начинается с «FLM1:». Скопируй сообщение друга целиком': 'This isn’t a pack code: it starts with “FLM1:”. Copy your friend’s message in full',
    'Этот код сделан более новой версией лаунчера — обнови лаунчер и вставь код снова': 'This code was made by a newer launcher version — update the launcher and paste it again',
    'Код слишком большой — так выглядит не код сборки': 'The code is too big — this doesn’t look like a pack code',
    'Код повреждён: при копировании что-то потерялось или изменилось. Попроси друга скопировать его заново': 'The code is damaged: something got lost or changed while copying. Ask your friend to copy it again',
    'В тексте нет ни адреса, ни кода сборки': 'There’s neither an address nor a pack code in the text', 'В тексте нет кода сборки: вставь сообщение друга целиком': 'There’s no pack code in the text: paste your friend’s message in full',
    'Нет связи с Modrinth — без неё моды не опознать и не скачать. Проверь интернет и попробуй ещё раз': 'Can’t reach Modrinth — without it the mods can’t be identified or downloaded. Check your internet and try again',
    'Файл мода отдаётся не по https — не скачиваю': 'The mod file isn’t served over https — not downloading it', 'Выбери сборку': 'Choose an instance',
    'Собираю код сборки…': 'Building the pack code…', 'Сверяю моды с Modrinth…': 'Checking the mods against Modrinth…', 'Перед установкой модов друга': 'Before installing the friend’s mods',
  });

  // «Пора на новую версию?»: значок на карточке и выключатель в настройках
  Object.assign(D, {
    'Столько модов этой сборки уже вышло под новую версию Minecraft. Нажми, чтобы посмотреть, что получится при переносе': 'This many mods of this instance are already out for the new Minecraft version. Click to see what a migration would do',
    'Подсказывать, когда моды готовы к новой версии Minecraft': 'Tell me when the mods are ready for a new Minecraft version',
    'Раз в сутки лаунчер в фоне спрашивает у Modrinth, сколько модов каждой сборки уже вышло под самую свежую версию игры, и показывает значок «🚀 версия: готовы N из M модов» (по нему открывается перенос). На Modrinth уходят хэши файлов модов, как и при проверке обновлений; ничего не скачивается и не меняется. Выключи, если не нужно.':
      'Once a day the launcher asks Modrinth in the background how many mods of each instance are already out for the newest game version, and shows a “🚀 version: N of M mods ready” badge (it opens the migration). The hashes of the mod files go to Modrinth, as with the update check; nothing is downloaded or changed. Turn it off if you don’t need it.',
  });

  // «Коллекция Modrinth»: окно импорта по ссылке (и сообщения core/collection.js, которые доходят до окна)
  Object.assign(D, {
    'Коллекция': 'Collection', 'Поставить моды, ресурспаки и шейдеры из коллекции Modrinth по ссылке': 'Install mods, resource packs and shaders from a Modrinth collection by link',
    'Импорт коллекции Modrinth (по ссылке)': 'Import a Modrinth collection (by link)',
    'Коллекция Modrinth 📚': 'Modrinth collection 📚', 'Вставь ссылку на коллекцию — поставлю её моды, ресурспаки и шейдеры': 'Paste a collection link — I’ll install its mods, resource packs and shaders',
    'Ссылка на коллекцию': 'Collection link', 'Показать': 'Show', 'Читаю коллекцию…': 'Reading the collection…',
    'Коллекции делают люди на modrinth.com: в них собраны любимые моды, ресурспаки и шейдеры. Закрытые (приватные) коллекции лаунчер не видит.': 'People make collections on modrinth.com: favourite mods, resource packs and shaders. The launcher can’t see closed (private) collections.',
    'Куда ставить': 'Install to', '➕ Новая сборка': '➕ New instance', 'Загрузчик': 'Loader', 'Название (как у коллекции)': 'Name (as in the collection)',
    'Все подходящие': 'All that fit', 'Снять все': 'Clear all', 'В коллекции пока ничего нет.': 'The collection is empty so far.',
    'нет под эту версию игры': 'no version for this game version', 'нет под этот загрузчик': 'none for this loader',
    'в сборку не ставится: модпаки ставятся из «Моды → Модпаки»': 'can’t go into an instance: modpacks are installed from “Mods → Modpacks”',
    'Открыть сборку': 'Open instance', 'Ничего не поставилось': 'Nothing was installed', 'ничего не поставилось': 'nothing was installed',
    'Коллекция не найдена. Проверь ссылку; закрытые (приватные) коллекции лаунчер не видит': 'Collection not found. Check the link; the launcher can’t see closed (private) collections',
    'Не вижу ссылки на коллекцию Modrinth: она выглядит как modrinth.com/collection/abcd1234': 'I can’t see a Modrinth collection link: it looks like modrinth.com/collection/abcd1234',
    'Modrinth ответил не так, как ожидалось: это точно коллекция?': 'Modrinth answered unexpectedly: is this really a collection?',
    'Некорректный код коллекции': 'Invalid collection code', 'Не выбрана версия Minecraft для новой сборки': 'No Minecraft version chosen for the new instance',
    'Из выбранного ничего поставить нельзя': 'None of the selected items can be installed', 'такого проекта нет в этой коллекции': 'there’s no such project in this collection',
    'модпак в сборку так не ставится — модпаки ставятся из «Моды → Модпаки»': 'a modpack can’t be put into an instance this way — modpacks are installed from “Mods → Modpacks”',
    'Перед импортом коллекции': 'Before importing a collection',
    '👥 как у друга': '👥 like a friend’s',
    'Следовать за сборкой друга: моды, которых у него нет, отключу (вернуть можно из точки восстановления). Когда друг обновит моды, вставь его новый код сюда же': 'Follow the friend’s pack: mods they don’t have will be switched off (you can bring them back from a restore point). When the friend updates their mods, paste their new code here',
    'Отключу лишних': 'Will switch off', 'Есть у тебя, но нет у друга: отключу': 'You have it, the friend doesn’t: will switch off', 'Сделать как у друга': 'Make it like the friend’s',
    'Одинаковые моды': 'Identical mods', 'Найти одинаковые моды': 'Find identical mods', 'Объединить': 'Merge', 'Сверяю моды…': 'Comparing mods…', 'Одинаковых модов нет ♡': 'No identical mods ♡',
    'Один и тот же мод часто лежит сразу в нескольких сборках. Лаунчер может хранить его одним файлом: в каждой сборке всё остаётся как есть, а места нужно меньше. Если потом заменить такой файл вручную поверх (а не удалить и положить новый), он изменится сразу во всех сборках.':
      'The same mod often sits in several instances at once. The launcher can keep it as a single file: everything stays as it is in each instance, but less space is needed. If you later replace such a file by hand on top of itself (instead of deleting it and putting a new one), it changes in all instances at once.',
  });

  // «Вышли обновления модов»: значок на карточке, «Что нового» в окне обновлений и выключатель в настройках
  Object.assign(D, {
    'Что нового': 'What’s new',
    'Подсказывать, когда вышли обновления модов': 'Tell me when mod updates are out',
    'Раз в сутки лаунчер в фоне спрашивает у Modrinth, вышли ли новые версии модов каждой сборки, и показывает на карточке значок «N обновлений модов»: по нему открывается окно «Обновить моды» с описанием изменений. Сам ничего не ставит и не скачивает; на Modrinth уходят хэши файлов модов, как и при ручной проверке. Выключи, если не нужно.':
      'Once a day the launcher asks Modrinth in the background whether new versions of the mods of each instance are out, and shows an “N mod updates” badge on the card: it opens the “Update mods” window with the changes described. It installs and downloads nothing by itself; the hashes of the mod files go to Modrinth, as with the manual check. Turn it off if you don’t need it.',
  });

  // «Итоги игры»: окно с картинкой (сама картинка и её подпись приходят из главного процесса уже на нужном языке)
  Object.assign(D, {
    '🖼️ Итоги недели и месяца': '🖼️ Weekly and monthly recap', 'Картинка с итогами за неделю или месяц: можно сохранить или скопировать': 'A picture with the weekly or monthly recap: save it or copy it',
    'Итоги игры 🖼️': 'Play recap 🖼️', 'Картинка за неделю или месяц — можно показать друзьям': 'A picture of your week or month — you can show it to friends',
    'За какой срок': 'Period', 'Неделя': 'Week', 'Месяц': 'Month', 'Скрыть названия сборок': 'Hide instance names',
    'За этот срок игр ещё не было — сыграй, и тут появятся итоги ♡': 'No games in this period yet — play a bit and the recap will appear here ♡',
    'Картинка рисуется здесь же и никуда не отправляется. Если покажешь её друзьям, названия сборок можно скрыть.': 'The picture is drawn right here and isn’t sent anywhere. If you show it to friends, you can hide the instance names.',
    'Сохранить картинку': 'Save picture', 'Картинка сохранена ♡': 'Picture saved ♡', 'Картинка скопирована ♡': 'Picture copied ♡',
    'Итоги недели и месяца (картинка)': 'Weekly and monthly recap (picture)',
    'Картинка не получена': 'The picture wasn’t received', 'Картинка слишком большая': 'The picture is too big',
    'Не удалось скопировать картинку': 'Couldn’t copy the picture',
  });

  // Строки с подстановками: [шаблон, замена]
  const P = [
    [/^Не удалось сохранить картинку: (.+)$/, 'Couldn’t save the picture: $1'],
    [/^Выбрано: (\d+)(?: · не подойдут: (\d+))?$/, (m, a, b) => `Selected: ${a}${b ? ` · won’t fit: ${b}` : ''}`],
    [/^Поставить: (\d+)$/, 'Install: $1'],
    [/^(\d+) (?:проект|проекта|проектов)$/, (m, n) => `${n} ${n === '1' ? 'project' : 'projects'}`],
    [/^удалено автором: (\d+)$/, 'removed by the author: $1'],
    [/^показаны первые (\d+), ещё (\d+) не загружены$/, 'showing the first $1, $2 more not loaded'],
    [/^Для новой сборки подойдёт Minecraft (.+): под него есть (\d+) из (\d+)$/, (m, v, a, b) => `A new instance would fit Minecraft ${v.replace('Ванилла', 'Vanilla')}: ${a} of ${b} have a version for it`],
    [/^Создана сборка «(.+)»$/, 'Created instance “$1”'],
    [/^Готово: «(.+)»$/, 'Done: “$1”'],
    [/^поставлено: (\d+)$/, 'installed: $1'],
    [/^Не вышло: (\d+)$/, 'Failed: $1'],
    [/^(\w+) в сборку так не ставится$/, '$1 can’t be put into an instance this way'],
    [/^Не получилось поставить ничего: (.+)$/, (m, rest) => `Couldn’t install anything: ${rest.split('; ').map((s) => { const k = /^«(.+?)» — (.+)$/.exec(s); return k ? `“${k[1]}” — ${tr(k[2])}` : tr(s); }).join('; ')}`],
    [/^(\d+) (?:обновление|обновления|обновлений) модов$/, (m, n) => `${n} mod ${n === '1' ? 'update' : 'updates'}`],
    [/^Вышли обновления модов: (.+)\. Нажми, чтобы посмотреть, что нового, и обновить$/, (m, names) => `Mod updates are out: ${names.replace(/ и ещё (\d+)$/, ' and $1 more')}. Click to see what’s new and update`],
    [/^(.+) · (рекомендуемая|последняя|пре-релиз|сейчас)$/, (m, v, w) => `${v} · ${{ рекомендуемая: 'recommended', последняя: 'latest', 'пре-релиз': 'pre-release', сейчас: 'current' }[w]}`],
    [/^(Fabric|Quilt|Forge|NeoForge) (.+) для Minecraft (.+) не найден — выбери другую версию загрузчика в настройках сборки$/, '$1 $2 for Minecraft $3 not found — choose another loader version in the instance settings'],
    [/^Выключила: (.+)\. Остальное вернула как было ♡$/, 'Switched off: $1. Put the rest back as it was ♡'],
    [/^Поиск виновника в «(.+)» не закончен: часть модов выключена\. «Ещё → Продолжить поиск виновника» продолжит или вернёт всё как было$/, 'The culprit search in “$1” isn’t finished: some mods are switched off. “More → Continue the culprit search” will continue it or put everything back'],
    [/^Смотрю, что есть под (.+)…$/, 'Checking what’s available for $1…'],
    [/^Копирую файлы сборки… \((\d+)\)$/, 'Copying instance files… ($1)'],
    [/^Переношу моды \((\d+) \/ (\d+)\)…$/, 'Moving mods ($1 / $2)…'],
    [/^Ставлю нужные библиотеки \((\d+) \/ (\d+)\)…$/, 'Installing the needed libraries ($1 / $2)…'],
    [/^Нужна библиотека «(.+)», но под эту версию её пока нет$/, 'The library “$1” is needed, but there’s no version of it for this game version yet'],
    [/^На диске не хватает места для загрузки: нужно около (.+), свободно (.+)\. Освободи место \(Настройки → «Место и переезд» → «Освободить место»\) и запусти снова$/, 'Not enough disk space for the download: about $1 needed, $2 free. Free up some space (Settings → “Space and moving” → “Free up space”) and try again'],
    [/^На диске не хватает места для копии: нужно около (.+), свободно (.+)$/, 'Not enough disk space for the copy: about $1 needed, $2 free'],
    [/^Версия (.+) не найдена$/, 'Version $1 not found'],
    [/^(Forge|NeoForge) для (.+) не найден$/, '$1 for $2 not found'],
    [/^Не отвечают: (.+)\. Нажми, чтобы проверить$/, 'Not responding: $1. Click to check'],
    [/^Нет связи: (.+)\. Нажми, чтобы проверить$/, 'No connection: $1. Click to check'],
    [/^Запускаю и захожу в мир «(.+)»…$/, 'Starting and opening the world “$1”…'],
    [/^Тема: (.+)$/, (m, t) => `Theme: ${tr(t)}`],
    [/^Настройки: (.+)$/, (m, t) => `Settings: ${tr(t)}`],
    [/^Масштаб интерфейса: (\d+)%$/, 'Interface scale: $1%'],
    [/^Играть: (.+)$/, 'Play: $1'],
    [/^Искать «(.+)» на Modrinth$/, 'Search “$1” on Modrinth'],
    [/^Отчёт готов \((.+)\) — папка с ним открыта ♡$/, 'The report is ready ($1) — its folder is open ♡'],
    [/^Нет связи с mclo\.gs \((.+)\)$/, 'Can’t reach mclo.gs ($1)'],
    [/^mclo\.gs не принял лог: (.+)$/, 'mclo.gs didn’t accept the log: $1'],
    [/^У (\d+) (?:мода|модов) неизвестный источник: этих файлов нет на Modrinth\. Так бывает с модами с других сайтов, но если не помнишь, откуда файл взялся, лучше убрать его: чужие jar-файлы могут быть вредоносными\.$/, (m, n) => `${n} ${n === '1' ? 'mod has' : 'mods have'} an unknown source: these files aren’t on Modrinth. That happens with mods from other sites, but if you don’t remember where a file came from, better remove it: unknown jar files can be malicious.`],
    [/^Игре нужна Java (\d+) или новее, а здесь Java (\d+): игра не запустится$/, 'The game needs Java $1 or newer, but this is Java $2: the game won’t start'],
    [/^(.+): подходит игре ✓$/, '$1: fits the game ✓'],
    [/^(.+): 32-битная Java не даст выделить игре больше 1,5 ГБ памяти$/, '$1: 32-bit Java can’t give the game more than 1.5 GB of memory'],
    [/^(.+): игра рассчитана на Java (\d+), с модами \(особенно с Forge\) на более новой может не запускаться\. Надёжнее оставить «Авто»$/, '$1: the game is made for Java $2, with mods (especially Forge) a newer one may fail to start. Safer to leave “Auto”'],
    [/^(.+)\. Выбери другую Java в настройках или очисти поле: лаунчер скачает нужную сам$/, (m, e) => `${tr(e)}. Pick another Java in the settings or clear the field: the launcher downloads the right one itself`],
    [/^Ely\.by ответил: (.+)$/, 'Ely.by replied: $1'],
    [/^Ely\.by не подключён: (.+)$/, (m, e) => `Ely.by isn’t connected: ${tr(e)}`],
    [/^Настройки Ely\.by не получены \((.+)\) — агент возьмёт их сам$/, 'Ely.by settings weren’t fetched ($1) — the agent will get them itself'],
    [/^(\d+) (мод|мода|модов)$/, (m, n) => `${n} ${n === '1' ? 'mod' : 'mods'}`],
    [/^с тех пор (.+)$/, 'since then $1'],
    [/^Вернула «(.+)» ✧$/, (m, r) => `Restored “${tr(r)}” ✧`],
    [/^Не получилось подменить папку (.+): (.+)$/, 'Couldn’t replace the $1 folder: $2'],
    [/^Точка восстановления не сохранилась: (.+)$/, 'The restore point wasn’t saved: $1'],
    [/^Точка восстановления «последний удачный запуск» не сохранилась: (.+)$/, 'The “last successful launch” restore point wasn’t saved: $1'],
    [/^и ещё (\d+)$/, 'and $1 more'],
    [/^готовы (\d+) из (\d+) (?:мода|модов)$/, '$1 of $2 mods ready'],
    // «Войти к другу»
    [/^Код обрезан: не хватает (\d+) знаков в конце\. Скопируй сообщение друга целиком \(длинные сообщения чаты иногда режут на части\)$/, 'The code is cut off: $1 characters are missing at the end. Copy your friend’s message in full (chats sometimes split long messages)'],
    [/^В коде сборки что-то не так \((.+)\) — попроси друга скопировать его заново$/, (m, w) => `Something is wrong in the pack code (${{ формат: 'format', 'версия кода': 'code version', 'версия игры': 'game version', загрузчик: 'loader', 'версия загрузчика': 'loader version', 'список модов': 'mod list', 'чужие файлы': 'other files', содержимое: 'contents' }[w] || w}) — ask your friend to copy it again`],
    [/^Modrinth ответил ошибкой \(HTTP (\d+)\) — попробуй позже$/, 'Modrinth answered with an error (HTTP $1) — try again later'],
    [/^У друга Minecraft (.+) · (.+), а в «(.+)» (.+) · (.+): моды друга под другую версию не подходят\. Выбери сборку с такой же версией или создай новую «как у друга»$/, (m, a, b, n, c, d) => `The friend has Minecraft ${a} · ${b.replace('Ванилла', 'Vanilla')}, but “${n}” is ${c} · ${d.replace('Ванилла', 'Vanilla')}: the friend’s mods don’t fit another version. Pick an instance with the same version or create a new one “like your friend’s”`],
    [/^Файл «(.+)» уже есть и отличается от нужного — убери его из папки mods и повтори$/, 'The file “$1” is already there and differs from the one needed — remove it from the mods folder and try again'],
    [/^Ставлю (.+) \((\d+) \/ (\d+)\)…$/, 'Installing $1 ($2 / $3)…'],
    [/^Заменяю (.+) \((\d+) \/ (\d+)\)…$/, 'Replacing $1 ($2 / $3)…'],
    [/^Включаю (.+) \((\d+) \/ (\d+)\)…$/, 'Switching on $1 ($2 / $3)…'],
    [/^Готово: поставлено (\d+), заменено (\d+), включено (\d+)(?:, отключено (\d+))?(?:, не вышло (\d+))?$/, (m, a, b, c, off, d) => `Done: installed ${a}, replaced ${b}, switched on ${c}${off ? `, switched off ${off}` : ''}${d ? `, failed ${d}` : ''}`],
    [/^Не с Modrinth: (\d+) — их другу придётся отправить файлами$/, 'Not from Modrinth: $1 — your friend will need those files sent separately'],
    [/^Моды не с Modrinth \(другу нужно отправить файлы\): (.+)$/, 'Mods not from Modrinth (your friend needs the files): $1'],
    [/^➕ Новая сборка как у друга · (.+)$/, (m, v) => `➕ New instance like your friend’s · ${v.replace('Ванилла', 'Vanilla')}`],
    // 0.8.0: идут раньше общих, иначе «Нет связи с … (…)» перехватит длинное сообщение
    [/^(.+) — без интернета запускается только то, что уже скачано \(для первого запуска нужна связь\)$/, (m, e) => `${tr(e)} — without internet only what’s already downloaded can launch (the first launch needs a connection)`],
    [/^Лаунчер ходит через (HTTP|HTTPS|SOCKS)-прокси (.+) \((из настроек|так настроен Windows)\)\.$/, (m, k, a, s) => `The launcher goes online through the ${k} proxy ${a} (${s === 'из настроек' ? 'from the settings' : 'as Windows is set up'}).`],
    [/^Прокси для игры: (.+) \((из настроек|так настроен Windows)\)$/, (m, a, s) => `Proxy for the game: ${a} (${s === 'из настроек' ? 'from the settings' : 'as Windows is set up'})`],
    [/^Прокси (.+) не отвечает — игра идёт в сеть напрямую$/, 'The proxy $1 isn’t answering — the game goes online directly'],
    [/^Белый список друзей записан: (.+)$/, 'Friends’ whitelist saved: $1'],
    [/^Белый список друзей не записан: (.+)$/, 'Friends’ whitelist wasn’t saved: $1'],
    [/^Белый список записан: (.+) ♡$/, 'Whitelist saved: $1 ♡'],
    [/^Найдено: (\d+) из (\d+)$/, 'Found: $1 of $2'],
    [/^считаю с (.+)$/, 'counting since $1'],
    [/^Мир открыт по сети на порту (\d+)\. Другу в той же сети или VPN: (.+)$/, 'The world is open on the network on port $1. For a friend on the same network or VPN: $2'],
    [/^Мир открыт по сети на порту (\d+)$/, 'The world is open on the network on port $1'],
    [/^Сохранила копию мира «(.+)» перед тем, как его откроют друзьям ♡$/, 'Saved a copy of the world “$1” before it is opened to friends ♡'],
    [/^Копия мира «(.+)» перед друзьями уже есть: сохранена меньше получаса назад$/, 'The pre-friends copy of the world “$1” already exists: saved less than half an hour ago'],
    [/^Копия мира перед друзьями не сохранилась: (.+)$/, 'The world copy before friends wasn’t saved: $1'],
    [/^Закреплённые моды не обновляются: (\d+)\.$/, 'Pinned mods are not updated: $1.'],
    [/^Все остальные моды свежие ♡ Закреплено, не проверялось: (\d+)$/, 'All the other mods are up to date ♡ Pinned, not checked: $1'],
    [/^проверено (\d+), скачано заново: (\d+)$/, 'checked $1, downloaded again: $2'],
    [/^(.+) заходит в мир ♡$/, '$1 joins the world ♡'],
    [/^(.+) выходит из мира$/, '$1 leaves the world'],
    [/^Ник «(.+)» скопирован ✧$/, 'Nickname “$1” copied ✧'],
    [/^Сборка «(.+)» вернулась ♡$/, 'Instance “$1” is back ♡'],
    [/^Белый список очищен: (.+)\. В следующий мир друзей нужно добавить заново \(в «Играть с другом» — «Подготовить»\)$/, 'Whitelist cleared: $1. For the next world, add your friends again (“Play with a friend” → “Prepare”)'],
    [/^Лицензионного аккаунта «(.+)» нет — записала друга как «без лицензии»$/, 'There is no licensed account “$1” — saved the friend as “no license”'],
    [/^Не смогла проверить, есть ли лицензия у «(.+)»: если нет, отметь «без лицензии»$/, 'Couldn’t check whether “$1” has a license: if not, tick “no license”'],
    [/^Лицензионного аккаунта нет у (.+) — записала как друзей без лицензии$/, 'There is no licensed account for $1 — saved as friends without a license'],
    [/^Не смогла узнать UUID у (.+) \(нет связи с Mojang\): нажми «Подготовить» ещё раз, когда связь появится$/, 'Couldn’t get the UUID of $1 (no connection to Mojang): press “Prepare” again when the connection is back'],
    [/^«(.+)» уже есть в списке друзей$/, '“$1” is already in the friends list'],
    [/^В списке друзей не больше (\d+)$/, 'There can be at most $1 friends in the list'],
    [/^У (.+) нет лицензионного аккаунта: друг записан как друг без лицензии$/, '$1 has no licensed account: saved as a friend without a license'],
    [/^Не смогла узнать UUID у (.+): нет связи с Mojang$/, 'Couldn’t get the UUID of $1: no connection to Mojang'],
    [/^Привет, (.+) ~$/, 'Hi, $1 ~'],
    // главная
    [/^вместе(?: · последний запуск (.+))?$/, (m, d) => 'together' + (d ? ` · last played ${d}` : '')],
    [/^(\d+) (?:мод|мода|модов)$/, (m, n) => `${n} mod${n === '1' ? '' : 's'}`],
    [/^(\d+) (?:мир|мира|миров)$/, (m, n) => `${n} world${n === '1' ? '' : 's'}`],
    [/^(\d+) (?:проблема|проблемы|проблем)$/, (m, n) => `${n} issue${n === '1' ? '' : 's'}`],
    [/^Наряд «(.+)»$/, (m, n) => `Outfit “${tr(n)}”`],
    [/^Встроенная: (.+) · Мощная: (.+)$/, 'Built-in: $1 · Powerful: $2'],
    [/^Нашла на компьютере: (.+)$/, (m, list) => 'Found on this computer: ' + list.replace(/ и ещё (\d+)$/, ' and $1 more')],
    [/^Поставить \((\d+)\)$/, 'Install ($1)'],
    [/^Поставить (\d.*)$/, 'Set $1'],
    [/^(\d+) (?:совет|совета|советов)$/, (m, n) => `${n} tip${n === '1' ? '' : 's'}`],
    [/^В ноутбуке две видеокарты: (.+) и (.+)\. Если Windows запустит игру на встроенной, кадров будет мало\.$/, 'Your laptop has two graphics cards: $1 and $2. If Windows runs the game on the built-in one, the FPS will be low.'],
    [/^Игре отдано (.+)\. С (.+) сборка грузится быстрее и реже подвисает\.$/, 'The game has $1. With $2 the instance loads faster and stutters less.'],
    [/^Игре отдано (.+) из (.+)\. Остальному в Windows не хватает, а Java долго убирает мусор — отсюда подвисания\.$/, 'The game has $1 of $2. Windows lacks memory for everything else and Java takes long to collect garbage — hence the stutters.'],
    [/^Не нашла (.+?)(?: и ещё (\d+))?\. Они заметно прибавляют кадров\.$/, (m, names, more) => `Couldn’t find ${names}${more ? ` and ${more} more` : ''}. They add a lot of FPS.`],
    [/^Сейчас (\d+) чанков — для этого компьютера тяжеловато\.$/, 'Currently $1 chunks — a bit heavy for this computer.'],
    [/^Ресурспаки занимают (\d+) МБ: игра дольше грузится и ест больше памяти\.$/, 'Resource packs take $1 MB: the game loads longer and uses more memory.'],
    [/^Сейчас: (.+) чанков · (.+) FPS$/, 'Now: $1 chunks · $2 FPS'],
    [/^нет для (.+)$/, 'not available for $1'],
    [/^Оптимизация: не поставила — (.+)$/, (m, rest) => 'Optimization: couldn’t install — ' + rest.replace(/нет для /g, 'not available for ')],
    [/^В твоём ноутбуке две видеокарты: (.+) \(встроенная\) и (.+)\. Windows нередко .+$/, 'Your laptop has two graphics cards: $1 (built-in) and $2. Windows often runs Minecraft on the built-in one, and then the FPS is low. I can ask Windows to run the launcher’s Java on the powerful one: it’s the regular “Graphics settings” option, I don’t touch the drivers.'],
    [/^синхронизировано (.+)$/, 'synced $1'],
    [/^(\d+) из (\d+) открыто$/, '$1 of $2 unlocked'],
    [/^(.+) · Оффлайн$/, '$1 · Offline'],
    // перенос из других лаунчеров
    [/^Выбрано: (\d+)\. Займёт на диске: (.+)$/, 'Selected: $1. Disk space needed: $2'],
    [/^Перенесено сборок: (\d+) ♡$/, 'Instances moved: $1 ♡'],
    [/^Переношу из других лаунчеров… (.+)$/, 'Moving from other launchers… $1'],
    [/^Переношу «(.+)»…$/, 'Moving “$1”…'],
    [/^можно освободить (.+)$/, 'can free $1'],
    [/^Удалить программу «(.+)»$/, 'Uninstall “$1”'],
    [/^Запустить удаление программы «(.+)»\? .+$/, 'Run the uninstaller of “$1”? Its own window will open — you’ll need to confirm there once more.'],
    [/^Убрать старые копии в Корзину \((\d+) шт\.\)\? .+$/, 'Move $1 old copies to the Recycle Bin? Everything stays in Femboy Launcher.'],
    [/^Не тронула: (.+)$/, 'Left alone: $1'],
    [/^сборок: (\d+)(?: · миров: (\d+))?$/, (m, a, b) => `instances: ${a}${b ? ` · worlds: ${b}` : ''}`],
    [/^миров: (\d+)$/, 'worlds: $1'],
    [/^Не знаю версию игры для «(.+)» — выбери её в списке$/, 'Don’t know the game version for “$1” — pick it in the list'],
    [/^Папка «(.+)» уже есть в сборке$/, 'Folder “$1” already exists in the instance'],
    [/^Из ([A-Za-z].*)$/, 'From $1'],
    [/^· (.+)$/, (m, rest) => `· ${tr(rest)}`],
    // достижения, копии, синхронизация, железо, игра с другом
    [/^Достижение: (\S+) (.+?)(?: — котику открыт наряд «(.+)»)? ♡$/, (m, ico, t, r) => `Achievement: ${ico} ${tr(t)}${r ? ` — the kitty unlocked “${tr(r)}”` : ''} ♡`],
    [/^Открывается достижением «(.+)»$/, (m, t) => `Unlocked by the “${tr(t)}” achievement`],
    [/^🎁 (.+)$/, (m, r) => `🎁 ${tr(r)}`],
    [/^(.+) · (автокопия|вручную)$/, (m, a, k) => `${tr(a)} · ${k === 'автокопия' ? 'auto backup' : 'manual'}`],
    [/^Мир восстановлен как «(.+)» ♡$/, 'World restored as “$1” ♡'],
    [/^Сохранила копию: (.+) ♡$/, 'Backed up: $1 ♡'],
    [/^Копия мира не сохранилась: (.+)$/, (m, e) => `World backup failed: ${tr(e)}`],
    [/^Синхронизировано ♡ Отдано файлов: (\d+), получено: (\d+)$/, 'Synced ♡ Files sent: $1, received: $2'],
    [/^Синхронизация: (.+)$/, (m, e) => `Sync: ${tr(e)}`],
    [/^Состояние сборки «(.+)» на этом компьютере станет новым облачным состоянием\. Прежняя облачная копия сохранится в корзине синхронизации: папка «Корзина» в папке облака\.$/, 'The state of the “$1” instance on this computer will become the new cloud state. The previous cloud copy will be kept in the sync trash: the “Корзина” folder in the cloud folder.'],
    [/^Сборка «(.+)» сейчас запущена: сначала закрой игру\.$/, 'The “$1” instance is running: close the game first.'],
    [/^Облако восстановлено с этого компьютера: «(.+)» ♡$/, 'Cloud restored from this computer: “$1” ♡'],
    [/^Восстанавливаю облако с этого компьютера: (.+)…$/, 'Restoring the cloud from this computer: $1…'],
    [/^«(.+?)»: (?=Мир «|Файл «|сборка удалена|Список синхронизации|Облако не приходило)([\s\S]+)$/, (m, n, rest) => `“${n}”: ${tr(rest)}`],
    [/^Мир «(.+?)»: изменён на обоих компьютерах\. Здесь оставлена твоя версия, облачная сохранена как мир «(.+)»\.$/, 'World “$1”: changed on both computers. Your version was kept here; the cloud version was saved as the world “$2”.'],
    [/^Файл «(.+?)»: изменён на обоих компьютерах\. Здесь оставлена твоя версия, облачная сохранена как «(.+)»\.$/, 'File “$1”: changed on both computers. Your version was kept here; the cloud version was saved as “$2”.'],
    [/^(Файл|Мир) «(.+?)»: удалён на другом компьютере, но изменён здесь\. Оставлена твоя версия\.$/, (m, k, n) => `${k === 'Мир' ? 'World' : 'File'} “${n}”: deleted on another computer but changed here. Your version was kept.`],
    [/^(Файл|Мир) «(.+?)»: удалён здесь, но изменён на другом компьютере\. Оставлена изменённая версия\.$/, (m, k, n) => `${k === 'Мир' ? 'World' : 'File'} “${n}”: deleted here but changed on another computer. The changed version was kept.`],
    [/^Файл «(.+)» изменился во время копирования\. Повтори синхронизацию\.$/, 'File “$1” changed while being copied. Run sync again.'],
    [/^Пропущено \(идёт игра\): (.+)$/, 'Skipped (the game is running): $1'],
    [/^Папка: (.+?)\. Последняя синхронизация: (.+?)\. Сборки синхронизируются перед игрой и после неё\.(?: Последняя попытка не удалась: ([\s\S]+))?$/, (m, d, at, err) => `Folder: ${d}. Last sync: ${tr(at)}. Instances sync before and after playing.${err ? ` The last attempt failed: ${tr(err.split('\n')[0])}` : ''}`],
    [/^(.+) · (\d+) потоков$/, '$1 · $2 threads'],
    [/^Советую: (.+?) памяти для игры, шейдеры (.+) \(кнопка «Шейдеры под мой ПК» в сборке\)\.$/, 'Suggested: $1 of memory for the game, $2 shaders (the “Shaders for my PC” button in an instance).'],
    [/^Советую: (.+?) памяти для игры, без шейдеров — лучше включи «Оптимизацию» в сборке\.$/, 'Suggested: $1 of memory for the game, no shaders — use “Optimization” in an instance instead.'],
    [/^Игре дано (.+) памяти ♡$/, 'Gave the game $1 of memory ♡'],
    [/^Ставлю шейдеры (.+)…$/, 'Installing $1 shaders…'],
    [/^Шейдеры (.+) уже стоят ♡$/, '$1 shaders are already installed ♡'],
    [/^Адрес для друга скопирован: (.+) ♡$/, 'Address for your friend copied: $1 ♡'],
    [/^Ник «(.+)»: 3–16 символов, латиница, цифры и _$/, 'Nickname “$1”: 3–16 characters, Latin letters, digits and _'],
    [/^Скин (\S+) 🎨$/, 'Skin of $1 🎨'],
    [/^Скин (.+)$/, (m, n) => (n.length < 20 && !/\s/.test(n) ? `Skin of ${n}` : m)],
    [/^«(.+)» удалится вместе со всеми мирами, модами и скриншотами\. Это нельзя отменить\.$/, '“$1” will be deleted with all its worlds, mods and screenshots. This can’t be undone.'],
    [/^Сборка «(.+)» создана ♡$/, 'Instance “$1” created ♡'],
    [/^Сборка «(.+)» переведена на (\w+) — (.+)$/, (m, n, l, why) => `Instance “${n}” switched to ${l} — ${tr(why)}`],
    [/^без загрузчика моды не работают$/, 'mods don’t work without a loader'],
    [/^шейдерам нужен (.+)$/, 'shaders need $1'],
    [/^этого требует мод (.+)$/, 'mod $1 requires it'],
    [/^«(.+)» установлен ♡$/, '“$1” installed ♡'],
    [/^Установлено: (.+)$/, 'Installed: $1'],
    [/^Поставлено: (.+)$/, 'Installed: $1'],
    [/^Добавлено: (.+)$/, 'Added: $1'],
    [/^Добро пожаловать, (.+) ♡$/, 'Welcome, $1 ♡'],
    [/^Ник «(.+)» добавлен ✧$/, 'Nickname “$1” added ✧'],
    [/^привет, (.+) 😳$/, 'hi, $1 😳'],
    [/^(.+)\? милый ник 😳$/, '$1? cute nickname 😳'],
    [/^Модпак «(.+)» готов! Жми «Играть» ♡$/, 'Modpack “$1” is ready! Hit “Play” ♡'],
    [/^Сборка «(.+)» импортирована ♡$/, 'Instance “$1” imported ♡'],
    [/^Поставить модпак «(.+)» как новую сборку\?$/, 'Install the modpack “$1” as a new instance?'],
    [/^Готова копия «(.+)»$/, 'Copy “$1” is ready'],
    [/^(.+) \(копия\)$/, '$1 (copy)'],
    [/^Копия мира «(.+)» сохранена ♡$/, 'Backup of world “$1” saved ♡'],
    [/^Удалить мир «(.+)» навсегда\? Лучше сначала сделай резервную копию\.$/, 'Delete world “$1” forever? Better make a backup first.'],
    [/^Экспорт готов ♡ \((\d+) модов ссылками, (\d+) внутри\)$/, 'Export ready ♡ ($1 mods as links, $2 inside)'],
    [/^Модпак обновлён: (.+) → (.+?)(?: \(убрано старых файлов: (\d+)\))?$/, (m, a, b, n) => `Modpack updated: ${a} → ${b}${n ? ` (old files removed: ${n})` : ''}`],
    [/^Обновить до (.+)$/, 'Update to $1'],
    [/^Модпак с (Modrinth|CurseForge)$/, 'Modpack from $1'],
    [/^установлена версия (.+)$/, 'installed version $1'],
    [/^Обновлено модов: (\d+) ♡$/, 'Mods updated: $1 ♡'],
    [/^Для «(.+)» нашлось обновлений: (\d+)\.(.*)$/, (m, n, c, rest) => `Found ${c} updates for “${n}”.${tr(rest.trim()) ? ' ' + tr(rest.trim()) : ''}`],
    [/^Освобождено (.+) ♡$/, 'Freed $1 ♡'],
    [/^Переведено сборок: (\d+) ♡ Обнови лаунчер на других компьютерах$/, 'Instances moved to the new format: $1 ♡ Update the launcher on your other computers'],
    [/^Сборка следует за сборкой друга \(обновлена (.+)\)\. Нажми и вставь новый код от друга, чтобы обновиться$/, 'This instance follows a friend’s pack (updated $1). Click and paste the friend’s new code to update'],
    [/^Одинаковых файлов: (\d+), освободится (.+)$/, 'Identical files: $1, will free $2'],
    [/^Объединить одинаковые моды \(освободится (.+)\)\? Названия и содержимое файлов останутся прежними; у сборок, где идёт игра, моды не трогаются\.$/, 'Merge identical mods (will free $1)? Names and file contents stay the same; mods of instances with a running game are left alone.'],
    [/^Объединено файлов: (\d+), освобождено (.+?) ♡(?: · пропущено: (\d+))?$/, (m, n, size, skipped) => `Merged files: ${n}, freed ${size} ♡${skipped ? ` · skipped: ${skipped}` : ''}`],
    [/^Очистить (.+)$/, 'Clean up $1'],
    [/^можно убрать (.+)$/, 'can free $1'],
    [/^Удалить неиспользуемые файлы \((.+)\)\? Сборки, миры и моды не пострадают\.$/, 'Delete unused files ($1)? Instances, worlds and mods stay safe.'],
    [/^Сборки \(миры, моды, настройки\): (.+) — их очистка не трогает\. Всё, что удаляется, лаунчер сам скачает заново, если понадобится\.$/, 'Instances (worlds, mods, settings): $1 — cleanup doesn’t touch them. Anything removed is downloaded again when needed.'],
    [/^В системе (.+) ОЗУ\. Для модпаков обычно хватает 4–6 ГБ\.$/, 'Your system has $1 of RAM. Modpacks usually need 4–6 GB.'],
    [/^Громкость: ?(.*)$/, 'Volume: $1'], [/^Максимум: ?(.*)$/, 'Maximum: $1'], [/^Минимум: ?(.*)$/, 'Minimum: $1'], [/^Видимость фона: ?(.*)$/, 'Background opacity: $1'], [/^Размытие: ?(.*)$/, 'Blur: $1'],
    [/^Отпусти — добавлю в «(.+)» ♡$/, 'Drop it — I’ll add it to “$1” ♡'],
    [/^(.+) — (.+) · (основной|второй) слой · (\d+), (\d+)$/, (m, part, side, layer, x, y) => `${tr(part)} — ${SIDES[side] || side} · ${layer === 'основной' ? 'base' : 'overlay'} layer · ${x}, ${y}`],
    [/^Скин «(.+)» загружен с (.+) ✧$/, 'Skin “$1” loaded from $2 ✧'],
    [/^Скачиваю Java (\d+) \((\w+)\): (.+)$/, 'Downloading Java $1 ($2): $3'],
    [/^Скачиваю Minecraft (.+): (.+)$/, 'Downloading Minecraft $1: $2'],
    [/^Скачиваю библиотеки: (.+)$/, 'Downloading libraries: $1'],
    [/^Скачиваю ресурсы игры: (\d+) \/ (\d+) \((\d+) из (\d+) МБ\)$/, 'Downloading game assets: $1 / $2 ($3 of $4 MB)'],
    [/^Скачиваю (.+): (\d+) \/ (\d+)$/, (m, what, a, b) => `Downloading ${TASKS[what] || what}: ${a} / ${b}`],
    [/^Скачиваю установщик (\w+) (.+)…$/, 'Downloading the $1 $2 installer…'],
    [/^Устанавливаю (\w+) (\S+)(?: \(попытка (\d+)\))? — при первом запуске это 1–3 минуты…$/, (m, l, v, n) => `Installing ${l} ${v}${n ? ` (attempt ${n})` : ''} — the first launch takes 1–3 minutes…`],
    [/^Устанавливаю (\w+)…$/, 'Installing $1…'],
    [/^Запускаю и захожу на (.+)…$/, 'Starting and joining $1…'],
    [/^Качаю модпак «(.+)»(.*)…$/, 'Downloading modpack “$1”$2…'],
    [/^(Качаю|Обновляю) моды: (\d+) \/ (\d+)$/, (m, v, a, b) => `${v === 'Качаю' ? 'Downloading' : 'Updating'} mods: ${a} / ${b}`],
    [/^Ставлю оптимизацию: (.+)$/, 'Installing optimization: $1'],
    [/^Ставлю: (.+)$/, 'Installing: $1'],
    [/^Ставлю недостающее: (.+)$/, 'Installing missing: $1'],
    [/^Обновляю (.+) \((\d+) \/ (\d+)\)…$/, 'Updating $1 ($2 / $3)…'],
    [/^Игра закрыта \(код (.+)\)$/, 'Game closed (code $1)'],
    [/^Игра закрылась с ошибкой \(код (.+)\)\.$/, 'The game exited with an error (code $1).'],
    [/^Конфликт модов(?: \(виноват, скорее всего, «(.+)»\))?\.$/, (m, n) => `Mod conflict${n ? ` (most likely “${n}”)` : ''}.`],
    [/^♡ Запуск «(.+)» \((.+)\) как (.+)$/, (m, n, v, rest) => {
      const w = /^(.*) → мир «(.+)»$/.exec(rest);
      return w ? `♡ Launching “${n}” (${v}) as ${w[1]} → world “${w[2]}”` : `♡ Launching “${n}” (${v}) as ${rest}`;
    }],
    [/^Java: (.+)$/, 'Java: $1'], [/^Профиль загрузчика: (.+)$/, 'Loader profile: $1'], [/^Скин подключён ♡$/, 'Skin attached ♡'],
    [/^Клиент (.+) скачан заново \(не было или был повреждён\)$/, 'Client $1 downloaded again (missing or damaged)'],
    [/^захожу на (.+)… 😳$/, 'joining $1… 😳'],
    [/^ты играешь уже (\d+) ч… попей водички и разомнись 💧$/, 'you’ve been playing for $1 h… drink some water and stretch 💧'],
    [/^Не та версия (.+)$/, 'Wrong version of $1'], [/^Не хватает (.+)$/, 'Missing $1'],
    [/^(?:стоит (.+), а )?нужно (.+) — для (.+)$/, (m, have, need, by) => `${have ? `have ${have}, ` : ''}need ${need === 'любая версия' ? 'any version' : need} — for ${by}`],
    [/^«(.+)» (несовместим|плохо работает) с «(.+)»$/, (m, a, k, b) => `“${a}” ${k === 'несовместим' ? 'is incompatible' : 'works badly'} with “${b}”`],
    [/^Выключить «(.+)»$/, 'Disable “$1”'],
    [/^«(.+)» стоит (\d+) раза$/, '“$1” is installed $2 times'],
    [/^(.+) — так говорят сами моды$/, '$1 — according to the mods themselves'],
    [/^«(.+)» несовместим с (.+) — так указано в самом моде\. Не ставлю, чтобы игра не сломалась$/, '“$1” is incompatible with $2 — the mod says so itself. Not installing it so the game doesn’t break'],
    [/^«(.+)» может плохо работать вместе с (.+) — так предупреждает сам мод$/, '“$1” may work badly with $2 — the mod warns about it itself'],
    [/^«(.+)» заменён на (?:версию )?(.+) — такую (?:версию )?требует «(.+)»$/, '“$1” replaced with $2 — “$3” requires it'],
    [/^У «(.+)» нет версии для (.+) на (\w+)(?: — есть только для (.+))?$/, (m, n, v, l, o) => `“${n}” has no version for ${v} on ${l}${o ? ` — only for ${o}` : ''}`],
    [/^У «(.+)» нет (?:версии|файла) для (?:Minecraft )?(.+)$/, '“$1” has no version for $2'],
    [/^«(.+)» нет для Minecraft (.+)$/, '“$1” isn’t available for Minecraft $2'],
    [/^Для шейдеров нужен Iris или Oculus, но под (.+) \((.+)\) их пока нет — шейдер не заработает$/, 'Shaders need Iris or Oculus, but they aren’t out for $1 ($2) yet — the shader won’t work'],
    [/^Автор «(.+)» запретил скачивание из сторонних лаунчеров — скачай вручную: (.+)$/, 'The author of “$1” forbids third-party launcher downloads — download it manually: $2'],
    [/^(.+): такие файлы лаунчер не понимает$/, '$1: the launcher doesn’t understand this kind of file'],
    [/^Нет связи с (.+) \((.+)\)$/, 'Can’t reach $1 ($2)'],
    [/^Загрузка зависла: (.+)$/, 'Download stalled: $1'],
    [/^Файл повреждён \(не совпал хэш\): (.+)$/, 'File is damaged (hash mismatch): $1'],
    [/^Скин должен быть 64×64.*, а этот (.+)$/, 'A skin must be 64×64, this one is $1'],
    [/^Скин «(.+)» не найден.*$/, 'Skin “$1” not found'],
    [/^«(.+)» — это (.+), переключи вкладку сверху$/, '“$1” is a $2 — switch the tab above'],
    [/^Вышла версия (.+)\. Скачай новую версию на сайте\.$/, 'Version $1 is out. Download the new version from the website.'],
    [/^Версия (.+) скачана\. Нажми плашку сверху, чтобы установить обновление\.$/, 'Version $1 is downloaded. Click the banner above to install it.'],
    [/^Вышла версия (.+)\. Portable-версия не обновляется сама — скачай новую\.$/, 'Version $1 is out. The portable version doesn’t update itself — download the new one.'],
    [/^Скачиваю версию (.+): (\d+)%$/, 'Downloading version $1: $2%'],
    [/^Версия (.+) скачана\. Нажми плашку сверху или просто закрой лаунчер — обновится сам\.$/, 'Version $1 is downloaded. Click the badge at the top or just close the launcher — it updates itself.'],
    [/^Не получилось проверить: (.+)$/, 'Couldn’t check: $1'],
    [/^✨ Качаю версию (.+)… (\d+)%$/, '✨ Downloading version $1… $2%'],
    [/^✨ Версия (.+) готова — перезапустить ♡$/, '✨ Version $1 is ready — restart ♡'],
    [/^✨ Вышла версия (.+) — скачать$/, '✨ Version $1 is out — download'],
    [/^Обновление (.+) скачано ✧$/, 'Update $1 downloaded ✧'],
    [/^Ничего не нашлось под (.+) 🥺$/, 'Nothing found for $1 🥺'],
    [/^Вставь Project ID, например (\d+) — это JEI$/, 'Paste a Project ID, e.g. $1 — that’s JEI'],
    [/^«(.+)» — ванильная сборка\. При установке мода лаунчер сам переведёт её на подходящий загрузчик \(обычно Fabric\) ♡$/, '“$1” is a vanilla instance. When you install a mod, the launcher switches it to a suitable loader (usually Fabric) ♡'],
    [/^При установке шейдера лаунчер сам переведёт «(.+)» на Fabric и поставит Iris с Sodium ♡$/, 'When you install a shader, the launcher switches “$1” to Fabric and installs Iris with Sodium ♡'],
    [/^играли (.+)$/, 'played $1'],
    [/^ещё запущено: (\d+)$/, 'also running: $1'],
    [/^Мод (.+) — мод для (\w+), а сборка на (\w+): скорее всего, он не загрузится$/, '$1 is a mod for $2, but the instance runs $3: it probably won’t load'],
    [/^Плащ: (.+)$/, 'Cape: $1'],
    [/^(\d+) \/ (\d+)$/, '$1 / $2'],
    // ошибки бэкенда
    [/^Не удалось войти через Microsoft: (.+)$/, (m, e) => `Couldn’t sign in with Microsoft: ${tr(e)}`],
    [/^Сессия Microsoft устарела — удали аккаунт и войди заново\. \((.+)\)$/, (m, e) => `The Microsoft session expired — remove the account and sign in again. (${tr(e)})`],
    [/^Небезопасный путь в (Java|модпаке): (.+)$/, (m, w, p) => `Unsafe path in ${w === 'Java' ? 'Java' : 'the modpack'}: ${p}`],
    [/^Не удалось скачать Java (\d+)\. ([\s\S]*)$/, (m, v, e) => `Couldn’t download Java ${v}. ${tr(e)}`],
    [/^Не удалось скачать authlib-injector для скинов: (.+)$/, (m, e) => `Couldn’t download authlib-injector for skins: ${tr(e)}`],
    [/^Установщик завершился с ошибкой \(код (.+?)\):([\s\S]*)$/, 'The installer failed (code $1):$2'],
    [/^Установщик упал, пробую ещё раз: (.+)$/, 'The installer crashed, trying again: $1'],
    [/^Установщик не создал профиль (.+)$/, 'The installer didn’t create profile $1'],
    [/^У Mojang нет (.+) для (.+)$/, 'Mojang has no $1 for $2'],
    [/^Неизвестный (загрузчик|источник|канал) (.+)$/, (m, w, x) => `Unknown ${{ загрузчик: 'loader', источник: 'source', канал: 'channel' }[w]} ${x}`],
    [/^(\S+) не поддерживает (.+)$/, '$1 doesn’t support $2'],
    [/^Проект (.+) — не для Minecraft$/, 'Project $1 isn’t for Minecraft'],
    [/^Не нашёл версию «(.+)», которую требует «(.+)» — ставлю самую свежую, игра может не запуститься$/, 'Couldn’t find the version of “$1” that “$2” needs — installing the newest, the game may not start'],
    [/^Не понимаю загрузчик модпака: (.+)$/, (m, l) => `Unknown modpack loader: ${l === 'не указан' ? 'not specified' : l}`],
    [/^«(.+)» нужен мод «(.+)», но автоматически поставить его не вышло: (.+)$/, (m, a, b, e) => `“${a}” needs mod “${b}”, but it couldn’t be installed automatically: ${tr(e)}`],
    [/^Ресурспаку «(.+)» для «(.+)» нужен мод (.+), но он не поставился: (.+)$/, (m, a, w, s, e) => `Resource pack “${a}” needs mod ${s} for “${tr(w)}”, but it didn’t install: ${tr(e)}`],
    [/^Mojang ответил ошибкой (\d+)$/, 'Mojang returned error $1'],
    [/^Скин не подключён: (.+)$/, (m, e) => `Skin not attached: ${tr(e)}`],
    [/^Сервер скинов: (.+)$/, 'Skin server: $1'],
    [/^несовместим с (.+) — так указано в самом моде, не добавляю$/, 'incompatible with $1 — the mod says so itself, not adding it'],
    [/^Оптимизация: под эту версию нет — (.+)$/, 'Optimization: not available for this version — $1'],
    [/^♡ Установка модпака «(.+)» \((.+)\)$/, '♡ Installing modpack “$1” ($2)'],
    [/^(.+) установлен — пробуй запустить снова ♡$/, '$1 installed — try launching again ♡'],
    [/^Моя сборка (.+)$/, 'My instance $1'],
    [/^Изменить сборку (.+)$/, 'Edit instance $1'],
  ];
  const WORDS = { модели_сущностей: 'entity models', текстуры_мобов: 'mob textures', соединённые_текстуры: 'connected textures', особые_текстуры_предметов: 'custom item textures', мод: 'mod', ресурспак: 'resource pack', шейдер: 'shader', модпак: 'modpack' };
  for (const [k, v] of Object.entries(WORDS)) D[k.replace(/_/g, ' ')] = v;
  const SIDES = { верх: 'top', низ: 'bottom', 'правый бок': 'right side', перед: 'front', 'левый бок': 'left side', спина: 'back' };
  const TASKS = { ресурсы: 'assets', 'копирую ресурсы': 'copying assets', 'нативные библиотеки': 'native libraries', библиотеки: 'libraries', 'библиотеки загрузчика': 'loader libraries' };
  // Единицы и короткие слова внутри любых строк
  const UNITS = [
    // \b в JS не видит кириллицу, поэтому границы слов проверяем вручную
    [/(\d)\s?ГБ(?![А-Яа-я])/g, '$1 GB'], [/(\d)\s?МБ(?![А-Яа-я])/g, '$1 MB'], [/(\d)\s?КБ(?![А-Яа-я])/g, '$1 KB'], [/(\d+) ч (\d+) мин/g, '$1 h $2 min'], [/(\d+) мин(?![А-Яа-я])/g, '$1 min'], [/(\d+) ч(?![А-Яа-я])/g, '$1 h'], [/(\d+) мс(?![А-Яа-я])/g, '$1 ms'],
    [/ · играет/g, ' · playing'], [/ · играли /g, ' · played '], [/▶ играет/g, '▶ playing'], [/\(снапшот\)/g, '(snapshot)'], [/^от (.+)$/, 'by $1'],
    [/ещё не запускалась/g, 'never played'], [/^Скачиваю (.+)$/, 'Downloading $1'],
  ];

  const CYR = /[А-Яа-яЁё]/;
  function tr(s) {
    if (lang !== 'en' || !s || !CYR.test(s)) return s;
    const lead = s.match(/^\s*/)[0];
    const trail = s.match(/\s*$/)[0];
    let core = s.trim();
    if (D[core] !== undefined) return lead + D[core] + trail;
    let matched = false;
    for (const [re, rep] of P) {
      if (re.test(core)) {
        const translated = core.replace(re, rep);
        if (translated === core) continue;
        core = translated;
        matched = true;
        break;
      }
    }
    if (D[core] !== undefined) core = D[core];
    // «файл.jar: причина» — переводим причину
    const colon = !matched && core.match(/^([^:]+): ([\s\S]+)$/);
    if (colon) {
      const right = tr(colon[2]);
      if (right !== colon[2]) core = `${tr(colon[1])}: ${right}`;
    }
    for (const [re, rep] of UNITS) core = core.replace(re, rep);
    return lead + core + trail;
  }

  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function translateNode(node) {
    if (node.nodeType === 3) {
      const t = tr(node.nodeValue);
      if (t !== node.nodeValue) node.nodeValue = t;
      return;
    }
    if (node.nodeType !== 1 || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
    for (const a of ATTRS) {
      const v = node.getAttribute?.(a);
      if (!v || !CYR.test(v)) continue;
      const t = tr(v);
      if (t !== v) node.setAttribute(a, t);
    }
    // Что человек сам вписал в поле, не трогаем
    if (node.tagName !== 'TEXTAREA') for (const c of node.childNodes) translateNode(c);
  }

  // Включить язык на лету. Русский обратно вернуть нельзя (оригиналы уже заменены) — тогда false, нужна перезагрузка
  function set(next) {
    try {
      localStorage.setItem('lang', next);
    } catch {}
    if (next === lang) return true;
    if (next !== 'en') return false;
    lang = next;
    start();
    return true;
  }

  let started = false;
  function start() {
    if (lang !== 'en' || started) return;
    started = true;
    document.documentElement.lang = 'en';
    document.title = 'Femboy Launcher';
    translateNode(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') translateNode(m.target);
        else m.addedNodes.forEach(translateNode);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // Системные окна подтверждения и уведомления Windows тоже переводим
    const nativeConfirm = window.confirm.bind(window);
    window.confirm = (msg) => nativeConfirm(tr(String(msg)));
    if (window.Notification) {
      const N = window.Notification;
      window.Notification = function (title, opts = {}) {
        return new N(title, { ...opts, body: tr(opts.body || '') });
      };
    }
  }

  window.I18N = { tr, set, get lang() { return lang; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
