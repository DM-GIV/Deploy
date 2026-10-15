proxy_http_version 1.1;
proxy_set_header Connection close;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-Proto https;
proxy_connect_timeout 2s;
proxy_read_timeout 15s;
