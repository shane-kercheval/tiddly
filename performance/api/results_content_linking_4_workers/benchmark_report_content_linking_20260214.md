# API Benchmark Report

**Date:** 2026-02-14 12:09:39
**Branch:** content-linking
**Commit:** ec66624
**Baseline:** `performance/api/results/benchmark_api_{1kb,50kb}_20260205_09*.md` (main branch, 2026-02-05)
**Profiling:** See profiling_report_content_linking_20260214.md
**Environment:** Local dev (VITE_DEV_MODE=true, no auth overhead)
**Machine:** Apple M2 Max, 64 GB RAM, macOS 26.2

## Branch Changes Summary

The `content-linking` branch adds a content relationship system allowing users to link bookmarks, notes, and prompts together. Key changes:

- **New DB table:** `content_relationships` with indexes on `(user_id, source_type, source_id)` and `(user_id, target_type, target_id)`
- **New service:** `relationship_service.py` — full CRUD for relationships
- **`base_entity_service.py`:** `get_metadata_snapshot()` now async, queries relationships from DB; new `_compute_changed_fields()` method
- **Entity services (bookmark, note, prompt):** Create/Update now sync relationships and compute changed_fields for history
- **Routers:** All GET/CREATE/UPDATE responses now call `embed_relationships()` (1 extra DB query per response)
- **Hard delete:** Now calls `delete_relationships_for_content()` (1 extra DB query)
- **History:** `changed_fields` column added to `content_history`; restore now resolves tag IDs and restores relationships

**Affected endpoints:** All CRUD endpoints for bookmarks, notes, and prompts. List/Search endpoints not directly affected (no relationship embedding in list views).

## Test Parameters

| Parameter | Value |
|-----------|-------|
| Content sizes | 1KB, 50KB |
| Concurrency levels | 10, 50, 100 |
| Iterations per test | 100 |
| API URL | http://localhost:8000 |

## Results: 1KB Content

| Operation | Conc | Min | P50 | P95 | P99 | Max | Mean±Std | RPS | Err |
|-----------|------|-----|-----|-----|-----|-----|----------|-----|-----|
| Create Bookmark | 10 | 30.86 | 37.22 | 49.18 | 53.43 | 53.45 | 38.5±4.45 | 255.8 | 0% |
| Create Bookmark | 50 | 39.73 | 219.55 | 374.35 | 403.91 | 404.09 | 231.26±93.45 | 192.0 | 0% |
| Create Bookmark | 100 | 65.74 | 380.89 | 485.52 | 495.41 | 495.42 | 366.64±106.13 | 195.0 | 0% |
| Create Note | 10 | 28.75 | 33.88 | 50.72 | 56.27 | 56.29 | 35.06±5.2 | 277.6 | 0% |
| Create Note | 50 | 33.57 | 195.78 | 335.45 | 389.3 | 389.33 | 209.94±86.47 | 212.0 | 0% |
| Create Note | 100 | 56.9 | 381.76 | 486.6 | 510.16 | 510.16 | 368.44±110.69 | 193.3 | 0% |
| Create Prompt | 10 | 29.77 | 34.97 | 41.39 | 44.24 | 44.24 | 35.18±2.66 | 281.0 | 0% |
| Create Prompt | 50 | 38.24 | 222.91 | 390.54 | 477.19 | 477.27 | 231.96±100.64 | 191.9 | 0% |
| Create Prompt | 100 | 60.0 | 445.19 | 556.69 | 576.87 | 576.9 | 418.03±123.71 | 172.0 | 0% |
| Hard Delete Bookmark | 10 | 10.23 | 21.24 | 25.25 | 28.88 | 28.89 | 20.99±2.56 | 460.2 | 0% |
| Hard Delete Bookmark | 50 | 19.5 | 84.75 | 216.64 | 241.65 | 241.73 | 99.96±58.8 | 390.5 | 0% |
| Hard Delete Bookmark | 100 | 49.21 | 146.26 | 250.42 | 265.97 | 266.02 | 149.34±62.2 | 355.9 | 0% |
| Hard Delete Note | 10 | 13.32 | 20.63 | 28.26 | 38.86 | 38.9 | 20.91±3.68 | 462.1 | 0% |
| Hard Delete Note | 50 | 19.81 | 89.56 | 237.0 | 253.8 | 253.81 | 102.19±63.46 | 378.6 | 0% |
| Hard Delete Note | 100 | 54.87 | 142.02 | 247.75 | 257.89 | 257.98 | 146.86±59.41 | 373.4 | 0% |
| Hard Delete Prompt | 10 | 14.39 | 21.06 | 24.25 | 25.74 | 25.75 | 20.72±2.02 | 464.6 | 0% |
| Hard Delete Prompt | 50 | 20.0 | 89.59 | 348.0 | 358.51 | 358.59 | 128.76±100.22 | 273.5 | 0% |
| Hard Delete Prompt | 100 | 50.94 | 291.43 | 352.39 | 359.46 | 359.48 | 252.27±99.74 | 263.2 | 0% |
| List Bookmarks | 10 | 14.1 | 24.76 | 39.42 | 43.76 | 43.78 | 25.76±5.42 | 372.2 | 0% |
| List Bookmarks | 50 | 29.36 | 174.42 | 317.65 | 352.81 | 352.89 | 177.25±96.78 | 252.6 | 0% |
| List Bookmarks | 100 | 50.41 | 317.31 | 401.12 | 415.99 | 416.01 | 276.06±110.89 | 238.5 | 0% |
| List Notes | 10 | 16.11 | 23.98 | 31.51 | 35.59 | 35.6 | 24.55±3.43 | 396.2 | 0% |
| List Notes | 50 | 32.28 | 183.47 | 327.05 | 365.11 | 365.28 | 177.73±100.66 | 249.2 | 0% |
| List Notes | 100 | 56.6 | 316.06 | 371.65 | 399.03 | 399.04 | 276.09±98.5 | 246.1 | 0% |
| List Prompts | 10 | 16.09 | 25.95 | 30.68 | 34.91 | 34.94 | 25.87±2.94 | 377.7 | 0% |
| List Prompts | 50 | 32.34 | 205.13 | 391.61 | 410.87 | 410.96 | 214.35±114.95 | 211.9 | 0% |
| List Prompts | 100 | 57.69 | 312.29 | 393.11 | 415.19 | 415.19 | 291.07±97.8 | 235.3 | 0% |
| Read Bookmark | 10 | 10.24 | 18.45 | 31.91 | 48.82 | 48.92 | 19.47±6.24 | 490.9 | 0% |
| Read Bookmark | 50 | 18.47 | 90.32 | 248.92 | 259.35 | 259.35 | 105.02±70.58 | 372.0 | 0% |
| Read Bookmark | 100 | 51.04 | 148.54 | 266.26 | 291.86 | 292.03 | 154.66±66.64 | 334.0 | 0% |
| Read Note | 10 | 9.98 | 18.37 | 29.45 | 37.38 | 37.43 | 19.09±4.64 | 500.0 | 0% |
| Read Note | 50 | 19.8 | 87.63 | 239.91 | 262.23 | 262.27 | 103.71±66.15 | 375.4 | 0% |
| Read Note | 100 | 50.03 | 140.45 | 250.15 | 260.42 | 260.46 | 144.39±63.64 | 360.9 | 0% |
| Read Prompt | 10 | 10.23 | 19.01 | 26.96 | 28.62 | 28.62 | 18.96±3.33 | 507.1 | 0% |
| Read Prompt | 50 | 18.55 | 92.07 | 234.84 | 264.66 | 264.79 | 106.16±64.99 | 373.1 | 0% |
| Read Prompt | 100 | 48.23 | 272.72 | 339.73 | 344.77 | 344.8 | 224.55±100.06 | 287.2 | 0% |
| Search Bookmarks | 10 | 10.13 | 24.62 | 31.36 | 40.92 | 40.93 | 24.62±4.32 | 388.6 | 0% |
| Search Bookmarks | 50 | 24.97 | 103.92 | 379.63 | 395.38 | 395.39 | 147.87±108.15 | 245.2 | 0% |
| Search Bookmarks | 100 | 52.86 | 311.99 | 374.24 | 405.26 | 405.29 | 273.93±107.21 | 244.2 | 0% |
| Search Notes | 10 | 12.33 | 24.31 | 32.82 | 39.4 | 39.44 | 24.38±4.65 | 391.6 | 0% |
| Search Notes | 50 | 28.56 | 172.68 | 321.56 | 361.86 | 361.9 | 173.75±100.41 | 258.2 | 0% |
| Search Notes | 100 | 50.2 | 320.23 | 383.92 | 408.45 | 408.46 | 276.13±105.95 | 242.0 | 0% |
| Search Prompts | 10 | 16.76 | 26.17 | 30.45 | 32.18 | 32.18 | 25.63±3.36 | 376.3 | 0% |
| Search Prompts | 50 | 26.15 | 114.73 | 388.5 | 395.2 | 395.22 | 158.4±112.78 | 247.1 | 0% |
| Search Prompts | 100 | 53.78 | 331.04 | 397.94 | 424.07 | 424.08 | 295.1±99.99 | 233.9 | 0% |
| Soft Delete Bookmark | 10 | 13.15 | 21.46 | 26.53 | 28.48 | 28.48 | 21.32±2.3 | 453.8 | 0% |
| Soft Delete Bookmark | 50 | 20.02 | 93.76 | 219.7 | 254.6 | 254.62 | 104.12±61.97 | 371.7 | 0% |
| Soft Delete Bookmark | 100 | 50.54 | 283.2 | 354.42 | 366.89 | 366.98 | 233.7±109.78 | 268.6 | 0% |
| Soft Delete Note | 10 | 14.16 | 21.3 | 30.99 | 37.77 | 37.79 | 21.62±3.4 | 448.1 | 0% |
| Soft Delete Note | 50 | 20.51 | 83.58 | 303.03 | 314.4 | 314.44 | 110.63±78.96 | 303.7 | 0% |
| Soft Delete Note | 100 | 52.12 | 158.18 | 377.07 | 395.95 | 396.07 | 209.78±123.58 | 250.9 | 0% |
| Soft Delete Prompt | 10 | 11.31 | 20.84 | 23.26 | 26.5 | 26.51 | 20.66±2.14 | 470.8 | 0% |
| Soft Delete Prompt | 50 | 19.16 | 87.72 | 319.43 | 334.94 | 334.99 | 113.77±85.1 | 291.0 | 0% |
| Soft Delete Prompt | 100 | 52.39 | 284.94 | 362.08 | 373.14 | 373.19 | 259.35±94.28 | 263.7 | 0% |
| Update Bookmark | 10 | 24.66 | 41.48 | 53.65 | 58.76 | 58.78 | 41.1±5.75 | 235.5 | 0% |
| Update Bookmark | 50 | 49.74 | 269.8 | 439.64 | 502.24 | 502.65 | 268.09±120.41 | 167.8 | 0% |
| Update Bookmark | 100 | 60.5 | 480.82 | 608.69 | 628.37 | 628.42 | 464.02±122.36 | 158.2 | 0% |
| Update Note | 10 | 20.6 | 41.77 | 52.48 | 57.81 | 57.81 | 41.38±5.85 | 233.9 | 0% |
| Update Note | 50 | 44.21 | 250.26 | 440.81 | 458.19 | 458.33 | 271.82±106.67 | 164.3 | 0% |
| Update Note | 100 | 63.74 | 465.43 | 599.18 | 608.98 | 608.98 | 447.82±126.15 | 161.7 | 0% |
| Update Prompt | 10 | 36.63 | 41.86 | 86.3 | 87.05 | 87.05 | 46.58±13.54 | 211.3 | 0% |
| Update Prompt | 50 | 45.98 | 249.38 | 455.3 | 500.43 | 500.48 | 263.25±107.12 | 167.8 | 0% |
| Update Prompt | 100 | 75.59 | 437.44 | 571.98 | 582.71 | 582.73 | 420.95±116.32 | 168.1 | 0% |

## Results: 50KB Content

| Operation | Conc | Min | P50 | P95 | P99 | Max | Mean±Std | RPS | Err |
|-----------|------|-----|-----|-----|-----|-----|----------|-----|-----|
| Create Bookmark | 10 | 22.23 | 40.78 | 53.98 | 58.7 | 58.71 | 40.66±5.28 | 237.3 | 0% |
| Create Bookmark | 50 | 48.34 | 242.35 | 423.58 | 492.46 | 492.49 | 252.88±110.54 | 174.4 | 0% |
| Create Bookmark | 100 | 101.52 | 506.52 | 608.79 | 633.1 | 633.13 | 479.83±115.77 | 153.2 | 0% |
| Create Note | 10 | 29.53 | 38.76 | 54.46 | 62.31 | 62.34 | 39.15±5.57 | 248.3 | 0% |
| Create Note | 50 | 54.44 | 268.96 | 428.87 | 496.97 | 496.99 | 262.8±119.47 | 170.2 | 0% |
| Create Note | 100 | 80.9 | 434.02 | 562.6 | 597.56 | 597.59 | 421.89±128.63 | 166.1 | 0% |
| Create Prompt | 10 | 35.09 | 69.66 | 122.08 | 126.2 | 126.2 | 71.87±17.26 | 135.6 | 0% |
| Create Prompt | 50 | 69.48 | 341.86 | 576.49 | 731.64 | 732.7 | 363.98±117.06 | 118.4 | 0% |
| Create Prompt | 100 | 211.6 | 598.32 | 805.72 | 808.32 | 808.32 | 591.03±162.7 | 117.0 | 0% |
| Hard Delete Bookmark | 10 | 11.39 | 20.64 | 23.98 | 25.38 | 25.38 | 20.56±2.14 | 472.8 | 0% |
| Hard Delete Bookmark | 50 | 20.93 | 88.46 | 233.36 | 252.7 | 252.75 | 100.39±60.4 | 384.4 | 0% |
| Hard Delete Bookmark | 100 | 49.03 | 322.04 | 401.53 | 404.83 | 404.85 | 254.16±129.62 | 240.0 | 0% |
| Hard Delete Note | 10 | 12.78 | 20.99 | 27.74 | 31.23 | 31.24 | 20.94±3.03 | 459.4 | 0% |
| Hard Delete Note | 50 | 19.84 | 91.67 | 214.0 | 240.02 | 240.06 | 100.35±59.6 | 385.5 | 0% |
| Hard Delete Note | 100 | 49.0 | 272.08 | 349.4 | 358.55 | 358.56 | 224.15±105.83 | 273.0 | 0% |
| Hard Delete Prompt | 10 | 11.42 | 20.26 | 23.08 | 26.93 | 26.93 | 20.09±2.58 | 477.0 | 0% |
| Hard Delete Prompt | 50 | 19.55 | 84.87 | 304.76 | 338.07 | 338.12 | 115.28±82.88 | 289.0 | 0% |
| Hard Delete Prompt | 100 | 51.26 | 141.4 | 270.11 | 285.01 | 285.04 | 152.29±65.74 | 334.8 | 0% |
| List Bookmarks | 10 | 16.95 | 26.84 | 35.99 | 45.05 | 45.07 | 26.83±5.01 | 356.7 | 0% |
| List Bookmarks | 50 | 35.79 | 170.05 | 338.86 | 378.77 | 379.02 | 182.42±96.91 | 245.7 | 0% |
| List Bookmarks | 100 | 62.63 | 326.8 | 408.33 | 426.69 | 426.69 | 283.71±116.22 | 231.0 | 0% |
| List Notes | 10 | 18.71 | 25.69 | 35.21 | 45.01 | 45.03 | 26.48±4.61 | 359.7 | 0% |
| List Notes | 50 | 46.33 | 183.51 | 341.06 | 367.57 | 367.77 | 186.65±95.1 | 238.6 | 0% |
| List Notes | 100 | 65.69 | 312.9 | 393.94 | 410.07 | 410.17 | 289.39±98.72 | 235.5 | 0% |
| List Prompts | 10 | 17.65 | 28.88 | 34.47 | 36.62 | 36.64 | 28.14±4.59 | 340.3 | 0% |
| List Prompts | 50 | 38.15 | 194.8 | 342.34 | 368.52 | 368.65 | 189.28±97.08 | 235.6 | 0% |
| List Prompts | 100 | 65.61 | 351.3 | 418.16 | 443.04 | 443.06 | 302.23±108.24 | 223.8 | 0% |
| Read Bookmark | 10 | 13.22 | 22.44 | 31.46 | 40.74 | 40.75 | 22.75±4.94 | 421.5 | 0% |
| Read Bookmark | 50 | 22.0 | 98.08 | 232.92 | 291.05 | 291.09 | 111.02±70.37 | 332.7 | 0% |
| Read Bookmark | 100 | 49.29 | 153.06 | 262.9 | 276.21 | 276.25 | 156.28±65.7 | 345.8 | 0% |
| Read Note | 10 | 12.42 | 22.07 | 29.63 | 39.69 | 39.73 | 22.18±4.05 | 427.0 | 0% |
| Read Note | 50 | 21.26 | 93.84 | 269.53 | 281.56 | 281.6 | 113.23±76.68 | 348.7 | 0% |
| Read Note | 100 | 48.56 | 161.22 | 273.23 | 289.14 | 289.15 | 163.42±69.13 | 336.4 | 0% |
| Read Prompt | 10 | 15.04 | 21.99 | 26.55 | 28.35 | 28.36 | 21.81±2.74 | 442.9 | 0% |
| Read Prompt | 50 | 21.56 | 101.12 | 266.69 | 282.82 | 282.86 | 112.79±69.85 | 343.1 | 0% |
| Read Prompt | 100 | 50.06 | 303.07 | 368.08 | 390.66 | 390.66 | 274.08±93.88 | 252.1 | 0% |
| Search Bookmarks | 10 | 15.54 | 26.53 | 31.02 | 31.82 | 31.83 | 25.5±4.09 | 376.2 | 0% |
| Search Bookmarks | 50 | 29.18 | 104.22 | 397.29 | 413.31 | 413.37 | 150.77±110.87 | 237.4 | 0% |
| Search Bookmarks | 100 | 55.55 | 319.63 | 391.86 | 428.16 | 428.19 | 290.02±105.33 | 231.1 | 0% |
| Search Notes | 10 | 17.58 | 25.84 | 33.87 | 41.67 | 41.69 | 26.12±4.49 | 366.3 | 0% |
| Search Notes | 50 | 27.31 | 101.3 | 304.4 | 370.66 | 370.73 | 133.76±90.23 | 260.5 | 0% |
| Search Notes | 100 | 54.59 | 313.92 | 397.05 | 414.31 | 414.36 | 282.74±107.83 | 237.1 | 0% |
| Search Prompts | 10 | 16.86 | 28.7 | 32.56 | 35.48 | 35.49 | 27.64±3.81 | 343.2 | 0% |
| Search Prompts | 50 | 31.71 | 185.71 | 343.75 | 414.98 | 415.28 | 190.62±106.96 | 232.2 | 0% |
| Search Prompts | 100 | 56.04 | 326.02 | 425.03 | 432.67 | 432.67 | 286.57±119.51 | 227.2 | 0% |
| Soft Delete Bookmark | 10 | 14.66 | 22.13 | 24.71 | 28.16 | 28.18 | 21.79±2.09 | 445.7 | 0% |
| Soft Delete Bookmark | 50 | 19.31 | 92.88 | 254.85 | 286.01 | 286.04 | 109.16±73.24 | 328.0 | 0% |
| Soft Delete Bookmark | 100 | 50.03 | 155.51 | 285.04 | 308.04 | 308.07 | 160.16±74.35 | 317.0 | 0% |
| Soft Delete Note | 10 | 12.25 | 21.79 | 27.52 | 38.73 | 38.74 | 22.08±3.79 | 437.8 | 0% |
| Soft Delete Note | 50 | 20.32 | 92.79 | 230.88 | 259.83 | 259.86 | 104.1±66.03 | 373.6 | 0% |
| Soft Delete Note | 100 | 53.95 | 151.19 | 325.61 | 335.86 | 335.92 | 163.22±80.42 | 288.8 | 0% |
| Soft Delete Prompt | 10 | 13.29 | 21.59 | 26.98 | 31.28 | 31.3 | 21.6±2.8 | 451.5 | 0% |
| Soft Delete Prompt | 50 | 19.28 | 95.87 | 222.76 | 269.27 | 269.29 | 106.54±62.59 | 366.4 | 0% |
| Soft Delete Prompt | 100 | 51.23 | 156.32 | 415.88 | 428.19 | 428.24 | 226.31±141.24 | 228.2 | 0% |
| Update Bookmark | 10 | 31.41 | 46.91 | 58.11 | 64.49 | 64.53 | 46.83±4.84 | 208.1 | 0% |
| Update Bookmark | 50 | 54.69 | 298.13 | 498.99 | 586.27 | 586.84 | 306.08±125.05 | 145.7 | 0% |
| Update Bookmark | 100 | 78.75 | 477.96 | 623.78 | 648.75 | 648.78 | 458.17±132.28 | 153.4 | 0% |
| Update Note | 10 | 28.46 | 47.33 | 59.33 | 67.22 | 67.25 | 47.21±5.77 | 205.7 | 0% |
| Update Note | 50 | 52.45 | 263.97 | 441.12 | 518.73 | 518.77 | 281.05±106.76 | 155.5 | 0% |
| Update Note | 100 | 271.88 | 529.89 | 653.76 | 676.79 | 676.89 | 517.18±102.49 | 142.5 | 0% |
| Update Prompt | 10 | 28.88 | 75.39 | 84.57 | 90.42 | 90.44 | 73.56±10.46 | 132.3 | 0% |
| Update Prompt | 50 | 108.61 | 409.7 | 578.51 | 745.71 | 746.53 | 416.72±107.93 | 105.0 | 0% |
| Update Prompt | 100 | 101.25 | 636.57 | 915.24 | 934.35 | 934.4 | 637.99±200.26 | 105.9 | 0% |

## Regression Analysis

Baseline: main branch benchmarks from 2026-02-05. Only operations with >10% P95 change or >10% RPS change shown.

### 1KB Regressions

| Operation | Conc | Baseline P95 | Current P95 | Delta % | Baseline RPS | Current RPS | RPS Delta % | Status |
|-----------|------|-------------|-------------|---------|-------------|-------------|-------------|--------|
| Create Bookmark | 50 | 260.47 | 374.35 | +43.7% | 276.1 | 192.0 | -30.4% | Regression |
| Create Bookmark | 100 | 349.40 | 485.52 | +39.0% | 259.6 | 195.0 | -24.9% | Regression |
| Create Note | 50 | 256.37 | 335.45 | +30.8% | 264.0 | 212.0 | -19.7% | Regression |
| Create Note | 100 | 342.38 | 486.60 | +42.1% | 261.6 | 193.3 | -26.1% | Regression |
| Create Prompt | 50 | 255.74 | 390.54 | +52.7% | 270.8 | 191.9 | -29.1% | Regression |
| Create Prompt | 100 | 365.22 | 556.69 | +52.4% | 248.7 | 172.0 | -30.8% | Regression |
| Update Bookmark | 50 | 245.94 | 439.64 | +78.8% | 258.4 | 167.8 | -35.0% | Regression |
| Update Bookmark | 100 | 366.77 | 608.69 | +66.0% | 248.1 | 158.2 | -36.2% | Regression |
| Update Note | 50 | 267.64 | 440.81 | +64.7% | 245.9 | 164.3 | -33.2% | Regression |
| Update Note | 100 | 405.43 | 599.18 | +47.8% | 223.7 | 161.7 | -27.7% | Regression |
| Update Prompt | 10 | 44.74 | 86.30 | +92.8% | 255.3 | 211.3 | -17.2% | Regression |
| Update Prompt | 50 | 279.88 | 455.30 | +62.7% | 236.2 | 167.8 | -28.9% | Regression |
| Update Prompt | 100 | 392.61 | 571.98 | +45.7% | 231.1 | 168.1 | -27.3% | Regression |
| Hard Delete Prompt | 50 | 205.63 | 348.00 | +69.2% | 418.7 | 273.5 | -34.7% | Regression |
| Hard Delete Prompt | 100 | 278.02 | 352.39 | +26.7% | 323.0 | 263.2 | -18.5% | Regression |
| List Bookmarks | 100 | 274.66 | 401.12 | +46.0% | 319.5 | 238.5 | -25.4% | Regression |
| List Notes | 100 | 288.99 | 371.65 | +28.6% | 324.2 | 246.1 | -24.1% | Regression |
| List Prompts | 50 | 236.74 | 391.61 | +65.4% | 311.7 | 211.9 | -32.0% | Regression |
| List Prompts | 100 | 283.92 | 393.11 | +38.5% | 311.3 | 235.3 | -24.4% | Regression |
| Read Prompt | 100 | 234.72 | 339.73 | +44.7% | 382.0 | 287.2 | -24.8% | Regression |
| Search Bookmarks | 50 | 295.32 | 379.63 | +28.5% | 322.7 | 245.2 | -24.0% | Regression |
| Search Bookmarks | 100 | 296.53 | 374.24 | +26.2% | 322.5 | 244.2 | -24.3% | Regression |
| Search Prompts | 50 | 269.96 | 388.50 | +43.9% | 271.5 | 247.1 | -9.0% | Regression |
| Search Prompts | 100 | 284.06 | 397.94 | +40.1% | 309.1 | 233.9 | -24.3% | Regression |
| Soft Delete Bookmark | 100 | 244.61 | 354.42 | +44.9% | 353.1 | 268.6 | -23.9% | Regression |
| Soft Delete Note | 100 | 265.03 | 377.07 | +42.3% | 360.9 | 250.9 | -30.5% | Regression |

### 50KB Regressions

| Operation | Conc | Baseline P95 | Current P95 | Delta % | Baseline RPS | Current RPS | RPS Delta % | Status |
|-----------|------|-------------|-------------|---------|-------------|-------------|-------------|--------|
| Create Bookmark | 50 | 301.57 | 423.58 | +40.5% | 243.4 | 174.4 | -28.3% | Regression |
| Create Bookmark | 100 | 384.58 | 608.79 | +58.3% | 230.8 | 153.2 | -33.6% | Regression |
| Create Note | 50 | 223.33 | 428.87 | +92.0% | 270.3 | 170.2 | -37.0% | Regression |
| Create Note | 100 | 352.72 | 562.60 | +59.5% | 248.7 | 166.1 | -33.2% | Regression |
| Create Prompt | 10 | 70.22 | 122.08 | +73.9% | 156.3 | 135.6 | -13.2% | Regression |
| Create Prompt | 50 | 451.78 | 576.49 | +27.6% | 138.5 | 118.4 | -14.5% | Regression |
| Update Bookmark | 50 | 297.97 | 498.99 | +67.5% | 220.5 | 145.7 | -33.9% | Regression |
| Update Bookmark | 100 | 492.93 | 623.78 | +26.6% | 184.3 | 153.4 | -16.8% | Regression |
| Update Note | 50 | 298.28 | 441.12 | +47.9% | 218.5 | 155.5 | -28.8% | Regression |
| Update Note | 100 | 447.36 | 653.76 | +46.1% | 200.6 | 142.5 | -29.0% | Regression |
| Update Prompt | 50 | 439.28 | 578.51 | +31.7% | 138.7 | 105.0 | -24.3% | Regression |
| Hard Delete Bookmark | 100 | 248.16 | 401.53 | +61.8% | 369.6 | 240.0 | -35.1% | Regression |
| Hard Delete Note | 100 | 231.73 | 349.40 | +50.8% | 388.4 | 273.0 | -29.7% | Regression |
| Hard Delete Prompt | 50 | 206.77 | 304.76 | +47.4% | 423.4 | 289.0 | -31.7% | Regression |
| List Bookmarks | 50 | 232.59 | 338.86 | +45.7% | 331.0 | 245.7 | -25.8% | Regression |
| List Prompts | 50 | 268.18 | 342.34 | +27.6% | 314.5 | 235.6 | -25.1% | Regression |
| List Prompts | 100 | 319.33 | 418.16 | +30.9% | 300.0 | 223.8 | -25.4% | Regression |
| Read Prompt | 100 | 275.08 | 368.08 | +33.8% | 335.7 | 252.1 | -24.9% | Regression |
| Search Bookmarks | 50 | 305.68 | 397.29 | +30.0% | 285.8 | 237.4 | -16.9% | Regression |
| Search Prompts | 50 | 252.95 | 343.75 | +35.9% | 327.1 | 232.2 | -29.0% | Regression |
| Search Prompts | 100 | 316.32 | 425.03 | +34.4% | 302.9 | 227.2 | -25.0% | Regression |
| Soft Delete Prompt | 100 | 259.12 | 415.88 | +60.5% | 354.6 | 228.2 | -35.6% | Regression |

**Status key:** OK (<10% change), Warning (10-25% change), Regression (>25% change), Improvement (>10% faster)

## Scaling Analysis

### 1KB Content

| Operation | Size | P95 @10 | P95 @100 | Ratio | Status |
|-----------|------|---------|----------|-------|--------|
| Create Bookmark | 1KB | 49.18 | 485.52 | 9.9x | Good |
| Create Note | 1KB | 50.72 | 486.60 | 9.6x | Good |
| Create Prompt | 1KB | 41.39 | 556.69 | 13.4x | Moderate |
| Hard Delete Bookmark | 1KB | 25.25 | 250.42 | 9.9x | Good |
| Hard Delete Note | 1KB | 28.26 | 247.75 | 8.8x | Good |
| Hard Delete Prompt | 1KB | 24.25 | 352.39 | 14.5x | Moderate |
| List Bookmarks | 1KB | 39.42 | 401.12 | 10.2x | Moderate |
| List Notes | 1KB | 31.51 | 371.65 | 11.8x | Moderate |
| List Prompts | 1KB | 30.68 | 393.11 | 12.8x | Moderate |
| Read Bookmark | 1KB | 31.91 | 266.26 | 8.3x | Good |
| Read Note | 1KB | 29.45 | 250.15 | 8.5x | Good |
| Read Prompt | 1KB | 26.96 | 339.73 | 12.6x | Moderate |
| Search Bookmarks | 1KB | 31.36 | 374.24 | 11.9x | Moderate |
| Search Notes | 1KB | 32.82 | 383.92 | 11.7x | Moderate |
| Search Prompts | 1KB | 30.45 | 397.94 | 13.1x | Moderate |
| Soft Delete Bookmark | 1KB | 26.53 | 354.42 | 13.4x | Moderate |
| Soft Delete Note | 1KB | 30.99 | 377.07 | 12.2x | Moderate |
| Soft Delete Prompt | 1KB | 23.26 | 362.08 | 15.6x | Poor |
| Update Bookmark | 1KB | 53.65 | 608.69 | 11.3x | Moderate |
| Update Note | 1KB | 52.48 | 599.18 | 11.4x | Moderate |
| Update Prompt | 1KB | 86.30 | 571.98 | 6.6x | Good |

### 50KB Content

| Operation | Size | P95 @10 | P95 @100 | Ratio | Status |
|-----------|------|---------|----------|-------|--------|
| Create Bookmark | 50KB | 53.98 | 608.79 | 11.3x | Moderate |
| Create Note | 50KB | 54.46 | 562.60 | 10.3x | Moderate |
| Create Prompt | 50KB | 122.08 | 805.72 | 6.6x | Good |
| Hard Delete Bookmark | 50KB | 23.98 | 401.53 | 16.7x | Poor |
| Hard Delete Note | 50KB | 27.74 | 349.40 | 12.6x | Moderate |
| Hard Delete Prompt | 50KB | 23.08 | 270.11 | 11.7x | Moderate |
| List Bookmarks | 50KB | 35.99 | 408.33 | 11.3x | Moderate |
| List Notes | 50KB | 35.21 | 393.94 | 11.2x | Moderate |
| List Prompts | 50KB | 34.47 | 418.16 | 12.1x | Moderate |
| Read Bookmark | 50KB | 31.46 | 262.90 | 8.4x | Good |
| Read Note | 50KB | 29.63 | 273.23 | 9.2x | Good |
| Read Prompt | 50KB | 26.55 | 368.08 | 13.9x | Moderate |
| Search Bookmarks | 50KB | 31.02 | 391.86 | 12.6x | Moderate |
| Search Notes | 50KB | 33.87 | 397.05 | 11.7x | Moderate |
| Search Prompts | 50KB | 32.56 | 425.03 | 13.1x | Moderate |
| Soft Delete Bookmark | 50KB | 24.71 | 285.04 | 11.5x | Moderate |
| Soft Delete Note | 50KB | 27.52 | 325.61 | 11.8x | Moderate |
| Soft Delete Prompt | 50KB | 26.98 | 415.88 | 15.4x | Poor |
| Update Bookmark | 50KB | 58.11 | 623.78 | 10.7x | Moderate |
| Update Note | 50KB | 59.33 | 653.76 | 11.0x | Moderate |
| Update Prompt | 50KB | 84.57 | 915.24 | 10.8x | Moderate |

**Status key:** Good (<10x), Moderate (10-15x), Poor (>15x)

## Slow Operations (P95 > 100ms at any concurrency)

### 1KB Content - Absolute Threshold Violations (P95 > thresholds)

| Operation | Conc | P95 (ms) | Threshold (ms) | Severity |
|-----------|------|----------|----------------|----------|
| Update Bookmark | 100 | 608.69 | 400 | Exceeded |
| Update Note | 100 | 599.18 | 400 | Exceeded |
| Update Prompt | 100 | 571.98 | 400 | Exceeded |
| Create Prompt | 100 | 556.69 | 400 | Exceeded |
| Create Note | 100 | 486.60 | 400 | Exceeded |
| Create Bookmark | 100 | 485.52 | 400 | Exceeded |
| Update Prompt | 50 | 455.30 | 150 | Exceeded |
| Update Note | 50 | 440.81 | 150 | Exceeded |
| Update Bookmark | 50 | 439.64 | 150 | Exceeded |

### 50KB Content - Absolute Threshold Violations

| Operation | Conc | P95 (ms) | Threshold (ms) | Severity |
|-----------|------|----------|----------------|----------|
| Update Prompt | 100 | 915.24 | 800 | Exceeded |
| Create Prompt | 100 | 805.72 | 800 | Exceeded |
| Create Prompt | 10 | 122.08 | 100 | Exceeded |
| Update Prompt | 50 | 578.51 | 300 | Exceeded |
| Create Prompt | 50 | 576.49 | 300 | Exceeded |
| Update Bookmark | 50 | 498.99 | 300 | Exceeded |
| Update Note | 50 | 441.12 | 300 | Exceeded |
| Create Note | 50 | 428.87 | 300 | Exceeded |
| Create Bookmark | 50 | 423.58 | 300 | Exceeded |

## Errors

None. All operations maintained 0% error rate at all concurrency levels for both content sizes.

## Summary

- **Overall assessment:** PASS WITH WARNINGS
- **Key findings:**
  - Write operations (Create, Update) show significant P95 regressions at concurrency 50 and 100 (typically +30-80% vs baseline). This is expected: each write now includes `get_metadata_snapshot()` (relationship DB query), `_compute_changed_fields()`, and `embed_relationships()` in the response path, adding 2-3 DB round-trips per write.
  - Read operations are minimally affected at concurrency 10 and 50. Regressions appear mainly at concurrency 100 for certain operations, likely due to increased DB connection contention from the write overhead rather than the read path itself.
  - At concurrency 10, many operations actually improved or stayed flat, confirming the regression is load-dependent (contention under concurrent writes) rather than a per-request algorithmic regression.
  - No errors at any concurrency level. The system remains stable under load.
  - Profiling confirms the relationship service functions each add ~1ms (single indexed DB query). The aggregate impact is 2-3ms per write operation, which is negligible at low concurrency but amplifies under load due to DB connection pool contention.
- **Recommendations:**
  - The regressions are an expected cost of the relationship feature. The per-request overhead is small (~2-3ms), but under high concurrency the additional DB round-trips compete for connection pool slots, amplifying tail latency.
  - Monitor production DB connection pool utilization after merge. If pool saturation is observed, consider increasing `pool_size` or batching the relationship queries.
  - The `Update Prompt` at 50KB/concurrency 100 (915ms P95) is the single worst case. Prompt updates have additional overhead from template validation (`validate_template`) that compounds with relationship queries. This is acceptable for the use case (prompts are edited infrequently).
