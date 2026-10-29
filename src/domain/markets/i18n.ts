/**
 * RU/EN dictionary for the F1 domain (F1-052, SRS §9).
 *
 * Conventions:
 * - market copy: f1.market.mNN.{title|question|rule} (M01 uses the SRS key f1.position.question);
 * - outcome labels: Outcome.label_key, e.g. f1.outcome.position {position}, f1.outcome.driver {driver};
 * - params named driver/driver_a/driver_b/passer/passed hold driver ids (the UI maps them to names);
 * - params t1/t2/reference are integer milliseconds; at/from/to are ISO instants (UI formats them);
 * - void reasons: f1.void.<reason lower>; validation: f1.validation.<code lower>.
 */

const PAIRS: Record<string, readonly [ru: string, en: string]> = {
  /* SRS §9 dictionary */
  'f1.position.question': ['Какую позицию займёт {driver}?', 'What position will {driver} hold?'],
  'f1.anchor.leader_lap': ['После завершения лидером круга {lap}', 'When the leader completes lap {lap}'],
  'f1.pit.stationary': ['Время неподвижной остановки', 'Stationary stop time'],
  'f1.pit.lane': ['Время в пит-лейне', 'Time in the pit lane'],
  'f1.pass.confirmed': ['Подтверждённый обгон на трассе', 'Confirmed on-track pass'],
  'f1.quali.provisional': ['Сейчас в зоне прохождения', 'Currently above the cut'],
  'f1.quali.confirmed': ['Прохождение подтверждено', 'Progression confirmed'],
  'f1.location.pit': ['Боксы / пит-лейн', 'Garage / pit lane'],
  'f1.data.approximate': ['Положение на схеме приблизительное', 'Map positions are approximate'],
  'f1.result.none': ['Подходящего события не было', 'No qualifying event occurred'],
  'f1.result.unknown': ['Недостаточно данных для результата', 'Not enough data to determine the result'],

  /* Market copy */
  'f1.market.m01.title': ['Позиция на контрольной линии', 'Position at the control line'],
  'f1.market.m01.rule': [
    'Результат определяет порядок в хронометраже в момент якоря. Приоритет статусов: DSQ → DNS → RETIRED → текущая позиция. Гонщик, отстающий на круг, сохраняет собственный номер круга. SC и VSC не отменяют измерение; красный флаг до якоря — VOID.',
    'Decided by the timing order at the anchor. Status precedence: DSQ → DNS → RETIRED → running position. A lapped driver keeps their own lap number. SC and VSC do not cancel the measurement; a red flag before the anchor voids the pool.',
  ],
  'f1.market.m02.title': ['Кто выше в хронометраже', 'Who is ahead on timing'],
  'f1.market.m02.question': [
    'Кто будет выше после завершения лидером круга {lap}: {driver_a} или {driver_b}?',
    'Who will be ahead when the leader completes lap {lap}: {driver_a} or {driver_b}?',
  ],
  'f1.market.m02.rule': [
    'Сравниваются целые позиции одного снимка хронометража на якоре. Гонщик с действующей позицией выше сошедшего, не стартовавшего или дисквалифицированного. Если действующей позиции нет у обоих — «Оба без действующей позиции». Противоречивые данные ждут исправления, затем — VOID по крайнему сроку.',
    'Integer positions from one timing snapshot at the anchor are compared. A driver with a running position is ahead of one who retired, did not start or was disqualified. If neither has a running position — "Both without a running position". Contradictory data waits for a correction, then is voided at the deadline.',
  ],
  'f1.market.m03.title': ['Следующий въезд в пит-лейн', 'Next pit-lane entry'],
  'f1.market.m03.question': ['Кто следующим въедет в пит-лейн?', 'Who enters the pit lane next?'],
  'f1.market.m03.rule': [
    'Засчитывается первый нормальный гоночный въезд в пит-лейн в окне [начало; конец): событие ровно в момент окончания окна не входит. Принудительный возврат при красном флаге не учитывается. Неустановимый порядок въездов — VOID.',
    'The first normal racing pit-lane entry in the window [start; end) counts: an event exactly at the window end is outside. A forced return under a red flag does not count. An unresolvable entry order voids the pool.',
  ],
  'f1.market.m04.title': ['Шины на выезде', 'Tyres at the exit'],
  'f1.market.m04.question': [
    'Состав {driver} на выезде после следующего въезда в пит-лейн',
    "{driver}'s compound at the exit after the next pit-lane entry",
  ],
  'f1.market.m04.rule': [
    'Берётся первый нормальный въезд {driver} после начала окна и его выезд, связанный с подтверждённым стинтом. Визит, начавшийся до окна, не считается. Въезд без выезда к крайнему сроку — VOID. «Не было подходящего визита» — только при полном наблюдении окна.',
    "{driver}'s first normal entry after the window start and its exit linked to a confirmed stint are used. A visit that began before the window does not count. An entry without an exit by the deadline voids the pool. \"No qualifying pit visit\" requires full observation of the window.",
  ],
  'f1.market.m05.title': ['Неподвижная остановка', 'Stationary stop'],
  'f1.market.m05.question': ['Сколько продлится неподвижная остановка {driver}?', 'How long will {driver} be stationary in the pit box?'],
  'f1.market.m05.rule': [
    'Измеряется только неподвижная часть остановки, а не всё время в пит-лейне. Корзины полуоткрытые: {t1} мс относится ко второй корзине, {t2} мс — к третьей. Подтверждённый проезд drive-through или stop-and-go — «Без обслуживания». Отсутствие данных об остановке не означает «Без обслуживания». Красный флаг внутри визита — VOID.',
    'Only the stationary part of the stop is measured, not the whole pit-lane time. Buckets are half-open: {t1} ms belongs to the second bucket, {t2} ms to the third. A confirmed drive-through or stop-and-go is "No service". Missing stop data does not mean "No service". A red flag inside the visit voids the pool.',
  ],
  'f1.market.m06.title': ['Время в пит-лейне', 'Pit-lane time'],
  'f1.market.m06.question': ['Сколько {driver} проведёт в пит-лейне?', 'How long will {driver} spend in the pit lane?'],
  'f1.market.m06.rule': [
    'Измеряется весь визит — от въезда до выезда. Пороги {t1} и {t2} мс зафиксированы при создании пула. Проезд drive-through измерим. Красный флаг внутри визита — VOID.',
    'The whole visit is measured, from entry to exit. The {t1} and {t2} ms thresholds were fixed when the pool was created. A drive-through is measurable. A red flag inside the visit voids the pool.',
  ],
  'f1.market.m07.title': ['Дуэль: обгон на трассе', 'Duel: on-track pass'],
  'f1.market.m07.question': [
    'Кто первым подтверждённо обгонит соперника: {driver_a} или {driver_b}?',
    'Who completes the first confirmed on-track pass: {driver_a} or {driver_b}?',
  ],
  'f1.market.m07.rule': [
    'Засчитывается только проверенный обгон на трассе на одном гоночном круге вне SC, VSC и красного флага. Не считаются обгон на круг, перестановка из-за пит-стопа, возврат позиции по указанию дирекции гонки и изменение таблицы из-за штрафа. Красный флаг в окне — VOID.',
    'Only a verified on-track pass on the same race lap outside SC, VSC and red flag counts. Lapping, pit-stop swaps, positions returned on race control instruction and penalty changes do not count. A red flag in the window voids the pool.',
  ],
  'f1.market.m08.title': ['Следующий чистый круг', 'Next clean lap'],
  'f1.market.m08.question': [
    'Каким будет следующий чистый круг {driver} относительно эталона {reference} мс?',
    "How will {driver}'s next clean lap compare with the {reference} ms reference?",
  ],
  'f1.market.m08.rule': [
    'Измеряется первый круг, полностью начатый после закрытия приёма. Аннулированный круг — «Нет действительного круга», следующий круг не подставляется. Если круг не начался в окне — VOID. SC, VSC или красный флаг во время круга — VOID. Сравниваются целые миллисекунды.',
    'The first lap fully started after entries close is measured. An invalidated lap is "No valid lap"; the next lap is never substituted. If no lap starts in the window the pool is voided. SC, VSC or a red flag during the lap voids the pool. Whole milliseconds are compared.',
  ],
  'f1.market.m09.title': ['Лучший круг в окне', 'Fastest lap in the window'],
  'f1.market.m09.question': ['Кто покажет лучшее время круга в окне?', 'Who sets the fastest valid lap in the window?'],
  'f1.market.m09.rule': [
    'Сравниваются все действительные круги, завершённые внутри окна; круг мог начаться раньше. Аннулированные круги исключаются. Одинаковое лучшее время у нескольких гонщиков — «Равное время». Круги под SC и VSC остаются в сравнении; красный флаг окно не продлевает.',
    'All valid laps completed inside the window are compared; a lap may have started earlier. Invalidated laps are excluded. The same best time for several drivers is a "Tie". Laps under SC and VSC stay in the comparison; a red flag does not extend the window.',
  ],
  'f1.market.m10.title': ['Следующая нейтрализация', 'Next neutralisation'],
  'f1.market.m10.question': ['Что будет следующим: SC, VSC или красный флаг?', 'What comes next: SC, VSC or a red flag?'],
  'f1.market.m10.rule': [
    'Засчитывается первое новое глобальное состояние дирекции гонки в окне. Локальные жёлтые флаги не учитываются; повтор того же сообщения — один переход. «Нейтрализации не было» — только при полном наблюдении окна; разрыв данных — VOID.',
    'The first new global race control state in the window counts. Local yellow flags are excluded; a repeated message is one transition. "No neutralisation" requires full observation of the window; a data gap voids the pool.',
  ],
  'f1.market.m11.title': ['Где будет гонщик', 'Where will the driver be'],
  'f1.market.m11.question': ['Где будет {driver} в момент {at}?', 'Where will {driver} be at {at}?'],
  'f1.market.m11.rule': [
    'Используется подтверждённое состояние на момент {at}: сектор, боксы / пит-лейн (включая гараж) или статус. Приоритет: DSQ → DNS → RETIRED → боксы / пит-лейн → сектор. Положение на схеме не является источником. Неустранимая неопределённость на границе — VOID.',
    'The confirmed state at {at} is used: sector, garage / pit lane (garage included) or status. Precedence: DSQ → DNS → RETIRED → garage / pit lane → sector. The map position is never the source. Unresolvable uncertainty at a boundary voids the pool.',
  ],
  'f1.market.m12.title': ['Первый сход', 'First retirement'],
  'f1.market.m12.question': ['Кто первым официально сойдёт в окне?', 'Who is the first official retirement in the window?'],
  'f1.market.m12.rule': [
    'Засчитывается подтверждённый статус схода. «Одновременно» возможно только по правилу, объявленному до открытия пула. Неизвестный порядок не является ничьей — VOID.',
    'A confirmed retirement status counts. "Simultaneous" is possible only under a rule declared before the pool opened. An unknown order is not a tie — the pool is voided.',
  ],
  'f1.market.m13.title': ['Итоговая группа в Гран-при', 'Grand Prix finishing group'],
  'f1.market.m13.question': ['В какой группе финиширует {driver} в Гран-при?', 'Which group will {driver} finish in at the Grand Prix?'],
  'f1.market.m13.rule': [
    'Только официальная итоговая классификация Гран-при. Приоритет: DSQ → DNS → классифицированная позиция → «Не классифицирован». Сошедший, но классифицированный гонщик остаётся в своей группе. Без итога к крайнему сроку — VOID.',
    'Only the official final Grand Prix classification. Precedence: DSQ → DNS → classified position → "Not classified". A classified retiree keeps their group. No result by the deadline voids the pool.',
  ],
  'f1.market.m14.title': ['Подиум Гран-при', 'Grand Prix podium'],
  'f1.market.m14.question': ['{driver} попадёт в официальную тройку?', 'Will {driver} finish in the official top three?'],
  'f1.market.m14.rule': [
    'Официальная итоговая классификация Гран-при. DNS, DSQ и «Не классифицирован» — «Нет».',
    'The official final Grand Prix classification. DNS, DSQ and "Not classified" count as "No".',
  ],
  'f1.market.m15.title': ['Проход в следующую часть', 'Progression to the next part'],
  'f1.market.m15.question': ['{driver} пройдёт из {segment} в следующую часть?', 'Will {driver} progress from {segment} to the next part?'],
  'f1.market.m15.rule': [
    'Решает только подтверждённая классификация части, а не текущая позиция. Вопрос доступен для Q1, Q2, SQ1 и SQ2. Отменённая часть без результата — VOID.',
    'Only the confirmed classification of the part decides, not the live position. Available for Q1, Q2, SQ1 and SQ2. A cancelled part without a result voids the pool.',
  ],
  'f1.market.m16.title': ['Дуэль в квалификации', 'Qualifying duel'],
  'f1.market.m16.question': [
    'Кто покажет лучшее время в {segment}: {driver_a} или {driver_b}?',
    'Who sets the better time in {segment}: {driver_a} or {driver_b}?',
  ],
  'f1.market.m16.rule': [
    'Сравниваются лучшие действительные круги внутри одной части. Приём закрывается до начала части. Аннулированные круги исключаются; одинаковое время — «Равное время».',
    'The best valid laps within one part are compared. Entries close before the part starts. Invalidated laps are excluded; equal times are a "Tie".',
  ],
  'f1.market.m17.title': ['Лучший в финальной части', 'Top of the final part'],
  'f1.market.m17.question': ['Кто будет первым в классификации {segment}?', 'Who will top the {segment} classification?'],
  'f1.market.m17.rule': [
    'Официальная классификация части. Это не стартовая позиция: штраф на решётке не меняет результат. Без классификации — VOID.',
    'The official classification of the part. This is not the grid position: a grid penalty does not change the result. No classification voids the pool.',
  ],
  'f1.market.m18.title': ['Итоговая группа в спринте', 'Sprint finishing group'],
  'f1.market.m18.question': ['В какой группе финиширует {driver} в спринте?', 'Which group will {driver} finish in at the Sprint?'],
  'f1.market.m18.rule': [
    'Только официальная итоговая классификация этого спринта. Приоритет: DSQ → DNS → классифицированная позиция → «Не классифицирован».',
    'Only the official final classification of this Sprint. Precedence: DSQ → DNS → classified position → "Not classified".',
  ],
  'f1.market.m19.title': ['Следующий чистый сектор', 'Next clean sector'],
  'f1.market.m19.question': ['За какое время {driver} пройдёт следующий сектор {sector}?', 'How fast will {driver} complete the next sector {sector}?'],
  'f1.market.m19.rule': [
    'Измерение начинается при следующем въезде в сектор {sector} после закрытия приёма. Сравнение до округления; корзины полуоткрытые. SC, VSC или красный флаг во время сектора — VOID.',
    'Measurement starts on the next entry into sector {sector} after entries close. Compared before rounding; buckets are half-open. SC, VSC or a red flag during the sector voids the pool.',
  ],
  'f1.market.m20.title': ['Смена состава шин', 'Compound change'],
  'f1.market.m20.question': [
    'Сменит ли {driver} подтверждённый состав шин до конца окна?',
    "Will {driver}'s confirmed compound change before the window ends?",
  ],
  'f1.market.m20.rule': [
    'Засчитывается переход между подтверждёнными стинтами в нормальном гоночном визите. Новый комплект того же состава — не смена. Красный флаг в окне — VOID.',
    'A transition between confirmed stints in a normal racing visit counts. A new set of the same compound is not a change. A red flag in the window voids the pool.',
  ],
  'f1.market.m21.title': ['Два условия одного момента', 'Two conditions, one moment'],
  'f1.market.m21.question': ['Выполнятся ли оба условия в момент {at}?', 'Will both conditions hold at {at}?'],
  'f1.market.m21.rule': [
    'Оба условия проверяются в одном снимке. Разрешены только пары: группа позиции + состав шин; гонщик впереди соперника + гонщик на трассе; сектор + состав шин. Неизвестная обязательная часть — VOID.',
    'Both conditions are checked in one snapshot. Only these pairs are allowed: position group + compound; driver ahead of rival + driver on track; sector + compound. An unknown required part voids the pool.',
  ],

  /* Outcomes */
  'f1.outcome.position': ['P{position}', 'P{position}'],
  'f1.outcome.retired': ['Сход (RETIRED)', 'Retired'],
  'f1.outcome.dns': ['Не стартовал (DNS)', 'Did not start (DNS)'],
  'f1.outcome.dsq': ['Дисквалифицирован (DSQ)', 'Disqualified (DSQ)'],
  'f1.outcome.driver': ['{driver}', '{driver}'],
  'f1.outcome.driver_ahead': ['{driver} выше', '{driver} ahead'],
  'f1.outcome.driver_faster': ['{driver} быстрее', '{driver} faster'],
  'f1.outcome.both_inactive': ['Оба без действующей позиции', 'Both without a running position'],
  'f1.outcome.no_entry': ['Никто не въедет', 'No pit entry'],
  'f1.outcome.compound.soft': ['Мягкие (S)', 'Soft (S)'],
  'f1.outcome.compound.medium': ['Средние (M)', 'Medium (M)'],
  'f1.outcome.compound.hard': ['Жёсткие (H)', 'Hard (H)'],
  'f1.outcome.compound.intermediate': ['Промежуточные (I)', 'Intermediate (I)'],
  'f1.outcome.compound.wet': ['Дождевые (W)', 'Wet (W)'],
  'f1.outcome.other_confirmed': ['Другой подтверждённый состав', 'Other confirmed compound'],
  'f1.outcome.no_exit': ['Не было подходящего визита', 'No qualifying pit visit'],
  'f1.outcome.bucket.low': ['Меньше {t1} мс', 'Under {t1} ms'],
  'f1.outcome.bucket.mid': ['От {t1} до {t2} мс', '{t1} ms to under {t2} ms'],
  'f1.outcome.bucket.high': ['{t2} мс и больше', '{t2} ms or more'],
  'f1.outcome.no_service': ['Без обслуживания', 'No service'],
  'f1.outcome.no_visit': ['Без визита в пит-лейн', 'No pit-lane visit'],
  'f1.outcome.passes': ['{passer} обгоняет {passed}', '{passer} passes {passed}'],
  'f1.outcome.no_pass': ['Обгона не будет', 'No pass'],
  'f1.outcome.faster': ['Быстрее эталона', 'Faster than the reference'],
  'f1.outcome.equal': ['Точно как эталон', 'Equal to the reference'],
  'f1.outcome.slower': ['Медленнее эталона', 'Slower than the reference'],
  'f1.outcome.no_valid_lap': ['Нет действительного круга', 'No valid lap'],
  'f1.outcome.tie': ['Равное время', 'Tie'],
  'f1.outcome.sc': ['Автомобиль безопасности (SC)', 'Safety Car (SC)'],
  'f1.outcome.vsc': ['Виртуальный автомобиль безопасности (VSC)', 'Virtual Safety Car (VSC)'],
  'f1.outcome.red': ['Красный флаг', 'Red flag'],
  'f1.outcome.no_neutralisation': ['Нейтрализации не будет', 'No neutralisation'],
  'f1.outcome.sector': ['Сектор {sector}', 'Sector {sector}'],
  'f1.outcome.simultaneous': ['Одновременно', 'Simultaneous'],
  'f1.outcome.no_retirement': ['Схода не будет', 'No retirement'],
  'f1.outcome.group.p1': ['P1', 'P1'],
  'f1.outcome.group.p2_3': ['P2–P3', 'P2–P3'],
  'f1.outcome.group.p4_10': ['P4–P10', 'P4–P10'],
  'f1.outcome.group.p11_plus': ['P11 и ниже', 'P11 or lower'],
  'f1.outcome.group.p4_8': ['P4–P8', 'P4–P8'],
  'f1.outcome.group.p9_plus': ['P9 и ниже', 'P9 or lower'],
  'f1.outcome.not_classified': ['Не классифицирован', 'Not classified'],
  'f1.outcome.yes': ['Да', 'Yes'],
  'f1.outcome.no': ['Нет', 'No'],
  'f1.outcome.neither_valid': ['Ни у кого нет действительного времени', 'Neither sets a valid time'],
  'f1.outcome.no_valid_sector': ['Нет действительного сектора', 'No valid sector'],
  'f1.outcome.both_true': ['Оба условия выполнены', 'Both true'],
  'f1.outcome.not_both': ['Не оба', 'Not both'],

  /* M21 parts */
  'f1.combo.part.position_group': ['{driver} в группе {value}', '{driver} in group {value}'],
  'f1.combo.part.tyre_compound': ['{driver} на шинах {value}', '{driver} on {value} tyres'],
  'f1.combo.part.ahead_of': ['{driver} впереди {value}', '{driver} ahead of {value}'],
  'f1.combo.part.on_track': ['{driver} на трассе', '{driver} on track'],
  'f1.combo.part.sector': ['{driver} в секторе {value}', '{driver} in sector {value}'],
  'f1.combo.group.p1': ['P1', 'P1'],
  'f1.combo.group.p1_3': ['P1–P3', 'P1–P3'],
  'f1.combo.group.p2_3': ['P2–P3', 'P2–P3'],
  'f1.combo.group.p4_10': ['P4–P10', 'P4–P10'],
  'f1.combo.group.p1_10': ['P1–P10', 'P1–P10'],
  'f1.combo.group.p11_plus': ['P11 и ниже', 'P11 or lower'],

  /* Determinants (F1-003) */
  'f1.determinant.label': ['Результат определяет: {determinant}', 'Result decided by: {determinant}'],
  'f1.determinant.track_order': ['Порядок на трассе', 'On-track order'],
  'f1.determinant.timing_order': ['Порядок в хронометраже', 'Timing order'],
  'f1.determinant.official_classification': ['Официальная классификация', 'Official classification'],
  'f1.determinant.starting_grid': ['Стартовая решётка', 'Starting grid'],
  'f1.determinant.race_control': ['Официальные сообщения дирекции гонки', 'Official race control messages'],
  'f1.determinant.pit_timing': ['Хронометраж пит-лейна', 'Pit-lane timing'],
  'f1.determinant.lap_timing': ['Официальное время круга и сектора', 'Official lap and sector timing'],
  'f1.determinant.occupancy': ['Подтверждённое местоположение (сектор / боксы)', 'Confirmed location (sector / garage)'],
  'f1.determinant.tyre_stints': ['Подтверждённые стинты шин', 'Confirmed tyre stints'],

  /* Window profiles (F1-019) */
  'f1.window.wall_clock': ['Окно по времени UTC; остановка его не продлевает', 'UTC time window; stoppages do not extend it'],
  'f1.window.next_driver_lap': ['Следующий начатый круг гонщика', "The driver's next started lap"],
  'f1.window.leader_lap_range': ['Подтверждённое пересечение линии лидером', 'Confirmed leader crossing'],
  'f1.window.next_event': ['Первое подходящее событие до крайнего срока', 'First qualifying event before the deadline'],
  'f1.window.session_final': ['Подтверждённая итоговая классификация', 'Confirmed final classification'],

  /* Interruption policies (F1-023) */
  'f1.interruption.continue': ['Остановка не мешает определению результата', 'Stoppages do not prevent the result'],
  'f1.interruption.void_if_interrupted': ['Прерванное измерение — VOID', 'An interrupted measurement is voided'],
  'f1.interruption.wait_for_final': ['Ожидается итоговая классификация', 'Waits for the final classification'],

  /* SC/VSC behaviour */
  'f1.neutralisation.continue_with_anchor': ['SC/VSC: измерение продолжается при существующем якоре', 'SC/VSC: measurement continues at the existing anchor'],
  'f1.neutralisation.normal_visits_allowed': ['SC/VSC: обычные непринудительные визиты в пит-лейн засчитываются', 'SC/VSC: normal unforced pit visits count'],
  'f1.neutralisation.only_passes_outside_neutralisation': ['SC/VSC: засчитываются только обгоны вне нейтрализации', 'SC/VSC: only passes outside neutralisation count'],
  'f1.neutralisation.void_on_interruption': ['SC/VSC во время измерения — VOID', 'SC/VSC during the measurement voids the pool'],
  'f1.neutralisation.valid_laps_remain': ['SC/VSC: действительные круги остаются в сравнении', 'SC/VSC: valid laps stay in the comparison'],
  'f1.neutralisation.observation_continues': ['SC/VSC: наблюдение продолжается', 'SC/VSC: observation continues'],
  'f1.neutralisation.wait_for_result': ['SC/VSC: ожидается итог', 'SC/VSC: waits for the result'],
  'f1.neutralisation.inherit_compatible': ['SC/VSC: обе части следуют одному режиму', 'SC/VSC: both parts follow one mode'],

  /* RED behaviour */
  'f1.red.void_before_anchor': ['Красный флаг до якоря — VOID', 'A red flag before the anchor voids the pool'],
  'f1.red.void_in_affected_window': ['Красный флаг в окне или во время визита — VOID', 'A red flag in the window or during the visit voids the pool'],
  'f1.red.void_on_interruption': ['Красный флаг, прервавший измерение, — VOID', 'A red flag interrupting the measurement voids the pool'],
  'f1.red.original_window_continues': ['Красный флаг: сравнение в исходном окне, время не добавляется', 'Red flag: the comparison stays in the original window, no time is added'],
  'f1.red.observation_continues': ['Красный флаг: наблюдение продолжается', 'Red flag: observation continues'],
  'f1.red.wait_for_result_void_if_cancelled': ['Красный флаг: ожидается итог; отменённая часть без итога — VOID', 'Red flag: waits for the result; a cancelled part without a result is voided'],
  'f1.red.inherit_compatible': ['Красный флаг: обе части наследуют один режим', 'Red flag: both parts inherit one mode'],

  /* Anchors */
  'f1.anchor.driver_lap': ['После завершения {driver} своего круга {lap}', 'When {driver} completes their own lap {lap}'],
  'f1.anchor.instant': ['В момент {at}', 'At {at}'],
  'f1.anchor.next_lap': ['Следующий круг {driver}, начатый после закрытия приёма', "{driver}'s next lap started after entries close"],
  'f1.anchor.next_sector': ['Следующий въезд {driver} в сектор {sector}', "{driver}'s next entry into sector {sector}"],
  'f1.anchor.segment': ['Часть {segment}', 'Part {segment}'],
  'f1.anchor.session_final': ['Итоговая классификация сессии', 'Final session classification'],
  'f1.anchor.window': ['Окно с {from} до {to}', 'Window {from} – {to}'],

  /* VOID reasons */
  'f1.void.title': ['Пул аннулирован (VOID)', 'Pool voided (VOID)'],
  'f1.void.incomplete_observation': ['Недостаточно данных: поток наблюдался не полностью', 'Not enough data: the feed was not fully observed'],
  'f1.void.target_not_started': ['Измеряемое событие не началось', 'The measured event never started'],
  'f1.void.target_cancelled': ['Сессия или часть отменена', 'The session or part was cancelled'],
  'f1.void.resolution_deadline_exceeded': ['Определяющий итог не получен до крайнего срока', 'No decisive result before the deadline'],
  'f1.void.target_boundary_contaminated': ['Приём участий пересёкся с началом события', 'Entries overlapped the start of the event'],
  'f1.void.ambiguous_event_order': ['Порядок событий установить невозможно', 'The order of events cannot be established'],
  'f1.void.interrupted': ['Измерение прервано остановкой или нейтрализацией', 'The measurement was interrupted by a stoppage or neutralisation'],
  'f1.void.reference_invalid': ['Эталонное время признано недействительным', 'The reference time was invalidated'],
  'f1.void.unknown_required_part': ['Одно из обязательных условий неизвестно', 'A required condition is unknown'],
  'f1.void.contradictory_data': ['Противоречивые данные источника не были исправлены', 'Contradictory source data was not corrected'],

  /* Validation (pool creation) */
  'f1.validation.session_type_not_allowed': ['Вопрос недоступен для этого типа сессии', 'This question is not available for this session type'],
  'f1.validation.capability_unavailable': ['Нет обязательного сигнала данных нужного качества: {capability}', 'A required data signal of sufficient quality is missing: {capability}'],
  'f1.validation.driver_required': ['Не выбран гонщик', 'No driver selected'],
  'f1.validation.driver_unknown': ['Гонщик не участвует в сессии', 'The driver is not in this session'],
  'f1.validation.drivers_must_differ': ['Выберите двух разных гонщиков', 'Choose two different drivers'],
  'f1.validation.target_lap_required': ['Не задан круг якоря', 'The anchor lap is not set'],
  'f1.validation.lap_anchor_required': ['Укажите, чьё пересечение линии определяет круг: лидера или гонщика', "Specify whose line crossing defines the lap: the leader's or the driver's"],
  'f1.validation.leader_anchor_required': ['Для дуэли нужен якорь по кругу лидера', 'A duel needs a leader-lap anchor'],
  'f1.validation.thresholds_required': ['Не заданы пороги корзин', 'Bucket thresholds are not set'],
  'f1.validation.thresholds_invalid': ['Пороги должны быть целыми и возрастать', 'Thresholds must be whole numbers in ascending order'],
  'f1.validation.reference_required': ['Не задано эталонное время', 'The reference time is not set'],
  'f1.validation.sector_required': ['Не выбран сектор', 'No sector selected'],
  'f1.validation.segment_required': ['Не выбрана часть квалификации', 'No qualifying part selected'],
  'f1.validation.segment_not_allowed': ['Вопрос недоступен для части {segment}', 'This question is not available for {segment}'],
  'f1.validation.segment_not_in_session': ['Части {segment} нет в этой сессии', '{segment} is not part of this session'],
  'f1.validation.m15_no_next_segment': ['После {segment} нет следующей части — используйте вопрос о классификации части', 'There is no part after {segment} — use the part classification question'],
  'f1.validation.m16_must_close_before_segment': ['Приём должен закрыться до начала {segment}', 'Entries must close before {segment} starts'],
  'f1.validation.segment_already_decided': ['Часть {segment} уже завершена', '{segment} is already finished'],
  'f1.validation.admitted_required': ['Не известен состав допущенных в финальную часть', 'The drivers admitted to the final part are unknown'],
  'f1.validation.combo_required': ['Комбинация должна содержать ровно две части', 'A combination needs exactly two parts'],
  'f1.validation.combo_pair_not_allowed': ['Такое сочетание условий не разрешено', 'This combination of conditions is not allowed'],
  'f1.validation.combo_value_invalid': ['Недопустимое значение условия', 'Invalid condition value'],
  'f1.validation.combo_subject_mismatch': ['Обе части должны относиться к одному гонщику', 'Both parts must refer to the same driver'],
  'f1.validation.instant_required': ['Не задан момент снимка', 'The snapshot instant is not set'],
  'f1.validation.timing_invalid': ['Некорректное время открытия или закрытия', 'Invalid opening or closing time'],
  'f1.validation.closes_after_target_start': ['Приём должен закрыться до начала измеряемого события', 'Entries must close before the measured event starts'],
  'f1.validation.window_invalid': ['Некорректные границы окна', 'Invalid window bounds'],
  'f1.validation.window_profile_not_allowed': ['Этот профиль окна недоступен для текущего качества данных', 'This window profile is not allowed for the current data quality'],
  'f1.validation.no_finite_deadline': ['У пула нет конечного крайнего срока расчёта', 'The pool has no finite settlement deadline'],
  'f1.validation.tie_profile_invalid': ['Некорректное правило одновременности', 'Invalid simultaneity rule'],

  /* Pool lifecycle */
  'f1.pool.status.draft': ['Черновик', 'Draft'],
  'f1.pool.status.scheduled': ['Запланирован', 'Scheduled'],
  'f1.pool.status.open': ['Открыт', 'Open'],
  'f1.pool.status.locked': ['Приём закрыт', 'Locked'],
  'f1.pool.status.resolving': ['Определяется результат', 'Resolving'],
  'f1.pool.status.settled': ['Рассчитан', 'Settled'],
  'f1.pool.status.void': ['Аннулирован', 'Void'],
  'f1.pool.intake.accepting': ['Приём открыт', 'Accepting entries'],
  'f1.pool.intake.suspended': ['Приём приостановлен', 'Entries suspended'],
  'f1.pool.suspend.red_flag': ['Красный флаг: приём приостановлен', 'Red flag: entries suspended'],
  'f1.pool.suspend.signal_lost': ['Потерян обязательный сигнал данных', 'A required data signal was lost'],
  'f1.pool.suspend.session_suspended': ['Сессия остановлена', 'Session suspended'],
  'f1.entry.not_open': ['Приём ещё не открыт', 'Entries are not open yet'],
  'f1.entry.closed': ['Приём закрыт', 'Entries are closed'],
  'f1.entry.suspended.red_flag': ['Красный флаг: приём приостановлен', 'Red flag: entries suspended'],
  'f1.entry.suspended.signal_lost': ['Приём приостановлен: потерян сигнал данных', 'Entries suspended: data signal lost'],
  'f1.entry.suspended.session_suspended': ['Приём приостановлен: сессия остановлена', 'Entries suspended: session stopped'],
  'f1.availability.session_type': ['Недоступно для этого типа сессии', 'Not available for this session type'],
  'f1.availability.missing_signal': ['Недоступно: нет обязательного сигнала данных', 'Unavailable: a required data signal is missing'],
  'f1.availability.degraded_signal': ['Недоступно: качество данных снижено', 'Unavailable: data quality is degraded'],

  /* Corrections & settlement (F1-042, F1-054 … F1-056) */
  'f1.correction.revised': ['Данные источника исправлены', 'Source data corrected'],
  'f1.correction.retracted': ['Запись источника отозвана', 'Source record retracted'],
  'f1.correction.superseded': ['Запись заменена новой', 'Record superseded'],
  'f1.settlement.checking': ['Проверяем подтверждение', 'Checking confirmation'],
  'f1.settlement.provisional': ['Предварительный результат', 'Provisional result'],
  'f1.settlement.final': ['Результат подтверждён', 'Result confirmed'],
  'f1.settlement.corrected': ['Результат исправлен', 'Result corrected'],
  'f1.settlement.previous': ['Прежнее значение', 'Previous value'],

  /* Result-proof values */
  'f1.value.stop_duration_ms': ['Неподвижная остановка', 'Stationary stop'],
  'f1.value.lane_duration_ms': ['Время в пит-лейне', 'Pit-lane time'],
  'f1.value.lap_time_ms': ['Время круга', 'Lap time'],
  'f1.value.sector_time_ms': ['Время сектора', 'Sector time'],
  'f1.value.reference_time_ms': ['Эталон', 'Reference'],
  'f1.value.delta_ms': ['Разница', 'Delta'],
  'f1.value.best_lap_ms': ['Лучший круг', 'Best lap'],
  'f1.value.position': ['Позиция', 'Position'],
  'f1.value.driver_lap': ['Круг гонщика', 'Driver lap'],
  'f1.value.leader_lap': ['Круг лидера', 'Leader lap'],
  'f1.value.compound': ['Состав шин', 'Compound'],
  'f1.value.classification_revision': ['Редакция классификации', 'Classification revision'],
  'f1.value.snapshot_revision': ['Редакция снимка', 'Snapshot revision'],

  /* Sessions, segments, track states (F1-051: SC/VSC/RED always have text) */
  'f1.session.practice': ['Практика', 'Practice'],
  'f1.session.qualifying': ['Квалификация', 'Qualifying'],
  'f1.session.sprint_qualifying': ['Спринт-квалификация', 'Sprint Qualifying'],
  'f1.session.sprint': ['Спринт', 'Sprint'],
  'f1.session.grand_prix': ['Гран-при', 'Grand Prix'],
  'f1.segment.q1': ['Q1', 'Q1'],
  'f1.segment.q2': ['Q2', 'Q2'],
  'f1.segment.q3': ['Q3', 'Q3'],
  'f1.segment.sq1': ['SQ1', 'SQ1'],
  'f1.segment.sq2': ['SQ2', 'SQ2'],
  'f1.segment.sq3': ['SQ3', 'SQ3'],
  'f1.track.green': ['Зелёный флаг', 'Green flag'],
  'f1.track.sc': ['Автомобиль безопасности (SC)', 'Safety Car (SC)'],
  'f1.track.vsc': ['Виртуальный автомобиль безопасности (VSC)', 'Virtual Safety Car (VSC)'],
  'f1.track.red': ['Красный флаг', 'Red flag'],
  'f1.track.sc_ending': ['SC уходит в конце круга', 'SC in this lap'],
  'f1.track.vsc_ending': ['VSC заканчивается', 'VSC ending'],
  'f1.track.chequered': ['Финишный флаг', 'Chequered flag'],
};

export type F1Locale = 'ru' | 'en';

function pick(index: 0 | 1): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(PAIRS)) out[k] = v[index];
  return out;
}

export const F1_I18N: { ru: Record<string, string>; en: Record<string, string> } = {
  ru: pick(0),
  en: pick(1),
};

/** Replaces {param} placeholders; unknown keys return the key itself (visible in QA). */
export function formatI18n(locale: F1Locale, key: string, params: Record<string, string | number> = {}): string {
  const template = F1_I18N[locale][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (params[name] !== undefined ? String(params[name]) : m));
}
