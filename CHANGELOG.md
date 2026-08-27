# Changelog

## [1.5.7] – 2026-08-27

### Dodano
- **Alert naruszenia odpoczynku dobowego (11h)** – Kodeks pracy art. 132 §1 wymaga co najmniej 11h nieprzerwanego odpoczynku na dobę; UKG tego nie pilnuje. Dla każdej pary kolejnych dni zegarowych wtyczka liczy lukę „ostatni koniec dnia D → pierwszy start dnia D+1" i przy wyniku `< 11:00` wstawia czerwony badge w stopce dnia, w którym pracę rozpoczęto za wcześnie (`⚠️ 09:30 odpoczynku — od 07:00`, tooltip z pełnym łańcuchem i brakującym czasem). Dokładnie 11:00 to cisza – prawo mówi „co najmniej". Próg jest stałą (`MIN_REST_MINUTES`), bez przełącznika w popupie.
  - Klasyfikacja dnia (`collectWorkDayTimes()`): **ZEGAROWY** (wpis pracy z godzinami; koniec znany o ile brak otwartej zmiany), **NIEPRZEJRZYSTY** (praca tylko w `Raw Total` bez godzin – Business Trip, nieoznaczone 8.00 → *zerywa* łańcuch, bo nie wiadomo, kiedy trwała), **ODPOCZYNEK** (brak wpisów albo sama absencja – Vacation/Holiday/TOIL → przeskakiwany).
  - Wiersze absencji są ignorowane **nawet z godzinami**: odbiór TOIL 19:00–20:00 czy Childcare PTO 15:00–15:20 to nie praca i nie może przedłużać dnia pracy. Dzień mieszany (praca + wiersz raw) zostaje zegarowy. Otwarta zmiana jest sprawdzana jako start, ale zerywa łańcuch dla dnia następnego. Pierwszy dzień okresu nie alarmuje (brak poprzednika w DOM). `end < start` → koniec `+24h` (praca przez północ).
- **Alert naruszenia odpoczynku tygodniowego (35h)** – Kodeks pracy art. 133 §1 wymaga co najmniej 35h nieprzerwanego odpoczynku w każdym tygodniu (11h dobowego + 24h). W normalnym tygodniu przypada on na weekend, więc sprawdzana jest **przerwa obejmująca sobotę lub niedzielę**: kto pracował w sobotę do 21:00, w poniedziałek może zacząć najwcześniej o 08:00 (34h → fioletowy badge `⚠️ 34:00 odpoczynku tyg. — od 08:00`). Próg jest stałą (`MIN_WEEKLY_REST_MINUTES`).
  - Łańcuch dni zegarowych i traktowanie absencji są **te same** co przy odpoczynku dobowym (wspólne `sortedWorkDayEntries()`), ale przerwa może obejmować wiele dni (`pt 17:00 → pn 08:00`).
  - Weekend rozliczany **jako całość**: praca w sobotę i w niedzielę daje kilka przerw, a odpoczynkiem tygodniowym jest **najdłuższa** z nich – alert pada raz, w dniu powrotu do pracy po tej przerwie.
  - Weekend z zerwanym łańcuchem (praca bez godzin, otwarta zmiana) jest **pomijany** – brak danych oznacza ciszę, nigdy fałszywy alert. Pierwszy weekend okresu zwykle nie alarmuje (przerwa startuje w poprzednim miesiącu, którego nie ma w DOM).
  - Gdy najwcześniejszy dozwolony start (`koniec pracy + 35h`) wypada dzień po dniu powrotu do pracy (niedziela do 20:00 → wtorek 07:00), badge pokazuje również dzień: `od wt 07:00`.
- **Alert nadgodzin bez wypracowanej normy dnia** – zasada firmowa: godziny *Overtime Payout* mogą być wpisane dopiero **ponad** normą dnia. Kto pracował 6h i wpisał 3h nadgodzin, wpisał je źle (powinno być 8h zwykłej pracy + 1h nadgodzin). Wtyczka liczy `zwykła_praca = Calc. Total − OT` i przy `zwykła_praca < norma dnia` wstawia pomarańczowy badge z informacją, ile godzin przenieść z *Overtime Payout* do zwykłych godzin. Weekendy są pomijane w całości (praca w dzień wolny może być cała nadgodzinami), podobnie dni przyszłe. Alert jest **wyłącznie informacyjny** – nie zmienia salda flex ani delt dziennych.
  - Trzy badge'e (dobowy czerwony, tygodniowy fioletowy, nadgodziny pomarańczowy) mogą siedzieć w tej samej komórce *Calc. Total* pod widgetem delty – dlatego różnią się kolorem.

### Zmieniono
- **Model TOIL: godziny odbierane z banku flex są odejmowane dokładnie raz** – *Time Off In Lieu* wchodzi do *Calc. Total* dnia, więc pokrywa normę na równi z pracą, ale jest wypłatą z banku flex, więc obciąża saldo jednorazowo. Delta dnia sprowadza się do jednej formuły – tej samej w banerze i w widgetach dziennych: `footer − OT − norma − TOIL`. Do ≤1.5.6 TOIL był odejmowany **dwa razy** (raz z przepracowanych, raz w formule salda), a normę anulowały tylko dni „w całości TOIL". Dla pełnych dni TOIL wynik był ten sam (anulowana norma kompensowała drugie odjęcie), ale **częściowy TOIL zawyżał minus** o kwotę TOIL: 1h TOIL w dniu 8:39 dawało `−01:21` zamiast poprawnego `−00:21`.
- **Zaplanowany TOIL obciąża saldo od razu po wpisaniu** – dni **przyszłe** z wpisem TOIL wchodzą do salda przez `futureToilAdjust` (`footer − norma dnia − TOIL`). Wolne wzięte z banku flex widać w saldzie już w dniu wpisania (środa, wolne zaklepane na piątek → saldo spada dziś), a ponieważ formuła jest identyczna jak dla dni minionych, **saldo nie drgnie**, gdy ten dzień stanie się przeszłością. Widgety dzienne z tego samego powodu pokazują też przyszłe dni z TOIL – inaczej ostatnie `∑` rozjeżdżałoby się z banerem.

### Naprawiono
- **Błędna sugestia godziny wyjścia dla popołudniowego startu** – godziny w UKG są w formacie **12-godzinnym**, a znacznik am/pm siedzi w sufiksie `aria-label` pola (`"Frompm"`, `"Toam"`), nie w jego wartości. Stary parser to ignorował, więc `01:00pm` czytał jako `01:00` i podpowiadana godzina wyjścia była o 12h za wczesna. Nowy `parseClockInput()` jest jedynym parserem czasu w pliku (używa go też kontrola odpoczynku).
- **Dzień z alertem nie konwertował się na HH:MM** – konwersja sum dnia czytała surowy `textContent` komórki, odfiltrowując tylko widget delty. Po dodaniu badge'y komórka z alertem miałaby zabrudzoną wartość i nie dała się sparsować. Wszystkie elementy wstrzykiwane do komórki *Calc. Total* są teraz wypisane w `INJECTED_CELL_SELECTOR` i filtrowane przez `getOriginalText()`.

## [1.5.6] – 2026-07-27

### Naprawiono
- **Salda urlopowe nie przeliczały się na dni po zmianie DOM w UKG** – na stronie *Time Off Request* UKG owinęło wartość salda dodatkowym `<span>` (`208.00<span>hrs</span>` → `<span>208.00<span>hrs</span></span>`). `convertVacationBalancesToDays()` brało „pierwszy `<span>`", którym stał się zewnętrzny wrapper o treści `208.00hrs` (a nie `hrs`), więc guard odrzucał wpis i saldo zostawało w godzinach. Teraz namierzamy `<span>` o dokładnej treści `hrs`/`days`, a liczbę czytamy z jego `previousSibling` – działa dla starej i nowej struktury. Ten sam fix objął `revertVacationBalancesToHours()`.
- **Wtyczka liczyła saldo na zakładkach pomocniczych timesheeta** – domyślny widok timesheeta ma zakładki (`Time Entry`, `Calc Detail`, `Counters`). Wtyczka analizowała każdą tak samo, przez co na `Calc Detail`/`Counters` baner pokazywał ujemne saldo, a dni robocze zaznaczały się na czerwono. Nowy `isTimeEntryTab()` rozpoznaje aktywną zakładkę po `.c-page-tabs` (`aria-selected="true"` + `data-category="category-TIME_ENTRY"`, z fallbackiem na zwinięty dropdown). Poza `Time Entry` wtyczka sprząta swoje elementy (`removeFlexUI()`) i nic nie liczy; popup prosi o przejście na `Time Entry`. Brak paska zakładek (starszy/menedżerski układ) → zachowanie bez zmian.

## [1.5.5] – 2026-06-26

### Naprawiono
- **Dzienne widgety nie liczyły absencji z godzinami w sumie dnia** – małe widgety pod sumą dnia (delta dnia + skumulowane `∑`) pomijały całkowicie każdy dzień z wpisem Time Off innym niż TOIL (Childcare PTO, Vacation, Holiday, Blood Donation itp.). Gdy taki dzień miał godziny doliczone do *Calc. Total* (UKG wlicza godziny absencji do sumy dnia – np. częściowy Childcare PTO: 6.70h pracy + 0.33h PTO = `07:02`), widget nie wyświetlał delty, a skumulowane `∑` rozjeżdżało się z saldem banera (dla problematycznego timesheeta: baner `−00:23`, a widgety `+01:35`). Pełnodniowe Vacation/Holiday (suma = etat) dawały netto zero i maskowały błąd. Teraz `injectDailyFlexWidgets()` liczy każdy miniony dzień roboczy po sumie dnia (`delta = suma − etat`) – tak samo jak `calculate()`. Dni absencji „na cały dzień" z zerem godzin nadal są pomijane (warunek `rawMinutes === 0`), co odpowiada anulowaniu normy w banerze (`absenceNormAdjust`). TOIL i Overtime Payout dalej odejmowane per-dzień.
- **Wiszący debounce po zmianie strony** – przy nawigacji w SPA UKG (`hashchange`) anulowany jest teraz oczekujący timer MutationObservera (`clearTimeout(debounceTimer)`), żeby kalkulacja ze starej strony nie odpaliła się już po przejściu na inny widok.

### Zmieniono
- **Deterministyczne parsowanie dat okresu** – zakres z nagłówka („May 01, 2026 - May 31, 2026") jest parsowany jawnie (`parseEnglishDate`) zamiast przez `new Date(string)`, którego wynik bywa zależny od locale/silnika przeglądarki. Spójne z resztą parsowania dat w wtyczce.
- **Etat ograniczony do zakresu 0–24 h** – pole etatu na banerze przycina wpisaną wartość do sensownego zakresu (ujemny etat dawał ujemną normę).

## [1.5.4] – 2026-06-16

### Dodano
- **Pamięć ustawień per osoba** – etat i korekta są teraz zapamiętywane dla konkretnej osoby na podstawie numeru pracowniczego z nagłówka timesheeta (np. `(5978)`); we własnym widoku pod kluczem `self`. Menedżer „skacząc" między timesheetami widzi i ustawia indywidualne wartości każdego pracownika.
  - **Etat** (norma h/dzień) – trwały per osoba, obowiązuje w każdym miesiącu. Standard to 8h; wyjątki (np. 7/8) ustawiasz wprost na banerze danego timesheeta. Znacznik `💾` informuje o zapamiętanym własnym etacie.
  - **Korekta** – zapamiętywana per osoba **i miesiąc**; świeża (0) w nowym miesiącu, poprzednie miesiące zachowane. Edytowalna wprost na banerze.
  - Baner pokazuje, dla kogo zapisywane są ustawienia (👤 imię i nazwisko / „Twój timesheet").
  - Dane przechowywane lokalnie w `chrome.storage.local` (klucz `personData`).
- **Podświetlanie niedokończonych dni** – przeszłe dni robocze (Pn–Pt) bez żadnych godzin w kolumnie *Raw Total* są delikatnie zaznaczane czerwonym tłem. Wyłapuje to typowy błąd: wpisany *Clock In* bez *Clock Out* (Raw Total pusty) oraz całkiem puste dni robocze. Dni z dowolnym wpisem (praca lub absencja: Holiday, Vacation, Blood Donation itp.) mają Raw Total > 0, więc nie są zaznaczane. Dzień bieżący i weekendy są pomijane.

### Zmieniono
- **Etat zamiast globalnej normy dziennej** – pole *Norma godzin/dzień* usunięte z menu wtyczki. Standardowy etat to teraz stała 8h, a wyjątki ustawia się indywidualnie per osoba na banerze. Wcześniej globalna norma była domyślną dla wszystkich, przez co zmiana na np. 7h błędnie narzucała 7h każdemu pracownikowi bez własnego ustawienia.
- **Ujemna korekta w banerze** – wartość ujemnej korekty ręcznej jest teraz pokazywana ze znakiem `−` i czerwonym kolorem (wcześniej bez znaku).

## [1.5.3] – 2026-06-08

### Zmieniono
- **Korekta ręczna (h)** – pole *Sick Leave (dni)* zastąpione polem *Korekta ręczna* w godzinach; obsługuje wartości dodatnie, ujemne i ułamkowe (np. `-4`, `+8`, `-4.5`). Używaj gdy wtyczka liczy coś błędnie z powodu niestandardowej konfiguracji UKG.

### Naprawiono
- **Absencja w bieżącym dniu** – gdy dzień dzisiejszy jest dniem absencji (Child Care, Blood Donation, Vacation on Demand itp.) z zerem godzin w `Calc.Total`, saldo flex było zawyżone o wartość całodniowej normy. Błąd wynikał z jednoczesnego działania logiki `isTodayEmpty` i `absenceNormAdjust`, które wzajemnie się dublowały. Naprawiono przez wyłączenie `isTodayEmpty` dla dni z wpisem absencji.

---

## [1.3.0] – 2026-05-29

### Dodano
- **Format HH:MM** – sumy godzin w wierszach podsumowujących dzień są wyświetlane jako `08:01` zamiast `8.02 hrs`; przełącznik w ustawieniach wtyczki
- **Sick Leave** – pole korekty dni Sick Leave bezpośrednio w banerze (bez otwierania panelu ustawień)

### Naprawiono
- Baner nie przesuwa już zawartości strony w dół – usunięto `padding-top` z `body`, który powodował ucinanie ostatniego dnia miesiąca przy pełnym widoku timesheeta

### Zmieniono
- Opis rozszerzenia w `manifest.json` zaktualizowany do angielskiego (zgodność z wymogami sklepów)
- Drobne poprawki tekstu w README

---

## [1.2.0] – 2026-05-28

### Dodano
- **Salda urlopowe w dniach** – strony `Time Off → Balances` i `Time Off → Request` automatycznie przeliczają godziny na dni (÷ 8) dla kart Vacation i Childcare PTO; przełącznik w ustawieniach
- **Lepsza obsługa UKG** – poprawiona detekcja timesheeta, bardziej odporna na zmiany konfiguracji kolumn

### Naprawiono
- Poprawna obsługa wiersza dzisiejszego dnia bez wpisanych godzin (norma nie jest naliczana za pusty dzień)

---

## [1.1.0] – 2026-05-20

### Dodano
- Panel ustawień (popup) z konfiguracją normy godzin dziennie i ręcznej normy miesięcznej
- Obsługa trybu menedżera (`Manage → Time → Timesheet`)

---

## [1.0.0] – 2026-05-15

### Pierwsze wydanie
- Baner z saldem czasu flex (`+HH:MM` / `-HH:MM`) wstrzykiwany na górę timesheeta UKG Pro
- Obliczanie normy na podstawie minionych dni roboczych (pon–pt)
- Wykluczanie wpisów `Overtime Payout` z kalkulacji flex
- Obsługa routingu SPA (hashchange, MutationObserver, polling)
