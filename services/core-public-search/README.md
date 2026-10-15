# Dedicated Core public-search container — approval package (NOT APPLIED)

Code: Core worktree `/home/deploy/aa-core-public-search-wt`, branch `feature/torgatlas-core-public-search`, commit `737e2fd` (over `16880db` over the deployed `fc6dbce`).
Entry point `public_search_app:app` mounts only `POST /api/v1/public-search` (service token) and `GET /health`.

## Why a new container and not a restart of aa-data004-api-1
The running Core API image has no public-search route. A new container delivers the route with **no restart of aa-data004-api-1, no change of its
image/env/ports, no change of Docker networks' configuration, no secret of Core**. Rollback = remove one container (+ drop one DB role).
(Alternative, not recommended: rebuild and recreate aa-data004-api-1 with the extension — a shared-service restart; the Core compose files at
`/home/deploy/aa-a022-ops-wt/docker/compose/` pin a different image tag than the one running, so that path needs the Core owner's coordination first.)

## Approvals required (each is a shared production operation)
1. **DB role** (Core DB owner): `services/core-public-search/role.sql.template` — a SELECT-only login on 4 tables, read-only by default, 5 s statement timeout, 4 connections.
2. **Secrets** (owner): generate DB password and service token; the env file `/home/deploy/torgatlas-ops/core-public-search.env` (0600) holds `DATABASE_URL`
   and `PUBLIC_SEARCH_TOKEN_SHA256` (digest only); the token itself goes into `/home/deploy/torgatlas-ops/ai-search.env` as `AI_LOT_CORE_TOKEN`. Values are never printed or committed.
3. **Network membership** (owner): the new container joins the existing `aa-data004_default` (to reach PostgreSQL) and `torgatlas-ai_ta_ai_internal` (so ai-search can call it). No network is created or reconfigured.
4. **Data policy** (owner): Core contains ЕФРСБ and ГИС Торги lots that the live crawler has disabled; showing them is a separate decision. Legal review of platform offers is still open.

## Exact steps after approval
```
# 0. build the image (local, no registry)            cd /home/deploy/aa-core-public-search-wt/app/backend && docker build -f Dockerfile.data004 -t auction-data004:torgatlas-public-search-c13524f .
# 1. DB role (Core DB owner)                          psql ... -f <role.sql with the generated password>
# 2. env files (0600), see above
# 3. preflight (read-only)                            services/core-public-search/ops.sh preflight
# 4. start                                            services/core-public-search/ops.sh up && services/core-public-search/ops.sh verify
# 5. site daemon: add to ai-search.env                AI_LOT_CORE_URL=http://ai-core-search:8000/api/v1/public-search   AI_LOT_CORE_TOKEN=<token>   AI_LOT_REQUIRE_CORE=true
#    rebuild+recreate ONLY ai-search (new code)       AI_SEARCH_ENV_FILE=/home/deploy/torgatlas-ops/ai-search.env docker compose -p torgatlas-ai -f services/ai-search/compose.yml up -d --build --no-deps ai-search
# 6. public verification                              scripts/ai-live-captcha-smoke.mjs + the three owner scenarios (real clicks, desktop and mobile)
```
## Immediate disconnect / rollback
- Feature flag: remove `AI_LOT_CORE_URL`/`AI_LOT_CORE_TOKEN` and recreate ai-search (with `AI_LOT_REQUIRE_CORE=true` search then shows "temporarily unavailable"; it never silently falls back to the legacy engine).
- Container: `services/core-public-search/ops.sh down` (removes only this container). Role: `DROP OWNED BY torgatlas_public_search; DROP ROLE torgatlas_public_search;`
- Daemon image rollback: `docker tag torgatlas-ai-search:pre-core-ui torgatlas-ai-search:local` + previous env (see 16_AI_CORE_SEARCH.md).
