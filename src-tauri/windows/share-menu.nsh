; "Share with Tools" in Explorer's right-click menu for every file (on
; Windows 11 it is under "Show more options"). The app starts with the
; file's path; a running app gets it instead (src/shared.rs).
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\*\shell\ShareWithTools" "" "Share with Tools"
  WriteRegStr SHCTX "Software\Classes\*\shell\ShareWithTools" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr SHCTX "Software\Classes\*\shell\ShareWithTools\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\*\shell\ShareWithTools"
!macroend
