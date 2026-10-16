; Preserve runtime data while removing the installed application files.
; Do not force-kill the desktop app during uninstall. A running process can
; keep native modules and the database open, leaving a partial uninstall.
!macro abortIfMiniShopRunningFunction
check_process:
  nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c tasklist /FI "IMAGENAME eq ${APP_FILENAME}.exe" /FO csv | %SYSTEMROOT%\System32\find.exe /I "${APP_FILENAME}.exe"`
  Pop $R0
  StrCmp "$R0" "0" 0 app_not_running

  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "MiniShop is still running. Exit it, then click Retry. Click Cancel to abort uninstall." IDRETRY check_process IDCANCEL abort_uninstall
  Return
app_not_running:
  Return
abort_uninstall:
  Quit
!macroend

!ifdef BUILD_UNINSTALLER
  Function un.abortIfMiniShopRunning
    !insertmacro abortIfMiniShopRunningFunction
  FunctionEnd
!else
  Function abortIfMiniShopRunning
    !insertmacro abortIfMiniShopRunningFunction
  FunctionEnd
!endif

!macro abortIfMiniShopRunning
  !ifdef BUILD_UNINSTALLER
    Call un.abortIfMiniShopRunning
  !else
    Call abortIfMiniShopRunning
  !endif
!macroend

!macro customCheckAppRunning
  !insertmacro abortIfMiniShopRunning
!macroend

!macro customRemoveFiles
  !insertmacro abortIfMiniShopRunning
  StrCpy $R8 ""
  IfFileExists "$INSTDIR\data\*.*" 0 +2
    Rename "$INSTDIR\data" "$PLUGINSDIR\preserved-install-data"
  IfFileExists "$PLUGINSDIR\preserved-install-data\*.*" 0 +2
    StrCpy $R8 "1"

  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"
    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"
      Push ""
      Call un.restoreFiles
      Pop $R0
      ${if} $R8 == "1"
        Rename "$PLUGINSDIR\preserved-install-data" "$INSTDIR\data"
      ${endIf}
      Abort `Can't remove the installed application files.`
    ${endIf}
  ${endIf}

  RMDir /r "$INSTDIR"
  ${if} $R8 == "1"
    CreateDirectory "$INSTDIR"
    Rename "$PLUGINSDIR\preserved-install-data" "$INSTDIR\data"
  ${endIf}
!macroend

; Remove stale settings and caches on a full uninstall, but preserve data that
; was explicitly stored below the Electron userData directory.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    StrCpy $R8 ""
    IfFileExists "$APPDATA\${APP_FILENAME}\data\*.*" 0 +2
      Rename "$APPDATA\${APP_FILENAME}\data" "$PLUGINSDIR\preserved-user-data"
    IfFileExists "$PLUGINSDIR\preserved-user-data\*.*" 0 +2
      StrCpy $R8 "1"

    RMDir /r "$APPDATA\${APP_FILENAME}"
    ${if} $R8 == "1"
      CreateDirectory "$APPDATA\${APP_FILENAME}"
      Rename "$PLUGINSDIR\preserved-user-data" "$APPDATA\${APP_FILENAME}\data"
    ${endIf}
  ${endIf}
!macroend
