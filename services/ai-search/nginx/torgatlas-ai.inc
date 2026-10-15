location = /api/ai-lot-search {
    limit_except GET POST { deny all; }
    client_max_body_size 2k;
    limit_req zone=torgatlas_ai_search burst=2 nodelay;
    limit_conn torgatlas_ai_conn 1;
    proxy_connect_timeout 2s;
    proxy_read_timeout 60s;
    proxy_send_timeout 5s;
    proxy_pass http://127.0.0.1:18082;
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_hide_header X-Powered-By;
}
