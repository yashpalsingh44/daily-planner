# ⌛ ChronosPlan — Premium Daily Planner & Schedule Manager

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.22-00ADD8?style=for-the-badge&logo=go&logoColor=white" alt="Go 1.22" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Three.js-WebGL-black?style=for-the-badge&logo=three.js&logoColor=white" alt="Three.js WebGL" />
  <img src="https://img.shields.io/badge/RealTime-SSE-FF6F00?style=for-the-badge" alt="SSE Realtime" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
</p>

A state-of-the-art, feature-rich daily planner and time-blocking application built with a high-performance **Go REST API**, pure Go **SQLite database persistence**, **Server-Sent Events (SSE)** real-time notifications, **JWT multi-user authentication**, and a glassmorphic **Three.js WebGL frontend**.

---

## ✨ Features

- 🔐 **User Authentication & Multi-User Isolation**:
  - Secure registration & login endpoints (`/api/auth/register`, `/api/auth/login`).
  - Cryptographically salted SHA-256 password hashing.
  - HMAC-SHA256 JWT authorization tokens (24-hour expiration).
  - Complete user task isolation so each user manages their private schedule.

- 📡 **Real-Time Task Notifications & Audio Chimes**:
  - **Server-Sent Events (SSE)** event stream (`/api/events`) for instant server-to-browser alerts.
  - Web Audio API dual-tone chime generator (zero external `.mp3` dependencies).
  - Browser Desktop OS Notifications (`Notification` API).
  - Floating glassmorphic toast popups with inline **"Mark Done"** action buttons.

- 🔄 **Recurring Tasks Engine**:
  - Support for **Daily**, **Weekdays (Mon-Fri)**, **Weekly**, and **Monthly** recurring schedules.
  - Dynamic calendar timeline projection without database row duplication.

- 🧪 **Automated Testing Suite**:
  - `main_test.go` integration test suite running on an isolated in-memory SQLite database (`:memory:`).
  - Verifies JWT claims, password hashing, payload validation, and multi-user data isolation.

- 🎨 **Glassmorphic UI & 3D WebGL Particle Visuals**:
  - Interactive Three.js particle canvas background with mouse parallax.
  - 3D card tilt hover physics.
  - Light & Dark theme toggle with ambient background glows.
  - AetherAgent Console terminal widget with live system log streaming.

- 🐳 **Docker Production Deployment**:
  - Multi-stage CGO-free Alpine container build (`Dockerfile`).

---

## 📁 Repository Structure

```
daily-planner/
├── main.go               # Go REST API, Auth JWT, SSE Broker & SQLite Storage
├── main_test.go          # Automated Unit & Integration Test Suite
├── Dockerfile            # Multi-stage production container build
├── go.mod                # Go module dependencies
├── public/               # Static Frontend Assets
│   ├── index.html        # Glassmorphic HTML5 Application Structure
│   ├── style.css         # Modern Glassmorphic CSS Design System
│   └── app.js            # JavaScript Logic, Three.js 3D Engine & Auth
└── data/                 # SQLite Database Volume (`tasks.db`)
```

---

## ⚡ Quick Start Guide

### Prerequisites
- [Go 1.22+](https://go.dev/dl/) installed locally, OR [Docker](https://www.docker.com/).

### 1. Run Locally with Go

```bash
# Clone repository
git clone https://github.com/yashpalsingh44/daily-planner.git
cd daily-planner

# Run server
go run main.go
```

Open your browser and navigate to: **`http://localhost:8080`**

### 2. Run Automated Unit Tests

```bash
go test -v ./...
```

### 3. Run with Docker

```bash
# Build Docker image
docker build -t aetherplan:latest .

# Run Docker container
docker run -p 8080:8080 -v $(pwd)/data:/app/data aetherplan:latest
```

---

## 🔗 REST API Endpoints

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/auth/register` | Register a new user account | No |
| `POST` | `/api/auth/login` | Authenticate user credentials & return JWT | No |
| `GET` | `/api/auth/me` | Fetch authenticated user profile | Yes |
| `GET` | `/api/tasks` | Get user tasks (supports `?date=YYYY-MM-DD`) | Optional |
| `POST` | `/api/tasks` | Create a new task | Optional |
| `PUT` | `/api/tasks/{id}` | Update existing task details/status | Optional |
| `DELETE` | `/api/tasks/{id}` | Delete a task | Optional |
| `GET` | `/api/events` | SSE real-time notification stream | No |
| `POST` | `/api/tasks/test-reminder` | Trigger test live SSE notification | No |

---

## 👤 Author & License

Developed by **[Yashpal Singh](https://github.com/yashpalsingh44)**.
Distributed under the MIT License.
