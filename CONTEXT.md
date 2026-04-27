# Передача контекста: ticiana-color

> Этот файл — точка входа для новой сессии Claude Code в `C:\claude\ticiana-color\`.
> Цель: продолжить разработку без необходимости заново исследовать AdsPro.

## TL;DR

Браузерный калькулятор колорантов для системы тонирования **AdsPro / TINTEC** (Hongpu, Шуньдэ, КНР), на которой работает линейка **Ticiana Deluxe** и фабричные краски «Фарбитекс». Чистый HTML/CSS/JS, без сборщика, разворачивается как статика на GitHub Pages.

Сделан как близнец двух референсов того же автора:
- `C:\claude\oikos-paint\` — Oikos Expert Tint (COROB DCS 16C, dBase III)
- `C:\claude\spiver-color\` — Spiver / CPSCOLOR 4.12 (dBase III)

ticiana-color отличается от обоих тем, что AdsPro хранит формулы не в DBF, а в текстовом CSV (cp866) — поэтому свой парсер.

## Архитектура

| Файл | Что |
|---|---|
| `index.html` | разметка (3 карточки: продукт → цвет → объём → результат) |
| `styles.css` | бренд-палитра Ticiana (deep red `#8c1d2a`, кремовый фон) |
| `app.js` | вся клиентская логика, vanilla JS, ~250 строк |
| `data.js` | ядро БД (колоранты, базы, каталог продуктов с фандеками) ~31 KB |
| `formulas/p<N>.js` | формулы одной линии — 71 файл, ленивая загрузка по выбору |
| `tools/extract_csv.py` | ETL: `data/book/*.csv` + `tint_book.ini` → `data.js` + `formulas/*.js` |
| `data/book/` | 172 исходных CSV (см. ниже) |
| `data/tint_book.ini` | каталог продуктов из ADS-Pro |
| `.claude/launch.json` | preview-сервер на порту 8732 |
| `README.md` | пользовательская документация |

## Источники данных (ВАЖНО)

### Где живёт оригинал на боевой машине
```
C:\Program Files (x86)\Hongpu\AdsPro\
  ADSPro.exe                          # сама программа
  book\tint_book.ini                  # каталог продуктов (UTF-8 BOM)
  book\<prefix>_<fandeck>.book.csv    # ★ В БОЕВОЙ ВЕРСИИ ЗАШИФРОВАНЫ ★
save\ADSPro_last.csv                  # журнал сохранённых формул (cp866, открытый)
logs\ADSPro_stats.csv                 # журнал дозирований (cp866, открытый)
logs\ADSPro_recipe.log                # последний рецепт человекочитаемо
help\ADSPro_en.pdf                    # мануал ADS-Pro User's Manual, IRO Group, 2018
```

### Откуда взяты формулы в этом репозитории

**`D:\backup\Ticiana\Резервные копии и обновления\book_резервная копия 24.01.2024.zip`** —
последний бэкап, в котором CSV хранятся **в открытом виде**. Распакованы в `data/book/`.

Боевые CSV (`D:\backup\Ticiana\AdsPro\book\` и `book_копия_06.08.2025\book\`)
зашифрованы простым потоковым шифром. Алгоритм расшифрован (см.
`tools/decrypt_book.py`):

```
файл = <4 байта magic prefix> + XOR-stream
key[i] = (7 + 7*i) mod 255
plain[i] = cipher[i + 4] XOR key[i]
```

Ключевая деталь — `mod 255` (не 256). Wraparound происходит каждые 36-37
байт и при mod-256 выглядит как +1 «глитч». При mod-255 keystream идеально
ложится. k0 = 7 одинаковый для всех 175+ файлов — per-file derivation нет.

Расшифровка верифицирована known-plaintext: байт-в-байт совпадает с
открытым Jan-2024 бэкапом, кроме 6 байт timestamp в первой строке (это
дата последнего пересохранения — она вообще различается между snapshot'ами).

## Кодировки (★ грабли ★)

| Файл | Кодировка |
|---|---|
| `data/tint_book.ini` | **UTF-8 BOM** (`LoadCode = UTF-8` в шапке) |
| `data/book/*.book.csv` | **cp866** (DOS Russian) — записи и заголовки |
| `save/ADSPro_last.csv` | cp866 |
| `logs/ADSPro_stats.csv` | cp866 |
| `logs/ADSPro_recipe.log` | cp866 |
| `data.js` (наш генерированный) | UTF-8 |

При выводе в Bash/PowerShell кириллица из cp866 рендерится как `A-�����` —
**это не повреждённые данные**, а stdout encoding терминала. В Python используйте
`sys.stdout.reconfigure(encoding="utf-8")` или пишите в файл, чтобы проверять корректность.

## Формат записи в book.csv

```
Header: <yymmddhhmm>;[Default];<title>;;;;;[lt]<ref-size>;1;1
Record: <yymmdd>;<color-code>;;;<color_int>;<base-code>;[CID]amount[CID]amount...;;1;1
```

- `<color_int>` — внутренний идентификатор оттенка ADS-Pro, в калькуляторе **не используется**
  (значение неизвестного формата; не RGB, не CIE, не Lab — пробовал декодировать).
  Вместо него цвет синтезируется линейным микшированием колорантов в RGB поверх белой базы.
- `<base-code>` — `A` (Белая), `A1` (Декоративная), `C` (Прозрачная), `E` (Лак).
- `amount` — миллилитры на эталонную банку (`ProSize[0]` из `tint_book.ini`).
  В ADS-Pro `DropSize = 1.0 мл`, поэтому в книге значения уже в миллилитрах.

## tint_book.ini — каталог

```ini
[Default_INI]
DropSize = 1.0
ProList  = A, A1, C, E
ProText  = [A]A-Белая[A1]A1-Декоративная[C]C-Прозрачная[E]E-Лак
DyeList  = AN, AXX, B, C, D, E, F, I, KX, L, R, RN, T, TRO, TYO, V
DyeDens  = [AN]1.640[AXX]1.273[B]1.322...
DyeHtml  = [AN]FDFF13[AXX]FDFA1E...

[<Продукт>|<Фандек>]                  ; одна секция = один файл формул
ProFile = b11_ambiance.book.csv
ProSize = [LT]0.9/0.9/2.5/4.5/9/19    ; первый — эталон для расчёта, остальные — доступные банки
ProDens = [A]1[C]1                    ; плотность базы (для KG-банок)
ProMult = [A]1.26                     ; ★ поправочный множитель силы по базе ★
```

`ProMult` — критичен: один и тот же файл формул может работать на разных базовых
пастах с разной укрывистостью. Калькулятор обязан умножать на этот коэффициент,
иначе выдаст значения, не совпадающие с ADS-Pro.

## Математика пересчёта

```
ref_unit = ProSize.unit                # "LT" или "KG"
ref_size = ProSize[0]                  # первый размер в списке
ref_ml   = ref_size * 1000             # для LT
ref_ml   = ref_size * 1000 / density   # для KG (density = плотность базы из формы)

target_ml = (kg ⨯ 1000) / density для kg/g; иначе ml/L * 1000

mult   = ProMult[base] || 1.0
factor = (target_ml / ref_ml) * mult
ml_of_tint  = formula_amount * factor
g_of_tint   = ml_of_tint * colorant_density   # из DyeDens
```

## Цифры

- 71 продукт (32 Ticiana Deluxe + 28 Фарбитекс + 7 WOOD + 3 Олеколор + 1 декор)
- 148 (продукт × фандек)
- **94 444 формулы**
- 16 колорантов H.PU CC, 4 базы

## Точность калькулятора

Сверена с реальной строкой из `ADSPro_last.csv`:
`5-6-2 / Ticiana Deluxe Fondo 1 / Spirit 1050 / база A / 0.9 LT`

| Колорант | ADSPro_last.csv | Калькулятор |
|---|---:|---:|
| B (Lamp Black)   | 0.92232 мл | 0.922 мл |
| C (Yellow Oxide) | 2.15208 мл | 2.152 мл |
| I (Brown Oxide)  | 1.02564 мл | 1.026 мл |

Совпадение с точностью округления.

## Структура tuple в `formulas/p<N>.js`

Каждая формула — массив (для компактности JSON):
```
[sp_idx, code, base, formula_str, [r, g, b]]
```

Соответствующие константы в JS — `F_SP=0, F_CODE=1, F_BASE=2, F_FORMULA=3, F_RGB=4`
(см. `app.js:6`). При изменении layout в Python — обязательно синхронизировать.

`formula_str` — `"L:0.244;V:0.081"` (точка с запятой, двоеточие).

## Как перегенерировать

```bash
cd C:\claude\ticiana-color
python tools/extract_csv.py
```

Требует Python 3.8+. Без зависимостей. Читает `data/book/*.csv` и `data/tint_book.ini`,
пишет `data.js` и `formulas/p<N>.js`. ~94k формул, ~1 секунда.

## Локальный запуск

```bash
cd C:\claude\ticiana-color
python -m http.server 8732
# открыть http://localhost:8732/
```

или через preview-tool в Claude Code сессии, открытой в этой папке —
`.claude/launch.json` уже сконфигурирован.

## Проекты-близнецы (НЕ смешивать)

- `C:\claude\spiver-color\` — самостоятельный проект для CPSCOLOR/Spiver. Свой парсер DBF.
- `C:\claude\oikos-paint\` — самостоятельный проект для Oikos. Свой парсер DBF.

Они не зависят от ticiana-color и наоборот. Перекрёстных ссылок ноль (проверено `grep`).

Дизайн-конвенции взяты из `oikos-paint`: 3 карточки шага, фоновое изменение цвета
страницы под выбранный оттенок, таблица результата, ленивая подгрузка формул.

## Что можно добавить (TODO для следующих сессий)

- **Декодировать `<color_int>`** — реальный RGB из БД дал бы точный предпросмотр вместо
  синтеза. Пока экспериментально не получилось — формат не RGB/COLORREF/Lab.
- **Автосинхронизация с боевой машиной** — `tools/decrypt_book.py` умеет читать
  зашифрованные `book/*.csv` напрямую с production AdsPro. Можно сделать cron, который
  декриптит свежий снимок и регенерирует `data.js` без ручной правки.
- **Совместимость с Windows-1251** — на случай старых ADS-Pro версий до перехода на
  cp866. Сейчас парсер привязан к cp866.

## Глобальные инструкции пользователя

- Общение на русском.
- После правок кода всегда вызывать skill `simplify`.
- Деплой `proxer-vercel` (хост 65.108.230.15) — это ДРУГОЙ проект, к ticiana-color не относится.
