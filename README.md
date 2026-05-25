# CM.Expert -> Bitrix24 Catalog Sync

Легкий standalone-сервис на Node.js 20 + TypeScript для синхронизации автомобилей из CM.Expert в каталог товаров Bitrix24. Сервис создает и обновляет товары, цены, фото, описание, разделы и характеристики автомобиля.

Без n8n, Supabase, CSV, БД, Redis и очередей. Секреты читаются только из `.env`.

## Быстрый запуск в Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f app
```

Основной контейнер `app` запускает `npm run start`: сначала выполняет один sync при `RUN_SYNC_ON_START=true`, затем запускает cron по `SYNC_CRON`.

## Заполнение .env

Заполните `.env` в корне проекта:

```env
CM_CLIENT_ID=
CM_CLIENT_SECRET=
BITRIX_WEBHOOK_BASE_URL=
BITRIX_CATALOG_ID=14
BITRIX_IBLOCK_ID=14
BITRIX_ROOT_SECTION_NAME=Автомобили
SYNC_CRON=0 */2 * * *
DRY_RUN=false
RUN_SYNC_ON_START=true
BITRIX_DELAY_MS=300
BITRIX_MAX_RETRIES=5
LOG_LEVEL=info
```

`BITRIX_WEBHOOK_BASE_URL` должен быть входящим webhook Bitrix24 вида:

```text
https://domain.bitrix24.ru/rest/user_id/webhook_key
```

## Первый запуск

После заполнения `.env`:

```bash
docker compose up -d --build
docker compose logs -f app
```

Папки `data/` и `errors/` сохраняются на сервере через volumes, поэтому `state.json`, `sync.lock` и `sync-errors.jsonl` не теряются после пересоздания контейнера.

## Проверка CM.Expert

```bash
docker compose run --rm app npm run cm:sample
```

Команда получает первую страницу автомобилей, сохраняет пример в `data/cm-sample.json` и печатает реальные поля ответа CM.Expert.

## Проверка Bitrix24

Список каталогов:

```bash
docker compose run --rm app npm run bitrix:catalogs
```

Поля товара и свойства каталога:

```bash
docker compose run --rm app npm run bitrix:fields
```

Разделы каталога:

```bash
docker compose run --rm app npm run bitrix:sections
```

## Создание свойств товаров

Автомобильные характеристики создаются автоматически:

```bash
docker compose run --rm app npm run bitrix:create-car-properties
docker compose run --rm app npm run bitrix:fields
```

Команда использует `catalog.productProperty.list` и `catalog.productProperty.add`, не создает дубли по `code`, а затем заполняет `src/bitrix/fieldMap.ts` значениями вида `property123`.

В production compose исходники не монтируются в контейнер. Для локальной разработки, когда нужно обновлять `fieldMap.ts` из Docker-команды прямо на хосте, используйте:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm app npm run bitrix:create-car-properties
```

В этом репозитории `fieldMap.ts` уже заполнен актуальными `propertyN` для текущего Bitrix24.

## Dry-run

```bash
docker compose run --rm app npm run sync:dry
```

Dry-run ничего не записывает в Bitrix24. В начале вывода есть блок `dryRunCharacteristicPreview`: какие характеристики будут отправлены, какие пропущены из-за пустого `fieldMap.ts`, пустого значения CM.Expert или неизвестного свойства Bitrix24.

Для тестов на одной машине:

```bash
docker compose run --rm app npm run sync:dry -- --limit=1
docker compose run --rm app npm run sync:dry -- --vin=SALGA2BKXKA520203
docker compose run --rm -e SYNC_LIMIT=1 app npm run sync:dry
```

При `--limit=1`, `--vin=...` или `--external-code=...` сервис не архивирует отсутствующие товары и не обновляет `data/state.json`.

## Реальный sync

```bash
docker compose run --rm app npm run sync
```

Реальный sync только одной машины для проверки:

```bash
docker compose run --rm app npm run sync -- --limit=1
docker compose run --rm app npm run sync -- --vin=SALGA2BKXKA520203
```

Этот режим нужен только для точечной проверки. Плановый production-запуск должен работать без `SYNC_LIMIT`.

Обычный фоновый режим:

```bash
docker compose up -d --build
```

Ссылка на карточку в CM.Expert строится из поля `id`, которое возвращает CM.Expert API:

```text
https://lk.cm.expert/stock/{id}/car
```

Сервис добавляет эту ссылку в описание товара и может писать ее в свойство `CAR_CM_EXPERT_URL`.

## Просмотр логов

```bash
docker compose logs -f app
docker compose logs --tail=100 app
```

Финальный отчет sync:

```json
{
  "received": 0,
  "filtered": 0,
  "unique": 0,
  "created": 0,
  "updated": 0,
  "archived": 0,
  "skipped": 0,
  "errors": 0,
  "dryRun": false
}
```

Ошибки отдельных товаров пишутся в `errors/sync-errors.jsonl`.

## Деплой на VPS

На сервере:

```bash
git clone https://github.com/marenichlifestyle/ManezhCM.git
cd ManezhCM
cp .env.example .env
nano .env
mkdir -p data errors
docker compose up -d --build
docker compose logs -f app
```

Минимальные требования: Docker Compose, доступ в интернет до CM.Expert и Bitrix24, Node.js на хосте не нужен.

## Как обновлять проект на сервере

```bash
cd ManezhCM
git pull
docker compose up -d --build
docker compose logs --tail=100 app
```

Если менялись свойства каталога:

```bash
docker compose run --rm app npm run bitrix:fields
docker compose run --rm app npm run sync:dry
docker compose run --rm app npm run sync
```

## Логика синхронизации

Импортируются автомобили, у которых `saleStatus === "onsale"` и есть признак публикации: заполненный `dealerSitePublicationUrl`, либо `publishStatus === "published"`, либо `stockPublications[].publish === true`.

Уникальный ключ:

```text
dmsCarId || vin || dealerSitePublicationUrl
```

Он записывается в Bitrix24 как `xmlId`, поэтому дубли не создаются.

Разделы создаются автоматически:

```text
Автомобили -> brand -> model
```

Если марка или модель пустые:

```text
Автомобили -> Без марки -> Без модели
```

Товары не удаляются физически. Если товар раньше синхронизировался, но пропал из CM.Expert, сервис ставит `active = "N"`. На первом запуске архивация не выполняется.

Защита от ошибочной архивации:

- если CM.Expert вернул 0 автомобилей, Bitrix24 не меняется
- если количество автомобилей стало меньше больше чем на 50% относительно прошлого успешного запуска, архивация и обновление `data/state.json` пропускаются

Lock-файл `data/sync.lock` не дает запустить две синхронизации одновременно.
