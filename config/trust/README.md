# Per-host trust bundle: torgi.gov.ru

Used ONLY for TLS connections to hosts whose registry entry lists `tls_ca` (currently torgi.gov.ru); never installed
system-wide, never via NODE_EXTRA_CA_CERTS, TLS verification is never disabled.

| File | Subject | SHA-256 (DER) | Valid until |
|---|---|---|---|
| russian-trusted-root-ca.pem | Russian Trusted Root CA (Минцифры РФ), self-signed | d26d2d0231b7c39f92cc738512ba54103519e4405d68b5bd703e9788ca8ecf31 | 2032-02-27 |
| russian-trusted-sub-ca-2024.pem | Russian Trusted Sub CA (subca_ssl_rsa2024), issued by the root | 2155785036c900dbb5f1bb2a1569c80c55595bd6bf94867a29bbddbc7d88a3f2 | 2029-07-19 |

Provenance (2026-10-15): root downloaded from https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer
(TLS-validated by a public CA) and the fingerprint matched an independent SSL Labs report; the sub CA was fetched from the
leaf's AIA URL (nuc-cdp.digital.gov.ru) and verified by signature against the root; `openssl verify` of the live
torgi.gov.ru leaf succeeds with this chain and fails for any other hostname. The engine refuses the host if a file's
hash differs from the registry pin. Rotation: replace files and pins in a reviewed commit.
