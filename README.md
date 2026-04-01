# Docker Tool

A web-based dashboard for managing `docker-compose.yml` files. Edit services, monitor status, view logs, and manage volumes/networks — all from a clean dark-theme UI without touching YAML by hand.

## Features

- **Service cards** — view all services at a glance with status, image, ports, and live CPU/memory stats
- **Start / Stop / Restart** — control individual containers with confirmation dialogs
- **Logs viewer** — tail the last 200 lines of any container's logs
- **Add / Edit / Copy / Delete** services with a structured form
- **Input validation** — port format, duplicate host ports, duplicate container names, env var format, ports vs expose conflict
- **Expose support** — configure `expose` as an alternative to `ports` for internal-only container ports
- **Env file support** — configure `env_file` paths per service
- **Volumes & Networks manager** — add/delete top-level volumes and networks (blocked if in use by a service)
- **Network selector** — pick from defined networks in a dropdown when editing services
- **Raw YAML editor** — view and edit the full compose file directly
- **Version history** — every save creates a snapshot; roll back to any previous version (max 50)
- **Search** — filter services by name or image
- **Global Up All / Down All** — run `docker compose up -d` or `docker compose down` in one click
- **Auto-refresh** — status refreshes every 10s, stats every 5s

## Screenshots

> Add screenshots to `docs/` and update the paths below.

![Dashboard](docs/screenshot-dashboard.png)
*Main dashboard — service cards with status and resource stats*

![Edit Service](docs/screenshot-edit.png)
*Edit service modal — full field support with inline validation*

![Version History](docs/screenshot-history.png)
*Version history — preview and restore any previous compose snapshot*

![Volumes & Networks](docs/screenshot-volnet.png)
*Volumes & Networks manager*

## Requirements

- [Node.js](https://nodejs.org) v18+
- [Docker](https://www.docker.com) with Compose v2 plugin (`docker compose`)

## Setup

```bash
# Clone the repo
git clone git@github.com:hoangdieuctu/docker-tool.git
cd docker-tool

# Install dependencies
npm install

# Place your docker-compose.yml in the project root
# (or use the example one included)

# Start the server
node server/index.js
```

Open http://localhost:3000 in your browser.

To change the port:

```bash
PORT=8080 node server/index.js
```

## Project Structure

```
docker-tool/
├── server/
│   ├── index.js      # Express API routes
│   ├── compose.js    # Read/write docker-compose.yml
│   ├── docker.js     # Docker CLI wrapper (start, stop, logs, stats)
│   └── history.js    # Version snapshot management
├── public/
│   ├── index.html    # Single-page UI
│   ├── app.js        # Frontend logic
│   └── style.css     # Dark theme styles
├── docker-compose.yml
└── package.json
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | All services with runtime state |
| POST | `/api/services/:name/start` | Start a service |
| POST | `/api/services/:name/stop` | Stop a service |
| POST | `/api/services/:name/restart` | Restart a service |
| GET | `/api/services/:name/logs` | Fetch container logs |
| POST | `/api/services` | Add a new service |
| PATCH | `/api/services/:name` | Update a service |
| DELETE | `/api/services/:name` | Remove a service |
| POST | `/api/up` | `docker compose up -d` |
| POST | `/api/down` | `docker compose down` |
| GET | `/api/compose/raw` | Get raw YAML |
| PUT | `/api/compose/raw` | Save raw YAML |
| GET | `/api/stats` | Live CPU/memory stats |
| GET | `/api/volumes` | List top-level volumes |
| POST | `/api/volumes` | Add a volume |
| DELETE | `/api/volumes/:name` | Remove a volume |
| GET | `/api/networks` | List top-level networks |
| POST | `/api/networks` | Add a network |
| DELETE | `/api/networks/:name` | Remove a network |
| GET | `/api/history` | List version snapshots |
| GET | `/api/history/:id` | Get a specific snapshot |
| POST | `/api/history/:id/restore` | Restore a snapshot |
| GET | `/api/ports/check` | Check if host ports are in use |
| GET | `/api/containers/check` | Check if a container name is in use |

## License

MIT
