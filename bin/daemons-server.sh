#!/bin/zsh
# C-547: DAEMONS Server on a Mac, run at login (DRAFT; a notarised .pkg comes later).
#   bin/daemons-server.sh install     the agent as a LaunchAgent, and the menu-bar item built and started at login
#   bin/daemons-server.sh uninstall   both stopped and removed (its settings and ARETE are kept)
#   bin/daemons-server.sh restart | log [n] | tray (build the menu-bar item only) | run (what the LaunchAgent runs)
# If this Mac already runs THE MESH's own node (the companion's hub/mesh.sh), uninstall that first, or it is two nodes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
AGENT=ca.codemusic.daemons-server
TRAYL=ca.codemusic.daemons-server.tray
LA="$HOME/Library/LaunchAgents"
APPS="$HOME/Library/Application Support/daemons-server"
LOG="$HOME/Library/Logs/daemons-server.log"
TRAY="$APPS/DAEMONS Server.app"

build_tray() {
  mkdir -p "$TRAY/Contents/MacOS"
  swiftc -O -o "$TRAY/Contents/MacOS/daemons-server-tray" "$HERE/mac/Tray.swift"
  cat > "$TRAY/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>DAEMONS Server</string>
  <key>CFBundleIdentifier</key><string>$TRAYL</string>
  <key>CFBundleExecutable</key><string>daemons-server-tray</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PL
  codesign -s - -f "$TRAY" >/dev/null 2>&1 || true
  echo "daemons-server: the menu-bar item built at $TRAY"
}
plist() {   # label, program arguments (as <string>s), keepalive
  cat > "$LA/$1.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array>$2</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><$3/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
  launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$LA/$1.plist"
}

case "${1:-}" in
  run) cd "$HERE" && exec node src/main.ts ;;
  install)
    command -v node >/dev/null || { echo "daemons-server: Node 22.18 or newer is needed" >&2; exit 2; }
    mkdir -p "$LA" "$APPS"; chmod 700 "$APPS"
    if launchctl print "gui/$(id -u)/ca.codemusic.daemons.mesh" >/dev/null 2>&1; then
      echo "daemons-server: this Mac already runs THE MESH's own node (ca.codemusic.daemons.mesh) -- uninstall it first, or it is two nodes" >&2; exit 3
    fi
    build_tray
    plist "$AGENT" "<string>/bin/zsh</string><string>$HERE/bin/daemons-server.sh</string><string>run</string>" true
    plist "$TRAYL" "<string>$TRAY/Contents/MacOS/daemons-server-tray</string>" false
    echo "daemons-server: running; the dashboard at http://127.0.0.1:4770/ and a dot in the menu bar" ;;
  uninstall)
    for l in "$AGENT" "$TRAYL"; do launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true; rm -f "$LA/$l.plist"; done
    echo "daemons-server: stopped and removed (settings and ARETE kept in $APPS)" ;;
  restart) launchctl kickstart -k "gui/$(id -u)/$AGENT" && echo "daemons-server: started again" ;;
  log) tail -n "${2:-40}" "$LOG" ;;
  tray) build_tray ;;
  *) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
