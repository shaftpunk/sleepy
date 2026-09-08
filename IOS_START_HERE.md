# Sleepy på iPhone – Capacitor startpakke

Dette klargjør den eksisterende React-appen for et lokalt pakket iOS-bygg.
Det er ikke en signert IPA eller et ferdig generert Xcode-prosjekt.
Den eksisterende Sleepy-mappen og alle tidligere endringer beholdes.

## 1. Kopier filene

- Erstatt `vite.config.ts`. Vanlig bygg går fortsatt til `dist` med PWA.
  Modus `native` går til `dist-ios`, uten service worker/manifest-generering.
- Legg til `capacitor.config.json` i prosjektroten.
- Legg til `scripts/ios-prepare.mjs`.

Ingen React-komponenter, søvn-/matlogikk, database eller RLS er endret her.
Denne pakken krever ditt eksisterende prosjekt, ikke bare filene i ZIP-en.
Ved nyere Vite-endringer: flett inn mode/outDir og betingelsen rundt VitePWA.

## 2. Krav og appidentitet

Capacitor 8: Node 22+, macOS og Xcode 26+. Bruk gjerne Node 24 LTS på begge
maskiner. Standard iOS-avhengigheter bruker Swift Package Manager.
Installer Xcode og åpne det én gang for å fullføre installasjonen.

I `capacitor.config.json` er `no.larsmarius.sleepy` foreslått bundle identifier.
Dette er et lokalt forslag, ikke et registrert Apple-ID. Endre det før første
`cap add ios` hvis du ønsker noe annet. Etter generering må bundle identifier
også stemme i Xcode. Appnavnet på hjemskjermen blir Sleepy.

## 3. Installer Capacitor i din prosjektmappe

Disse kommandoene kan kjøres på Windows. De oppdaterer package.json og lockfile:

```sh
npm install @capacitor/core@8 @capacitor/ios@8
npm install -D @capacitor/cli@8
```

Commit package.json og package-lock.json sammen. Ikke kopier Windows-mappen
node_modules til Mac. Legg `dist-ios/` til i .gitignore. Behold det genererte
ios-prosjektet i Git når det er klart; respekter .gitignore fra Capacitor.

## 4. Generer iOS-prosjektet på Mac

Flytt/klon Sleepy-kildekoden til Mac, uten node_modules. Gå til prosjektmappen:

```sh
npm ci
node scripts/ios-prepare.mjs
npx cap open ios
```

Skriptet bygger webfilene først, oppretter ios-mappen bare hvis den ikke finnes,
og kjører sync. Det stopper ved feil. Det åpner eller publiserer ikke appen.
Ikke slett et eksisterende ios-prosjekt for å regenerere; det kan ha native kode.

Før bygg: legg samme offentlige Supabase URL/publishable eller anon key som i
webappen i din lokale .env (eller .env.native). Ikke bruk service-role key.
Vite baker VITE_-verdier inn i appen. Pakken inneholder ingen nøkler.
Hvis miljøet trenger egne native verdier, bruk .env.native.

## 5. Første kjøring i Xcode

1. Velg App-target → Signing & Capabilities.
2. Velg din egen Apple Team og automatisk signering.
3. Bekreft bundle identifier og appnavn.
4. Velg en iPhone-simulator og trykk Run for første test.
5. Koble til din iPhone, velg den som mål og følg Xcodes instruksjoner om
   Developer Mode/signering. Fysisk telefon er nødvendig for reell mikrofontest.
6. Logg inn med e-post/passord. Bekreft barn, søvn, mating, historikk og tema.

Webappen og iOS-appen er separate installasjoner. Innlogging og lokale
innstillinger følger ikke automatisk med fra Safari/PWA. Supabase-dataene
følger kontoen. Test at ingen duplikatregistreringer skjer ved gjenåpning.

## 6. Hva som ikke er native-integrert ennå

- Bakgrunnslyd: denne pakken lager ikke en Swift-mikrofontjeneste. Dagens
  lydovervåking stopper fortsatt ved navigasjon/bakgrunn og kan ikke loves å
  virke med skjermlås. Hold den av under første native-test.
- Mikrofon i forgrunnen: før du tester, legg `NSMicrophoneUsageDescription`
  (Privacy - Microphone Usage Description) til i Xcodes App Info.plist:
  «Sleepy bruker mikrofonen til å måle lydnivå under søvn. Lyd tas ikke opp.»
  Test Web Audio i WKWebView på en fysisk telefon. Ikke legg til bakgrunnsmodus
  audio før en ekte native mikrofontjeneste er implementert.
- Push: eksisterende Web Push/VAPID-abonnement gjelder nettappen, ikke Apples
  native push. Det trengs en egen APNs-integrasjon og backend for dette.
  Eksisterende NotificationSettings kan derfor vise at push ikke støttes.
- Passordreset/e-postlenker: eksisterende reset-kode bruker web-origin.
  Ikke bruk den inne i native-appen før deep-link/redirect-håndtering er satt opp.
  Bruk eksisterende nettapp for passordreset og bekreft e-post der, og logg inn
  i iOS-appen med e-post/passord. Native magic-link/OAuth er ikke implementert.
- Appikon/splash, skjermutforming ved safe areas/tastatur og tilgjengelighet
  må sjekkes i Xcode før deling. PWA-ikon kopieres ikke automatisk til AppIcon.
- Ingen TestFlight/App Store-publisering, Apple-signering eller skybygg er
  konfigurert. Dette krever din Apple-konto og valgte distribusjonsmåte.

## 7. Oppdateringer videre

Nettapp/Vercel: fortsett med vanlig `npm run build` og din Git-push.
iPhone: etter kodeendringer kjører du på Mac:

```sh
node scripts/ios-prepare.mjs
npx cap open ios
```

Bygg/kjør eller arkiver deretter i Xcode. En Git-push til Vercel oppdaterer
ikke automatisk den installerte iOS-appen. Ikke sett server.url til Vercel for
å late som du har en native utgivelsesflyt; dette prosjektet pakker lokale filer.

## Validering utført her

- TypeScript-kontroll av eksisterende prosjekt med ny Vite-konfigurasjon.
- Syntakskontroll av Node-skript og parsing av JSON-konfigurasjon.
- Skriptets plattformkontroll avviser Linux med forklarende melding.
- Ingen Capacitor-installasjon, cap add/sync, native build eller iPhone-kjøring
  utført: miljøet har ikke Mac/Xcode, og npm-nedlasting var tidligere blokkert.
- Full Vite-bygging er fortsatt ikke verifisert i dette Linux-miljøet, fordi
  den innsendte node_modules-mappen inneholder Windows-spesifikke binærfiler.

## Offisiell dokumentasjon

- [Miljøkrav](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Installere i eksisterende prosjekt](https://capacitorjs.com/docs/getting-started)
- [iOS](https://capacitorjs.com/docs/ios)
- [Konfigurasjon](https://capacitorjs.com/docs/config)
- [Info.plist](https://capacitorjs.com/docs/ios/configuration)

Neste milepæl: første vellykkede kjøring på iPhone. Deretter native
mikrofontjeneste med avbruddshåndtering, lokal metadatakø og synkronisering.
