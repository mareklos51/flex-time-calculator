/**
 * Better UKG – content script
 * Strona docelowa: *.saashr.com (UKG Pro)
 *
 * Algorytm (uproszczony — pełna formuła w calculate()):
 *  1. Pobierz zakres okresu z nagłówka timesheeta (span.c-timesheet-header__date-carousel-title)
 *  2. Zsumuj "Calc. Total" z m-footer ≤ dziś (tr[data-group-date].m-footer, TD[5])
 *  3. Odejmij Overtime Payout i TOIL; wykryj Holiday/absencje (anulują normę dnia)
 *  4. Saldo = przepracowane(−OT−TOIL) − norma_minionych_dni + korekty (TOIL/absencje/ręczna)
 *  5. Wstrzyknij baner + dzienne widgety; podświetl niedokończone dni
 */

(function () {
  'use strict';

  // ─── Konfiguracja (nadpisywana przez chrome.storage) ─────────────────────────
  // Standardowy etat (pełny) — stała, nieedytowalna. Wyjątki (np. 7/8) ustawia się
  // indywidualnie per osoba wprost na banerze. Nie ma globalnego etatu, bo łatwo nim
  // przez pomyłkę narzucić nietypową normę wszystkim pracownikom naraz.
  const DEFAULT_HOURS_PER_DAY = 8;

  let CFG = {
    manualNorm: 0,        // ręczna norma miesiąca (godziny); 0 = auto
    vacationInDays: true, // wyświetlaj salda urlopowe w dniach (zamiast godzin)
    hhmmFormat: true,     // wyświetlaj sumy godzin w formacie HH:MM zamiast X.XX hrs
  };

  // ─── Pamięć per osoba ────────────────────────────────────────────────────────
  //
  // Każdy timesheet ma na górze imię/nazwisko + numer pracowniczy "(5978)" (widok
  // menedżera). Pod tym numerem zapamiętujemy ustawienia danej osoby. We własnym
  // widoku ("My Time") brak kontekstu pracownika → klucz "self".
  //
  // Struktura:
  //   personData["5978"] = {
  //     name: "Halina Stosik-Fleszar",
  //     hoursPerDay: 7,                          // etat — TRWAŁY (obowiązuje co miesiąc)
  //     months: { "2026-05": { correctionHours: 16 } }  // korekta — per MIESIĄC (auto-reset)
  //   }
  //
  // Rozwiązywanie wartości dla bieżącego widoku (EFF):
  //   hoursPerDay     = personData[key].hoursPerDay        ?? DEFAULT_HOURS_PER_DAY (standard 8h)
  //   correctionHours = personData[key].months[ym].correctionHours ?? 0       (świeża co miesiąc)
  let personData      = {};                                   // ładowane z chrome.storage
  let currentPerson   = { key: 'self', name: '', scope: 'self' };
  let currentMonthKey = null;
  let EFF = { hoursPerDay: 8, manualNorm: 0, correctionHours: 0 }; // wartości obowiązujące w bieżącym widoku

  const BANNER_ID            = 'flex-time-calc-banner';
  const CALC_TOTAL_TD_INDEX  = 5;    // indeks kolumny "Calc. Total" w TR timesheeta
  const POLL_INTERVAL_MS     = 500;
  const POLL_MAX_ATTEMPTS    = 40;   // 20 sekund czekania

  const TIMESHEET_HASH_PATTERNS = [
    '#time/timesheet',
    '#manage/time/timesheet',
    '#time/view/timesheets',
  ];

  const VACATION_HASH_PATTERNS = [
    '#time/timeoff',
    '#manage/time/timeoff',
  ];

  let pollTimer       = null;
  let mutationObs     = null;
  let debounceTimer   = null;

  // ─── Parsowanie i formatowanie ────────────────────────────────────────────────

  /** "8.02 hrs" → 481 min */
  function parseHoursToMinutes(text) {
    const m = (text || '').trim().match(/^([\d.]+)\s*hrs?$/i);
    return m ? Math.round(parseFloat(m[1]) * 60) : 0;
  }

  /** 481 min → "+08:01" lub "-00:45" */
  function formatBalance(minutes) {
    const sign = minutes >= 0 ? '+' : '-';
    const abs  = Math.abs(minutes);
    return sign + fmt2(Math.floor(abs / 60)) + ':' + fmt2(abs % 60);
  }

  /** 481 min → "08:01" (bez znaku) */
  function formatMinutes(minutes) {
    const abs = Math.abs(minutes);
    return fmt2(Math.floor(abs / 60)) + ':' + fmt2(abs % 60);
  }

  function fmt2(n) { return String(n).padStart(2, '0'); }

  /**
   * Zwraca oryginalny tekst komórki: jeśli została przekonwertowana do HH:MM,
   * atrybut data-ftc-hhmm przechowuje oryginalną wartość "X.XX hrs".
   * Jeśli komórka zawiera widget .ftc-daily-widget, pomija go przy odczycie textContent.
   */
  function getOriginalText(el) {
    if (el.hasAttribute('data-ftc-hhmm')) return el.getAttribute('data-ftc-hhmm');
    const widget = el.querySelector('.ftc-daily-widget');
    if (!widget) return el.textContent;
    const clone = el.cloneNode(true);
    clone.querySelector('.ftc-daily-widget').remove();
    return clone.textContent.trim();
  }

  /** Zlicza dni robocze Pn–Pt od start do end (włącznie) */
  function countWorkingDays(start, end) {
    const s = new Date(start); s.setHours(0, 0, 0, 0);
    const e = new Date(end);   e.setHours(0, 0, 0, 0);
    let count = 0;
    const d = new Date(s);
    while (d <= e) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  /**
   * Parsuje pojedynczą angielską datę "May 01, 2026" (też "September 1 2026") → Date
   * (lokalna północ). Jawne parsowanie zamiast new Date(string): new Date() na takim
   * formacie jest zależne od implementacji/locale silnika JS, a tu chcemy wyniku
   * deterministycznego i spójnego z parseDateAttr()/rowToDate() (też new Date(rok, mc, dz)).
   * Zakłada angielskie nazwy miesięcy (UKG renderuje nagłówek po angielsku).
   */
  function parseEnglishDate(str) {
    const m = (str || '').trim().match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
    if (!m) return null;
    const abbr  = m[1].slice(0, 3);   // pełna nazwa i skrót dzielą 3 pierwsze litery (September→Sep, June→Jun)
    const month = MONTH_ABBR[abbr.charAt(0).toUpperCase() + abbr.slice(1).toLowerCase()];
    const day   = parseInt(m[2], 10);
    const year  = parseInt(m[3], 10);
    if (month === undefined || isNaN(day) || isNaN(year)) return null;
    const d = new Date(year, month, day);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Parsuje "May 01, 2026 - May 31, 2026" → { start: Date, end: Date } */
  function parsePeriodDates(text) {
    const m = (text || '').match(
      /([A-Za-z]+ \d{1,2},?\s*\d{4})\s*[-–—]\s*([A-Za-z]+ \d{1,2},?\s*\d{4})/
    );
    if (!m) return null;
    const start = parseEnglishDate(m[1]);
    const end   = parseEnglishDate(m[2]);
    if (!start || !end) return null;
    return { start, end };
  }

  // ─── Identyfikacja osoby i pamięć ustawień ───────────────────────────────────

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * Ustala kontekst osoby z nagłówka timesheeta.
   * - Widok menedżera (Manage): jest blok .c-user-context z imieniem i numerem
   *   pracowniczym w nawiasie "(5978)" → klucz = numer.
   * - Własny widok (My Time): brak tego bloku → klucz "self".
   */
  function getPersonContext() {
    const heading  = document.querySelector('.c-user-context__heading-link');
    const textInfo = document.querySelector('.c-user-context__user-text-info');
    if (heading || textInfo) {
      const name = (heading?.textContent || '').trim();
      const m = (textInfo?.textContent || '').match(/\((\d+)\)/);
      if (m) return { key: m[1], name: name || ('#' + m[1]), scope: 'employee' };
      if (name) return { key: 'name:' + name.toLowerCase(), name, scope: 'employee' };
    }
    return { key: 'self', name: '', scope: 'self' };
  }

  /** Period start → klucz miesiąca "YYYY-MM". */
  function getMonthKey(period) {
    const d = period.start;
    return d.getFullYear() + '-' + fmt2(d.getMonth() + 1);
  }

  /** Wartości obowiązujące dla danej osoby w danym miesiącu (override > globalne). */
  function resolveEffective(person, monthKey) {
    const eff = {
      hoursPerDay:     DEFAULT_HOURS_PER_DAY,  // standard; tylko indywidualny override go zmienia
      manualNorm:      CFG.manualNorm,
      correctionHours: 0,                      // korekta świeża co miesiąc (brak fallbacku globalnego)
    };
    const p = personData[person.key];
    if (p) {
      if (typeof p.hoursPerDay === 'number') eff.hoursPerDay = p.hoursPerDay;
      const mo = p.months && p.months[monthKey];
      if (mo && typeof mo.correctionHours === 'number') eff.correctionHours = mo.correctionHours;
    }
    return eff;
  }

  function ensurePerson(key, name) {
    if (!personData[key]) personData[key] = { months: {} };
    if (!personData[key].months) personData[key].months = {};
    if (name) personData[key].name = name;
    return personData[key];
  }

  function persistPersonData() {
    try { chrome.storage.local.set({ personData }); } catch (_) {}
  }

  /** Zapisz korektę osoby na konkretny miesiąc. 0 = usuń (powrót do domyślnego 0). */
  function setPersonCorrection(key, name, monthKey, hours) {
    const p = ensurePerson(key, name);
    if (!p.months[monthKey]) p.months[monthKey] = {};
    if (!hours) {
      delete p.months[monthKey].correctionHours;
      if (Object.keys(p.months[monthKey]).length === 0) delete p.months[monthKey];
    } else {
      p.months[monthKey].correctionHours = hours;
    }
    persistPersonData();
  }

  /** Zapisz etat osoby (trwały). null lub równy standardowi (8h) = usuń override. */
  function setPersonHoursPerDay(key, name, hours) {
    const p = ensurePerson(key, name);
    if (hours === null || isNaN(hours) || hours === DEFAULT_HOURS_PER_DAY) {
      delete p.hoursPerDay;
    } else {
      p.hoursPerDay = hours;
    }
    persistPersonData();
  }

  // ─── Główna kalkulacja ────────────────────────────────────────────────────────

  /**
   * Parsuje format daty z atrybutu data-group-date UKG: "THU May 28" → { month: 4, day: 28 }
   * new Date() nie radzi sobie z tym formatem (brak roku, niestandardowy zapis).
   */
  const MONTH_ABBR = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
                       Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

  function parseDateAttr(attr) {
    const m = (attr || '').trim().match(/^[A-Z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})$/);
    if (!m) return null;
    const month = MONTH_ABBR[m[1]];
    const day   = parseInt(m[2], 10);
    if (month === undefined || isNaN(day)) return null;
    return { month, day };
  }

  /**
   * Zwraca true jeśli m-footer dla dzisiejszej daty istnieje, ale ma 0 godzin.
   * Używane żeby nie naliczać normy za dzień, który jeszcze nie jest wpisany.
   */
  function isTodayEmpty(today) {
    const todayMonth = today.getMonth();
    const todayDay   = today.getDate();
    let foundRow = false;
    let hasHours = false;

    document.querySelectorAll('tr[data-group-date].m-footer').forEach((row) => {
      const parsed = parseDateAttr(row.getAttribute('data-group-date'));
      if (!parsed) return;
      if (parsed.month !== todayMonth || parsed.day !== todayDay) return;

      foundRow = true;
      const tds = row.querySelectorAll('td');
      if (tds.length > CALC_TOTAL_TD_INDEX) {
        if (parseHoursToMinutes(getOriginalText(tds[CALC_TOTAL_TD_INDEX])) > 0) hasHours = true;
      }
    });

    return foundRow && !hasHours;
  }

  function isLastWorkingDayOfMonth(today, periodEnd) {
    if (today > periodEnd) return false;
    if (today.getDay() === 0 || today.getDay() === 6) return false;
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return countWorkingDays(tomorrow, periodEnd) === 0;
  }

  function getTodayStartTime(today) {
    const todayMonth = today.getMonth();
    const todayDay   = today.getDate();
    for (const row of document.querySelectorAll('tr[data-group-date][data-shift-id]')) {
      const parsed = parseDateAttr(row.getAttribute('data-group-date'));
      if (!parsed) continue;
      if (parsed.month !== todayMonth || parsed.day !== todayDay) continue;
      const startInput = row.querySelector('input[name="start_time"]');
      const endInput   = row.querySelector('input[name="end_time"]');
      if (!startInput?.value) continue;
      if (endInput?.value) continue;
      return startInput.value;
    }
    return null;
  }

  function parseTimeHHMM(timeStr) {
    const m = (timeStr || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function calculate() {
    // 1. Nagłówek okresu
    const titleEl = document.querySelector('span.c-timesheet-header__date-carousel-title');
    if (!titleEl) return null;

    const period = parsePeriodDates(titleEl.textContent);
    if (!period) return null;

    // Ustal osobę (z nagłówka) i miesiąc → rozwiąż wartości obowiązujące (etat, korekta).
    currentPerson   = getPersonContext();
    currentMonthKey = getMonthKey(period);
    EFF             = resolveEffective(currentPerson, currentMonthKey);

    // Wyznacz "dziś" wcześnie — potrzebne do filtrowania wierszy przyszłych dat
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const effectiveToday = today < period.end ? today : period.end;

    // Pomocnik: konwertuje wynik parseDateAttr na obiekt Date (rok z okresu)
    function rowToDate(parsed) {
      if (!parsed) return null;
      const d = new Date(period.start.getFullYear(), parsed.month, parsed.day);
      d.setHours(0, 0, 0, 0);
      return d;
    }

    // 2. Suma "Calc. Total" ze wszystkich wierszy m-footer — TYLKO daty ≤ dziś.
    //    Przyszłe wpisy (np. Time Off: Holiday z góry wpisane) nie są jeszcze "zarobione"
    //    i nie powinny wpływać na saldo.
    let totalWorkedMinutes = 0;
    const allRows = document.querySelectorAll('tr[data-group-date]');
    if (allRows.length === 0) return null;   // timesheet się jeszcze ładuje

    allRows.forEach((row) => {
      if (!row.classList.contains('m-footer')) return;
      const parsed = parseDateAttr(row.getAttribute('data-group-date'));
      if (parsed) {
        const rowDate = rowToDate(parsed);
        if (rowDate && rowDate > effectiveToday) return; // pomiń przyszłe daty
      }
      const tds = row.querySelectorAll('td');
      if (tds.length > CALC_TOTAL_TD_INDEX) {
        totalWorkedMinutes += parseHoursToMinutes(getOriginalText(tds[CALC_TOTAL_TD_INDEX]));
      }
    });

    // 2b. Odejmij godziny z wpisów "Overtime Payout" — nie wliczają się do flex.
    //
    // Podejście odporne na zmienną liczbę kolumn (np. dodatkowe pola Accounting):
    //
    // 1. DETEKCJA ACTIVITY: szukamy input[aria-label="Activity"] w wierszu wpisu.
    //    UKG renderuje pole Activity jako kontrolkę z input-em, którego atrybut
    //    i właściwość .value zawiera nazwę wybranej aktywności.
    //
    // 2. CALC. TOTAL: w wierszach wpisów godziny są liczbami dziesiętnymi ("8.02",
    //    nie "8.02 hrs"). RawTotal i CalcTotal to jedyne TD z czystą liczbą dziesiętną.
    //    CalcTotal to zawsze DRUGI taki TD (RawTotal jest pierwszy).
    let overtimePayoutMinutes = 0;
    document.querySelectorAll('tr[data-group-date][data-shift-id]').forEach((row) => {
      // 1. Sprawdź Activity via input[aria-label="Activity"]
      const activityInput = row.querySelector('input[aria-label="Activity"]');
      if (!activityInput) return;

      const activityValue =
        activityInput.value ||                       // właściwość DOM (żywa strona)
        activityInput.getAttribute('value') || '';   // atrybut HTML (snapshot)

      if (!activityValue.includes('Overtime Payout')) return;

      // 2. Znajdź CalcTotal: drugi TD z czystą liczbą dziesiętną
      const tds = [...row.querySelectorAll('td')];
      const decimalTds = tds.filter((td) => {
        const t = td.textContent.replace(/\s+/g, ' ').trim();
        return /^\d+\.\d+$/.test(t);
      });

      // decimalTds[0] = RawTotal, decimalTds[1] = CalcTotal
      const calcTd = decimalTds[1] ?? decimalTds[0];
      if (!calcTd) return;

      const hoursText = calcTd.textContent.replace(/\s+/g, '').trim();
      overtimePayoutMinutes += Math.round(parseFloat(hoursText) * 60);
    });

    // 2c. Wykryj wpisy "Time Off: Holiday" — nie są dniami roboczymi, pokazujemy osobno.
    //     Skanujemy WSZYSTKIE wpisy miesiąca (nie tylko ≤ dziś) dla celów wyświetlania normy.
    const holidayDates = new Set();
    let holidayMinutes = 0;
    document.querySelectorAll('tr[data-group-date][data-shift-id]').forEach((row) => {
      const timeOffInput = row.querySelector('input[aria-label="Time Off"]');
      if (!timeOffInput) return;
      const val = timeOffInput.value || timeOffInput.getAttribute('value') || '';
      if (!val.includes('Holiday')) return;
      const dateAttr = row.getAttribute('data-group-date');
      if (holidayDates.has(dateAttr)) return;
      holidayDates.add(dateAttr);
      const footerRow = document.querySelector(`tr[data-group-date="${dateAttr}"].m-footer`);
      if (footerRow) {
        const tds = footerRow.querySelectorAll('td');
        if (tds.length > CALC_TOTAL_TD_INDEX) {
          holidayMinutes += parseHoursToMinutes(getOriginalText(tds[CALC_TOTAL_TD_INDEX]));
        }
      }
    });
    const holidayCount = holidayDates.size;

    // 2d. Odejmij godziny z wpisów "Time Off in Lieu" — pracownik wziął wolne w zamian
    //     za przepracowane nadgodziny. Odejmujemy z poziomu wpisu (entry-level), nie z m-footer —
    //     to jedyna metoda poprawna dla częściowego TOIL (np. 1.5h TOIL + 4.7h pracy tego samego
    //     dnia: footer = 6.2h, ale odejść należy tylko 1.5h).
    //
    //     Wiersze Time Off mają inną strukturę niż wpisy pracy: godziny są w
    //     input[aria-label="Raw Total"], a nie w czystym decimal TD (jak w OT Payout).
    let toilMinutes = 0;
    const toilByDateCalc = {};   // dateAttr → TOIL minut (do obliczenia fullToilNorm)
    document.querySelectorAll('tr[data-group-date][data-shift-id]').forEach((row) => {
      const timeOffInput = row.querySelector('input[aria-label="Time Off"]');
      if (!timeOffInput) return;
      const val = timeOffInput.value || timeOffInput.getAttribute('value') || '';
      if (!val.toLowerCase().includes('time off in lieu')) return;

      const rawTotalInput = row.querySelector('input[aria-label="Raw Total"]');
      const hoursStr = rawTotalInput
        ? (rawTotalInput.value || rawTotalInput.getAttribute('value') || '')
        : '';
      const hours = parseFloat(hoursStr);
      if (!isNaN(hours) && hours > 0) {
        const mins = Math.round(hours * 60);
        toilMinutes += mins;
        const dateAttr = row.getAttribute('data-group-date');
        toilByDateCalc[dateAttr] = (toilByDateCalc[dateAttr] || 0) + mins;
      }
    });

    // 2e. Wykryj dni z wpisem Time Off (nie-TOIL, nie-Holiday) gdzie UKG nie wykazuje
    //     godzin w m-footer — np. Blood Donation, Vacation itp. Norma za te dni
    //     nie powinna obowiązywać (analogicznie do pełnych dni TOIL).
    const absenceTimeOffDates = new Set();
    document.querySelectorAll('tr[data-group-date][data-shift-id]').forEach((row) => {
      const timeOffInput = row.querySelector('input[aria-label="Time Off"]');
      if (!timeOffInput) return;
      const val = timeOffInput.value || timeOffInput.getAttribute('value') || '';
      if (!val.trim()) return;
      if (val.toLowerCase().includes('time off in lieu')) return; // TOIL — obsługiwany w 2d
      if (val.toLowerCase().includes('holiday')) return;          // Holiday — UKG wpisuje godziny do m-footer
      absenceTimeOffDates.add(row.getAttribute('data-group-date'));
    });

    // 3. Minione dni robocze
    // Jeśli dziś jest dzień roboczy bez wpisanych godzin, nie naliczaj normy za dziś.
    // Wyjątek: jeśli 0h wynika z absencji (2e), pomiń przesunięcie — absenceNormAdjust już to obsłuży.
    const todayIsAbsenceDay = [...absenceTimeOffDates].some(dateAttr => {
      const parsed = parseDateAttr(dateAttr);
      if (!parsed) return false;
      const d = rowToDate(parsed);
      return d && d.getTime() === today.getTime();
    });
    let normEndDate = effectiveToday;
    const todayIsWeekday = effectiveToday.getDay() !== 0 && effectiveToday.getDay() !== 6;
    if (todayIsWeekday && !todayIsAbsenceDay && effectiveToday.getTime() === today.getTime() && isTodayEmpty(today)) {
      normEndDate = new Date(today);
      normEndDate.setDate(normEndDate.getDate() - 1);
    }

    const elapsedWorkingDays   = countWorkingDays(period.start, normEndDate);
    const fullMonthWorkingDays = countWorkingDays(period.start, period.end);

    // 4. Normy
    const normPerDay            = EFF.hoursPerDay * 60;

    // Dla każdego dnia z wpisem absencji (2e) gdzie m-footer = 0h (system nie naliczył godzin)
    // anuluj normę za ten dzień — pracownik miał ustawowo wolne, nie powinien mieć deficytu.
    let absenceNormAdjustMinutes = 0;
    for (const dateAttr of absenceTimeOffDates) {
      const parsed = parseDateAttr(dateAttr);
      if (!parsed) continue;
      const rowDate = rowToDate(parsed);
      if (!rowDate || rowDate > effectiveToday) continue;
      const dow = rowDate.getDay();
      if (dow === 0 || dow === 6) continue;
      const footerRow = document.querySelector(`tr[data-group-date="${dateAttr}"].m-footer`);
      if (!footerRow) continue;
      const ftds = footerRow.querySelectorAll('td');
      if (ftds.length <= CALC_TOTAL_TD_INDEX) continue;
      const footerTotal = parseHoursToMinutes(getOriginalText(ftds[CALC_TOTAL_TD_INDEX]));
      if (footerTotal === 0) absenceNormAdjustMinutes += normPerDay;
    }

    const normElapsedMinutes    = elapsedWorkingDays * normPerDay;
    const normFullMonthMinutes  = EFF.manualNorm > 0
      ? Math.round(EFF.manualNorm * 60)
      : fullMonthWorkingDays * normPerDay;

    // Pełne dni TOIL (cały m-footer = TOIL, brak zwykłej pracy): norma za te dni nie obowiązuje —
    // pracownik wziął dzień wolny z banku flex, więc kosztem jest tylko TOIL, nie norma vs 0h.
    // fullToilNormElapsedMinutes anuluje normę tych dni w formule salda.
    let fullToilNormElapsedMinutes = 0;
    for (const [dateAttr, toilMins] of Object.entries(toilByDateCalc)) {
      const parsed = parseDateAttr(dateAttr);
      if (!parsed) continue;
      const rowDate = rowToDate(parsed);
      if (!rowDate || rowDate > effectiveToday) continue;
      const dow = rowDate.getDay();
      if (dow === 0 || dow === 6) continue;
      const footerRow = document.querySelector(`tr[data-group-date="${dateAttr}"].m-footer`);
      if (!footerRow) continue;
      const ftds = footerRow.querySelectorAll('td');
      if (ftds.length <= CALC_TOTAL_TD_INDEX) continue;
      const footerTotal = parseHoursToMinutes(getOriginalText(ftds[CALC_TOTAL_TD_INDEX]));
      if (footerTotal > 0 && toilMins >= footerTotal) {
        fullToilNormElapsedMinutes += normPerDay;
      }
    }

    totalWorkedMinutes -= overtimePayoutMinutes + toilMinutes;

    const correctionMinutes = Math.round(EFF.correctionHours * 60);

    // Formuła salda:
    //   saldo = przepracowane_bez_TOIL − norma_bez_pełnych_dni_TOIL − TOIL + korekta + absenceAdj
    // absenceAdj: norma za dni absencji (Blood Donation, itp.) gdzie UKG nie wykazało godzin
    // (totalWorked jest już po odjęciu toilMinutes, stąd odejmujemy toilMinutes jeszcze raz)
    const balanceMinutes   = totalWorkedMinutes - normElapsedMinutes + fullToilNormElapsedMinutes - toilMinutes + correctionMinutes + absenceNormAdjustMinutes;
    const remainingMinutes = normFullMonthMinutes - totalWorkedMinutes - correctionMinutes;

    let isLastWorkingDay = false;
    let suggestedEndTime = null;
    if (today <= period.end) {
      isLastWorkingDay = isLastWorkingDayOfMonth(today, period.end);
      if (isLastWorkingDay && remainingMinutes > 0) {
        const startTimeStr = getTodayStartTime(today);
        if (startTimeStr !== null) {
          const startMins = parseTimeHHMM(startTimeStr);
          if (startMins !== null) {
            const endMins = startMins + remainingMinutes;
            if (endMins < 24 * 60) {
              suggestedEndTime = fmt2(Math.floor(endMins / 60)) + ':' + fmt2(endMins % 60);
            }
          }
        }
      }
    }

    return {
      balanceMinutes,
      totalWorkedMinutes,
      normElapsedMinutes,
      normFullMonthMinutes,
      elapsedWorkingDays,
      fullMonthWorkingDays,
      remainingMinutes,
      overtimePayoutMinutes,
      toilMinutes,
      correctionMinutes,
      holidayCount,
      holidayMinutes,
      isLastWorkingDay,
      suggestedEndTime,
      periodText: titleEl.textContent.trim(),
      // Kontekst osoby + rozwiązane ustawienia (dla banera i popupu)
      personName:        currentPerson.name,
      personScope:       currentPerson.scope,
      monthKey:          currentMonthKey,
      effHoursPerDay:    EFF.hoursPerDay,
      effCorrectionHours: EFF.correctionHours,
      hasPersonHours:    !!(personData[currentPerson.key] && typeof personData[currentPerson.key].hoursPerDay === 'number'),
    };
  }

  // ─── Baner ────────────────────────────────────────────────────────────────────

  function injectBanner(data) {
    document.getElementById(BANNER_ID)?.remove();
    if (!data) return;

    const {
      balanceMinutes,
      totalWorkedMinutes,
      normFullMonthMinutes,
      fullMonthWorkingDays,
      remainingMinutes,
      overtimePayoutMinutes,
      toilMinutes,
      correctionMinutes,
      holidayCount,
      holidayMinutes,
      isLastWorkingDay,
      suggestedEndTime,
    } = data;

    const isPositive = balanceMinutes >= 0;
    const normDone   = remainingMinutes <= 0;

    const endSuggestionNote = (isLastWorkingDay && suggestedEndTime)
      ? `<span class="ftc-sep">│</span>
         <span class="ftc-end-suggest" title="Wyjście o tej godzinie wyzeruje saldo flex na koniec miesiąca">
           🏁 Sugerowany koniec pracy: <strong>${suggestedEndTime}</strong>
         </span>`
      : '';

    const otNote = (overtimePayoutMinutes > 0 || toilMinutes > 0)
      ? `<span class="ftc-sep">│</span>
         <span class="ftc-ot" title="Godziny wykluczone z kalkulacji flex">
           🔒${overtimePayoutMinutes > 0 ? ` OT: ${formatMinutes(overtimePayoutMinutes)}h` : ''}${toilMinutes > 0 ? ` TOIL: ${formatMinutes(toilMinutes)}h` : ''}
         </span>`
      : '';

    // Kontekst osoby — pokazuje, dla kogo zapamiętywane są etat/korekta.
    const personLabel = (currentPerson.scope === 'employee' && currentPerson.name)
      ? currentPerson.name
      : 'Twój timesheet';
    const personNote = `
      <span class="ftc-sep">│</span>
      <span class="ftc-person" title="Etat i korekta są zapamiętywane dla tej osoby (miesiąc ${currentMonthKey})">
        👤 <span class="ftc-person-name">${escapeHtml(personLabel)}</span>
      </span>`;

    // Etat (norma h/dzień) — trwały per osoba. 💾 = zapisany własny etat (różny od globalnego).
    const etatCustom = data.hasPersonHours;
    const etatNote = `
      <span class="ftc-sep">│</span>
      <span class="ftc-etat${etatCustom ? ' ftc-etat--custom' : ''}"
            title="Norma godzin dziennie tej osoby (np. 7 = etat 7/8). Zapamiętywana na stałe. Wpisz ${DEFAULT_HOURS_PER_DAY} (standard), aby usunąć własny etat.">
        🧑‍💼 <span class="ftc-etat-label">Etat:</span>
        <input type="number" class="ftc-etat-input" step="0.5" min="0" max="24" value="${data.effHoursPerDay}">
        <span class="ftc-etat-unit">h/dz</span>${etatCustom ? ' <span class="ftc-saved-mark" title="Zapamiętany etat tej osoby">💾</span>' : ''}
      </span>`;

    const corrSign = correctionMinutes > 0 ? '+' : (correctionMinutes < 0 ? '−' : '');
    const corrClass = correctionMinutes < 0 ? 'ftc-sl-adj ftc-sl-adj--neg' : 'ftc-sl-adj';
    const slAdjLabel = correctionMinutes !== 0
      ? ` <span class="${corrClass}">(${corrSign}${formatMinutes(correctionMinutes)}h)</span>`
      : '';
    const slNote = `
      <span class="ftc-sep">│</span>
      <span class="ftc-sl">
        🔧 <span class="ftc-sl-label">Korekta:</span>
        <input type="number" class="ftc-sl-input" step="0.5" value="${data.effCorrectionHours}"
               title="Ręczna korekta salda flex w godzinach dla tej osoby na ${currentMonthKey} — np. -4, +8, -4.5. Zapamiętywana per miesiąc (świeża w nowym miesiącu).">
        <span class="ftc-sl-unit">h</span>${slAdjLabel}
      </span>`;

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'status');

    banner.innerHTML = `
      <span class="ftc-icon">⏱</span>
      <span class="ftc-label">Flex Time:</span>
      <span class="ftc-balance ${isPositive ? 'ftc-positive' : 'ftc-negative'}"
            title="Saldo vs norma na dziś (${formatMinutes(data.normElapsedMinutes)}h / ${data.elapsedWorkingDays} dni)">
        ${formatBalance(balanceMinutes)}
      </span>
      <span class="ftc-sep">│</span>
      <span class="ftc-detail">
        Przepracowano: <strong>${formatMinutes(totalWorkedMinutes)}h</strong>
        / <em>${formatMinutes(normFullMonthMinutes)}h (${fullMonthWorkingDays - holidayCount} dni rob. (${formatMinutes(normFullMonthMinutes - holidayMinutes)}h)${holidayCount > 0 ? ` + ${holidayCount} Holiday (${formatMinutes(holidayMinutes)}h)` : ''})</em>
      </span>
      <span class="ftc-sep">│</span>
      <span class="ftc-detail ${normDone ? 'ftc-done' : 'ftc-remaining'}">
        ${normDone
          ? `✅ Norma wyrobiona! (${formatBalance(-remainingMinutes)} nadwyżki)`
          : `📋 Pozostało: <strong>${formatMinutes(remainingMinutes)}h</strong>`}
      </span>
      ${endSuggestionNote}
      ${otNote}
      ${personNote}
      ${etatNote}
      ${slNote}
      <button class="ftc-close" title="Ukryj baner">✕</button>
    `;

    document.body.prepend(banner);

    banner.querySelector('.ftc-close').addEventListener('click', () => banner.remove());

    // Korekta — zapis per osoba + bieżący miesiąc.
    const slInput = banner.querySelector('.ftc-sl-input');
    if (slInput) {
      slInput.addEventListener('change', () => {
        const hours = parseFloat(slInput.value) || 0;
        slInput.value = hours;
        setPersonCorrection(currentPerson.key, currentPerson.name, currentMonthKey, hours);
        tryCalculateAndShow();
      });
    }

    // Etat — zapis trwały per osoba.
    const etatInput = banner.querySelector('.ftc-etat-input');
    if (etatInput) {
      etatInput.addEventListener('change', () => {
        let hours = parseFloat(etatInput.value);
        if (!isNaN(hours)) {
          hours = Math.max(0, Math.min(24, hours));  // etat w zakresie [0,24]h — ujemny dałby ujemną normę
          etatInput.value = hours;
        }
        setPersonHoursPerDay(currentPerson.key, currentPerson.name, isNaN(hours) ? null : hours);
        tryCalculateAndShow();
      });
    }
  }

  // ─── Konwersja kolumn Raw Total / Calc. Total do formatu HH:MM ───────────────

  /**
   * Zamienia wartości "X.XX hrs" na "HH:MM" w wierszach podsumowujących (m-footer).
   * Oryginalna wartość jest zachowana w atrybucie data-ftc-hhmm, żeby calculate()
   * mogło ją dalej odczytywać przez getOriginalText().
   */
  function convertTimesheetTotalsToHHMM() {
    if (!isTimesheetPage()) return;
    document.querySelectorAll('tr[data-group-date].m-footer').forEach((row) => {
      row.querySelectorAll('td').forEach((td) => {
        if (td.hasAttribute('data-ftc-hhmm')) return;
        // Usuń widget przed parsowaniem — nie może zabrudzić textContent
        td.querySelector('.ftc-daily-widget')?.remove();
        const text = td.textContent.trim();
        const m = text.match(/^([\d.]+)\s*hrs?$/i);
        if (!m) return;
        const totalMin = Math.round(parseFloat(m[1]) * 60);
        td.setAttribute('data-ftc-hhmm', text);
        td.textContent = fmt2(Math.floor(totalMin / 60)) + ':' + fmt2(totalMin % 60);
      });
    });
  }

  function revertTimesheetTotals() {
    document.querySelectorAll('tr[data-group-date].m-footer td[data-ftc-hhmm]').forEach((td) => {
      td.textContent = td.getAttribute('data-ftc-hhmm');
      td.removeAttribute('data-ftc-hhmm');
    });
  }

  // ─── Dzienny widget flex pod Calc. Total ──────────────────────────────────────

  /**
   * Pod sumą godzin każdego dnia (TD Calc. Total w m-footer) wstrzykuje mały widget
   * pokazujący: delta danego dnia vs norma | bieżące saldo skumulowane.
   * Dni z wpisem Time Off (Holiday, TOIL, itp.) są pomijane.
   */
  function injectDailyFlexWidgets() {
    if (!isTimesheetPage()) return;

    // Usuń stare widgety
    document.querySelectorAll('.ftc-daily-widget').forEach((el) => el.remove());

    // UWAGA: NIE pomijamy dni z absencją (Childcare PTO, Vacation, Holiday, Blood Donation, …).
    // UKG wlicza godziny absencji do Calc. Total dnia (np. 6.70h pracy + 0.33h Childcare PTO
    // = footer 07:02), więc traktujemy każdy miniony dzień roboczy tak samo jak baner:
    // delta = footer − norma. Dni z absencją "na cały dzień" (footer = 0h) i tak są pomijane
    // niżej (rawMinutes === 0), co odpowiada anulowaniu normy w calculate() (absenceNormAdjust).
    // Pominięcie absencji z footerem > 0 (jak było wcześniej) rozjeżdżało skumulowane ∑ z saldem
    // banera dla dni częściowej absencji. TOIL i OT Payout nadal odejmujemy per-dzień (poniżej).

    // TOIL per dzień — entry-level z input[aria-label="Raw Total"] (wiersze Time Off
    // nie mają decimal TDs jak wpisy pracy, tylko input Raw Total)
    const toilByDate = {};
    document.querySelectorAll('tr[data-group-date][data-shift-id]').forEach((row) => {
      const timeOffInput = row.querySelector('input[aria-label="Time Off"]');
      if (!timeOffInput) return;
      const val = timeOffInput.value || timeOffInput.getAttribute('value') || '';
      if (!val.toLowerCase().includes('time off in lieu')) return;
      const dateAttr = row.getAttribute('data-group-date');
      const rawTotalInput = row.querySelector('input[aria-label="Raw Total"]');
      const hoursStr = rawTotalInput
        ? (rawTotalInput.value || rawTotalInput.getAttribute('value') || '')
        : '';
      const hours = parseFloat(hoursStr);
      if (!isNaN(hours) && hours > 0) {
        toilByDate[dateAttr] = (toilByDate[dateAttr] || 0) + Math.round(hours * 60);
      }
    });

    // Overtime Payout per dzień — spójne z logiką bannera (odejmujemy per dzień)
    const otPayoutByDate = {};
    document.querySelectorAll('tr[data-group-date][data-shift-id]').forEach((row) => {
      const activityInput = row.querySelector('input[aria-label="Activity"]');
      if (!activityInput) return;
      const actVal = activityInput.value || activityInput.getAttribute('value') || '';
      if (!actVal.includes('Overtime Payout')) return;
      const dateAttr = row.getAttribute('data-group-date');
      const tds = [...row.querySelectorAll('td')];
      const decimalTds = tds.filter((td) => /^\d+\.\d+$/.test(td.textContent.replace(/\s+/g, '').trim()));
      const calcTd = decimalTds[1] ?? decimalTds[0];
      if (!calcTd) return;
      const mins = Math.round(parseFloat(calcTd.textContent.replace(/\s+/g, '')) * 60);
      otPayoutByDate[dateAttr] = (otPayoutByDate[dateAttr] || 0) + mins;
    });

    // Zbierz i posortuj wiersze m-footer chronologicznie
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const footerRows = [];
    document.querySelectorAll('tr[data-group-date].m-footer').forEach((row) => {
      const dateAttr = row.getAttribute('data-group-date');
      const parsed = parseDateAttr(dateAttr);
      if (parsed) footerRows.push({ row, parsed, dateAttr });
    });
    footerRows.sort((a, b) =>
      a.parsed.month !== b.parsed.month
        ? a.parsed.month - b.parsed.month
        : a.parsed.day - b.parsed.day
    );

    const normPerDay = EFF.hoursPerDay * 60;   // etat osoby (ustalony w calculate())
    let runningBalance = 0;

    footerRows.forEach(({ row, parsed, dateAttr }) => {
      const rowDate = new Date(today.getFullYear(), parsed.month, parsed.day);
      rowDate.setHours(0, 0, 0, 0);
      if (rowDate > today) return;

      // Pomiń weekendy (norma = 0, przepracowane = 0)
      const dow = rowDate.getDay();
      if (dow === 0 || dow === 6) return;

      const tds = row.querySelectorAll('td');
      if (tds.length <= CALC_TOTAL_TD_INDEX) return;
      const rawMinutes = parseHoursToMinutes(getOriginalText(tds[CALC_TOTAL_TD_INDEX]));
      if (rawMinutes === 0) return; // dzień bez godzin — brak widgetu

      // Odejmij OT Payout i TOIL — spójne z kalkulacją bannera:
      // - pełny dzień TOIL (workedMinutes == 0): koszt = tylko TOIL, norma nie obowiązuje
      // - częściowy TOIL + praca: koszt = deficyt_pracy + TOIL
      const toilForDay = toilByDate[dateAttr] || 0;
      const workedMinutes = rawMinutes - (otPayoutByDate[dateAttr] || 0) - toilForDay;
      const dayDelta = workedMinutes === 0 && toilForDay > 0
        ? -toilForDay
        : workedMinutes - normPerDay - toilForDay;
      runningBalance += dayDelta;

      const deltaClass = dayDelta >= 0 ? 'ftc-dw-pos' : 'ftc-dw-neg';
      const sumClass   = runningBalance >= 0 ? 'ftc-dw-sum-pos' : 'ftc-dw-sum-neg';

      const widget = document.createElement('div');
      widget.className = 'ftc-daily-widget';
      widget.innerHTML =
        `<span class="${deltaClass}">${formatBalance(dayDelta)}</span>` +
        `<span class="ftc-dw-sep">│</span>` +
        `<span class="ftc-dw-sum ${sumClass}">∑&nbsp;${formatBalance(runningBalance)}</span>`;
      tds[CALC_TOTAL_TD_INDEX].appendChild(widget);
    });
  }

  // ─── Podświetlanie niedokończonych dni (Clock In bez Clock Out) ───────────────

  /**
   * Zaznacza delikatnie czerwonym tłem przeszłe dni robocze, które wyglądają na
   * pominięte. Kryterium: brak godzin w kolumnie Raw Total dla danego dnia.
   *
   * Dlaczego Raw Total, a nie kod Time Off: kodów absencji jest mnóstwo (Holiday,
   * Vacation, Paid Absence, Blood Donation, …) i nie da się ich wszystkich wyliczyć.
   * Każdy taki wpis ma jednak Raw Total > 0, więc dzień z dowolnym wpisem (praca lub
   * absencja) NIE jest zaznaczany. Zaznaczane są tylko dni bez żadnych godzin:
   *   - wiersz zegarowy z Clock In, ale bez Clock Out → Raw Total pusty,
   *   - całkiem pusty dzień (sam wiersz-nagłówek m-header, brak wpisów).
   *
   * Zaznacza TYLKO przeszłe dni robocze (rowDate < dziś, Pn–Pt). Dzień bieżący i
   * weekendy są pomijane.
   */
  function highlightIncompleteDays() {
    if (!isTimesheetPage()) return;

    // Usuń stare zaznaczenia
    document.querySelectorAll('.ftc-incomplete-row').forEach((el) =>
      el.classList.remove('ftc-incomplete-row'));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Przeszły dzień roboczy (Pn–Pt, przed dziś)?
    function isPastWeekday(dateAttr) {
      const parsed = parseDateAttr(dateAttr);
      if (!parsed) return false;
      const d = new Date(today.getFullYear(), parsed.month, parsed.day);
      d.setHours(0, 0, 0, 0);
      if (d >= today) return false;            // tylko przeszłość (pomijamy dziś i przyszłość)
      const dow = d.getDay();
      if (dow === 0 || dow === 6) return false; // pomiń weekendy
      return true;
    }

    // Zmapuj daty → wiersze wpisów oraz czy którykolwiek wpis ma Raw Total > 0.
    const entryRowsByDate   = {};   // dateAttr → [tr, ...]
    const hasRawTotalByDate = {};   // dateAttr → bool
    document.querySelectorAll('tr[data-group-date][data-shift-id]').forEach((row) => {
      const dateAttr = row.getAttribute('data-group-date');
      if (!entryRowsByDate[dateAttr]) entryRowsByDate[dateAttr] = [];
      entryRowsByDate[dateAttr].push(row);

      const rawInput = row.querySelector('input[aria-label="Raw Total"]');
      const rawStr = rawInput
        ? (rawInput.value || rawInput.getAttribute('value') || '').trim()
        : '';
      const rawNum = parseFloat(rawStr);
      if (!isNaN(rawNum) && rawNum > 0) hasRawTotalByDate[dateAttr] = true;
    });

    // Wiersze-nagłówki pustych dni (brak data-shift-id, brak m-footer).
    const headerByDate = {};
    document.querySelectorAll('tr[data-group-date].m-header').forEach((row) => {
      headerByDate[row.getAttribute('data-group-date')] = row;
    });

    // Wszystkie daty z wpisami + daty samych nagłówków
    const allDates = new Set([
      ...Object.keys(entryRowsByDate),
      ...Object.keys(headerByDate),
    ]);

    allDates.forEach((dateAttr) => {
      if (!isPastWeekday(dateAttr)) return;
      if (hasRawTotalByDate[dateAttr]) return; // dzień ma godziny (praca lub absencja) — ok

      const rows = entryRowsByDate[dateAttr];
      if (rows && rows.length) {
        rows.forEach((r) => r.classList.add('ftc-incomplete-row')); // np. Clock In bez Clock Out
      } else if (headerByDate[dateAttr]) {
        headerByDate[dateAttr].classList.add('ftc-incomplete-row');  // całkiem pusty dzień
      }
    });
  }

  // ─── Konwersja sald urlopowych z godzin na dni ────────────────────────────────

  function isVacationPage() {
    return VACATION_HASH_PATTERNS.some((p) => window.location.hash.includes(p));
  }

  function convertVacationBalancesToDays() {
    if (!isVacationPage()) return false;
    if (!CFG.vacationInDays) return revertVacationBalancesToHours();
    let found = false;

    // Request window. UKG dodało zewnętrzny wrapper w v?:
    //   stare: "208.00<span>hrs</span>"           (liczba = bezpośredni text-node .value)
    //   nowe:  "<span>208.00<span>hrs</span></span>" (liczba zagnieżdżona w wrapperze)
    // Namierzamy span z dokładnym tekstem "hrs", liczba to jego previousSibling —
    // działa dla obu struktur.
    document.querySelectorAll('.c-accrual-balances__value:not([data-ftc-days])').forEach((el) => {
      const hrsSpan = [...el.querySelectorAll('span')].find(
        (s) => s.textContent.trim() === 'hrs'
      );
      if (!hrsSpan) return;

      const textNode = hrsSpan.previousSibling;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE || textNode.textContent.trim() === '')
        return;

      const hrs = parseFloat(textNode.textContent.trim());
      if (isNaN(hrs)) return;

      el.setAttribute('data-ftc-orig-text', textNode.textContent.trim());
      textNode.textContent = String(parseFloat((hrs / 8).toFixed(2)));
      hrsSpan.textContent = 'days';
      el.setAttribute('data-ftc-days', '1');
      found = true;
    });

    // Balances page: Vacation & Childcare PTO cards
    const TARGET_TITLES = ['Vacation', 'Childcare PTO'];
    document.querySelectorAll('.c-card:not([data-ftc-days])').forEach((card) => {
      const titleEl = card.querySelector('.c-card__title-primary');
      if (!titleEl || !TARGET_TITLES.includes(titleEl.textContent.trim())) return;

      // Featured value: 192.00<small class="c-balance-type-text-custom-size">hours</small>
      const valueEl = card.querySelector('.c-featured-content .value');
      if (valueEl && !valueEl.getAttribute('data-ftc-days')) {
        const smallEl = valueEl.querySelector('small.c-balance-type-text-custom-size');
        if (smallEl && smallEl.textContent.trim() === 'hours') {
          const textNode = [...valueEl.childNodes].find(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== ''
          );
          if (textNode) {
            const hrs = parseFloat(textNode.textContent.trim());
            if (!isNaN(hrs)) {
              valueEl.setAttribute('data-ftc-orig-text', textNode.textContent.trim());
              textNode.textContent = String(parseFloat((hrs / 8).toFixed(2)));
              smallEl.textContent = 'days';
              valueEl.setAttribute('data-ftc-days', '1');
            }
          }
        }
      }

      // Detail list items: <b>208.00 hrs</b>
      card.querySelectorAll('.text-list-item--line .data b').forEach((b) => {
        if (b.getAttribute('data-ftc-days')) return;
        const m = b.textContent.trim().match(/^([\d.]+)\s*hrs$/i);
        if (!m) return;
        const hrs = parseFloat(m[1]);
        if (isNaN(hrs)) return;
        b.setAttribute('data-ftc-orig', b.textContent.trim());
        b.textContent = `${parseFloat((hrs / 8).toFixed(2))} days`;
        b.setAttribute('data-ftc-days', '1');
      });

      card.setAttribute('data-ftc-days', '1');
      found = true;
    });

    return found;
  }

  function revertVacationBalancesToHours() {
    // Request window
    document.querySelectorAll('.c-accrual-balances__value[data-ftc-days]').forEach((el) => {
      const orig = el.getAttribute('data-ftc-orig-text');
      if (!orig) return;
      const hrsSpan = [...el.querySelectorAll('span')].find(
        (s) => s.textContent.trim() === 'days'
      );
      const textNode = hrsSpan ? hrsSpan.previousSibling : null;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) textNode.textContent = orig;
      if (hrsSpan) hrsSpan.textContent = 'hrs';
      el.removeAttribute('data-ftc-days');
      el.removeAttribute('data-ftc-orig-text');
    });

    // Balance cards — featured value
    document.querySelectorAll('.c-featured-content .value[data-ftc-days]').forEach((el) => {
      const orig = el.getAttribute('data-ftc-orig-text');
      if (!orig) return;
      const smallEl = el.querySelector('small.c-balance-type-text-custom-size');
      const textNode = [...el.childNodes].find(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== ''
      );
      if (textNode) textNode.textContent = orig;
      if (smallEl) smallEl.textContent = 'hours';
      el.removeAttribute('data-ftc-days');
      el.removeAttribute('data-ftc-orig-text');
    });

    // Balance cards — detail list items
    document.querySelectorAll('.text-list-item--line .data b[data-ftc-days]').forEach((b) => {
      const orig = b.getAttribute('data-ftc-orig');
      if (orig) b.textContent = orig;
      b.removeAttribute('data-ftc-days');
      b.removeAttribute('data-ftc-orig');
    });

    // Usuń markery z kart żeby pozwolić na ponowną konwersję przy przełączeniu
    document.querySelectorAll('.c-card[data-ftc-days]').forEach((card) => {
      card.removeAttribute('data-ftc-days');
    });

    return true;
  }

  // ─── Detekcja strony i odświeżanie ───────────────────────────────────────────

  function isTimesheetPage() {
    return TIMESHEET_HASH_PATTERNS.some((p) => window.location.hash.includes(p));
  }

  /**
   * Widok timesheeta ma zakładki (pasek `.c-page-tabs`): "Time Entry" (główna),
   * "Calc Detail", "Counters". Wtyczka ma sens TYLKO na "Time Entry" — pozostałe
   * mają inny układ wierszy, przez co baner pokazywał ujemne saldo, a dni
   * zaznaczały się na czerwono. Aktywna zakładka ma `aria-selected="true"`,
   * a "Time Entry" nosi `data-category="category-TIME_ENTRY"`.
   * Brak paska (starszy/menedżerski układ) → traktujemy jak główny widok.
   */
  function isTimeEntryTab() {
    if (!document.querySelector('.c-page-tabs')) return true;
    // Pełna lista (desktop): aktywny przycisk ma aria-selected="true".
    const selected = document.querySelector('.c-page-tabs__tab-button[aria-selected="true"]');
    if (selected) return selected.getAttribute('data-category') === 'category-TIME_ENTRY';
    // Zwinięty pasek (mobile): dropdown pokazuje nazwę aktywnej zakładki.
    const collapsed = document.querySelector('.m-contains-selected-tab .c-page-tabs__tab-button-text');
    if (collapsed) return collapsed.textContent.trim() === 'Time Entry';
    return true;
  }

  /** Usuwa wszystkie elementy wstrzyknięte przez wtyczkę (baner, widgety, podświetlenia). */
  function removeFlexUI() {
    document.getElementById(BANNER_ID)?.remove();
    document.querySelectorAll('.ftc-daily-widget').forEach((el) => el.remove());
    document.querySelectorAll('.ftc-incomplete-row').forEach((el) =>
      el.classList.remove('ftc-incomplete-row'));
  }

  function tryCalculateAndShow() {
    if (!isTimesheetPage()) return false;
    if (!isTimeEntryTab()) {
      removeFlexUI();      // zakładka Calc Detail / Counters — nic nie liczymy
      return true;          // strona obsłużona: świadomie nie pokazujemy banera
    }
    const data = calculate();
    if (data) {
      injectBanner(data);
      if (CFG.hhmmFormat) convertTimesheetTotalsToHHMM();
      else revertTimesheetTotals();
      injectDailyFlexWidgets();
      highlightIncompleteDays();
      return true;
    }
    return false;
  }

  function startPolling() {
    clearInterval(pollTimer);
    let attempts = 0;
    pollTimer = setInterval(() => {
      attempts++;
      const done = isVacationPage()
        ? convertVacationBalancesToDays()
        : tryCalculateAndShow();
      if (done || attempts >= POLL_MAX_ATTEMPTS) {
        clearInterval(pollTimer);
      }
    }, POLL_INTERVAL_MS);
  }

  function setupMutationObserver() {
    if (mutationObs) mutationObs.disconnect();
    mutationObs = new MutationObserver((mutations) => {
      if (!isTimesheetPage()) return;
      const relevant = mutations.some((mut) =>
        [...mut.addedNodes].some((node) =>
          node.nodeType === Node.ELEMENT_NODE &&
          (node.matches?.('tr[data-group-date]') ||
           node.querySelector?.('tr[data-group-date]') ||
           node.querySelector?.('.c-timesheet-header__date-carousel-title') ||
           node.matches?.('.c-accrual-balances__value') ||
           node.querySelector?.('.c-accrual-balances__value') ||
           node.matches?.('.c-page-tabs') ||
           node.querySelector?.('.c-page-tabs'))
        )
      );
      if (relevant) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (isVacationPage()) convertVacationBalancesToDays();
          else tryCalculateAndShow();
        }, 400);
      }
    });
    mutationObs.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Komunikacja z popup ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'getFlexData') {
      if (isTimesheetPage() && !isTimeEntryTab()) {
        sendResponse({ error: 'Przejdź na zakładkę „Time Entry", aby zobaczyć saldo.' });
      } else {
        const data = calculate();
        sendResponse(data || { error: 'Timesheet nie jest widoczny na tej stronie.' });
      }
    }

    if (msg.action === 'settingsUpdated') {
      if (msg.manualNorm !== undefined) CFG.manualNorm = msg.manualNorm;
      if (msg.vacationInDays !== undefined) CFG.vacationInDays = msg.vacationInDays;
      if (msg.hhmmFormat !== undefined) {
        CFG.hhmmFormat = msg.hhmmFormat;
        if (!CFG.hhmmFormat) revertTimesheetTotals();
      }
      if (isVacationPage()) convertVacationBalancesToDays();
      tryCalculateAndShow();
    }

    return true; // async response
  });

  // ─── Inicjalizacja ────────────────────────────────────────────────────────────

  async function init() {
    // Wczytaj ustawienia z chrome.storage
    try {
      const stored = await chrome.storage.local.get(['manualNorm', 'vacationInDays', 'hhmmFormat', 'personData']);
      if (stored.manualNorm  !== undefined) CFG.manualNorm  = stored.manualNorm;
      if (stored.vacationInDays !== undefined) CFG.vacationInDays = stored.vacationInDays;
      if (stored.hhmmFormat !== undefined) CFG.hhmmFormat = stored.hhmmFormat;
      if (stored.personData && typeof stored.personData === 'object') personData = stored.personData;
      // Sprzątanie po starym globalnym etacie — nie jest już używany (standard = stała 8h).
      chrome.storage.local.remove('hoursPerDay');
      chrome.storage.local.remove('correctionHours');
    } catch (_) {}

    if (isTimesheetPage() || isVacationPage()) startPolling();
    setupMutationObserver();
  }

  window.addEventListener('hashchange', () => {
    document.getElementById(BANNER_ID)?.remove();
    clearInterval(pollTimer);
    clearTimeout(debounceTimer);   // anuluj wiszący debounce MutationObservera sprzed nawigacji
    if (isTimesheetPage() || isVacationPage()) startPolling();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
