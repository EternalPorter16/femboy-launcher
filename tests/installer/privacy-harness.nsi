; Navigation harness for build/installer-privacy.nsh: the real privacy page code between a directory page and the
; install page, compiled by the same NSIS that electron-builder uses. It installs nothing except the choice record
; ($INSTDIR\resources\privacy-install.json) into the folder given with /D=, so it is safe to run on any computer.
; makensis /DBUILD_RESOURCES_DIR=<project>\build /DOUTFILE=<exe> privacy-harness.nsi
Unicode true
!ifndef BUILD_RESOURCES_DIR
  !error "define BUILD_RESOURCES_DIR"
!endif
!ifndef OUTFILE
  !error "define OUTFILE"
!endif
Name "Femboy Launcher privacy page harness"
OutFile "${OUTFILE}"
RequestExecutionLevel user
InstallDir "$TEMP\fl-privacy-harness"
ShowInstDetails show

!include "${BUILD_RESOURCES_DIR}\installer-privacy.nsh"
!include FileFunc.nsh

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"
!insertmacro customHeader

; /LANGID=1049 or /LANGID=1033 selects the page language like the Windows UI language does in the real Setup
Function .onInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/LANGID=" $1
  ${IfNot} ${Errors}
    StrCpy $LANGUAGE $1
  ${EndIf}
FunctionEnd

Section
  CreateDirectory "$INSTDIR\resources"
  !insertmacro customInstall
SectionEnd
