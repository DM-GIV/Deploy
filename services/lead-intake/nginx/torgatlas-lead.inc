# Direct lead endpoints -> isolated TorgAtlas lead container on 127.0.0.1:18081 (no Cloud/Core upstream).
# Replaces the disabled stubs for /api/lead-config and /api/lead in torgatlas-locations.inc.
# Fail-closed: when the container is down, lead-config reports enabled:false and POST is refused with 503.

location = /api/lead-config {
    if ($request_method !~ ^(GET|HEAD)$) { return 405; }
    proxy_pass http://127.0.0.1:18081/api/lead-config;
    proxy_http_version 1.1;
    proxy_set_header Connection close;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Cookie "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 5s;
    error_page 502 503 504 = @lead_config_disabled;
    add_header Cache-Control "no-store, max-age=0" always;
    add_header Vary "Origin" always;
    include /etc/nginx/torgatlas.d/torgatlas-headers.inc;
}
location @lead_config_disabled {
    default_type application/json;
    add_header Cache-Control "no-store, max-age=0" always;
    include /etc/nginx/torgatlas.d/torgatlas-headers.inc;
    return 200 '{"enabled":false}';
}

location = /api/altcha-challenge {
    if ($request_method !~ ^(GET|HEAD)$) { return 405; }
    limit_req zone=ta_lead_challenge burst=6 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:18081/api/altcha-challenge;
    proxy_http_version 1.1;
    proxy_set_header Connection close;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Cookie "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 5s;
    error_page 502 503 504 = @lead_unavailable;
    add_header Cache-Control "no-store, max-age=0" always;
    include /etc/nginx/torgatlas.d/torgatlas-headers.inc;
}

location = /api/lead {
    if ($request_method != POST) { return 405; }
    limit_req zone=ta_lead_submit burst=4 nodelay;
    limit_req_status 429;
    client_max_body_size 12k;
    proxy_pass http://127.0.0.1:18081/api/lead;
    proxy_http_version 1.1;
    proxy_set_header Connection close;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Cookie "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 15s;
    error_page 502 503 504 = @lead_unavailable;
    add_header Cache-Control "no-store, max-age=0" always;
    add_header Vary "Origin" always;
    include /etc/nginx/torgatlas.d/torgatlas-headers.inc;
}
location @lead_unavailable {
    default_type application/json;
    add_header Cache-Control "no-store, max-age=0" always;
    include /etc/nginx/torgatlas.d/torgatlas-headers.inc;
    return 503 '{"ok":false,"code":"UNAVAILABLE"}';
}
