# Ticiana Color — калькулятор колорантов AdsPro

Браузерный калькулятор формул колорантов для системы тонирования **AdsPro** (Hongpu / TINTEC), на которой построена линейка **Ticiana Deluxe** (Фарбитекс) и сопутствующие линейки заводских красок. Работает без сервера — чистый HTML/CSS/JS.

**Live:** https://catolseo.github.io/ticiana-color/

## Для кого

- **Колеровочные пункты** — посчитать формулу Ticiana Deluxe / Фарбитекс на любой объём, когда тинтометр занят, выключен или его рядом нет.
- **Маляры** — точная рецептура в миллилитрах и граммах для ручного домешивания/подкоррекции.
- **Магазины ЛКМ** — быстрая проверка без запуска тяжёлого ADS-Pro.

## Что умеет

1. **Выбор продукта** — 71 линия краски: 32 Ticiana Deluxe (BELUCCI, Fondo 1/2, Prima Bianco/Lavato, MODELLA, ASTI, SETERIA, VERSAILLES, CACHEMIRE, CAMOSCINO, CHARME, VENIERA и др.), 28 Фарбитекс (Latex, Color-X, ВДК, Supermatt, Eurofacade, BaseCover, 4 Season, ELASTIC, Textura, Короед и др.), 3 Олеколор, 7 WOOD-серий и 1 декоративная.
2. **Веер цветов (фандек)** внутри линии — NCS II, RAL Classic, Spirit 1050 / Spirit, Symphony, Ambiance, Caparol 3D / 3D System, Palette, ABC Collection, Коллекция 2021, Woodstains, Estetica и др. (16 разных фандеков, 148 (продукт × фандек) комбинаций).
3. **Фильтрация цветов** — по базе (A — Белая, A1 — Декоративная, C — Прозрачная, E — Лак) или по коду/названию (`S 1502-Y50R`, `RAL 5002`, `1011P`, `5-6-2`, …).
4. **Предпросмотр цвета** — квадратик с приближением оттенка на основе линейного смешения колорантов в RGB (база — белая). Фон страницы тоже подкрашивается в выбранный цвет.
5. **Пересчёт на любой объём** — литры, миллилитры, килограммы, граммы. Плотность базы редактируется (для весовых банок KG).
6. **Множитель силы** — учитывает поправку `ProMult` из исходной БД (например, `[A]1.26` для Fondo 1) — критично для совпадения с ADS-Pro.

## Цифры

| | |
|---|---|
| Всего формул | **94 444** |
| Продуктов | **71** |
| Веер × продукт | **148** |
| Колорантов H.PU CC | **16** (AN, AXX, B, C, D, E, F, I, KX, L, R, RN, T, TRO, TYO, V) |
| Баз | **4** (A — Белая, A1 — Декоративная, C — Прозрачная, E — Лак) |
| Эталонные размеры банок | от 0.625 до 25 LT / 1 до 25 KG |
| Дозирующая единица | **1 мл** (DropSize в `tint_book.ini` = 1.0) |

## Точность

Калькулятор сверен с реальными формулами из `ADSPro_last.csv` (журнал сохранённых формул). Пример — цвет `5-6-2` Ticiana Deluxe Fondo 1 на базе Spirit 1050, базе A, объём 0.9 LT:

| Колорант | ADSPro_last.csv | Этот калькулятор |
|---|---:|---:|
| B (Lamp Black)   | 0.92232 мл | 0.922 мл |
| C (Yellow Oxide) | 2.15208 мл | 2.152 мл |
| I (Brown Oxide)  | 1.02564 мл | 1.026 мл |

Совпадение с точностью до округления.

## Что достаётся из исходной БД

```
C:\Program Files (x86)\Hongpu\AdsPro\
  ADSPro.exe                    основное приложение
  book\tint_book.ini            каталог продуктов: ProFile, ProSize, ProDens, ProMult, DyeList
  book\<product>_<fandeck>.book.csv   в боевой версии XOR-зашифрованы под лицензию
save\ADSPro_last.csv            журнал сохранённых формул (cp866, открытый)
logs\ADSPro_stats.csv           журнал дозирований (cp866, открытый)
logs\ADSPro_recipe.log          последний рецепт в человекочитаемом виде
help\ADSPro_en.pdf              мануал «ADS-Pro User's Manual», IRO Group / Hongpu, 2018
```

В этом репозитории формулы собраны из **незашифрованной резервной копии `book_резервная копия 24.01.2024.zip`** (172 файла, формат CSV). Кодировка — **cp866** (DOS Russian) для книг и журналов, **UTF-8 BOM** для `tint_book.ini`.

## Формат записи в book.csv

```
Header: <yymmddhhmm>;[Default];<title>;;;;;[lt]<ref-size>;1;1
Record: <yymmdd>;<color-code>;;;<color_int>;<base-code>;[CID]amount[CID]amount...;;1;1
```

`amount` — миллилитры на эталонный размер банки (`ProSize[0]` в `tint_book.ini`). `color_int` — внутренний идентификатор оттенка ADS-Pro (для предпросмотра не используется, в репозитории применён линейный синтез RGB).

## Математика пересчёта

```
ref_ml = ProSize[0] × 1000        # эталонный объём в мл (для KG-банок: ref_kg × 1000 / density)
target_ml = (target_kg × 1000) / density        для kg
target_ml = target_l × 1000                     для l/ml
factor = target_ml / ref_ml × ProMult[base]
ml_of_tint  = formula_amount × factor
g_of_tint   = ml_of_tint × colorant.density     # из DyeDens в tint_book.ini
```

`ProMult` — это специфичный для базы поправочный коэффициент силы (нужен, потому что в ADS-Pro один и тот же файл формул может работать на разных базовых пастах с разной укрывистостью).

## Архитектура

| Файл | Назначение |
|---|---|
| `index.html` | разметка + точки монтажа UI |
| `styles.css` | оформление в фирменной красно-кремовой палитре Ticiana Deluxe |
| `app.js` | логика: фильтры, ленивая подгрузка формул, пересчёт |
| `data.js` | ядро: колоранты, базы, каталог продуктов с фандеками (~30 KB) |
| `formulas/p<N>.js` | формулы одной линии — 71 файл, ленивая загрузка по выбору |
| `tools/extract_csv.py` | парсер `data/book/*.book.csv` + `tint_book.ini` → JS |
| `data/book/` | оригинальные CSV-файлы из бэкапа (для перегенерации) |
| `data/tint_book.ini` | каталог из ADS-Pro |

Файлы `formulas/p*.js` подгружаются лениво — выбран продукт «Ticiana Deluxe Fondo 1» — браузер докачивает только `formulas/p14.js`, не все ~6.5 МБ формул.

## Перегенерация

Если у вас новая версия `book_резервная копия *.zip` — распакуйте в `data/book/` и:

```bash
python tools/extract_csv.py
git add -A && git commit -m "Update formulas" && git push
```

Требуется Python 3.8+. Парсер читает CSV напрямую (`cp866`), `tint_book.ini` (`utf-8-sig`), сторонних зависимостей нет.

## Лицензия и источник данных

Формулы принадлежат «Фарбитекс» / лицензиарам Ticiana Deluxe; программа ADS-Pro — Hongpu Machinery Manufacture Co. Ltd. (Шуньдэ, Гуандун, КНР), © 2018 IRO Group Limited. Этот репозиторий — инструмент-калькулятор для уже приобретённой базы; повторное распространение базы данных формул отдельно от лицензированного дозатора TINTEC ADS / шейкера TINTEC HS-3T не предусмотрено.

## Полезные ссылки

- [Ticiana Deluxe](https://ticiana-deluxe.ru/) — линейка декоративных красок и фактурных штукатурок «Фарбитекс»
- [Фарбитекс](https://www.farbitex.ru/) — производитель ЛКМ (Иваново)
- Hongpu Machinery — официальный сайт `www.hpuglobal.com`, ADS-Pro, ADS-Maintenance, ADS-Link, дозаторы серии ATS / NDS / 12 / 14 / 16 / 18 / 24
