# Harish's work
# 🖥️ Task Manager Desktop App – React + Electron

A modern, responsive task manager and remote work monitoring desktop application built with **React + Tailwind CSS + Electron**, designed for efficient time tracking, activity logging, and hierarchical task management.

---

## 📦 Features

### 🧭 Screen 1: Task Selector (TaskList.js)
- Multi-level dropdown for:
  - Project → Task (Level 1)
    - Subtask (Level 2)
      - Action (Level 3)
        - Sub-action (Level 4)
- Each dropdown dynamically loads data only if available.
- Displays project status beside project dropdown.
- Dropdown styling adapts to light/dark theme:
  - Light Mode: Cream background, white text.
  - Dark Mode: Grey dropdowns, black/white text.
- Scrollable layout for large task lists.

### ⏱️ Screen 2: Task Timer & Activity Monitor
- **Start**, **Pause**, **Break**, **Resume**, and **Stop** functionality.
- Timer pauses on break/pause and resumes correctly.
- Time is recorded in **UTC** with breakdown (days, hours, minutes).
- Each project has an **independent timer**.
- **Cumulative time tracking** per project per day.
- **Prevents timer from running** if project is marked completed.
- Displays "Last screenshot taken X mins ago" label (auto-updating).
- Screenshots captured **randomly every 10 minutes**.
- Screenshot stored:
  - As Base64 in local database.
  - As image file in folder (`~/Desktop/BugAppScreenshots/`).
  
### 🖱️ Activity Tracking
- Records:
  - Mouse and keyboard events using `iohook`.
  - Active window data using `active-win`.
- Flags warnings for:
  - Blank/black screenshots.
  - No mouse/keyboard activity during session.
  - Break exceeding 1 hour.

### ⚙️ Bottom Navigation
- **Settings** page:
  - Toggle Dark/Light theme.
  - Display keyboard/mouse stats.
  - Login panel (mock).
  - Warning log viewer.
- **Quit** button cleanly exits the app.

---

## 📁 Project Structure

```bash
root/
├── public/
├── src/
│   ├── components/
│   ├── hooks/
│   ├── pages/
│   │   ├── TaskList.js     # Screen 1
│   │   └── TimerScreen.js  # Screen 2
│   ├── services/
│   ├── store/
│   ├── types/
│   ├── App.tsx
│   └── main.tsx
├── electron/
│   ├── main.js
│   ├── preload.js
│   └── utils/
├── db/
│   └── local.sqlite
├── screenshots/
├── tailwind.config.js
├── package.json
└── vite.config.ts




```

| Layer          | Technology                    |
| -------------- | ----------------------------- |
| Frontend       | React + Vite + Tailwind CSS   |
| Desktop        | Electron                      |
| Backend        | Node.js + Express.js (local)  |
| DB             | SQLite (via `better-sqlite3`) |
| Screenshot     | `screenshot-desktop`          |
| Input Tracking | `iohook`, `active-win`        |

```
🚀 Getting Started
1. Clone the Repo
bash
git clone https://github.com/your-username/task-manager-desktop.git
cd task-manager-desktop

2. Install Dependencies
bash
npm install

3. Start Development
bash
npm run dev

5. Package App for Production
bash
npm run build
npm run electron:package
```

📂 Local Storage
Task Data: Stored in SQLite.

Screenshots: Saved both in Base64 (for database display) and image files.

Mouse/Keyboard Logs: Stored locally per session.

Theme & Preferences: Stored using electron-store.

⚠️ Warnings (Auto-triggered)
Missing or black screenshots.

Inactive mouse/keyboard for extended time.

Break exceeding 1 hour duration.

🌙 Theme Support
🔲 Dark Mode: Black/gray backgrounds, white/red text.

🔳 Light Mode: White/cream backgrounds, black text.

Toggle in Settings.

✅ TODOs / Future Enhancements
🔐 Login Page: Add a user login UI (even if fake/mock for now).

🎨 CSS Improvements: Polish layout styling, especially in Light Mode for better readability and UI consistency.




🗃️ Database Schema (SQL)
```
sql
-- Table: projects
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userID INT,
  name VARCHAR(255),
  description TEXT,
  startDate DATETIME,
  endDate DATETIME,
  estHours FLOAT,
  actHours FLOAT,
  wsID INT,
  createdAt DATETIME,
  modifiedAt DATETIME
);

-- Table: tasks
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wsID INT,
  userID INT,
  projectID INT,
  name VARCHAR(255),
  description TEXT,
  taskLevel TINYINT,
  status VARCHAR(50),
  parentID INT,
  level1ID INT,
  level2ID INT,
  level3ID INT,
  level4ID INT,
  assignee1ID INT,
  assignee2ID INT,
  assignee3ID INT,
  estHours FLOAT,
  estPrevHours JSON,
  actHours FLOAT,
  isExceeded TINYINT,
  priority VARCHAR(20),
  info JSON,
  taskType VARCHAR(50),
  dueDate DATETIME,
  comments TEXT,
  createdAt DATETIME,
  modifiedAt DATETIME,
  expanded TINYINT(1)
);

-- Table: workdiary
CREATE TABLE workdiary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectID INT,
  projectName VARCHAR(50),
  userID INT,
  taskID INT,
  taskName VARCHAR(50),
  screenshotTimeStamp DATETIME,
  calcTimeStamp DATETIME,
  keyboardJSON JSON,
  mouseJSON JSON,
  activeJSON JSON,
  activeFlag INT,
  activeMins INT,
  deletedFlag INT,
  activeMemo VARCHAR(256),
  imageURL LONGTEXT,
  createdAt DATETIME,
  modifiedAt DATETIME
);
```
"# yeaapp" 
