; electron-builder подключает только один файл (nsis.include), поэтому фирменное оформление берём здесь же (R4-INST-01)
!include "${BUILD_RESOURCES_DIR}\installer.nsh"
!include MUI2.nsh
!include LogicLib.nsh
!include nsDialogs.nsh
!ifndef BUILD_UNINSTALLER
Var FLPrivacyDialog
Var FLPrivacyText
Var FLPrivacyUpdates
Var FLPrivacyDiscord
Var FLPrivacyMods
Var FLPrivacyReadiness
Var FLPrivacyAccepted
Var FLPrivacyU
Var FLPrivacyD
Var FLPrivacyM
Var FLPrivacyR

!macro customPageAfterChangeDir
  Page custom FLPrivacyPage FLPrivacyLeave
!macroend

Function FLPrivacyPage
  IfSilent fl_privacy_skip
  nsDialogs::Create 1018
  Pop $FLPrivacyDialog
  ${If} $FLPrivacyDialog == error
    Abort
  ${EndIf}
  ${If} $LANGUAGE == 1049
    !insertmacro MUI_HEADER_TEXT "Приватность и сеть" "Выбери необязательные фоновые функции"
  ${Else}
    !insertmacro MUI_HEADER_TEXT "Privacy and network" "Choose optional background features"
  ${EndIf}
  nsDialogs::CreateControl EDIT ${DEFAULT_STYLES}|${ES_MULTILINE}|${ES_AUTOVSCROLL}|${ES_READONLY}|${WS_VSCROLL} ${WS_EX_CLIENTEDGE} 0 0 100% 63u ""
  Pop $FLPrivacyText
  InitPluginsDir
  ${If} $LANGUAGE == 1049
    File /oname=$PLUGINSDIR\privacy-notice.txt "${BUILD_RESOURCES_DIR}\privacy-notice.txt"
  ${Else}
    File /oname=$PLUGINSDIR\privacy-notice.txt "${BUILD_RESOURCES_DIR}\privacy-notice-en.txt"
  ${EndIf}
  Push $0
  Push $1
  FileOpen $0 "$PLUGINSDIR\privacy-notice.txt" r
  fl_privacy_read:
    ClearErrors
    FileReadUTF16LE $0 $1
    IfErrors fl_privacy_read_done
    SendMessage $FLPrivacyText ${EM_REPLACESEL} 0 "STR:$1"
    Goto fl_privacy_read
  fl_privacy_read_done:
  FileClose $0
  Pop $1
  Pop $0
  SendMessage $FLPrivacyText ${EM_SETSEL} 0 0
  SendMessage $FLPrivacyText ${EM_SCROLLCARET} 0 0
  ${If} $LANGUAGE == 1049
    ${NSD_CreateCheckbox} 0 67u 100% 12u "Фоновые проверки и загрузка обновлений лаунчера"
    Pop $FLPrivacyUpdates
    ${NSD_CreateCheckbox} 0 81u 100% 12u "Показывать мою игру в Discord (включая адрес сервера)"
    Pop $FLPrivacyDiscord
    ${NSD_CreateCheckbox} 0 95u 100% 12u "Проверять обновления модов и модпаков"
    Pop $FLPrivacyMods
    ${NSD_CreateCheckbox} 0 109u 100% 12u "Проверять готовность модов к новой версии игры"
    Pop $FLPrivacyReadiness
    ${NSD_CreateLabel} 0 124u 100% 20u "Выбор заменит эти настройки при следующем запуске. Ручные действия и каталоги используют сеть отдельно."
    Pop $0
  ${Else}
    ${NSD_CreateCheckbox} 0 67u 100% 12u "Background launcher update checks and downloads"
    Pop $FLPrivacyUpdates
    ${NSD_CreateCheckbox} 0 81u 100% 12u "Show my game in Discord (including server address)"
    Pop $FLPrivacyDiscord
    ${NSD_CreateCheckbox} 0 95u 100% 12u "Check mods and modpacks for updates"
    Pop $FLPrivacyMods
    ${NSD_CreateCheckbox} 0 109u 100% 12u "Check mod readiness for a new game version"
    Pop $FLPrivacyReadiness
    ${NSD_CreateLabel} 0 124u 100% 20u "These choices replace the matching settings at next launch. Manual actions and catalogs use networking separately."
    Pop $0
  ${EndIf}
  ; Каждый щелчок (и пробел на флажке) сразу записывает текущий выбор: «Назад» leave-функцию не вызывает,
  ; и без этого возврат на страницу (Назад -> Далее) сбрасывал отметки
  ${NSD_OnClick} $FLPrivacyUpdates FLPrivacyClick
  ${NSD_OnClick} $FLPrivacyDiscord FLPrivacyClick
  ${NSD_OnClick} $FLPrivacyMods FLPrivacyClick
  ${NSD_OnClick} $FLPrivacyReadiness FLPrivacyClick
  ; Страница создаётся заново при каждом показе: отметки восстанавливаются из текущего выбора этого запуска Setup.
  ; Переменные живут только в этом процессе, поэтому новый запуск начинает со всех четырёх выключенных
  ${If} $FLPrivacyU == "true"
    ${NSD_Check} $FLPrivacyUpdates
  ${EndIf}
  ${If} $FLPrivacyD == "true"
    ${NSD_Check} $FLPrivacyDiscord
  ${EndIf}
  ${If} $FLPrivacyM == "true"
    ${NSD_Check} $FLPrivacyMods
  ${EndIf}
  ${If} $FLPrivacyR == "true"
    ${NSD_Check} $FLPrivacyReadiness
  ${EndIf}
  nsDialogs::Show
  Return
  fl_privacy_skip:
    Abort
FunctionEnd

; nsDialogs кладёт на стек дескриптор нажатого флажка: снимаем его, сохраняя $0
Function FLPrivacyClick
  Exch $0
  Pop $0
  Call FLPrivacySave
FunctionEnd

; «Далее»: выбор подтверждён (только тогда customInstall пишет запись) и сохранён
Function FLPrivacyLeave
  StrCpy $FLPrivacyAccepted 1
  Call FLPrivacySave
FunctionEnd

; Текущие отметки -> FLPrivacyU/D/M/R ("true"/"false")
Function FLPrivacySave
  Push $0
  StrCpy $FLPrivacyU "false"
  StrCpy $FLPrivacyD "false"
  StrCpy $FLPrivacyM "false"
  StrCpy $FLPrivacyR "false"
  ${NSD_GetState} $FLPrivacyUpdates $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $FLPrivacyU "true"
  ${EndIf}
  ${NSD_GetState} $FLPrivacyDiscord $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $FLPrivacyD "true"
  ${EndIf}
  ${NSD_GetState} $FLPrivacyMods $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $FLPrivacyM "true"
  ${EndIf}
  ${NSD_GetState} $FLPrivacyReadiness $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $FLPrivacyR "true"
  ${EndIf}
  Pop $0
FunctionEnd

!macro customInstall
  ${IfNot} ${Silent}
    ${If} $FLPrivacyAccepted == 1
      Push $0
      Push $1
      Push $2
      System::Call 'kernel32::GetCurrentProcessId() i.r1'
      System::Call 'kernel32::GetTickCount() i.r2'
      IntFmt $2 "%u" $2
      ClearErrors
      FileOpen $0 "$INSTDIR\resources\privacy-install.json.tmp" w
      IfErrors fl_privacy_write_failed
      FileWrite $0 '{$\"schema$\":1,$\"id$\":$\"$1-$2$\",$\"settings$\":{$\"backgroundUpdateChecks$\":$FLPrivacyU,$\"discordRpc$\":$FLPrivacyD,$\"modUpdatesCheck$\":$FLPrivacyM,$\"readinessCheck$\":$FLPrivacyR}}'
      FileClose $0
      IfErrors fl_privacy_write_failed
      System::Call 'kernel32::MoveFileExW(w "$INSTDIR\resources\privacy-install.json.tmp", w "$INSTDIR\resources\privacy-install.json", i 9) i.r0'
      IntCmp $0 0 fl_privacy_write_failed
      Goto fl_privacy_write_ok
      fl_privacy_write_failed:
      Pop $2
      Pop $1
      Pop $0
      MessageBox MB_ICONSTOP "Could not save privacy choices. Installation will not start the launcher. / Не удалось сохранить выбор сетевых функций. Установка прервана."
      Abort
      fl_privacy_write_ok:
      Pop $2
      Pop $1
      Pop $0
    ${EndIf}
  ${EndIf}
!macroend
!endif
