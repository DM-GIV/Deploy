# ALTCHA — third-party notice (self-hosted, MIT)

| Item | Value |
| --- | --- |
| Widget | `altcha` npm package **2.3.0** (ES-module build `dist_external/`), https://github.com/altcha-org/altcha |
| Widget source | https://registry.npmjs.org/altcha/-/altcha-2.3.0.tgz, tarball sha256 `559c584cd1fa932767c51497b56b2955282a7cbc08c1a3bb943665e572b45d3f`, registry integrity `sha512-vl8I0dQvSQB7/Mx09XuWZ1+LdSP7vEda6OLbg9kUQ2ZO2LT7MzgUyLK7Iips+GAV6c0ntVcS1XWOqhEPpwbDhQ==` (verified) |
| Served files | `assets/vendor/altcha/{altcha.js,altcha.css,worker.js,LICENSE.txt}`, sha256 in `assets/vendor/altcha/SHA256SUMS.txt` (`altcha.js` f8c0ae32…413e, `altcha.css` 2be949d4…c53d, `worker.js` 9ad5e1ba…89c8) |
| Server library | `altcha` PyPI **2.3.0** (altcha-lib-py), https://github.com/altcha-org/altcha-lib-py, sdist sha256 `26fd7a08fa56eb36c286d4da7da9af0b9a81cd17280d596d8ee613c22b48ddd0` |
| Vendored file | `services/lead-intake/vendor/altcha_v1.py` (unmodified `altcha/v1.py`, sha256 `2eda6647…d114fd569`, pinned in a unit test) + `LICENSE.altcha-lib-py` |
| Licence | MIT, Copyright (c) 2023 Daniel Regeci (widget: also BAU Software s.r.o.). Notice texts are shipped next to the files and must be kept. |
| Protocol | ALTCHA v1 (SHA-256 proof of work, HMAC-signed challenge, `expires` in the signed salt). The 3.x widget uses a different protocol and is intentionally NOT used. |

Not used and never configured: ALTCHA Cloud / Sentinel, API keys, `verifyurl`, `spamfilter`, `customfetch`, CDN. The widget only talks to `/api/altcha-challenge` on torgatlas.ru and runs its worker from `/assets/vendor/altcha/worker.js` (browser test asserts zero external requests).

Update procedure: new version = new review, new hashes here, new unit-test pin, widget and library versions must speak the same protocol.
