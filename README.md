# Grundkenntnistest Zürich — Web-Übung

Kleine Web-App zum Üben für den kantonalen Grundkenntnistest (Kanton Zürich). Läuft als **Progressive Web App (PWA)** — offline nutzbar, sobald einmal geladen.

---

## Voraussetzungen

- **Python 3** (für den eingebauten HTTP-Server)
- Computer und Handy im **selben WLAN**

---

## Server starten

Im **Projektroot** (Ordner `naturalization`, nicht `web/`):

```bash
python3 -m http.server 8765 --bind 0.0.0.0
```

- `--bind 0.0.0.0` erlaubt Zugriff von anderen Geräten im Netz (nicht nur `localhost`).
- Standardport in diesem Projekt: **8765**.

Im Browser am Computer testen:

```text
http://localhost:8765/index.html
```

---

## Adresse fürs Handy

Der Rechner braucht einen erreichbaren Hostnamen im lokalen Netz. Auf macOS liefert oft:

```bash
hostname
```



Dann im **Handy-Browser** öffnen (WLAN wie am Computer):

```text
http://<hostname>:8765/index.html
```

Open chrome: "chrome://flags/#unsafely-treat-insecure-origin-as-secure."
put the url in the text box. set box below to enabled. relaunch chrome

> **Hinweis:** Wenn `hostname` nur einen Kurznamen ohne `.local` zeigt, probieren Sie `http://<Name>.local:8765/…` oder die **LAN-IP** des Computers (z. B. unter Systemeinstellungen → Netzwerk), z. B. `http://192.168.1.42:8765/index.html`.

Falls die Seite nicht lädt: **Firewall** prüfen (eingehende Verbindungen für Python erlauben) und sicherstellen, dass kein VPN den lokalen Zugriff blockiert.

---

## Als App speichern (PWA)

1. Seite auf dem Handy wie oben öffnen und kurz nutzen (damit Manifest & Service Worker geladen werden).
2. **Installieren / Zum Home-Bildschirm** — je nach Browser und OS:
   - **iPhone (Safari):** Teilen-Menü → **Zum Home-Bildschirm**
   - **Android (Chrome):** Menü → **App installieren** oder **Zum Startbildschirm hinzufügen**
3. Anschließend startet die Übung wie eine normale App (Vollbild, eigenes Symbol).
