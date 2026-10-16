; Preserve runtime data while removing the installed application files.
; Do not force-kill the desktop app during uninstall. A running process can
; keep native modules and the database open, leaving a partial uninstall.
!macro customCheckAppRunning
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "MiniShop is still running. Please exit it before uninstalling."
    Quit
  ${endIf}
!macroend

!macro customRemoveFiles
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
