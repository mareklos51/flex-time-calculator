# ⏱ Better UKG

Rozszerzenie przeglądarki **Microsoft Edge / Chrome / Firefox** dla systemu **UKG Pro**, które automatycznie oblicza saldo czasu elastycznego (flex) na podstawie timesheeta i wyświetla je jako pasek na górze strony. Dodatkowo przelicza salda urlopowe z godzin na dni.

| Przeglądarka | Pobierz |
|---|---|
| **Edge / Chrome** | [better-ukg-1.5.7-edge-chrome.zip](https://github.com/mareklos51/better-ukg/releases/download/v1.5.7/better-ukg-1.5.7-edge-chrome.zip) |
| **Firefox** | [better-ukg-1.5.7-firefox.xpi](https://github.com/mareklos51/better-ukg/releases/download/v1.5.7/better-ukg-1.5.7-firefox.xpi) |

---

## Funkcjonalności

### Kalkulator czasu flex (Timesheet)

Wtyczka odczytuje dane bezpośrednio z timesheeta i oblicza:

- **Saldo flex** (`+HH:MM` / `-HH:MM`) — ile godzin jesteś przed lub za normą *na dziś*
- **Przepracowane / norma miesiąca** — łączna liczba godzin vs pełna norma miesięczna
- **Pozostało** — ile godzin zostało do wyrobienia normy do końca miesiąca
- **Overtime Payout** — godziny oznaczone jako *Overtime Payout* w kolumnie Activity są automatycznie **wykluczone** z salda flex
- **Korekta ręczna** — pole w banerze i w menu wtyczki pozwala dodać lub odjąć dowolną liczbę godzin od salda flex (np. `-4`, `+8`, `-4.5`); przydatne gdy UKG liczy coś niestandardowo i wtyczka pokazuje błędne saldo
- **Sugestia godziny wyjścia** — na ostatni dzień roboczy miesiąca, po wpisaniu godziny Clock In, baner automatycznie podpowiada o której wyjść, żeby wyzerować saldo flex

![Baner flex time na górze timesheeta](assets/flex-time-bar-timesheet.png)

Sumy godzin w wierszach podsumowujących dzień są wyświetlane w formacie **HH:MM** zamiast domyślnego `X.XX hrs`:

![Sumy godzin w formacie HH:MM](assets/time-in-hhmm-timesheet.png)

### Kontrola czasu pracy (Kodeks pracy)

UKG nie pilnuje wymaganych przerw, więc wtyczka robi to sama — pod sumą dnia pojawia się badge z krótkim opisem i tooltipem ze szczegółami (od kiedy do kiedy trwała praca, ile brakuje, od której można było zacząć). Alerty są **wyłącznie informacyjne** — nie zmieniają salda flex ani delt dziennych.

- **Odpoczynek dobowy 11h** (czerwony badge, art. 132 §1) — dla każdej pary kolejnych dni z godzinami liczona jest przerwa „ostatni koniec dnia → pierwszy start następnego". Praca do 22:00 i start o 06:00 = 8h odpoczynku → alert `⚠️ 08:00 odpoczynku — od 09:00`. Dokładnie 11:00 jest w porządku (prawo mówi „co najmniej").
- **Odpoczynek tygodniowy 35h** (fioletowy badge, art. 133 §1) — sprawdzana jest przerwa obejmująca weekend. Praca w sobotę do 21:00 oznacza, że w poniedziałek można zacząć najwcześniej o 08:00; wcześniejszy start → alert `⚠️ 34:00 odpoczynku tyg. — od 08:00`. Gdy pracowano i w sobotę, i w niedzielę, liczy się najdłuższa przerwa weekendu (alert pada raz).
- **Nadgodziny bez wypracowanej normy dnia** (pomarańczowy badge) — godziny *Overtime Payout* mogą być wpisane dopiero **ponad** normą dnia. Kto pracował 6h i wpisał 3h nadgodzin, wpisał je źle — badge podpowiada, ile godzin przenieść z *Overtime Payout* do zwykłych godzin (powinno być 8h pracy + 1h nadgodzin). Weekendy są pomijane — praca w dzień wolny może być w całości nadgodzinami.
- **Niedokończone dni** — przeszłe dni robocze bez żadnych godzin (np. *Clock In* bez *Clock Out*) są delikatnie zaznaczane czerwonym tłem.

Alerty milkną, gdy nie da się ich policzyć uczciwie: dzień z pracą bez godzin (Business Trip, nieoznaczone `8.00`) albo z otwartą zmianą zerywa łańcuch, bo nie wiadomo, kiedy ta praca trwała. Absencje (Vacation, Holiday, TOIL, Childcare PTO) nie są pracą — nie przedłużają dnia i nie przerywają odpoczynku, nawet gdy mają wpisane godziny.

### Menu wtyczki

Kliknij ikonę ⏱ na pasku przeglądarki, aby otworzyć panel z saldem flex i ustawieniami:

![Panel ustawień wtyczki](assets/addon-menu.png)

### Salda urlopowe (Time Off Balances)

Na stronie `Time Off → Balances` wtyczka automatycznie przelicza salda urlopowe z godzin na dni dla kart **Vacation** i **Childcare PTO**:

- Duże saldo (`192.00 hours` → `24 days`)
- Wszystkie pozycje na liście (`Current Accrued`, `Current Balance`, `Taken`, `Scheduled`, `Requested`, `Available Balance`)

![Salda urlopowe w dniach – widok Balances](assets/vacation-balance-mgr-view-days.png)

Na stronie `Time Off → Request` wtyczka automatycznie przelicza saldo urlopowe z godzin na dni:

![Salda urlopowe w dniach – widok Request](assets/vacation-balance-request-days.png)

Działa zarówno w widoku pracownika (`My Time`) jak i w widoku menedżera (`Manage → Time`).

---

## Jak to działa

| Co | Jak |
|---|---|
| Norma | Dni robocze (Pn–Pt) w miesiącu × 8h |
| Saldo vs dziś | Przepracowane − (minione dni robocze × 8h) |
| Urlopy / PTO / Holiday | Wpisane w UKG jako 8h → naturalnie wliczają się do normy |
| Overtime Payout | Wykrywane po polu `Activity` i odejmowane od sumy flex |
| Przelicznik urlopu | Godziny ÷ 8 = dni (konfigurowalne w menu wtyczki) |
| Odświeżanie | Automatyczne po nawigacji i zmianie danych (odśwież stronę) |
| Odpoczynek dobowy | Przerwa „koniec dnia D → start dnia D+1" < 11h → badge w stopce dnia (art. 132 §1) |
| Odpoczynek tygodniowy | Najdłuższa przerwa obejmująca weekend < 35h → badge w dniu powrotu do pracy (art. 133 §1) |
| Nadgodziny | `Calc. Total − Overtime Payout < norma dnia` → badge z liczbą godzin do przeniesienia (weekendy pomijane) |
| TOIL (Time Off in Lieu) | Pokrywa normę dnia jak praca, ale jako wypłata z banku flex jest odejmowany raz: `delta = suma dnia − OT − norma − TOIL`. Wolne zaklepane na przyszłość obciąża saldo już w dniu wpisania |
| Korekta ręczna | Pole `🔧` w banerze i menu wtyczki — dodaje lub odejmuje podaną liczbę godzin od salda (obsługuje wartości ujemne i ułamkowe, np. `-4`, `+8`, `-4.5`) |

---

## Instalacja w Microsoft Edge / Chrome

### Krok 1 – Pobierz pliki

Pobierz paczkę odpowiednią dla swojej przeglądarki:

| Przeglądarka | Pobierz |
|---|---|
| **Edge / Chrome** | [better-ukg-1.5.7-edge-chrome.zip](https://github.com/mareklos51/better-ukg/releases/download/v1.5.7/better-ukg-1.5.7-edge-chrome.zip) |
| **Firefox** | [better-ukg-1.5.7-firefox.xpi](https://github.com/mareklos51/better-ukg/releases/download/v1.5.7/better-ukg-1.5.7-firefox.xpi) |

Rozpakuj archiwum w dowolnym folderze (np. na pulpicie)

![Rozpakuj archiwum](assets/2-unpack-addon.png)

### Krok 2 – Włącz tryb dewelopera i załaduj rozszerzenie

1. W pasku adresu wpisz `edge://extensions` (lub `chrome://extensions`)
2. Włącz przełącznik **„Tryb dewelopera"** / **„Developer mode"**
3. Kliknij **„Załaduj rozpakowane"** / **„Load unpacked"**

![Tryb dewelopera i załaduj rozpakowane](assets/3-open-developer-mode-and-load-unpacked.png)

### Krok 3 – Wskaż folder z rozszerzeniem

Wskaż folder, który właśnie rozpakowałeś (ten, w którym jest plik `manifest.json` — zazwyczaj `better-ukg-main`).

![Wybierz folder better-ukg-main](assets/4-select-folder-better-ukg-main.png)

### Krok 4 – Gotowe!

Przejdź do timesheeta w UKG Pro — baner z saldem flex pojawi się automatycznie na górze strony.

![Baner flex pojawia się na górze timesheeta](assets/5-flex-bar-should-be-visible.png)

> **Uwaga (Edge):** Edge będzie przypominał o włączonym trybie dewelopera. Możesz to przypomnienie odsuwać co 2 tygodnie.

### Opcjonalnie – Przypnij ikonę do paska

Kliknij ikonę puzzli na pasku przeglądarki i przypnij **Better UKG**, aby mieć szybki dostęp do panelu ustawień.

![Przypnij rozszerzenie do paska](assets/6-optional-pin-the-addon.png)

---

## Instalacja w Firefox

### Krok 1 – Pobierz plik

Pobierz plik [better-ukg-1.5.7-firefox.xpi](https://github.com/mareklos51/better-ukg/releases/download/v1.5.7/better-ukg-1.5.7-firefox.xpi)

### Krok 2 – Zainstaluj

Kliknij pobrany plik `.xpi` — Firefox wyświetli okienko z pytaniem o instalację. Kliknij **Dodaj**.

Gotowe — wtyczka jest zainstalowana na stałe i nie wymaga trybu dewelopera.

---

## Historia wersji

### v1.5.7

- **Alert odpoczynku dobowego (11h)** — Kodeks pracy art. 132 §1 wymaga co najmniej 11h nieprzerwanego odpoczynku na dobę. Wtyczka liczy przerwę „ostatni koniec dnia → pierwszy start następnego" i przy zbyt krótkiej wstawia czerwony badge w stopce dnia, w którym pracę rozpoczęto za wcześnie — z godziną, od której było wolno zacząć. Absencje (Vacation, Holiday, TOIL, Childcare PTO) nie przedłużają dnia pracy nawet z wpisanymi godzinami; dzień z pracą bez godzin lub z otwartą zmianą zerywa łańcuch (nie zgadujemy, kiedy ta praca trwała).
- **Alert odpoczynku tygodniowego (35h)** — Kodeks pracy art. 133 §1 wymaga co najmniej 35h nieprzerwanego odpoczynku w tygodniu. Sprawdzana jest przerwa obejmująca weekend: po pracy w sobotę do 21:00 poniedziałek startuje najwcześniej o 08:00. Gdy pracowano w sobotę i w niedzielę, liczy się najdłuższa przerwa weekendu i alert pada raz — w dniu powrotu do pracy. Fioletowy badge, żeby odróżnić od alertu dobowego.
- **Alert nadgodzin bez wypracowanej normy dnia** — godziny *Overtime Payout* mogą być wpisane dopiero ponad normą dnia. Kto pracował 6h i wpisał 3h nadgodzin, dostanie pomarańczowy badge z podpowiedzią, ile godzin przenieść do zwykłych godzin (powinno być 8h pracy + 1h nadgodzin). Weekendy pomijane — praca w dzień wolny może być cała nadgodzinami.
- **Bugfix częściowy TOIL zawyżał minus** — godziny *Time Off In Lieu* były odejmowane dwa razy, więc 1h TOIL w dniu o sumie `08:39` dawała `−01:21` zamiast poprawnego `−00:21`. Teraz TOIL pokrywa normę dnia jak praca i jest odejmowany dokładnie raz (`delta = suma dnia − OT − norma − TOIL`). Dla dni w całości TOIL wynik był i jest ten sam.
- **Zaplanowane wolne z banku flex widać od razu** — dzień przyszły z wpisanym TOIL obciąża saldo już w chwili wpisania (środa, wolne na piątek → saldo spada dziś) i nie zmienia go ponownie, gdy stanie się przeszłością.
- **Bugfix błędna sugestia godziny wyjścia po południu** — godziny w UKG są w formacie 12-godzinnym, a am/pm siedzi w atrybucie pola, nie w jego wartości. `01:00pm` było czytane jako `01:00`, więc podpowiadana godzina wyjścia wypadała o 12h za wcześnie.

### v1.5.6

- **Bugfix salda urlopowe nie przeliczały się na dni** — na stronie *Time Off Request* UKG owinęło wartość salda dodatkowym `<span>` (`208.00<span>hrs</span>` → `<span>208.00<span>hrs</span></span>`). Wtyczka brała „pierwszy span", którym stał się zewnętrzny wrapper, więc konwersja na dni była pomijana i saldo zostawało w godzinach. Teraz liczbę czytamy z `<span>` o dokładnej treści `hrs` — działa dla starej i nowej struktury.
- **Bugfix wtyczka liczyła na zakładkach pomocniczych** — domyślny widok timesheeta ma zakładki `Time Entry`, `Calc Detail`, `Counters`. Na dwóch ostatnich baner pokazywał ujemne saldo, a dni robocze zaznaczały się na czerwono. Teraz wtyczka liczy wyłącznie na głównej zakładce `Time Entry`; na pozostałych sprząta swoje elementy i nic nie pokazuje.

### v1.5.5

- **Bugfix dzienne widgety a absencje z godzinami** — dzienne widgety (delta dnia + skumulowane `∑` pod sumą dnia) pomijały całkowicie dni z wpisem absencji innym niż TOIL (Childcare PTO, Vacation, Holiday itp.). Gdy taka absencja miała godziny doliczone do *Calc. Total* dnia (np. częściowy Childcare PTO: 6.70h pracy + 0.33h PTO = `07:02`), widget nie pokazywał delty, a skumulowane `∑` rozjeżdżało się z saldem w banerze. Teraz każdy miniony dzień roboczy jest liczony spójnie z banerem (`delta = suma dnia − etat`); dni absencji „na cały dzień" z zerem godzin nadal są pomijane (norma za nie jest anulowana, jak w banerze).
- **Deterministyczne parsowanie dat okresu** — zakres okresu z nagłówka jest teraz parsowany jawnie, niezależnie od locale przeglądarki (wcześniej `new Date(string)` mógł dać różny wynik na różnych silnikach).
- **Etat 0–24 h** — pole etatu na banerze przycina wpisaną wartość do sensownego zakresu.
- **Bugfix wiszący debounce** — przy zmianie widoku w UKG anulowany jest oczekujący przelicznik ze starej strony.

### v1.5.4

- **Pamięć ustawień per osoba** — etat i korekta zapamiętywane są dla konkretnej osoby (po numerze pracowniczym z nagłówka timesheeta, np. `(5978)`; we własnym widoku jako `self`). Menedżer przełączając się między timesheetami widzi i ustawia indywidualne wartości każdego pracownika — wprost na banerze.
  - **Etat** (norma h/dzień) — trwały per osoba, ten sam w każdym miesiącu. Standard 8h; wyjątki (np. 7/8) ustawiasz na banerze, znacznik `💾` pokazuje zapamiętany własny etat.
  - **Korekta** — per osoba **i miesiąc**, świeża w nowym miesiącu (poprzednie miesiące zachowane).
  - Pole *Norma godzin/dzień* usunięte z menu wtyczki — standardem jest stałe 8h, a etat ustawia się indywidualnie. (Wcześniej globalna norma narzucała się wszystkim pracownikom bez własnego ustawienia.)
- **Podświetlanie niedokończonych dni** — przeszłe dni robocze bez żadnych godzin w *Raw Total* (np. *Clock In* bez *Clock Out*, albo całkiem pusty dzień) są delikatnie zaznaczane czerwonym tłem. Dni z wpisem pracy lub absencji są pomijane, podobnie dzień bieżący i weekendy.
- **Ujemna korekta** — wartość ujemnej korekty ręcznej w banerze pokazywana ze znakiem `−` i na czerwono.

### v1.5.3

- **Korekta ręczna** — pole *Sick Leave (dni)* zastąpione polem `🔧 Korekta ręczna (h)`, które przyjmuje dowolną liczbę godzin ze znakiem (np. `-4`, `+8`, `-4.5`). Przydatne gdy UKG liczy coś niestandardowo i wtyczka pokazuje błędne saldo.
- **Bugfix absencja dzisiaj** — gdy bieżący dzień jest dniem absencji (Child Care, Blood Donation, Vacation on Demand itp.) saldo flex było zawyżone o wartość normy dziennej. Naprawiono.

### v1.5.2

- **UX:** Dzienny widget flex — neutralne tło zamiast kolorowania całego pola; kolor tekstu każdej wartości zależy od jej znaku niezależnie: delta dnia i suma skumulowana mają osobne kolory (zielony `+` / czerwony `−`), co pozwala odczytać oba sygnały jednocześnie (np. `+01:00` zielony, ale `∑ −04:00` czerwony)

### v1.5.1

- **Bugfix:** Poprawiono wykrywanie wpisów *Time Off in Lieu* — UKG zapisuje wartość jako `"Time Off In Lieu"` (duże I i L), przez co porównanie case-sensitive nie znajdowało wpisów i TOIL nie był odejmowany z salda flex

### v1.5.0

- **Dzienny widget flex** — pod sumą godzin każdego dnia pojawia się mały pasek z deltą dnia (`+01:00` / `-00:30`) oraz skumulowanym saldem flex (`∑ +01:00`). Tło zmienia się na zielone gdy saldo jest na plusie, czerwone gdy na minusie
- **Holiday** — dni z wpisem *Time Off: Holiday* są automatycznie wykrywane i wyłączone z liczby dni roboczych; widoczne osobno w opisie normy: `176:00h (21 dni rob. (168h) + 1 Holiday (8h))`
- **Time Off in Lieu (TOIL)** — godziny z wpisem *Time Off in Lieu* są odejmowane od przepracowanych godzin (analogicznie do Overtime Payout); widoczne w banerze jako `🔒 TOIL: 08:00h`
- **Filtrowanie przyszłych dat** — wpisy z datą w przyszłości (np. Holiday wpisany z góry przez dział HR) nie wpływają na saldo flex bieżącego dnia
- **Disclaimer** — informacja *"For informational purposes only"* dodana w opisie rozszerzenia, menu wtyczki i README

### v1.4.0
- **Sugestia godziny wyjścia** na ostatni dzień roboczy miesiąca — po wpisaniu Clock In (bez Clock Out) baner pokazuje `🏁 Wyjdź o: HH:MM` — godzinę, o której należy wyjść, żeby wyzerować saldo flex

### v1.3.0
- Sumy godzin w formacie **HH:MM** zamiast `X.XX hrs` (toggle w ustawieniach)
- Sick Leave dostępny bezpośrednio w banerze
- Baner nie przesuwa już zawartości strony — naprawiono ucinanie ostatniego dnia miesiąca

### v1.2.0
- Zmiana nazwy wtyczki na **Better UKG**
- Przeliczanie sald urlopowych z godzin na dni na stronie **Time Off Balances** (Vacation i Childcare PTO)
- Obsługa widoku menedżerskiego (`manage/time/timeoff/balances`)
- Toggle w menu wtyczki: **Urlop w dniach / godzinach** (działa natychmiast, bez zapisywania)

### v1.1.0
- Obsługa strony `Time Off → Request` — salda urlopowe przeliczane na dni
- Obsługa przypadku gdy dzisiejszy dzień jest pusty w timesheecie

### v1.0.0
- Pierwsze wydanie: kalkulator salda flex z banerem na górze strony
- Wykluczanie Overtime Payout z kalkulacji
- Obsługa Sick Leave
- Panel ustawień w popup

---

---

> **Disclaimer:** This extension is for informational purposes only. The flex balance displayed is an estimate based on data read from the timesheet and may not reflect all factors affecting your working time. Always verify your hours independently using official UKG Pro reports.

*Better UKG v1.5.7 by Marek Łoś · UKG Pro*
