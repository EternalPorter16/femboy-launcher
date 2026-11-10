; Оформление установщика: цвета, приветствие и тексты в стиле лаунчера.
; Картинки (installerSidebar.bmp, uninstallerSidebar.bmp, installerHeader.bmp) electron-builder берёт из build/ сам,
; а рисуются они из build/art/installer-art.js.

; Фон шапки и страниц приветствия/завершения — тот же, что у картинок (BG в installer-art.js)
!define MUI_BGCOLOR "FFF5FA"
!define MUI_TEXTCOLOR "3A2340"

!ifndef BUILD_UNINSTALLER
  !define MUI_DIRECTORYPAGE_TEXT_TOP "$(fbDirText)"
  !define MUI_FINISHPAGE_TITLE "$(fbFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(fbFinishText)"
  !define MUI_FINISHPAGE_RUN_TEXT "$(fbRunText)"
!else
  !define MUI_WELCOMEPAGE_TITLE "$(fbUnWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(fbUnWelcomeText)"
  !define MUI_FINISHPAGE_TITLE "$(fbUnFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(fbUnFinishText)"
!endif

; Приветствие (у electron-builder его по умолчанию нет); при обновлении поверх старой версии пропускается
!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "$(fbWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(fbWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Строки объявляются здесь: customHeader вставляется после загрузки языков
!macro customHeader
  LangString fbWelcomeTitle ${LANG_RUSSIAN} "Привет! Это Femboy Launcher ♡"
  LangString fbWelcomeTitle ${LANG_ENGLISH} "Hi! This is Femboy Launcher ♡"
  LangString fbWelcomeText ${LANG_RUSSIAN} "Милый Minecraft-лаунчер с котиком-бойкиссером уже почти у тебя.$\r$\n$\r$\nСборки, моды и модпаки с Modrinth и CurseForge, вход через Microsoft, скины и темы — всё в один клик.$\r$\n$\r$\nНажми «Далее», и котик всё сделает сам :3"
  LangString fbWelcomeText ${LANG_ENGLISH} "A cute Minecraft launcher with a boykisser kitty is almost here.$\r$\n$\r$\nInstances, mods and modpacks from Modrinth and CurseForge, Microsoft sign-in, skins and themes — all in one click.$\r$\n$\r$\nPress Next and the kitty will do the rest :3"
  LangString fbDirText ${LANG_RUSSIAN} "Куда поселить котика? Обычная папка подходит, менять её не обязательно.$\r$\nТвои сборки и миры хранятся отдельно и никуда не денутся."
  LangString fbDirText ${LANG_ENGLISH} "Where should the kitty live? The default folder is fine, no need to change it.$\r$\nYour instances and worlds are stored separately and stay safe."
  LangString fbFinishTitle ${LANG_RUSSIAN} "Готово! Котик переехал ♡"
  LangString fbFinishTitle ${LANG_ENGLISH} "All done! The kitty has moved in ♡"
  LangString fbFinishText ${LANG_RUSSIAN} "Ярлык ждёт тебя на рабочем столе и в меню «Пуск». Обновления будут приходить сами.$\r$\n$\r$\nПриятной игры! :3"
  LangString fbFinishText ${LANG_ENGLISH} "The shortcut is waiting on your desktop and in the Start menu. Updates arrive on their own.$\r$\n$\r$\nHave fun! :3"
  LangString fbRunText ${LANG_RUSSIAN} "Запустить Femboy Launcher"
  LangString fbRunText ${LANG_ENGLISH} "Launch Femboy Launcher"
  LangString fbUnWelcomeTitle ${LANG_RUSSIAN} "Уже уходишь? :("
  LangString fbUnWelcomeTitle ${LANG_ENGLISH} "Leaving already? :("
  LangString fbUnWelcomeText ${LANG_RUSSIAN} "Котик немножко грустит, но всё понимает.$\r$\n$\r$\nУдалится только сама программа. Сборки, миры, скины и аккаунты останутся на месте — если вернёшься, всё будет как прежде.$\r$\n$\r$\nНажми «Далее», чтобы продолжить."
  LangString fbUnWelcomeText ${LANG_ENGLISH} "The kitty is a little sad, but understands.$\r$\n$\r$\nOnly the program itself is removed. Your instances, worlds, skins and accounts stay where they are — come back and everything will be just like before.$\r$\n$\r$\nPress Next to continue."
  LangString fbUnFinishTitle ${LANG_RUSSIAN} "Пока-пока!"
  LangString fbUnFinishTitle ${LANG_ENGLISH} "Bye-bye!"
  LangString fbUnFinishText ${LANG_RUSSIAN} "Femboy Launcher удалён. Сборки и миры остались в папке %APPDATA%\Femboy Launcher.$\r$\n$\r$\nВозвращайся, котик будет ждать ♡"
  LangString fbUnFinishText ${LANG_ENGLISH} "Femboy Launcher has been removed. Your instances and worlds are still in %APPDATA%\Femboy Launcher.$\r$\n$\r$\nCome back, the kitty will be waiting ♡"
!macroend
