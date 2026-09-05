# История транспорта

Публичная карта читает снимки из PostGIS. Наполнение — отдельная студия, на главной странице входа нет.

На выбранную дату для каждого включённого вида берётся последний снимок с датой `<=` текущей.

## Запуск

Через Docker на `https://th.test` (сеть `proxy` и Traefik из `_local-infra`):

```bash
docker compose up --build -d
```

Карта: `https://th.test`  
Студия (не ссылается с карты): `https://th.test/edit`  
Локальный вход: `editor` / `editor` (см. `EDITOR_USERNAME` и `EDITOR_PASSWORD`).

Локально фронт с прокси на API:

```bash
docker compose up --build -d db api
npm install
npm run api
npm run dev
```
