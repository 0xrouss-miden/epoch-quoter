# Contabo deployment

Public URL: https://185.249.225.58/epoch

The source lives at `/opt/epoch-quoter` on the VPS. Docker Compose runs one
non-root Next.js container, listening only on `127.0.0.1:3102`. Its restart policy
starts it again after a crash or host reboot. Nginx forwards `/epoch` and
`/epoch/` from the existing HTTPS IP host. The existing Certbot renewal timer
manages that host's certificate.

The image builds with `NEXT_PUBLIC_BASE_PATH=/epoch` and
`NEXT_STANDALONE=1`. Local development defaults to `/`. The path prefix is a
build-time setting, so rebuild the image if it changes.

After copying updated source to the VPS:

```sh
cd /opt/epoch-quoter
docker compose build
docker compose up -d --wait --wait-timeout 90
docker compose ps
docker compose logs --tail 100 web
```

The build runs the tests before creating the production bundle. The container
health check requests the catalog. Check live quotes separately after deployment.

Nginx configuration:

- `nginx-rate-limit.conf` → `/etc/nginx/conf.d/epoch-quoter-rate-limit.conf`
- `nginx-proxy.conf` → `/etc/nginx/snippets/epoch-quoter-proxy.conf`
- `nginx-location.conf` → `/etc/nginx/snippets/epoch-quoter.conf`

The existing `/etc/nginx/sites-available/cryptohold` HTTPS server includes
`/etc/nginx/snippets/epoch-quoter.conf`. Validate with `nginx -t` before
`systemctl reload nginx`. Its pre-deployment configuration is backed up under
`/etc/nginx/backups/`.

Nginx limits request size and request rate. The app retains its allocator pacing,
cooldowns, concurrency cap, and short quote cache. Monitoring still runs while
a visitor has the page open; deployment does not introduce scheduled scans.

No SSH credentials or private keys are stored in the repository, image, or app.
