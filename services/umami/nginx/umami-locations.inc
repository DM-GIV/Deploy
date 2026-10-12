# Public analytics collection only. The Umami dashboard/login/API are NOT exposed (reachable via SSH tunnel to 127.0.0.1:19120).
location = /ta/s.js {
    if ($request_method !~ ^(GET|HEAD)$) { return 405; }
    proxy_pass http://127.0.0.1:19120/script.js;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Cookie "";
    proxy_hide_header Set-Cookie;
    proxy_connect_timeout 3s;
    proxy_read_timeout 10s;
    add_header Cache-Control "public, max-age=3600" always;
    include /etc/nginx/torgatlas.d/torgatlas-headers.inc;
}
location = /ta/api/send {
    if ($request_method != POST) { return 405; }
    limit_req zone=ta_umami burst=20 nodelay;
    limit_req_status 429;
    client_max_body_size 8k;
    proxy_pass http://127.0.0.1:19120/api/send;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Cookie "";
    proxy_hide_header Set-Cookie;
    proxy_connect_timeout 3s;
    proxy_read_timeout 10s;
    add_header Cache-Control "no-store" always;
    include /etc/nginx/torgatlas.d/torgatlas-headers.inc;
}
location ^~ /ta/ { return 404; }
