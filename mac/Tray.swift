// C-547: DAEMONS Server's menu-bar item (DRAFT). It holds no state of its own: every few seconds it reads the agent's
// /api/state on 127.0.0.1 and draws a dot -- green working or ready, amber resting, grey not running -- and its menu
// says why, opens the dashboard, and pauses or resumes. Built by bin/daemons-server.sh tray; no Xcode project needed.
import AppKit

let PORT = ProcessInfo.processInfo.environment["DAEMONS_SERVER_PORT"] ?? "4770"
let BASE = URL(string: "http://127.0.0.1:\(PORT)")!

final class Tray: NSObject, NSApplicationDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  let menu = NSMenu()
  let line1 = NSMenuItem(title: "DAEMONS Server", action: nil, keyEquivalent: "")
  let line2 = NSMenuItem(title: "…", action: nil, keyEquivalent: "")
  let line3 = NSMenuItem(title: "", action: nil, keyEquivalent: "")

  func applicationDidFinishLaunching(_ n: Notification) {
    for l in [line1, line2, line3] { l.isEnabled = false; menu.addItem(l) }
    menu.addItem(.separator())
    add("Open the dashboard", #selector(open), "d")
    add("Pause for an hour", #selector(pauseHour), "")
    add("Pause until tomorrow", #selector(pauseDay), "")
    add("Resume", #selector(resume), "")
    menu.addItem(.separator())
    add("Quit the menu-bar item", #selector(quit), "q")
    item.menu = menu
    draw(color: .systemGray, title: "not running")
    poll()
    Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { _ in self.poll() }
  }
  func add(_ t: String, _ s: Selector, _ k: String) { let m = NSMenuItem(title: t, action: s, keyEquivalent: k); m.target = self; menu.addItem(m) }

  func draw(color: NSColor, title: String) {
    let img = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { r in
      let ring = NSBezierPath(ovalIn: r.insetBy(dx: 2.5, dy: 2.5)); ring.lineWidth = 1.4; NSColor.labelColor.setStroke(); ring.stroke()
      let dot = NSBezierPath(ovalIn: r.insetBy(dx: 6, dy: 6)); color.setFill(); dot.fill(); return true }
    item.button?.image = img
    item.button?.toolTip = "DAEMONS Server: \(title)"
  }

  func poll() {
    URLSession.shared.dataTask(with: BASE.appendingPathComponent("api/state")) { data, _, _ in
      guard let data, let s = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        DispatchQueue.main.async { self.draw(color: .systemGray, title: "not running"); self.line2.title = "The agent is not running"; self.line3.title = "" }
        return
      }
      let v = s["verdict"] as? [String: Any] ?? [:], mesh = s["mesh"] as? [String: Any] ?? [:], arete = s["arete"] as? [String: Any] ?? [:]
      let work = v["work"] as? Bool ?? false, holds = mesh["holds"] as? Int ?? 0, why = v["why"] as? String ?? ""
      DispatchQueue.main.async {
        self.draw(color: holds > 0 || work ? .systemGreen : .systemOrange, title: why)
        self.line1.title = "DAEMONS Server · \(s["name"] as? String ?? "")"
        self.line2.title = holds > 0 ? "Working: \(holds) job\(holds == 1 ? "" : "s")" : work ? "Ready for work" : "Resting: \(why)"
        self.line3.title = "ARETE \(arete["balance"] as? Int ?? 0) · \(arete["allowanceLeft"] as? Int ?? 0) free asks today"
      }
    }.resume()
  }
  func post(_ path: String, _ body: [String: Any]) {
    var r = URLRequest(url: BASE.appendingPathComponent(path)); r.httpMethod = "POST"
    r.setValue("application/json", forHTTPHeaderField: "content-type")
    r.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: r) { _, _, _ in self.poll() }.resume()
  }
  @objc func open() { NSWorkspace.shared.open(BASE) }
  @objc func pauseHour() { post("api/pause", ["minutes": 60]) }
  @objc func pauseDay() { post("api/pause", ["minutes": 720]) }
  @objc func resume() { post("api/pause", ["minutes": 0]) }
  @objc func quit() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
let tray = Tray()
app.delegate = tray
app.setActivationPolicy(.accessory)
app.run()
