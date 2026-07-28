package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/glebarez/go-sqlite"
)

// Task represents a scheduled planner task
type Task struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Desc        string `json:"desc"`
	Date        string `json:"date"`
	Start       string `json:"start"`
	End         string `json:"end"`
	Status      string `json:"status"`
	Reminder    bool   `json:"reminder"`
	CompletedAt string `json:"completedAt,omitempty"`
}

var db *sql.DB

func initDB() {
	dbDir := "./data"
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		log.Printf("Warning: failed to create data dir: %v", err)
	}

	dbPath := filepath.Join(dbDir, "tasks.db")
	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("Failed to open SQLite database at %s: %v", dbPath, err)
	}

	// Create tasks table if not exists
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS tasks (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		desc TEXT,
		date TEXT NOT NULL,
		start TEXT NOT NULL,
		end TEXT NOT NULL,
		status TEXT NOT NULL,
		reminder BOOLEAN NOT NULL,
		completed_at TEXT
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatalf("Failed to initialize database schema: %v", err)
	}

	log.Printf("Database initialized successfully at %s", dbPath)
}

func enableCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

// GET /api/tasks
func getTasksHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, title, desc, date, start, end, status, reminder, COALESCE(completed_at, '') FROM tasks")
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to query tasks: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tasks := []Task{}
	for rows.Next() {
		var t Task
		var completedAt string
		if err := rows.Scan(&t.ID, &t.Title, &t.Desc, &t.Date, &t.Start, &t.End, &t.Status, &t.Reminder, &completedAt); err != nil {
			http.Error(w, fmt.Sprintf("Error scanning task: %v", err), http.StatusInternalServerError)
			return
		}
		t.CompletedAt = completedAt
		tasks = append(tasks, t)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tasks)
}

// POST /api/tasks
func createTaskHandler(w http.ResponseWriter, r *http.Request) {
	var t Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, "Invalid task JSON payload", http.StatusBadRequest)
		return
	}

	if t.ID == "" {
		t.ID = fmt.Sprintf("task_%d", time.Now().UnixNano())
	}
	if t.Status == "" {
		t.Status = "todo"
	}

	stmt := `INSERT INTO tasks (id, title, desc, date, start, end, status, reminder, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := db.Exec(stmt, t.ID, t.Title, t.Desc, t.Date, t.Start, t.End, t.Status, t.Reminder, t.CompletedAt)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to insert task: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(t)
}

// PUT /api/tasks/{id}
func updateTaskHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		id = strings.TrimPrefix(r.URL.Path, "/api/tasks/")
	}

	var t Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, "Invalid task JSON payload", http.StatusBadRequest)
		return
	}

	stmt := `UPDATE tasks SET title=?, desc=?, date=?, start=?, end=?, status=?, reminder=?, completed_at=? WHERE id=?`
	res, err := db.Exec(stmt, t.Title, t.Desc, t.Date, t.Start, t.End, t.Status, t.Reminder, t.CompletedAt, id)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to update task: %v", err), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}

	t.ID = id
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(t)
}

// DELETE /api/tasks/{id}
func deleteTaskHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		id = strings.TrimPrefix(r.URL.Path, "/api/tasks/")
	}

	stmt := `DELETE FROM tasks WHERE id=?`
	res, err := db.Exec(stmt, id)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to delete task: %v", err), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Task deleted successfully", "id": id})
}

// Background reminder ticker
func startReminderDaemon() {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		for range ticker.C {
			now := time.Now()
			dateStr := now.Format("2006-01-02")
			timeStr := now.Format("15:04")

			rows, err := db.Query("SELECT title FROM tasks WHERE date = ? AND start = ? AND reminder = 1 AND status != 'completed'", dateStr, timeStr)
			if err != nil {
				continue
			}

			for rows.Next() {
				var title string
				if err := rows.Scan(&title); err == nil {
					log.Printf("[AetherAgent Daemon] ALERT REMINDER: Task '%s' is starting now at %s!", title, timeStr)
				}
			}
			rows.Close()
		}
	}()
}

func main() {
	initDB()
	defer db.Close()

	startReminderDaemon()

	mux := http.NewServeMux()

	// REST API Endpoints
	mux.HandleFunc("GET /api/tasks", enableCORS(getTasksHandler))
	mux.HandleFunc("POST /api/tasks", enableCORS(createTaskHandler))
	mux.HandleFunc("PUT /api/tasks/{id}", enableCORS(updateTaskHandler))
	mux.HandleFunc("DELETE /api/tasks/{id}", enableCORS(deleteTaskHandler))

	// Serve Static Frontend Files from ./public
	fs := http.FileServer(http.Dir("./public"))
	mux.Handle("/", fs)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	fmt.Printf("\n🚀 AetherPlan Go Server running at http://localhost:%s\n", port)
	fmt.Printf("📁 Serving frontend static assets from ./public\n")
	fmt.Printf("💾 Persisting data to SQLite database at ./data/tasks.db\n\n")

	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server stopped: %v", err)
	}
}
