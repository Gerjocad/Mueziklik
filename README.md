# Müziklik

Ein Musik-Ratespiel mit Karten: Karte scannen, Song hören, Jahr erraten.

Jede Karte hat vorne einen QR-Code und hinten ein Jahr. Der QR-Code steht nur für das Jahr.
Welcher Song läuft, bestimmt das Thema des Spielers, der gerade dran ist. Zwei Spieler mit
verschiedenen Themen hören bei derselben Karte also verschiedene Songs.

## So wird gespielt

1. Spiel einrichten, in drei Schritten:
   - Namen aller Spieler eintragen, in der Reihenfolge, in der ihr spielt.
   - Festlegen, ob alle das gleiche Thema spielen oder jeder sein eigenes.
   - Thema wählen: einmal für alle oder nacheinander für jeden Spieler.
   Die Themen gelten für das ganze Spiel. Ändern geht nur über „Neues Spiel“.
2. Jeder Spieler zieht eine Startkarte und legt sie mit dem Jahr nach oben vor sich. Sie zählt nicht als Punkt.
3. Wer dran ist, zieht eine Karte (QR-Code nach oben) und scannt sie mit der App.
4. Die App spielt eine 30-Sekunden-Hörprobe, ohne Titel oder Jahr zu zeigen.
5. Der Spieler legt die Karte an die Stelle seiner Zeitleiste, an die das Jahr passt, und dreht sie um.
6. In der App „Richtig“ oder „Falsch“ tippen. Danach zeigt die App Titel und Interpret.
   - **Richtig:** Die Karte bleibt in der Zeitleiste, ein Punkt.
   - **Falsch:** Die Karte kommt aus dem Spiel und wandert verdeckt auf den Ablagestapel. Kein Punkt.
7. Wer zuerst die eingestellte Punktzahl erreicht, gewinnt.

**Gleiches Jahr:** Liegt schon eine Karte mit demselben Jahr in der Zeitleiste, ist die neue Karte richtig,
wenn sie direkt davor oder direkt dahinter liegt. Beispiel: Zeitleiste 1985 · 1994 · 2003, gezogen wird 1994.
Richtig sind beide Lücken neben der 1994.

Die Regeln stehen auch in der App: auf der ersten Seite der Einrichtung und in den Einstellungen.

Bonuspunkte (zum Beispiel für den richtigen Titel) lassen sich im Punktestand mit + eintragen.

## Karten drucken

Die PDFs liegen in `karten/`: 132 Karten (1960 bis 2025, zwei pro Jahr) auf 15 A4-Blättern, 63 × 88 mm.

- `muziklik-karten-beidseitig.pdf`: Vorder- und Rückseiten im Wechsel. Für Drucker mit Duplex:
  beidseitig drucken, **an der langen Kante wenden**, Größe **100 %** (nicht „an Seite anpassen“).
- `muziklik-karten-vorderseiten.pdf` und `muziklik-karten-rueckseiten.pdf`: für Drucker ohne Duplex.
  Erst alle Vorderseiten drucken, den Stapel wenden, dann die Rückseiten.

Am besten zuerst ein Blatt als Probe drucken und gegen das Licht halten. Papier ab 200 g/m² nehmen,
damit das Jahr nicht durchscheint. Geschnitten wird an den Schnittmarken am Blattrand.

Andere Jahre oder mehr Karten pro Jahr:

```
cd tools
npm install
node make-cards.mjs 1970 2025 3
```

## App veröffentlichen (GitHub Pages)

Die App besteht nur aus statischen Dateien und braucht keinen Server. Die Kamera funktioniert
nur über HTTPS, deshalb reicht es nicht, `index.html` per Doppelklick zu öffnen.

1. Im Repository unter **Settings → Pages** als Quelle „Deploy from a branch“ wählen, Branch `main`, Ordner `/ (root)`.
2. Nach etwa einer Minute läuft die App unter `https://<benutzer>.github.io/<repo>/`.
3. Auf dem Handy öffnen und über „Zum Home-Bildschirm“ wie eine App ablegen.

Lokal testen: `python3 -m http.server 8000` im Projektordner, dann `http://localhost:8000` öffnen.

## Songs und Themen ändern

Themen: Internationale Hits, Filmmusik, Disney, Türkische Musik, Deutschrap, Rock, Partyhits,
Hip-Hop & R&B, Serien & Zeichentrick, One-Hit-Wonder, Nummer 1 in Deutschland, Eurovision Song Contest.
Dazu kommt „Gemischt“ (alle Themen zusammen).
Bei Serien ist das Jahr das Jahr, in dem die Serie mit diesem Titelsong gestartet ist.
Bei Eurovision ist es das Jahr des Wettbewerbs.

Die Songs stehen in `tools/songs-src.txt`, eine Zeile pro Song: `Jahr | Interpret | Titel`.
Ein neues Thema beginnt mit einer Zeile wie `[schlager] Schlager`. Die App zeigt es dann von selbst an.
Heißt die Aufnahme bei Deezer anders als der Titel, den die App zeigen soll (zum Beispiel „Main Title“
für Game of Thrones), kommen zwei Spalten dazu: `| Suchbegriff | Titel bei Deezer`. Danach:

```
cd tools
node resolve-songs.mjs
```

Das Skript sucht die Deezer-Aufnahmen und schreibt `songs.js` neu. Songs ohne sicheren Treffer
sucht die App beim Spielen selbst, weil Deezer je nach Land andere Aufnahmen anbietet.
In der App unter **Einstellungen → Songs prüfen** siehst du, wie viele Songs bei dir spielbar sind.

Jeder Song läuft pro Spiel nur einmal, egal bei welchem Spieler und in welchem Thema. Auch übersprungene
Songs („Anderer Song“) zählen als gespielt. Hat ein Thema für ein Jahr keinen neuen Song mehr, spielt die App
einen noch nicht gespielten Hit aus diesem Jahr, danach einen Song aus einem anderen Thema, und sagt das dazu.
Sind alle Songs eines Jahres verbraucht, bittet die App um eine andere Karte. „Neues Spiel“ setzt das zurück.

## Aufbau

| Datei | Zweck |
| --- | --- |
| `index.html`, `style.css`, `app.js` | die App |
| `songs.js` | Songliste (erzeugt) |
| `code.js` | Kartencode: Jahr ↔ QR-Inhalt |
| `match.js` | wählt aus Deezer-Treffern das Original statt Cover- oder Live-Versionen |
| `vendor/jsQR.js` | QR-Erkennung (Apache-2.0) |
| `fonts/` | Schrift Poppins (OFL) |
| `tools/` | Karten-Generator und Song-Auflöser |

Design: Stilfamilie „Night“ aus Cemres Pattern-Bibliothek. Übernommen sind WordLoader, FloatingField,
ExpandIconButton und die Buttons des InsetLoginForm (Uiverse.io, MIT, Herkunft steht im CSS).

Musik: 30-Sekunden-Hörproben über die öffentliche Deezer-API. Die App speichert Spielstand und
gefundene Songs nur im Browser des Geräts.
