# Deploying Wideline to the shared server

Wideline runs from a checkout of this repository on the shared server, behind
the shared Caddy, which terminates TLS. Local development is unchanged
(`make up`, [docker-compose.yml](docker-compose.yml)); production uses
[docker-compose.prod.yml](docker-compose.prod.yml), a standalone file (compose
project `wideline-prod`).

| URL                                 | Container (`edge` alias) |
| ----------------------------------- | ------------------------ |
| `https://wideline.$SSLIP_HOST`      | `wideline-web:3000`      |
| `https://s3.wideline.$SSLIP_HOST`   | `wideline-rustfs:9000`   |
| `https://mail.wideline.$SSLIP_HOST` | `wideline-mail:8025`     |

The browser uploads footage and plays HLS segments straight from storage with
presigned URLs, so storage needs its own public hostname. Postgres stays on
the project's private network. No ports are published.

## Services

- `postgres`: Postgres 16, volume `postgres-data`.
- `rustfs`: S3-compatible storage, volume `rustfs-data`. Hetzner Object Storage
  can replace it later with S3_* settings only.
- `mailpit`: catches all outgoing mail (magic links, invitations) for the demo,
  behind Caddy basic auth. Messages are kept in memory. Replace with a real SMTP
  relay by setting `SMTP_*` in `.env.production`.
- `init`: one-shot; applies Prisma migrations and creates the bucket on every
  `up`, then exits. The app services wait for it.
- `web`: the Next.js standalone server, capped at `WEB_MEM_LIMIT`.
- `transcode-worker`: probe, transcode, clips, review sweep, retention and
  consent purges (ffmpeg, capped at `TRANSCODE_MEM_LIMIT`).

web and transcode-worker also join `edge`, so `s3.wideline.$SSLIP_HOST`
resolves to Caddy from inside them (see the alias below).

### CV is off

There is no Docker socket in production (`CV_DISPATCH=docker` is impossible),
and the hourly GPU provider is still a stub. The stack sets
`CV_DISPATCH=hourly` and runs no cv-dispatcher, so CV jobs stay queued.
Transcode and playback work, but an uploaded match stays in Processing: review
needs the cv and clips jobs. Once a provider exists (C19), add a
`cv-dispatcher` service (worker image, `WORKER_QUEUES=cv,cv-watchdog`) and
queued jobs run.

## First deploy

The `edge` network and the shared Caddy must already exist.

```sh
cp .env.production.example .env.production
# Fill in every <...>; see the openssl hints in the file.
chmod 600 .env.production

make prod-up

# Once: the organisation, the admin user, teams and a match. Prints the admin
# password when SEED_ADMIN_PASSWORD is empty. Running it again resets that password.
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm init prisma db seed
```

Then add the Caddy routes and the network alias below, and reload Caddy. Sign
in at `https://wideline.$SSLIP_HOST` with `SEED_ADMIN_EMAIL`.

## Updates

```sh
git pull
make prod-up
```

`init` reruns and applies any new migrations before `web` restarts.

## Caddy

### Network alias on `edge`

Presigned URLs are signed for `s3.wideline.$SSLIP_HOST`. For them to work from
inside containers too, the Caddy service needs this alias on `edge`:

```yaml
networks:
  edge:
    aliases:
      - s3.wideline.${SSLIP_HOST}
```

### Routes

```caddy
wideline.{$SSLIP_HOST} {
	encode zstd gzip
	reverse_proxy wideline-web:3000
}

# Storage: presigned uploads (multipart PUTs) and HLS playback.
s3.wideline.{$SSLIP_HOST} {
	@preflight method OPTIONS
	header {
		Access-Control-Allow-Origin "https://wideline.{$SSLIP_HOST}"
		Access-Control-Allow-Methods "GET, PUT, HEAD"
		Access-Control-Allow-Headers "*"
		Access-Control-Expose-Headers "ETag"
		Access-Control-Max-Age "3600"
		defer
	}
	respond @preflight 204
	request_body {
		max_size 0
	}
	reverse_proxy wideline-rustfs:9000 {
		# S3 signatures cover the Host header.
		header_up Host {host}
		flush_interval -1
	}
}

# Mailpit, demo only. Hash: caddy hash-password --plaintext '<password>'
mail.wideline.{$SSLIP_HOST} {
	basic_auth {
		<user> <bcrypt-hash>
	}
	reverse_proxy wideline-mail:8025
}
```

Do not add `encode` to the storage route; it would change the bytes that
range requests and ETags refer to.

## Operations

```sh
C="docker compose -f docker-compose.prod.yml --env-file .env.production"
$C ps
$C logs -f --tail=100 web transcode-worker
$C exec postgres pg_dump -U wideline wideline | gzip > wideline-$(date +%F).sql.gz
```

Back up `postgres-data` and `rustfs-data`. Never change `ID_HASH_SECRET` after
the first deploy: stored scout ID hashes stop matching.

## Resources

About 3.5 GB of RAM at peak (web up to `WEB_MEM_LIMIT`=1 GB, the transcode
worker up to `TRANSCODE_MEM_LIMIT`=2 GB, Postgres, RustFS and Mailpit a few
hundred MB together) and 2 to 3 cores while a match transcodes; idle is under
1 GB. Disk: footage plus its HLS ladder (several GB per 90-minute match) in
`rustfs-data`, and about 6 GB of ffmpeg scratch per transcode in the worker's
`/tmp`.
