# Worklog

---
Task ID: A-1
Agent: Explore
Date: 2025-06-14 (session date)
Task: Analyze venues/core/market/transfer layers of /home/z/funding-arb (RESEARCH ONLY, no code changes)

Scope analyzed:
- scripts/venues/ (base.py, http_util.py, binance.py, bitget.py, bybit.py, okx.py, hyperliquid.py, hyperliquid_funding.py, aster.py, aster_funding.py, lighter.py, lighter_funding.py, edgex.py, edgex_funding.py, dydx.py, dydx_funding.py)
- scripts/core/ (config.py, strategy_config.py, credentials.py, fee_providers.py, vip_fee_tiers.py, cross_interval_funding.py, notify.py, file_lock.py)
- scripts/market/ (parallel_fetch.py, funding_batch.py, futures_depth.py, price_oracle.py)
- scripts/transfer/ (chain_aliases.py, cross_venue_router.py, transfer_providers.py)
- Cross-referenced consumers: scripts/cli/scan_pure_futures_spreads.py, scripts/backtest/funding_providers.py, server/main.py + server/routes/settings.py

Key findings (summary):
1. Venue layer: Protocol-based `CexVenue` (structural typing, no inheritance); factory `get_venue()` in venues/__init__.py with lazy DEX imports. CEX adapters ~900-1050 LOC each with near-identical structure (duplicated execute_trades/place_buy/place_sell boilerplate ~4x). DEX adapters 330-620 LOC, futures-only, use Protocol defaults for spot/margin.
2. Auth: Binance/Aster/Bybit HMAC-SHA256 hex; Bitget/OKX HMAC-SHA256+base64 with passphrase; Hyperliquid wallet private key or trade-signer remote (monkey-patched SDK sign_inner); Lighter zk API key + account index; EdgeX EIP-712 trading key; dYdX Cosmos mnemonic + DYDX_ENABLE_LIVE=1 opt-in gate.
3. Funding fetch: `FundingProvider` duck-typed interface (fetch_all/fetch_current/fetch_since/fetch_interval_map); intervals vary (8h CEX, 4h EdgeX majors, 1h HL/Lighter/dYdX, per-symbol Aster via fundingInfo). Multi-layer TTL caching (60s meta, 120s snapshot, 3600s rules).
4. Cross-interval basis-blend math (core/cross_interval_funding.py): blended = (1−α)·(rate/interval) + α·(clamped_basis/interval), α = settle progress; spread = (short_hourly − long_hourly)·min(interval); net_edge = spread − taker fees; annual = spread·(24/eff_interval)·365.
5. Verified bug: BinanceSpotVenue.get_all_futures_tickers (scripts/venues/binance.py:170) passes an absolute URL as `path` to _api_call → malformed URL (BASE + full URL) → silently swallowed → always returns {}. Silent bulk-ticker failure on Binance.
6. Credentials: unified backend chain (keyring → systemd-creds → age → plaintext JSON) exists in core/credentials.py but is only consumed by the FastAPI server; venue adapters implement their own `_ensure_env()` reading only ~/.funding-arb/credentials.json (plaintext) + env — CLI paths bypass the secure backends.
7. Security notes: secrets live in os.environ process-wide; dYdX mnemonic in env; hyperliquid.py monkey-patches hl_signing.sign_inner globally (race risk if threaded); .env.local loaded at import time (side effect).
8. Market layer: ThreadPoolExecutor-based run_io_parallel (threads, not asyncio; optional per-batch timeout + cancel); depth pre-check via ±dev% window notional vs 3× trade size; price_oracle multi-source fallback (bitget→binance→okx→coinbase).
9. Transfer layer: canonical chain alias map (USDT-centric), per-venue TransferProvider (bitget/bybit/okx/binance) with ChainRoute/DepositAddress/WithdrawResult dataclasses, route ranking by total fee, dry_run-first execute_plan, deposit polling (poll_deposit_until, 15s interval, 600s timeout, 2% tolerance).

LOC per module counted (wc -l): venues=8,929 total (binance 1005, bitget 1036, bybit 877, okx 980, dydx 619, edgex 358, lighter 354, aster 329, hyperliquid 492 + funding modules); core=1,995; market=695; transfer=1,177.

No code was modified. Full structured report delivered in task response.

---
Task ID: A-3
Agent: Explore
Date: 2025-06-14 (session date)
Task: Analyze server/ (FastAPI backend) and web/ (Vue 3 frontend) of /home/z/funding-arb (RESEARCH ONLY, no code changes)

Scope analyzed:
- server/main.py, server/routes/{scanner,positions,backtest,settings}.py, server/requirements.txt
- web/: package.json, vite.config.ts, vercel.json, index.html, tsconfig, src/main.ts, src/App.vue, src/router/index.ts
- web/src/views/: Scanner.vue, Positions.vue, Backtest.vue, Docs.vue, CexConnection.vue, DexConnection.vue, StrategySettings.vue, FeeSettings.vue, AdvancedSettings.vue
- web/src/components/: DemoBanner.vue, DocArticleBody.vue, connection/{VenueConnectCard,VenueConnectGroupGrid,TestOrderModal}.vue
- web/src/composables/: useApi.ts, useDemoSnapshot.ts, wallet/{useWallet,useWalletTrade,useHyperliquidTrade,useDydxTrade}.ts
- web/src/constants/, web/src/content/docs/ (+articles), src/i18n.ts + locales (en/zh-CN/zh-TW), web/src-tauri/ (main.rs, tauri.conf.json, Cargo.toml)
- Build/run: start.sh, start.ps1, setup.sh, .github/workflows/{telegram-push,ci}.yml, scripts/notify/{telegram_push,snapshot_to_pages}.py (cross-refs)

Key findings (summary):
1. API surface: 4 routers under /api (scanner: status/opportunities/trigger/scan-all/recalc-fees; positions: list/get/open/close; backtest: run/history; settings: venues/strategy/fee-tiers/fees/credentials-status/wallet schema+status+connect+disconnect+balance/trading-mode) + WS /ws/events. NO authentication on any endpoint — security relies on 127.0.0.1 bind + localhost-only CORS list.
2. Background scanner loop (main.py _background_scanner_loop): warm pure at startup, carry/unified spawned concurrently, then poll every max(30, scan_interval_sec) with carry/unified refreshed every OTHER cycle; fire-and-forget task set with crash logging; per-strategy in-memory cache + _scanning_strategies re-entrancy guard; venue-set matching (`venues_mismatch`) so cached rows never misrepresent selected venues.
3. Server bridges to scripts/ purely via in-process imports (sys.path manipulation, no subprocess): cli.scan_pure_futures_spreads.scan_pure_futures_spreads, cli.scan_funding_arbitrage.scan_venue, backtest.unified_funding_pool.UnifiedFundingPool, execution.{pure_futures_executor,cross_venue_executor}, backtest.backtest_pure_futures_spread.run_backtest — all run in loop.run_in_executor (threads).
4. WebSocket: ConnectionManager fan-out broadcast("scanner.update"); client sends "ping" → "pong" (60s receive timeout as keepalive); frontend singleton WS with 30s ping + 3s reconnect + 200ms debounced apply in Scanner.vue.
5. Demo mode pipeline: GH Actions telegram-push.yml (hourly cron-job.org → workflow_dispatch) → snapshot_to_pages.py builds scanner-latest.json (pure+carry+unified slices) → committed to gh-pages orphan branch → Vercel static site fetches https://raw.githubusercontent.com/counterfactual5/funding-arb/gh-pages/scanner-latest.json at runtime with ?t=minute cache-bust, 5-min auto-refresh; demo detection = VITE_DEMO_MODE=1 | ?demo=1/0 | *.vercel.app host; useApi.request() short-circuits only known GET paths (scanner/opportunities, scanner/status).
6. Hyperliquid wallet flow: ethers.Wallet.createRandom() → sessionStorage("hl_agent_wallet") → ExchangeClient.approveAgent(agentAddress, name) signed by MetaMask EIP-712 → agent private key (loaded from sessionStorage) signs IOC market orders (price from L2 book ± slippage); closePosition uses reduce-only flag.
7. dYdX flow: Keplr enable(dydx-4) → per-order: REST account/sequence + block height + oracle price → manual Amino MsgCreateOrder (type "dydxprotocol/clob/MsgCreateOrder") → keplr.signAmino → POST /cosmos/tx/v1beta1/txs BROADCAST_MODE_SYNC. TODO in code: quantum conversion hardcoded 1e6; amino structure unvalidated.
8. Tauri: v1-style main.rs spawns `python3 -m uvicorn server.main:app --port 8787` as child, kills on window destroy; conf references externalBin binaries/python (sidecar NOT in repo); Cargo.toml pins tauri=1 while package.json uses @tauri-apps/cli v2 — version mismatch; CSP=null.
9. Security risks found: (a) wallet/connect POSTs raw API secrets over HTTP to server env (masked on read-back, session-scoped, not persisted — but no TLS by default); (b) settings/wallet/status exposes masked secrets (first4+last4 chars) — leaks key prefixes; (c) dYdX mnemonic + Hyperliquid private key stored in os.environ, visible in /proc; (d) no auth/rate-limit on /api — anyone on LAN when bound 0.0.0.0 can open/close positions or set credentials; (e) SPA fallback has path-traversal guard (is_relative_to) — good; (f) Telegram HTML properly escaped (_escape_html, 5 entities); (g) Hyperliquid env var naming inconsistency (HYPERLIQUID_API_KEY/SECRET in settings vs HYPERLIQUID_WALLET_ADDRESS/PRIVATE_KEY in venues/hyperliquid.py vs HYPERLIQUID_TESTNET vs HYPERLIQUID_NETWORK).
10. i18n: vue-i18n legacy:false, 3 locales (en/zh-CN/zh-TW) x 405 lines each, localStorage persistence; in-app docs = 9 articles with sectionsByLocale, rendered via typed DocBlock union (p/formula/ul/table/callout) — no v-html, XSS-safe; synced to docs/ markdown via export_docs_md.mts + gen_zh_tw_docs.py with CI check_docs_sync.sh.
11. Frontend: Naive UI + echarts + pinia (installed but effectively unused — state is module-level singletons/composables); only Scanner route eager-loaded, rest lazy; wallet-trade module (ethers+@nktkas/hyperliquid) lazy-imported from Scanner.
12. start.sh/start.ps1: no venv creation (global pip install; README/.venv references inconsistent); browser mode auto-builds web/dist then `python server/main.py --no-reload`; --desktop runs `npm run tauri dev`; --api-only runs uvicorn on 127.0.0.1:8787.

LOC counted (wc -l): server=2,771 (main 292, scanner 745, settings 978, positions 510, backtest 246); web/src ts+vue=12,663 (views 3,690 incl Scanner.vue 1,643; composables 1,469 incl wallet 1,068; content/docs articles 4,427; locales 1,215 JSON); src-tauri=71 Rust + 49 conf.

No code was modified. Full structured report delivered in task response.

---
Task ID: A-4
Agent: Explore
Date: 2025-06-14 (session date)
Task: Analyze test suite, documentation, CI/CD & deployment, project meta files, repo hygiene of /home/z/funding-arb (RESEARCH ONLY, no code changes)

Scope analyzed:
- scripts/tests/ — all 32 files (31 test_*.py + __init__.py, 7,159 LOC total); ran `pytest --collect-only` (361 tests) and full suite (361 passed in 6.14s, fully hermetic)
- docs/en/*.md (9 articles + README), docs/README.md; structural mirror check of docs/zh-CN and docs/zh-TW (identical anchors/line counts; formulas kept in English)
- .github/workflows/{ci.yml, telegram-push.yml}, .github/ISSUE_TEMPLATE/{config.yml, bug_report.md, feature_request.md}
- scripts/tools/ — verify_{edgex,hyperliquid,lighter,dydx}_live.py, check_docs_sync.sh, gen_zh_tw_docs.py, export_docs_md.mts
- Meta: LICENSE, SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md, plans/{dydx-trading-plan.md, edgex-integration-plan.md}, .env.example, .gitignore, README.md, requirements.txt, templates/*.json
- Hygiene: git ls-files scan for data/env/pem/jsonl, secret-pattern greps (AKIA/PEM/0x-hex-40+/key=value literals), git history deleted-file scan (106 commits)

Key findings (summary):
1. Test suite: 361 test functions across 31 files (confirmed by both grep `def test_` count and pytest --collect-only). NO conftest.py — each file bootstraps sys.path with `ROOT = Path(__file__).resolve().parent.parent`. Mocking = 3 patterns: (a) hand-rolled Fake* venue doubles (FakeFuturesVenue, FakeHyperliquidVenue, FakeCexVenue, FakeVenue, FakeFP) injected as long_venue/short_venue kwargs; (b) unittest.mock.patch/monkeypatch of module-level HTTP funcs (http_get_json, _api_call, _post, urlopen) with inline JSON fixture dicts; (c) MagicMock SDK doubles + stubbed sys.modules["edgex_sdk"]. Largest files: test_telegram_push.py (48), test_hyperliquid_integration.py (24), test_dydx_venue.py (23), test_pure_futures_executor.py (21), test_pure_futures_watcher.py (19).
2. Strongest coverage: pure-futures executor (rollback/naked/abort state machine, margin buffer, spot->futures shortfall transfer), DEX venue adapters (all 5: symbol mapping, precision rules, side/reduce-only mapping, dry-run vs live, SDK error paths, registration), cross-interval basis-blend math, settle-mismatch planner + backtest settlement counting (hand-verified funding math to 1e-9), Telegram digest formatting/chunking/dedup, notify dedup/throttle, scanner thresholds (real_edge/basis_risk_level), fee policy (HL staking+referral discounts, idempotent parse regression), credentials env-precedence, reverse-margin borrow/repay order-body tests for Bitget/Bybit/OKX.
3. Weak/untested areas: NO direct tests for binance.py/bitget.py/bybit.py/okx.py venue classes beyond reverse-margin _api_call patching (spot legs, funding fetch, ticker, rules untested); server/routes/{positions,settings,backtest}.py and server/main.py WS loop untested; core/{config,file_lock}.py, market/{price_oracle,parallel_fetch}.py, backtest/{funding_cache,borrow_providers}.py, transfer_providers.py untested; CLI mains (pure_futures_trade, orchestrate_funding, scan_funding_arbitrage, scan_unified_funding, setup_credentials) untested; cross_venue_executor untested directly. test_run_pure_futures.py has only 1 shape test. Docs claim "245+ tests" — stale (actual 361).
4. Docs math: funding-basics (annual_pct ≈ |rate_pct|×(24/interval_h)×365; basis_pct=(mark−index)/index×100%), cross-interval (blended_hourly=(1−p)·rate_hourly+p·basis_hourly; spread=(short_blended−long_blended)×min(intervals); basis caps ±0.3% CEX / ±0.5% HL/default; progress=(now−last)/(next−last)), fees-and-edge (net_edge=spread−open takers; real_edge=net_edge−mark_spread; round_trip=fee×2; all_in=net_edge−transfer_fee), pure-futures (short-higher/long-lower rule, forward/reverse direction labels), cash-and-carry (borrow_per_period=annual/(365×24)×interval_h), unified-carry (cross-venue routing + transfer cost amortization), serverless-pipeline (GH Actions→gh-pages orphan→raw.githubusercontent→Vercel, 5-min edge TTL).
5. CI: ci.yml = 2 jobs: `test` (matrix ubuntu+windows, py3.12, installs server/requirements+requests+pytest — venue SDKs intentionally omitted; Windows included to keep fcntl/msvcrt file-lock path green) + `docs-sync` (node 20, runs check_docs_sync.sh which regenerates docs/ and fails if git-dirty). telegram-push.yml = workflow_dispatch ONLY (hourly cadence driven by external cron-job.org POST because GitHub native cron unreliable for low-activity repos); inputs source(manual|cron)/min_edge/top_n/include_dex; cron source → --skip-if-unchanged anti-spam (diff vs previous gh-pages snapshot, 🆕/📈/📉 markers); permissions contents:write; concurrency group tg-funding-push cancel-in-progress; 4 steps: fetch prev snapshot → telegram_push.py (TELEGRAM_BOT_TOKEN/CHAT_ID secrets) → snapshot_to_pages.py --top 30 → publish to gh-pages (orphan or checkout -B; wipe worktree; commit scanner-latest.json + README + stub web/vercel.json deploymentEnabled:false; [skip ci]) → failure alert via Telegram curl. Secrets used: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GITHUB_TOKEN (in-built).
6. verify_*_live.py: 4 standalone pre-live smoke tools (~170-300 LOC each, same pattern: --base, --read-account, --dry-trade, --live-trade, --json; exit 0/1). EdgeX checks public getMetaData/getTicker then optional V2-SDK account reads and 0.01-size open_long; Hyperliquid additionally checks sibling ../hyperliquid repo + masks key in output; Lighter checks lighter-sdk import; dydx checks dydx-v4-client + masks mnemonic (first2/last2 words), supports --network testnet. None place live orders unless --live-trade.
7. Meta: MIT License (c) 2026 counterfactual5. SECURITY.md: pre-1.0 policy, private advisory/email reporting, 72h ack, explicit in-scope list (secret leakage, unintended trades, race conditions) + user hardening checklist (trade-only keys, no withdrawal, keyring/systemd-creds). CONTRIBUTING.md: trading-specific rules (never commit keys, testnet-first, conventional commits, venue integration 6-step checklist). COC: Contributor Covenant 2.0. Issue templates: bug/feature + config.yml with blank issues disabled and security redirect. plans/dydx-trading-plan.md (zh): dYdX v4 live trading plan — Cosmos protobuf order builder, quantums=size×step_base_quantums/stepSize, subticks=price/tickSize×subticksPerTick, GTB=current+20, side mapping, testnet rehearsal checklist — scan+dry-run done, live submission pending (matches DYDX_ENABLE_LIVE gate). plans/edgex-integration-plan.md (zh): EdgeX phased plan — Phase 1+2 complete 2026-06-12; key learnings: getTicker data is single-element list, getDepth uses object levels, taker=0.038% measured, no batch ticker + Cloudflare 429/ban → EDGEX_SCAN_BASES whitelist (~30), workers=3, 60s snapshot cache; no public funding history → _NO_PUBLIC_HISTORY set.
8. Hygiene: CLEAN. No data/, runs/, cache/, *.jsonl, .env, *.pem tracked (all gitignored); only .env.example (fully commented placeholders). No AKIA/AWS keys, no PEM blocks, no real 0x hex keys (only zero-address placeholder in fee_providers.py:176), no hardcoded key=value literals, templates carry dry_run:true with no credentials. git history (106 commits) deleted-files scan shows only stale docs/modules — no secret-bearing files ever committed. Minor nit: docs/en/overview.md testing section understates count ("245+"); worklog dates in plans say 2026 (fictional future dates).

No code was modified. Full structured report delivered in task response.
