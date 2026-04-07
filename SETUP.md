# Fusion System Administrator — Windows Setup Guide

Everything you need to get the project running locally on Windows from scratch.

---

## Prerequisites

Install the following before starting. Use the exact versions listed where specified.

| Tool | Version | Download |
|---|---|---|
| Python | 3.11 or 3.12 | https://www.python.org/downloads/ |
| Node.js | 18 LTS or 20 LTS | https://nodejs.org/ |
| PostgreSQL | 14 – 16 | https://www.postgresql.org/download/windows/ |
| Git | Latest | https://git-scm.com/download/win |

> **Important:** During Python installation check **"Add Python to PATH"**.  
> During PostgreSQL installation note the password you set for the `postgres` superuser — you will need it.

---

## 1. Clone the Repository

Open **Command Prompt** or **PowerShell**:

```cmd
git clone <your-repo-url>
cd Fusion_System_Administrator
```

---

## 2. PostgreSQL — Create the Database and User

Open the **psql** shell. You can find it in the Start Menu under **PostgreSQL → SQL Shell (psql)**.  
Press Enter to accept defaults for host/port/dbname, then enter your `postgres` password.  
Choose your own database username and a strong password instead of using a shared example value.

```sql
CREATE USER <DB_USER> WITH PASSWORD '<DB_PASSWORD>';
CREATE DATABASE fusionlab OWNER <DB_USER>;
GRANT ALL PRIVILEGES ON DATABASE fusionlab TO <DB_USER>;
\q
```

### Fix authentication method (required on most Windows installs) (Optional)

Find your `pg_hba.conf` file. It is usually at:

```
C:\Program Files\PostgreSQL\<version>\data\pg_hba.conf
```

Open it in Notepad as Administrator. Find the lines that look like:

```
host    all    all    127.0.0.1/32    scram-sha-256
host    all    all    ::1/128         scram-sha-256
```

Make sure they say `scram-sha-256` or `md5` — **not** `ident` or `peer`. If they say `ident`, change them to `md5`:

```
host    all    all    127.0.0.1/32    md5
host    all    all    ::1/128         md5
```

Restart PostgreSQL from **Services** (`Win + R` → `services.msc`) or run in PowerShell as Administrator:

```powershell
Restart-Service -Name postgresql*
```

---

## 3. Backend — Python Setup

All commands below are run from the repo root unless stated otherwise.

### 3.1 Create and activate a virtual environment

```cmd
cd Backend
python -m venv venv
venv\Scripts\activate
```

Your prompt should now start with `(venv)`.

### 3.2 Install Python dependencies

```cmd
pip install -r requirements.txt
pip install apscheduler django-apscheduler
```

### 3.3 Create the `.env` file

The `.env` file must sit at `Backend\.env` (one level above the `backend/` folder).  
Create it with Notepad or any editor:

```
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your_gmail@gmail.com
EMAIL_HOST_PASSWORD=your_gmail_app_password
EMAIL_TEST_USER=your_gmail@gmail.com
EMAIL_TEST_MODE=1
EMAIL_TEST_COUNT=1
EMAIL_TEST_ARRAY="[]"
```

> **Gmail App Password:** Go to your Google Account → Security → 2-Step Verification → App Passwords.  
> Generate one for "Mail" and paste it as `EMAIL_HOST_PASSWORD`.

### 3.4 Verify the database settings

Open `Backend\backend\backend\settings.py` and confirm the `DATABASES` block matches what you created in step 2:

```python
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "fusionlab",
        "USER": "fusion_admin",
        "PASSWORD": "hello123",
        "HOST": "localhost",
        "PORT": "5432",
    }
}
```

Change `USER` and `PASSWORD` if you chose different values.

### 3.5 Run migrations

```cmd
cd backend
python manage.py migrate
```

Expected output ends with something like:

```
Applying django_apscheduler.0009_djangojobexecution_unique_job_executions... OK
```

### 3.6 Create a superuser (admin login)

```cmd
python manage.py createsuperuser
```

Enter a username, email (optional), and password when prompted.  
This is the account you will use to log into the frontend.

### 3.7 Start the backend server

```cmd
python manage.py runserver
```

The backend is now running at **http://127.0.0.1:8000/**  
Leave this terminal open.

---

## 4. Frontend — Node.js Setup

Open a **second** Command Prompt or PowerShell window.

### 4.1 Navigate to the client folder

```cmd
cd Fusion_System_Administrator\client
```

### 4.2 Install dependencies

```cmd
npm install
```

### 4.3 Create the frontend `.env` file

Create a file called `.env` inside the `client\` folder with this content:

```
VITE_BACKEND_URL=http://127.0.0.1:8000
```

### 4.4 Start the frontend dev server

```cmd
npm run dev
```

The frontend is now running at **http://127.0.0.1:5173/**  
Open that URL in your browser.

---

## 5. Logging In

1. Go to **http://127.0.0.1:5173/**
2. You will be redirected to the login page.
3. Enter the **username** and **password** you created with `createsuperuser` in step 3.6.
4. Click **Login**.

---

## 6. Project Structure Overview

```
Fusion_System_Administrator/
├── Backend/
│   ├── .env                  ← environment variables (you create this)
│   ├── requirements.txt
│   └── backend/
│       ├── manage.py
│       ├── backups/          ← pg_dump files stored here (auto-created)
│       ├── api/              ← Django app: models, views, urls
│       └── backend/          ← Django project: settings, urls, wsgi
└── client/
    ├── .env                  ← VITE_BACKEND_URL (you create this)
    ├── package.json
    └── src/
        ├── api/              ← Axios API clients
        ├── components/       ← Sidebar, RequireAuth, etc.
        ├── context/          ← AuthContext, axiosInstance
        └── pages/            ← All page components
```

---

## 7. Useful Commands (Quick Reference)

### Backend

```cmd
:: Activate venv (run from Backend\)
venv\Scripts\activate

:: Start server
cd backend
python manage.py runserver

:: Make and apply migrations after model changes
python manage.py makemigrations
python manage.py migrate

:: Open Django shell
python manage.py shell

:: Create another admin user
python manage.py createsuperuser
```

### Frontend

```cmd
:: Start dev server
npm run dev

:: Build for production
npm run build

:: Lint
npm run lint
```

### PostgreSQL (psql)

```cmd
:: Connect to the database
psql -U fusion_admin -d fusionlab

:: List all tables
\dt

:: Quit
\q
```

---

## 8. Common Problems and Fixes

### `OperationalError: connection to server at "localhost" failed: FATAL: Ident authentication failed`

PostgreSQL is using `ident` auth. Fix `pg_hba.conf` as described in step 2 and restart the service.

### `django.db.utils.OperationalError: FATAL: password authentication failed for user "fusion_admin"`

The password in `settings.py` does not match what PostgreSQL has. Reset it:

```sql
-- in psql as postgres superuser
ALTER USER fusion_admin WITH PASSWORD 'hello123';
```

### `'venv\Scripts\activate' is not recognized`

You are not inside the `Backend\` folder, or the venv was not created there. Run:

```cmd
cd Fusion_System_Administrator\Backend
python -m venv venv
venv\Scripts\activate
```

### `npm : The term 'npm' is not recognized`

Node.js is not installed or not on PATH. Re-install from https://nodejs.org/ and restart your terminal.

### CORS error in browser console

Make sure `VITE_BACKEND_URL` in `client\.env` is exactly `http://127.0.0.1:8000` (no trailing slash) and that the backend is actually running. Restart the Vite dev server after changing `.env`.

### Frontend shows blank page or login loop

Clear `localStorage` in your browser DevTools (`Application → Local Storage → Clear All`) and hard-refresh (`Ctrl + Shift + R`).

### Backup / restore fails with `pg_dump not found`

PostgreSQL's `bin\` folder is not on your PATH. Add it manually:

1. Find the path — usually `C:\Program Files\PostgreSQL\<version>\bin`
2. Open **System Properties → Advanced → Environment Variables**
3. Edit the `Path` variable under **System variables** and add the path above
4. Restart your terminal

---

## 9. Scheduled Backups

Backup schedules are managed from the **Backup → Schedules** page in the UI. No external cron daemon is needed — APScheduler runs inside the Django process and re-registers all active schedules on every server restart.

Backup dump files are stored in `Backend\backups\` and are automatically pruned according to your retention setting.

---

## 10. Environment Variables Reference

### `Backend\.env`

| Variable | Description | Example |
|---|---|---|
| `EMAIL_PORT` | SMTP port | `587` |
| `EMAIL_USE_TLS` | Use TLS | `True` |
| `EMAIL_HOST_USER` | Gmail address | `you@gmail.com` |
| `EMAIL_HOST_PASSWORD` | Gmail App Password | `abcd efgh ijkl mnop` |
| `EMAIL_TEST_USER` | Address that receives test emails | `you@gmail.com` |
| `EMAIL_TEST_MODE` | `1` = test mode, `0` = production | `1` |
| `EMAIL_TEST_COUNT` | Number of test emails to send | `1` |
| `EMAIL_TEST_ARRAY` | Specific addresses to send to in test mode (JSON array string, empty = all users) | `"[]"` |

### `client\.env`

| Variable | Description | Example |
|---|---|---|
| `VITE_BACKEND_URL` | Base URL of the Django backend | `http://127.0.0.1:8000` |
