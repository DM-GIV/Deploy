# Bounded public AI-search beta. Fail-closed: every nginx-generated failure becomes a small JSON response,
# never a raw 502/504 page. Daemon replies (including NOT_ENABLED 503) pass through unchanged.
location = /api/ai-lot-search {
    limit_except GET POST { deny all; }
    client_max_body_size 2k;
    limit_req zone=torgatlas_ai_search burst=2 nodelay;
    limit_req_status 429;
    limit_conn torgatlas_ai_conn 1;
    limit_conn torgatlas_ai_global 4;
    limit_conn_status 429;
    proxy_pass http://127.0.0.1:18082;
    proxy_http_version 1.1;
    proxy_set_header Connection close;
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Cookie "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 25s;
    proxy_send_timeout 5s;
    proxy_hide_header X-Powered-By;
    error_page 429 = @ai_busy;
    error_page 502 503 504 = @ai_unavailable;
    add_header Cache-Control "no-store, max-age=0" always;
    include /etc/nginx/torgatlas.d/torgatlas-headers.inc;
}
location @ai_busy {
    default_type application/json;
    add_header Cache-Control "no-store, max-age=0" always;
    add_header Retry-After 30 always;
    include /etc/nginx/torgatlas.d/torgatlas-headers.inc;
    return 429 '{"ok":false,"code":"RATE_LIMITED"}';
}
location @ai_unavailable {
    default_type application/json;
    add_header Cache-Control "no-store, max-age=0" always;
    include /etc/nginx/torgatlas.d/torgatlas-headers.inc;
    return 503 '{"ok":false,"code":"SERVICE_UNAVAILABLE"}';
}
